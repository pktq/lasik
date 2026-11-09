import { Findings } from "../core/types.js";
import type { FormatHealer, FormatHealResult } from "./types.js";

/** Metadata keys BLA adds to safetensors `__metadata__` (BLA model.ts:232-259). */
const ST_META = /^(?:enclave\.(?:delegation\.(?:status|notice)|manifest\.\d+|canary\.(?:token|transport)\.\d+|diagnostic\.\d+)|bla\.shield\.signature)$/;
const ST_SIGNATURE = /^BLA-MODEL-SHIELD-[0-9a-f]{8}$/;
const SEAL = "enclave_topology_seal";
const SEAL_NOTICE = "BLA Counter-REA JSON nesting breaker";
/** GGUF KV entries BLA appends (BLA model.ts:420-492). */
const GGUF_CANARY = /^enclave\.(?:canary\.(?:token|transport)|diagnostic)\.\d+$/;
const GGUF_DESC_PREFIX = "[BLA-MODEL-SHIELD] ";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const unchanged = (input: Buffer, warnings: string[] = [], findings = new Findings()): FormatHealResult => ({ output: input, findings, warnings, changed: false });

export function isSafetensors(file: string, head: Buffer): boolean {
  if (file.toLowerCase().endsWith(".safetensors")) return true;
  // Same magic rule as BLA's detector: u64 LE header length, then `{"`.
  return head.length >= 10 && head[8] === 0x7b && head[9] === 0x22 && head.readUInt32LE(4) === 0 && head.readUInt32LE(0) > 2 && head.readUInt32LE(0) < 100_000_000;
}

export function isGguf(_file: string, head: Buffer): boolean {
  return head.length >= 4 && head.subarray(0, 4).toString("latin1") === "GGUF";
}

/** True when the value is BLA's nested `{layer, next}` chain ending in its notice. */
function isSeal(v: unknown): boolean {
  for (let depth = 0; isRecord(v) && depth < 10_000; depth++) {
    if (v.notice === SEAL_NOTICE && v.kind === "enclave_topology") return true;
    v = v.next;
  }
  return false;
}

/** Strip BLA honey metadata and the JSON nesting breaker from a safetensors header. Tensor bytes are copied untouched. */
export const healSafetensors: FormatHealer = (input) => {
  if (input.length < 10) return unchanged(input);
  const len = input.readBigUInt64LE(0);
  if (len > BigInt(input.length - 8)) return unchanged(input);
  const end = 8 + Number(len);
  const text = input.subarray(8, end).toString("utf8").replace(/ +$/, "");
  let header: unknown;
  try {
    header = JSON.parse(text);
  } catch {
    return unchanged(input);
  }
  if (!isRecord(header)) return unchanged(input);
  const meta = isRecord(header.__metadata__) ? header.__metadata__ : undefined;
  const sealed = Object.keys(header).filter((k) => k !== "__metadata__" && isRecord(header[k]) && isSeal((header[k] as Json)[SEAL]));
  const signed = !!meta && (ST_SIGNATURE.test(String(meta["bla.shield.signature"])) || meta["enclave.delegation.status"] === "HARDWARE_TEE_SPLIT_WEIGHTS");
  if (!signed && sealed.length === 0) return unchanged(input);

  const findings = new Findings();
  // BLA re-serialises with JSON.stringify (model.ts:127); anything else was edited later and we can't prove a lossless rewrite.
  if (JSON.stringify(header) !== text) {
    findings.add("deceive", "model-honey-metadata", "BLA model shield detected; header not in BLA's serialised form, left unchanged");
    return unchanged(input, ["safetensors header is not in BLA's canonical JSON form; left unchanged"], findings);
  }

  let metaRemoved = 0;
  if (signed && meta) {
    for (const k of Object.keys(meta)) {
      if (ST_META.test(k)) {
        delete meta[k];
        metaRemoved++;
      }
    }
    // BLA appends a new __metadata__ last (model.ts:261); a real one is written first.
    if (Object.keys(meta).length === 0 && Object.keys(header)[0] !== "__metadata__") delete header.__metadata__;
  }
  for (const k of sealed) delete (header[k] as Json)[SEAL];

  const raw = Buffer.from(JSON.stringify(header), "utf8");
  const json = Buffer.alloc(Math.ceil(raw.length / 8) * 8, 0x20);
  raw.copy(json);
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(json.length));
  findings.add("deceive", "model-honey-metadata", "removed BLA enclave.* / bla.shield.* metadata (chaff, canary tokens, fake diagnostics)", metaRemoved);
  findings.add("exhaust", "model-nesting-breaker", "removed BLA enclave_topology_seal JSON nesting breaker", sealed.length);
  return { output: Buffer.concat([prefix, json, input.subarray(end)]), findings, warnings: [], changed: true };
};

