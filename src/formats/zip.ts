import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Findings } from "../core/types.js";
import { isDecoyManifest } from "./axml.js";
import { healDex, isBlaXrefDex } from "./dex.js";
import { healIl2cpp } from "./il2cpp.js";
import { healJvm } from "./jvm.js";
import { healPlist } from "./plist.js";
import type { FormatHealer } from "./types.js";

const MAX_ENTRY = 512 * 1024 * 1024;
const GATE_SCHEMA = "bla-archive-enclave-shield/v1";
const GATE_NAMES = ["assets/bla-shield/bla-attestation-manifest.json", "assets/enclave/bla-attestation-manifest.json"];
const JNI_NAME = "lib/arm64-v8a/libbla_enclave_jni.so";
const JNI_EXPORT = "Java_com_enclave_sgx_TeeAttestationBridge_verifyShamirEd25519QuorumRing";
const MAPPING_MARK = "# bla-shield: decoy mapping";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isZip(_file: string, head: Buffer): boolean {
  return head.length >= 4 && head.readUInt32LE(0) === 0x04034b50;
}

interface Entry {
  name: string;
  method: number;
  usize: number;
  lho: number;
  localLen: number;
  nameLen: number;
  extraLen: number;
  central: Buffer;
  /** Replacement content; `null` drops the entry. */
  data?: Buffer | null;
}

function parse(b: Buffer): { entries: Entry[]; eocd: number } | string {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65535; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "no end-of-central-directory record";
  const count = b.readUInt16LE(eocd + 10);
  const cdOff = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || b.readUInt16LE(eocd + 4) || b.readUInt16LE(eocd + 6)) return "ZIP64 or multi-disk archive";
  const entries: Entry[] = [];
  let pos = cdOff;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || b.readUInt32LE(pos) !== 0x02014b50) return "malformed central directory";
    const flags = b.readUInt16LE(pos + 8);
    const csize = b.readUInt32LE(pos + 20);
    const nameLen = b.readUInt16LE(pos + 28);
    const total = 46 + nameLen + b.readUInt16LE(pos + 30) + b.readUInt16LE(pos + 32);
    const lho = b.readUInt32LE(pos + 42);
    if (flags & 0x9) return "encrypted entries or data descriptors";
    if (csize === 0xffffffff || lho === 0xffffffff || pos + total > eocd || lho + 30 > b.length || b.readUInt32LE(lho) !== 0x04034b50) return "ZIP64 or inconsistent entry";
    const extraLen = b.readUInt16LE(lho + 28);
    const localLen = 30 + b.readUInt16LE(lho + 26) + extraLen + csize;
    if (lho + localLen > cdOff) return "entry data overlaps the central directory";
    entries.push({
      name: b.toString("utf8", pos + 46, pos + 46 + nameLen),
      method: b.readUInt16LE(pos + 10),
      usize: b.readUInt32LE(pos + 24),
      lho,
      localLen,
      nameLen: b.readUInt16LE(lho + 26),
      extraLen,
      central: Buffer.from(b.subarray(pos, pos + total)),
    });
    pos += total;
  }
  entries.sort((x, y) => x.lho - y.lho);
  let end = 0;
  for (const e of entries) {
    if (e.lho !== end) return "gaps, prefixed data or signing blocks between entries";
    end = e.lho + e.localLen;
  }
  if (end !== cdOff) return "gaps, prefixed data or signing blocks between entries";
  return { entries, eocd };
}

function read(b: Buffer, e: Entry): Buffer | undefined {
  if (e.usize > MAX_ENTRY) return undefined;
  const start = e.lho + 30 + e.nameLen + e.extraLen;
  const raw = b.subarray(start, e.lho + e.localLen);
  if (e.method === 0) return raw;
  if (e.method !== 8) return undefined;
  try {
    return inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) });
  } catch {
    return undefined;
  }
}

/**
 * ZIP/JAR/APK healer. In a BLA-hardened archive it drops the planted entries
 * (attestation manifest, canary and stub files, shadow modules, decoy R8 mapping,
 * decoy JNI .so, decoy manifest copies, xref decoy classesN.dex), and heals
 * real members through the DEX, IL2CPP and plist healers. Untouched entries are
 * copied as raw records; the central directory, offsets and EOCD are rebuilt.
 */
