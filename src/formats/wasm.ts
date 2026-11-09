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
/**
 * Custom sections toolchains read (WebAssembly tool conventions, DWARF, Emscripten, wasm-bindgen).
 * Anything else carries no meaning for execution.
 */
const KNOWN_CUSTOM = /^(?:name|producers|target_features|linking|reloc\..+|sourceMappingURL|external_debug_info|dylink(?:\.0)?|metadata\.code\..+|build_id|\.debug_.+|emscripten_metadata|__wasm_bindgen_unstable|wasm-bindgen.*|go:.+|rustc.*)$/;
/** No toolchain emits export names this long; BLA's alias flood uses ~12 KB names to exhaust readers. */
const OVERSIZED_EXPORT = 1024;
/** An unknown custom section this large, dwarfing the code, exists only to be read by an analyser. */
const OVERSIZED_CUSTOM = 256 * 1024;

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
  /** Kind byte and index: what the export points at. */
  target: string;
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
    const index = readU32(payload, next + 1); // kind byte, then index
    pos = index.next;
    out.push({ name, target: `${payload[next]}:${index.value}`, raw: payload.subarray(start, pos) });
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
  const unknownDropped: string[] = [];
  let decoyExports = 0;
  let oversizedExports = 0;
  let realExports: string[] | undefined;
  try {
    const sections: { id: number; payload: Buffer; whole: Buffer; name?: string; body?: Buffer }[] = [];
    for (let pos = 8; pos < input.length; ) {
      const id = input[pos]!;
      const size = readU32(input, pos + 1);
      const end = size.next + size.value;
      if (end > input.length) throw new Error("section exceeds module size");
      const payload = input.subarray(size.next, end);
      const s: (typeof sections)[number] = { id, payload, whole: input.subarray(pos, end) };
      if (id === 0) {
        const { name, next } = readName(payload, 0);
        s.name = name;
        s.body = payload.subarray(next);
      }
      sections.push(s);
      pos = end;
    }

    // Evidence that needs no BLA name: an alias flood of absurdly long export names, or an
    // unknown custom section that dwarfs the code. Either proves the module was padded for readers.
    const exportSec = sections.find((s) => s.id === 7);
    const exports = exportSec ? parseExports(exportSec.payload) : [];
    const seen = new Set<string>();
    const oversized = new Set<Export>();
    for (const e of [...exports].sort((a, b) => a.name.length - b.name.length)) {
      if (seen.has(e.target) && Buffer.byteLength(e.name) > OVERSIZED_EXPORT) oversized.add(e);
      seen.add(e.target);
    }
    const codeBytes = sections.filter((s) => s.id !== 0).reduce((n, s) => n + s.payload.length, 0) - (exportSec?.payload.length ?? 0);
    const giant = (s: (typeof sections)[number]) => s.id === 0 && !KNOWN_CUSTOM.test(s.name!) && s.payload.length > OVERSIZED_CUSTOM && s.payload.length > 8 * codeBytes;
    const padded = oversized.size > 0 || sections.some(giant);

    for (const s of sections) {
      if (s.id === 0) {
        const name = s.name!;
        const honeyName = name === "name" && HONEY_NAME.test(s.body!.toString("latin1"));
        if (BLA_CUSTOM.test(name) || honeyName) {
          const key = name.startsWith("enclave.attestation.") ? "enclave.attestation.*" : name;
          dropped.set(key, (dropped.get(key) ?? 0) + 1);
          continue;
        }
        // Custom sections never change what the module does; in a padded module only known ones carry meaning.
        if (padded && !KNOWN_CUSTOM.test(name)) {
          unknownDropped.push(name);
          continue;
        }
      } else if (s.id === 7) {
        const kept = exports.filter((e) => !DECOY_EXPORT.test(e.name) && !oversized.has(e));
        realExports = kept.map((e) => e.name);
        decoyExports = exports.filter((e) => DECOY_EXPORT.test(e.name)).length;
        oversizedExports = exports.length - kept.length - decoyExports;
        if (kept.length < exports.length) {
          parts.push(section(7, Buffer.concat([u32(kept.length), ...kept.map((e) => e.raw)])));
          continue;
        }
      }
      parts.push(s.whole);
    }
  } catch (err) {
    warnings.push(`wasm parse failed (${(err as Error).message}); left unchanged`);
    return unchanged();
  }

  if (dropped.size === 0 && decoyExports === 0 && oversizedExports === 0 && unknownDropped.length === 0) return unchanged();
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
  if (unknownDropped.length) {
    findings.add("exhaust", "wasm-unknown-custom", "removed non-tool custom sections from a module padded for readers (custom sections never affect execution)", unknownDropped.length);
    warnings.push(`removed custom sections ${[...new Set(unknownDropped)].join(", ")}; JS that reads them through WebAssembly.Module.customSections() would see them gone`);
  }
  if (oversizedExports > 0) findings.add("exhaust", "wasm-oversized-exports", `removed export aliases with names over ${OVERSIZED_EXPORT} bytes`, oversizedExports);
  if (decoyExports > 0) findings.add("exhaust", "wasm-decoy-exports", "removed decoy WASM exports aliasing real functions", decoyExports);
  if (decoyExports > 0 || oversizedExports > 0) warnings.push(`real exports: ${realExports?.join(", ") || "(none)"}`);
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
