import { Findings } from "../core/types.js";
import { FUSE_SENTINEL, healFuseSentinels } from "./electron-fuses.js";
import type { FormatHealer } from "./types.js";

/** native.ts protectNativeBinary: every shield trailer starts with this, appended at EOF. */
const TRAILER_HEAD = Buffer.from("\0[BLA-NATIVE-SHIELD-V1]\0.dep-v0\0", "latin1");
/** 68 rustc lines follow the head, `i` as 8 hex digits then 32 random hex (MAX_RUSTC_HASHES flood). */
const RUSTC_LINE = /\/rustc\/([0-9a-f]{8})[0-9a-f]{32}\/library\/core\/src\/enclave_guard\.rs\0/y;
const RUSTC_LINES = 68;
/** go-flutter-exhaustion.ts GO_MAGIC (`\xff Go buildinf:`), then ptrSize 8 and flags 2. */
const GO_MAGIC = Buffer.from("ff20476f206275696c64696e663a0802", "hex");
/** headers.ts compiled-in `/rustc/` anchors (C: one per chaff string, Rust: 66 in BLA_RUSTC_OVERFLOW_TABLE). */
const HEADER_ANCHOR = /\/rustc\/([0-9a-f]{8})[0-9a-f]{32}\/library\/core\/src\/enclave\.rs/g;
/** headers.ts symbols of compiled decoy tarpit functions / tables (code: not removable without relinking). */
const HEADER_SYMBOLS = /enclave_tarpit_fn_\d+|enclave_keep_(?:fn|data)_table|BLA_RUSTC_OVERFLOW_TABLE|EnclaveTarpit\d+/g;
const GO_MAPPED = /\[BLA-GO-MAPPED|github\.com\/bla\/mapped-buildinfo/;
/** uvarint(GO_MAX_BUILD_INFO_BYTES + 1): the bankrupt plant's oversized length claim. */
const GO_BANKRUPT_CLAIM = Buffer.from([0x81, 0x80, 0x40]);
const FLUTTER_MAPPED = Buffer.from("\0[BLA-FLUTTER-MAPPED]\0", "latin1");
const DART_MAGIC = Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]);

export function isNative(_file: string, head: Buffer): boolean {
  if (head.length < 8) return false;
  const be = head.readUInt32BE(0);
  if (be === 0x7f454c46) return true; // ELF
  if (head[0] === 0x4d && head[1] === 0x5a) return true; // PE (MZ)
  if (be === 0xfeedface || be === 0xfeedfacf || be === 0xcefaedfe || be === 0xcffaedfe) return true;
  // Universal Mach-O shares 0xcafebabe with Java classes; fat headers have few arches, classes a major >= 45.
  const nfat = head.readUInt32BE(4);
  return be === 0xcafebabe && nfat >= 1 && nfat <= 30;
}

function count(hay: Buffer, needle: Buffer | string): number {
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) n++;
  return n;
}

/** Offset where BLA's native shield trailer starts, proven by its exact head, rustc run and Go frame. */
function findTrailer(b: Buffer): number {
  for (let at = b.indexOf(TRAILER_HEAD); at >= 0; at = b.indexOf(TRAILER_HEAD, at + 1)) {
    const text = b.toString("latin1", at, Math.min(b.length, at + TRAILER_HEAD.length + RUSTC_LINES * 82 + 64));
    RUSTC_LINE.lastIndex = TRAILER_HEAD.length;
    let i = 0;
    for (let m; i < RUSTC_LINES && (m = RUSTC_LINE.exec(text)) && parseInt(m[1]!, 16) === i; ) i++;
    const go = at + RUSTC_LINE.lastIndex;
    if (i === RUSTC_LINES && b.subarray(go, go + 16).every((x) => x === 0) && b.subarray(go + 16, go + 32).equals(GO_MAGIC)) return at;
  }
  return -1;
}

interface Section {
  name: string;
  type: number;
  addr: bigint;
  offset: number;
  size: number;
}