export const healZip: FormatHealer = (input, file, opts) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = { output: input, findings: new Findings(), warnings, changed: false };
  const parsed = parse(input);
  if (typeof parsed === "string") {
    if (isZip(file, input)) warnings.push(`${file}: zip not rewritten (${parsed})`);
    return unchanged;
  }
  const { entries, eocd } = parsed;

  const gated = entries.some((e) => {
    if (!GATE_NAMES.includes(e.name)) return false;
    return read(input, e)?.toString("utf8").includes(GATE_SCHEMA) === true;
  });
  const drop = (e: Entry, tech: string, layer: "deceive" | "exhaust", detail: string): void => {
    e.data = null;
    findings.add(layer, tech, detail, 1);
  };

  for (const e of entries) {
    if (e.name.endsWith("/")) continue;
    const lower = e.name.toLowerCase();
    const inShield = e.name.startsWith("assets/bla-shield/") || e.name.startsWith("assets/enclave/");
    const isDex = lower.endsWith(".dex");
    const isMeta = lower.endsWith("global-metadata.dat");
    const isPlistName = lower.endsWith(".plist");
    const isClass = lower.endsWith(".class");
    const isMapping = inShield && /(^|\/)(proguard-)?mapping\.txt$/.test(e.name);
    const isManifestCopy = inShield && /AndroidManifest[^/]*\.xml$/.test(e.name);
    const isJni = e.name === JNI_NAME;
    const generic = gated && (inShield || /^enclave\/shadow_module_[0-9a-f]{6,16}\.json$/.test(e.name));
    if (!(generic || isDex || isMeta || isPlistName || isClass || isMapping || isManifestCopy || isJni)) continue;

    const data = read(input, e);
    if (!data) continue;
    if (isMapping && data.toString("utf8").includes(MAPPING_MARK)) drop(e, "r8-mapping-decoy", "deceive", "removed decoy R8/ProGuard mapping.txt (residual conflicts, malformed bait)");
    else if (isManifestCopy && isDecoyManifest(data)) drop(e, "manifest-decoy", "exhaust", "removed decoy AndroidManifest sidecar (component/intent-filter flood)");
    else if (isJni && data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && data.includes(JNI_EXPORT)) drop(e, "jni-decoy-so", "deceive", "removed decoy libbla_enclave_jni.so with fake Java_* exports");
    else if (isDex && isBlaXrefDex(data)) drop(e, "dex-xref-flood", "exhaust", "removed decoy multidex classesN.dex of Log.d caller classes");
    else if (generic) drop(e, "archive-decoy-entries", "deceive", "removed BLA attestation manifest, canary tokens, stub and shadow-module decoys");
    else {
      const sub = isDex ? healDex : isMeta ? healIl2cpp : isPlistName ? healPlist : isClass ? healJvm : undefined;
      const r = sub?.(data, `${file}!${e.name}`, opts);
      if (r?.changed) {
        e.data = r.output;
        for (const f of r.findings.list()) findings.add(f.layer, f.technique, f.detail, f.count);
        warnings.push(...r.warnings);
      }
    }
  }
  if (!entries.some((e) => e.data !== undefined)) return unchanged;

  if (entries.some((e) => /^META-INF\/[^/]*\.(SF|RSA|DSA|EC)$/i.test(e.name))) warnings.push(`${file}: archive was signed; the signature no longer matches and must be redone`);

  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    if (e.data === null) continue;
    const cd = e.central;
    let local: Buffer;
    if (e.data) {
      const method = e.method === 0 ? 0 : 8;
      const comp = method === 0 ? e.data : deflateRawSync(e.data);
      const head = Buffer.from(input.subarray(e.lho, e.lho + 30 + e.nameLen + e.extraLen));
      const crc = crc32(e.data);
      head.writeUInt16LE(method, 8);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(comp.length, 18);
      head.writeUInt32LE(e.data.length, 22);
      cd.writeUInt16LE(method, 10);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(comp.length, 20);
      cd.writeUInt32LE(e.data.length, 24);
      local = Buffer.concat([head, comp]);
    } else {
      local = input.subarray(e.lho, e.lho + e.localLen);
    }
    cd.writeUInt32LE(offset, 42);
    locals.push(local);
    central.push(cd);
    offset += local.length;
  }
  const tail = Buffer.from(input.subarray(eocd));
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  tail.writeUInt16LE(central.length, 8);
  tail.writeUInt16LE(central.length, 10);
  tail.writeUInt32LE(cdSize, 12);
  tail.writeUInt32LE(offset, 16);
  return { output: Buffer.concat([...locals, ...central, tail]), findings, warnings, changed: true };
};
