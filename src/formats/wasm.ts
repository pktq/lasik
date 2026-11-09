import { gunzipSync, gzipSync } from "node:zlib";
import { Findings } from "../core/types.js";
import type { FormatHealer, FormatHealResult } from "./types.js";

const MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

/** Custom sections BLA adds: manifests, fake attestations, canaries, interface-exhaustion payloads. */
const BLA_CUSTOM = /^(?:bla\.|enclave\.attestation\.\d+$)/;
/** Decoy exports that alias real function indices to blow REA's interface budget. */
const DECOY_EXPORT = /^(?:enclave_export_[0-9a-f]+_\d+_|bla_enclave_verify_zero_trust_merkle_slot_)/;
/** Markers of BLA's honey `name` section (decoy module name / symbol names). */
const HONEY_NAME = /tee_hardware_enclave_transport_stub_|enclave_export_|bla_enclave_/;
/** v9 renames real exports to `ops_<hex>_...`; the originals are not recoverable. */
const RENAMED_EXPORT = /^ops_[0-9a-f]+_/;

function readU32(buf: Buffer, pos: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos++];
    if (b === undefined) throw new Error("truncated LEB128");
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, next: pos };
    shift += 7;
  }
  throw new Error("LEB128 too long");
}

function u32(value: number): Buffer {
  const out: number[] = [];
  do {
    let b = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) b |= 0x80;
    out.push(b);
  } while (value !== 0);
  return Buffer.from(out);
}

function readName(buf: Buffer, pos: number): { name: string; next: number } {
  const len = readU32(buf, pos);
  const end = len.next + len.value;
  if (end > buf.length) throw new Error("truncated name");
  return { name: buf.subarray(len.next, end).toString("utf8"), next: end };
}

function section(id: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([id]), u32(payload.length), payload]);
}

interface Export {
  name: string;
  raw: Buffer;
}

function parseExports(payload: Buffer): Export[] {
  const count = readU32(payload, 0);
  let pos = count.next;
  const out: Export[] = [];
  for (let i = 0; i < count.value; i++) {
    const start = pos;
    const { name, next } = readName(payload, pos);
    if (payload[next] === undefined) throw new Error("truncated export");
    pos = readU32(payload, next + 1).next; // kind byte, then index
    out.push({ name, raw: payload.subarray(start, pos) });
  }
  if (pos !== payload.length) throw new Error("export section size mismatch");
  return out;
}

function healModule(input: Buffer): FormatHealResult {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = (): FormatHealResult => ({ output: input, findings: new Findings(), warnings, changed: false });
  if (input.length < 8 || !input.subarray(0, 4).equals(MAGIC)) return unchanged();

  const parts: Buffer[] = [input.subarray(0, 8)];
  const dropped = new Map<string, number>();
  let decoyExports = 0;
  let realExports: string[] | undefined;
  try {
    let pos = 8;
    while (pos < input.length) {
      const id = input[pos]!;
      const size = readU32(input, pos + 1);
      const end = size.next + size.value;
      if (end > input.length) throw new Error("section exceeds module size");
      const payload = input.subarray(size.next, end);
      const whole = input.subarray(pos, end);
      pos = end;

      if (id === 0) {
        const { name, next } = readName(payload, 0);
        const honeyName = name === "name" && HONEY_NAME.test(payload.subarray(next).toString("latin1"));
        if (BLA_CUSTOM.test(name) || honeyName) {
          const key = name.startsWith("enclave.attestation.") ? "enclave.attestation.*" : name;
          dropped.set(key, (dropped.get(key) ?? 0) + 1);
          continue;
        }
      } else if (id === 7) {
        const exports = parseExports(payload);
        const kept = exports.filter((e) => !DECOY_EXPORT.test(e.name));
        realExports = kept.map((e) => e.name);
        decoyExports = exports.length - kept.length;
        if (decoyExports > 0) {
          parts.push(section(7, Buffer.concat([u32(kept.length), ...kept.map((e) => e.raw)])));
          continue;
        }
      }
      parts.push(whole);
    }
  } catch (err) {
    warnings.push(`wasm parse failed (${(err as Error).message}); left unchanged`);
    return unchanged();
  }

  if (dropped.size === 0 && decoyExports === 0) return unchanged();
  const output = Buffer.concat(parts);
  if (!WebAssembly.validate(new Uint8Array(output))) {
    if (WebAssembly.validate(new Uint8Array(input))) {
      warnings.push("healed wasm failed validation; left unchanged");
      return unchanged();
    }
    warnings.push("input wasm does not validate in this Node build; healed output not validated");
  }

  for (const [name, count] of dropped) {
    const layer = name === "bla.wasm.interface.exhaustion" ? "exhaust" : name === "bla.sidecar.v1" ? "entangle" : "deceive";
    findings.add(layer, `wasm-custom:${name}`, `removed BLA custom section "${name}"`, count);
  }
  if (dropped.has("bla.sidecar.v1")) {
    warnings.push("removed the bla.sidecar.v1 binding note; BLA's host-side sidecar verify will no longer pass on this module (intended)");
  }
  if (decoyExports > 0) {
    findings.add("exhaust", "wasm-decoy-exports", "removed decoy WASM exports aliasing real functions", decoyExports);
    warnings.push(`real exports: ${realExports?.join(", ") || "(none)"}`);
  }
  if (realExports?.some((n) => RENAMED_EXPORT.test(n))) {
    warnings.push("BLA renamed real exports to ops_<hex>_*; original export names are not recoverable (see the JS glue for how they are called)");
  }
  return { output, findings, warnings, changed: true };
}

/** Strip BLA's decoy custom sections and alias exports from a wasm module (raw or gzipped). Never instantiates it. */
export const healWasm: FormatHealer = (input) => {
  if (input[0] !== 0x1f || input[1] !== 0x8b) return healModule(input);
  let raw: Buffer;
  try {
    raw = gunzipSync(input);
  } catch (err) {
    return { output: input, findings: new Findings(), warnings: [`gunzip failed: ${(err as Error).message}`], changed: false };
  }
  const res = healModule(raw);
  return res.changed ? { ...res, output: gzipSync(res.output, { level: 9 }) } : { ...res, output: input };
};