/** ELF64 little-endian section headers with names; undefined when the table is malformed. */
function elf64Sections(b: Buffer): Section[] | undefined {
  if (b.length < 64 || b.readUInt32BE(0) !== 0x7f454c46 || b[4] !== 2 || b[5] !== 1) return undefined;
  const shoff = Number(b.readBigUInt64LE(40));
  const entsize = b.readUInt16LE(58);
  const num = b.readUInt16LE(60);
  const strndx = b.readUInt16LE(62);
  if (num === 0) return [];
  if (entsize < 64 || strndx >= num || shoff + num * entsize > b.length) return undefined;
  const raw = Array.from({ length: num }, (_, i) => {
    const h = shoff + i * entsize;
    return {
      nameOff: b.readUInt32LE(h),
      type: b.readUInt32LE(h + 4),
      addr: b.readBigUInt64LE(h + 16),
      offset: Number(b.readBigUInt64LE(h + 24)),
      size: Number(b.readBigUInt64LE(h + 32)),
    };
  });
  const str = raw[strndx]!;
  if (str.offset + str.size > b.length) return undefined;
  const strtab = b.subarray(str.offset, str.offset + str.size);
  return raw.map((s) => {
    const end = strtab.indexOf(0, s.nameOff);
    const name = s.nameOff < strtab.length ? strtab.toString("latin1", s.nameOff, end < 0 ? strtab.length : end) : "";
    return { name, type: s.type, addr: s.addr, offset: s.offset, size: s.size };
  });
}

/** PE optional-header CheckSum (same algorithm as imagehlp CheckSumMappedFile). */
function peChecksum(b: Buffer, field: number): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 2) {
    if (i === field || i === field + 2) continue;
    sum += i + 1 < b.length ? b.readUInt16LE(i) : b[i]!;
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  return (((sum & 0xffff) + (sum >>> 16)) + b.length) >>> 0;
}

/**
 * Native binary healer (ELF / PE / Mach-O), mirroring BLA native.ts protectNativeBinary:
 * 1. cuts the `[BLA-NATIVE-SHIELD-V1]` EOF trailer (rustc-hash, Go buildinfo, decoy fuse,
 *    Dart snapshot/pool floods, chaff, canaries, cognitive-armor text, `.dep-v0` decoy);
 *    BLA only appended it, so the prefix is the original binary byte for byte;
 * 2. zeroes BLA's in-place plants in ELF `.go.buildinfo` / `.isolate` (BLA overwrote the
 *    originals, so they are reported unrecoverable);
 * 3. blanks compiled-in headers.ts `/rustc/...enclave.rs` anchors past their first byte
 *    (the only byte BLA's tarpits read);
 * 4. falls back to the EOF decoy fuse-sentinel healer.
 */