const FIXED: Readonly<Record<number, number>> = { 0: 1, 1: 1, 7: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 10: 8, 11: 8, 12: 8 };

function u64(b: Buffer, at: number): number {
  if (at + 8 > b.length) throw new Error("truncated");
  const v = b.readBigUInt64LE(at);
  if (v > BigInt(b.length)) throw new Error("length exceeds file");
  return Number(v);
}

function skipValue(b: Buffer, at: number, type: number, depth: number): number {
  const need = (end: number) => {
    if (end > b.length) throw new Error("truncated value");
    return end;
  };
  const size = FIXED[type];
  if (size !== undefined) return need(at + size);
  if (type === 8) return need(at + 8 + u64(b, at));
  if (type !== 9 || depth > 1000) throw new Error(`unsupported GGUF value type ${type}`);
  need(at + 12);
  const elem = b.readUInt32LE(at);
  const count = u64(b, at + 4);
  at += 12;
  const es = FIXED[elem];
  if (es !== undefined) return need(at + count * es);
  for (let i = 0; i < count; i++) at = skipValue(b, at, elem, depth + 1);
  return at;
}

/** Strip BLA's metadata KV entries (incl. the 35-deep `enclave.nesting.breaker`) from a GGUF v2/v3 file. */
export const healGguf: FormatHealer = (input) => {
  if (input.length < 24 || !isGguf("", input)) return unchanged(input);
  const version = input.readUInt32LE(4);
  if (version !== 2 && version !== 3) return unchanged(input);
  const tensorCount = input.readBigUInt64LE(8);
  const kv: { key: string; raw: Buffer; drop: "nest" | "honey" | "canary" | undefined }[] = [];
  let pos = 24;
  try {
    const kvCount = u64(input, 16);
    for (let i = 0; i < kvCount; i++) {
      const start = pos;
      const keyLen = u64(input, pos);
      if (pos + 12 + keyLen > input.length) throw new Error("truncated key");
      const key = input.subarray(pos + 8, pos + 8 + keyLen).toString("utf8");
      const type = input.readUInt32LE(pos + 8 + keyLen);
      const valAt = pos + 12 + keyLen;
      pos = skipValue(input, valAt, type, 0);
      const str = type === 8 ? input.subarray(valAt + 8, pos).toString("utf8") : undefined;
      const drop =
        key === "enclave.nesting.breaker" && type === 9 ? "nest"
        : key === "enclave.delegation.manifest" && type === 8 ? "honey"
        : key === "general.description" && str?.startsWith(GGUF_DESC_PREFIX) ? "honey"
        : GGUF_CANARY.test(key) && type === 8 ? "canary"
        : undefined;
      kv.push({ key, raw: input.subarray(start, pos), drop });
    }
  } catch (err) {
    const marked = input.includes("enclave.nesting.breaker");
    return unchanged(input, marked ? [`gguf parse failed (${(err as Error).message}); left unchanged`] : []);
  }
  // The canary/diagnostic keys are only proof of BLA alongside one of its unambiguous markers.
  if (!kv.some((e) => e.drop === "nest" || e.drop === "honey")) return unchanged(input);

  const kept = kv.filter((e) => !e.drop);
  let trailing = input.subarray(pos);
  // With no tensor records BLA pads the file to 32 bytes (model.ts:509-512).
  if (tensorCount === 0n && trailing.length < 32 && input.length % 32 === 0 && trailing.every((x) => x === 0)) trailing = trailing.subarray(0, 0);
  const header = Buffer.from(input.subarray(0, 24));
  header.writeBigUInt64LE(BigInt(kept.length), 16);

  const findings = new Findings();
  const count = (d: string) => kv.filter((e) => e.drop === d).length;
  findings.add("exhaust", "model-nesting-breaker", "removed BLA enclave.nesting.breaker (35 nested GGUF arrays)", count("nest"));
  findings.add("deceive", "model-honey-metadata", "removed BLA chaff metadata (enclave.delegation.manifest, [BLA-MODEL-SHIELD] description)", count("honey"));
  findings.add("deceive", "model-canary-metadata", "removed BLA canary token / transport / fake diagnostic metadata", count("canary"));
  const warnings: string[] = [];
  if (kept.length === 0 && tensorCount === 0n && trailing.length === 0) {
    warnings.push("GGUF held only BLA metadata: BLA replaces unparseable input with a synthetic GGUF, so the original file is not recoverable");
  }
  return { output: Buffer.concat([header, ...kept.map((e) => e.raw), trailing]), findings, warnings, changed: true };
};