export const healNative: FormatHealer = (input, file, opts) => {
  const findings = new Findings();
  const warnings: string[] = [];
  let out = input;

  const cut = findTrailer(input);
  if (cut >= 0) {
    const trailer = input.subarray(cut);
    const prefix = input.subarray(0, cut);
    const elf = prefix.readUInt32BE(0) === 0x7f454c46 && prefix[4] === 2 ? elf64Sections(prefix) : [];
    if (elf === undefined) {
      warnings.push(`${file}: BLA native trailer found but the ELF section table does not fit before it; left unchanged`);
    } else {
      out = Buffer.from(prefix);
      findings.add("exhaust", "native-shield-trailer", "removed BLA native shield trailer appended at EOF", 1);
      findings.add("exhaust", "rustc-hash-flood", "removed decoy /rustc/<hash>/ strings past REA's MAX_RUSTC_HASHES", RUSTC_LINES);
      findings.add("exhaust", "go-buildinfo-flood", "removed framed decoy Go buildinfo + pclntab bait", 1);
      findings.add("exhaust", "decoy-fuse-sentinels", "removed decoy Electron fuse sentinel records (sentinel-limit flood)", count(trailer, FUSE_SENTINEL));
      findings.add("exhaust", "dart-snapshot-flood", "removed decoy Dart snapshot headers and package:/dart: pool flood", count(trailer, DART_MAGIC));
      findings.add("deceive", "native-decoy-strings", "removed canary credentials, decoy endpoints, diagnostics and chaff manifests", count(trailer, "PROTECTED_CANARY_CREDENTIAL=") + count(trailer, "TRANSPORT_ENDPOINT=") + count(trailer, " Remediation: "));
      findings.add("prompt", "cognitive-armor", "removed LLM-classifier trigger text", count(trailer, "[COGNITIVE_ARMOR_INTERLOCK:"));
      findings.add("deceive", "rust-auditable-decoy", "removed decoy cargo-auditable .dep-v0 dependency graph", 1);
    }
  }

  // In-place ELF plants (BLA writes into existing sections and never touches headers).
  let inPlace = false;
  const sections = elf64Sections(out) ?? [];
  const mutable = (): Buffer => (out === input ? (out = Buffer.from(input)) : out);
  for (const s of sections) {
    if (s.type !== 1 || s.offset + s.size > out.length) continue;
    if (s.name === ".go.buildinfo" && s.size >= 48) {
      const at = s.offset + Number((16n - (s.addr % 16n)) % 16n);
      const body = out.subarray(s.offset, s.offset + s.size);
      const planted =
        out.subarray(at, at + 16).equals(GO_MAGIC) &&
        (GO_MAPPED.test(body.toString("latin1")) || out.subarray(at + 32, at + 35).equals(GO_BANKRUPT_CLAIM));
      if (planted) {
        mutable().fill(0, s.offset, s.offset + s.size);
        inPlace = true;
        findings.add("exhaust", "go-buildinfo-mapped-plant", "zeroed decoy Go buildinfo BLA planted in .go.buildinfo", 1);
        warnings.push(`${file}: BLA zeroed the real .go.buildinfo before planting; original Go version/module info is unrecoverable (section left zeroed)`);
      }
    } else if (s.name === ".isolate" && s.size >= 64) {
      const plant = s.offset + 52; // BLA's marker sits right after a 52-byte snapshot header in both modes
      if (!out.subarray(plant, plant + FLUTTER_MAPPED.length).equals(FLUTTER_MAPPED)) continue;
      // A header with length 64 / kind 3 is BLA's own fake; a real snapshot header is kept.
      const fakeHeader = out.subarray(s.offset, s.offset + 4).equals(DART_MAGIC) && out.readBigUInt64LE(s.offset + 4) === 64n && out.readBigUInt64LE(s.offset + 12) === 3n;
      mutable().fill(0, fakeHeader ? s.offset : plant, s.offset + s.size);
      inPlace = true;
      findings.add("exhaust", "flutter-pool-mapped-plant", "zeroed decoy Dart package:/dart:/class pool BLA planted in .isolate", 1);
      warnings.push(`${file}: BLA overwrote the .isolate snapshot body with its pool plant; the original isolate data is unrecoverable (plant zeroed)`);
    }
  }

  // headers.ts anchors: require the run of indices 0..n-1 that BLA emits.
  const text = out.toString("latin1");
  const anchors = [...text.matchAll(HEADER_ANCHOR)];
  const idx = new Set(anchors.map((m) => parseInt(m[1]!, 16)));
  if (idx.size >= 2 && [...idx].every((i) => i < idx.size)) {
    const buf = mutable();
    for (const m of anchors) buf.fill(0, m.index! + 1, m.index! + m[0].length);
    inPlace = true;
    findings.add("exhaust", "rustc-hash-flood", "blanked compiled-in BLA header /rustc/ anchors (first byte kept for the tarpits that read it)", anchors.length);
  }
  const tarpits = new Set(text.match(HEADER_SYMBOLS) ?? []);
  if (tarpits.size > 0) {
    findings.add("tarpit", "native-header-tarpit", "compiled BLA shield-header decoy functions/tables present (code kept; removal needs relinking)", tarpits.size);
  }

  if (inPlace) {
    const lfanew = out.length >= 0x40 && out[0] === 0x4d && out[1] === 0x5a ? out.readUInt32LE(0x3c) : -1;
    const field = lfanew + 24 + 64;
    if (lfanew > 0 && field + 4 <= out.length && out.readUInt32LE(lfanew) === 0x4550 && out.readUInt32LE(field) !== 0) {
      out.writeUInt32LE(peChecksum(out, field), field);
    }
    if (out[0] !== 0x7f) {
      warnings.push(`${file}: bytes changed in place; an existing code signature no longer matches (re-sign before running)`);
    }
  }

  const fuses = healFuseSentinels(out, file, opts);
  if (fuses.changed) {
    out = fuses.output;
    for (const f of fuses.findings.list()) findings.add(f.layer, f.technique, f.detail, f.count);
  }
  const changed = out !== input;
  return { output: out, findings, warnings, changed };
};
