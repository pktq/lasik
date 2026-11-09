import { extname } from "node:path";
import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/**
 * CPython `.pyc`: 16-byte header (magic, PEP 552 flags, mtime+size or source
 * hash), then one marshalled code object. BLA adds two things:
 *  - a trailer of TYPE_ASCII honey records after the root object (marshal.loads
 *    ignores trailing bytes, so importlib never sees them);
 *  - with weaveDecoys, a re-marshal of the root WITHOUT FLAG_REF that appends
 *    unused `return None` decoy code objects to every co_consts tuple.
 * Both are undone here by splicing bytes; the header (flags/hash/mtime) is kept,
 * since it binds to the source file, not to the pyc body.
 */

type Layout = "py38" | "py311";
interface Version {
  layout: Layout;
  /** Opcode table, needed to prove no instruction loads a decoy const. Absent: detect only. */
  ops?: { extendedArg: number; hasConst: number[] };
}

/**
 * Release magic numbers only (pycore_magic_number.h); pre-release builds may use other
 * opcode tables. EXTENDED_ARG and `dis.hasconst` checked against CPython 3.9, 3.10,
 * 3.12 and 3.14; 3.8 and 3.11 tables from their `opcode.py` (unchanged LOAD_CONST /
 * EXTENDED_ARG; 3.11 adds KW_NAMES). 3.13 renumbered opcodes and is not verified here.
 */
const OPS: Record<number, Version["ops"]> = {
  3413: { extendedArg: 144, hasConst: [100] }, // 3.8
  3425: { extendedArg: 144, hasConst: [100] }, // 3.9
  3439: { extendedArg: 144, hasConst: [100] }, // 3.10
  3495: { extendedArg: 144, hasConst: [100, 172] }, // 3.11
  3531: { extendedArg: 144, hasConst: [100, 121, 172] }, // 3.12
  3627: { extendedArg: 69, hasConst: [82, 190, 191] }, // 3.14 (+ LOAD_CONST specialisations)
};

function versionFor(magic: number): Version | undefined {
  if (magic >= 3400 && magic <= 3439) return { layout: "py38", ops: OPS[magic] };
  if (magic >= 3450 && magic <= 3699) return { layout: "py311", ops: OPS[magic] };
  return undefined;
}

export function isPyc(file: string, head: Buffer): boolean {
  return extname(file).toLowerCase() === ".pyc" && head.length >= 16 && head[2] === 0x0d && head[3] === 0x0a;
}

/** Stems BLA's pyc weave names decoys from (`python-pyc-weave.ts`), suffixed `_NNNN`. */
const DECOY_NAME = new RegExp(
  "^(?:" +
    [
      "reconcile_invoice_batch", "hydrate_session_cache", "flush_telemetry_buffer", "normalize_locale_bundle",
      "schedule_backoff_retry", "compact_wal_segment", "project_catalog_facet", "bind_worker_pool_slot",
      "materialize_report_cursor", "encode_transport_frame", "observe_metric_histogram", "adapt_gateway_policy",
      "reduce_pipeline_shard", "capture_audit_sample", "prime_connection_pool", "transform_lookup_vector",
      "verify_enclave_attestation", "derive_hardware_kdf_schedule", "authenticate_tpm_quote_digest",
      "negotiate_vsock_channel_cipher", "synchronize_hsm_key_slot", "unseal_protected_memory_page",
    ].join("|") +
    ")_\\d{4}$",
);
const TRAILER_MARK = /^(?:PROTECTED_CANARY_CREDENTIAL=|TRANSPORT_ENDPOINT=)/;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
/** BLA's string encoding: TYPE_SHORT_ASCII for <= 255 UTF-8 bytes, else TYPE_ASCII. */
const blaStr = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([b.length <= 255 ? Buffer.from([0x7a, b.length]) : Buffer.concat([Buffer.from([0x61]), u32(b.length)]), b]);
};
const emptyBytes = Buffer.from([0x73, 0, 0, 0, 0]);
const emptyTuple = Buffer.from([0x29, 0]);

/** Exact bytes of BLA's `buildDecoyCode` as BLA encodes it. */
function decoyBytes(layout: Layout, name: string, filename: string): Buffer {
  const z = u32(0);
  return Buffer.concat([
    Buffer.from([0x63]), z, z, z, ...(layout === "py311" ? [] : [z]), u32(1), u32(0x40),
    Buffer.from([0x73, 4, 0, 0, 0, 0x64, 0x00, 0x53, 0x00]), // co_code: LOAD_CONST 0; RETURN_VALUE
    Buffer.from([0x29, 1, 0x4e]), // co_consts (None,)
    emptyTuple, // co_names
    ...(layout === "py311" ? [emptyTuple, emptyBytes] : [emptyTuple, emptyTuple, emptyTuple]),
    blaStr(filename), blaStr(name), ...(layout === "py311" ? [blaStr(name)] : []),
    u32(1), emptyBytes, ...(layout === "py311" ? [emptyBytes] : []),
  ]);
}

interface CodeInfo {
  code?: [number, number]; // co_code payload
  consts?: { at: number; small: boolean; items: [number, number][] };
  filename?: string;
}

/** Walks one marshal object; records code-object layout. Throws on anything malformed. */
class Walker {
  refs = false;
  codes: CodeInfo[] = [];
  /** Unflagged ASCII-typed strings holding non-ASCII bytes: [start, payload start, end]. */
  mojibake: [number, number, number][] = [];
  constructor(
    private readonly b: Buffer,
    private readonly layout: Layout,
  ) {}

  private need(o: number, n: number): number {
    if (o + n > this.b.length) throw new Error("truncated marshal data");
    return o + n;
  }

  obj(o: number): number {
    const b = this.b;
    this.need(o, 1);
    const raw = b[o]!;
    if (raw & 0x80) this.refs = true;
    const t = String.fromCharCode(raw & 0x7f);
    const n32 = () => (this.need(o + 1, 4), b.readUInt32LE(o + 1));
    switch (t) {
      case "N": case "F": case "T": case "S": case ".": return o + 1;
      case "i": return this.need(o, 5);
      case "I": case "g": return this.need(o, 9);
      case "y": return this.need(o, 17);
      case "f": return this.need(o, 2 + (this.need(o, 2), b[o + 1]!));
      case "x": { const r = this.need(o, 2 + (this.need(o, 2), b[o + 1]!)); return this.need(r, 1 + (this.need(r, 1), b[r]!)); }
      case "l": return this.need(o, 5 + Math.abs((n32(), b.readInt32LE(o + 1))) * 2);
      case "s": case "t": case "u": case "a": case "A": return this.ascii(raw, o, 5, this.need(o, 5 + n32()));
      case "z": case "Z": return this.ascii(raw, o, 2, this.need(o, 2 + (this.need(o, 2), b[o + 1]!)));
      case "r": this.refs = true; return this.need(o, 5);
      case ")": return this.items(o + 2, (this.need(o, 2), b[o + 1]!));
      case "(": case "[": case "<": case ">": return this.items(o + 5, n32());
      case "{": {
        let p = o + 1;
        while ((this.need(p, 1), b[p]! & 0x7f) !== 0x30) p = this.obj(this.obj(p));
        return p + 1;
      }
      case "c": return this.code(o);
      default: throw new Error(`unsupported marshal type 0x${raw.toString(16)}`);
    }
  }

  private ascii(raw: number, o: number, head: number, e: number): number {
    if ((raw === 0x61 || raw === 0x7a) && this.b.subarray(o + head, e).some((c) => c > 0x7f)) this.mojibake.push([o, o + head, e]);
    return e;
  }

  private items(p: number, n: number, out?: [number, number][]): number {
    for (let i = 0; i < n; i++) {
      const e = this.obj(p);
      out?.push([p, e]);
      p = e;
    }
    return p;
  }

  private str(o: number, e: number): string | undefined {
    const t = String.fromCharCode(this.b[o]!);
    if ("zZ".includes(t)) return this.b.toString("utf8", o + 2, e);
    if ("tuaA".includes(t)) return this.b.toString("utf8", o + 5, e);
    return undefined;
  }

  private code(o: number): number {
    const info: CodeInfo = {};
    this.codes.push(info);
    let p = this.need(o, 1 + (this.layout === "py311" ? 20 : 24));
    const codeAt = p;
    p = this.obj(p);
    if (this.b[codeAt] === 0x73) info.code = [codeAt + 5, p];
    const c = this.b[p];
    if (c === 0x29 || c === 0x28) {
      const small = c === 0x29;
      info.consts = { at: p, small, items: [] };
      this.need(p, small ? 2 : 5);
      p = this.items(p + (small ? 2 : 5), small ? this.b[p + 1]! : this.b.readUInt32LE(p + 1), info.consts.items);
    } else p = this.obj(p);
    p = this.obj(p); // names
    p = this.layout === "py311" ? this.obj(this.obj(p)) : this.obj(this.obj(this.obj(p)));
    const fn = p;
    p = this.obj(p);
    info.filename = this.str(fn, p);
    p = this.obj(p); // name
    if (this.layout === "py311") p = this.obj(p); // qualname
    p = this.obj(this.need(p, 4)); // firstlineno, linetable
    if (this.layout === "py311") p = this.obj(p); // exceptiontable
    return p;
  }
}

/** Const indices that instructions of this wordcode load, with EXTENDED_ARG folded in. */
function constRefs(code: Buffer, ops: NonNullable<Version["ops"]>): Set<number> {
  const out = new Set<number>();
  let ext = 0;
  for (let i = 0; i + 1 < code.length; i += 2) {
    const op = code[i]!;
    const arg = (ext << 8) | code[i + 1]!;
    ext = op === ops.extendedArg ? arg : 0;
    if (ops.hasConst.includes(op)) out.add(arg);
  }
  return out;
}

/** A BLA-encoded string at `o`: [value, end]. */
function readStr(b: Buffer, o: number): [string, number] | undefined {
  if (b[o] === 0x7a && o + 2 <= b.length) return [b.toString("utf8", o + 2, o + 2 + b[o + 1]!), o + 2 + b[o + 1]!];
  if (b[o] === 0x61 && o + 5 <= b.length) return [b.toString("utf8", o + 5, o + 5 + b.readUInt32LE(o + 1)), o + 5 + b.readUInt32LE(o + 1)];
  return undefined;
}

/** Index of the first decoy in a trailing run of BLA decoy code objects (each byte-exact), or items.length. */
function decoySuffix(b: Buffer, layout: Layout, items: [number, number][], parentFile: string | undefined): number {
  const fileAt = layout === "py311" ? 42 : 45; // fixed decoy prefix before co_filename
  let k = items.length;
  while (k > 0) {
    const [s, e] = items[k - 1]!;
    const file = readStr(b, s + fileAt);
    const name = file && readStr(b, file[1]);
    if (!file || !name || file[0] !== (parentFile || "shielded.py") || !DECOY_NAME.test(name[0])) break;
    if (!decoyBytes(layout, name[0], file[0]).equals(b.subarray(s, e))) break;
    k--;
  }
  return k;
}

export const healPyc: FormatHealer = (input) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = () => ({ output: input, findings, warnings, changed: false });
  if (input.length < 17 || input[2] !== 0x0d || input[3] !== 0x0a) return unchanged();
  const magic = input.readUInt16LE(0);
  const version = versionFor(magic);
  if (!version) {
    if (/PROTECTED_CANARY_CREDENTIAL=|TRANSPORT_ENDPOINT=/.test(input.toString("latin1"))) {
      findings.add("deceive", "pyc-honey-trailer", `BLA honey records present; pyc magic ${magic} not supported, left in place`);
      warnings.push(`unsupported .pyc magic ${magic}; not rewritten`);
    }
    return unchanged();
  }

  const w = new Walker(input, version.layout);
  let rootEnd: number;
  try {
    rootEnd = w.obj(16);
  } catch (e) {
    warnings.push(`.pyc marshal walk failed (${(e as Error).message}); not rewritten`);
    return unchanged();
  }

  // Edits are disjoint byte splices: [at, deleteLength, replacement].
  const edits: [number, number, Buffer][] = [];

  // 1. Trailer: a run of TYPE_ASCII records after the root, carrying BLA's honey prefixes.
  if (rootEnd < input.length) {
    let p = rootEnd;
    let records = 0;
    let marked = false;
    while (p + 5 <= input.length && input[p] === 0x61 && p + 5 + input.readUInt32LE(p + 1) <= input.length) {
      const e = p + 5 + input.readUInt32LE(p + 1);
      if (TRAILER_MARK.test(input.toString("utf8", p + 5, e))) marked = true;
      records++;
      p = e;
    }
    if (p === input.length && marked) {
      edits.push([rootEnd, input.length - rootEnd, Buffer.alloc(0)]);
      findings.add("deceive", "pyc-honey-trailer", "stripped BLA's honey string records appended after the code object (never loaded)", records);
    } else warnings.push(`${input.length - rootEnd} unrecognised byte(s) after the .pyc code object; left in place`);
  }

  // 2. Woven decoy code objects at the tail of co_consts.
  let decoys = 0;
  let blocked = 0;
  const cuts: [number, number][] = [];
  const pending: { info: CodeInfo; k: number }[] = [];
  for (const info of w.codes) {
    if (!info.consts) continue;
    const k = decoySuffix(input, version.layout, info.consts.items, info.filename);
    if (k < info.consts.items.length) pending.push({ info, k });
  }
  const found = pending.reduce((n, x) => n + x.info.consts!.items.length - x.k, 0);
  if (found && (w.refs || !version.ops)) {
    findings.add("deceive", "pyc-decoy-code", "BLA decoy code objects woven into co_consts (detected, not removed)", found);
    warnings.push(
      w.refs
        ? "pyc uses marshal references, so it is not BLA's ref-free re-marshal; decoy code objects left in place"
        : `no verified opcode table for pyc magic ${magic}; decoy code objects left in place`,
    );
  } else {
    for (const { info, k } of pending) {
      const c = info.consts!;
      const n = c.items.length;
      // Proof: no instruction of this code object has a decoy index as its oparg.
      const args = info.code ? constRefs(input.subarray(info.code[0], info.code[1]), version.ops!) : undefined;
      if (!args || [...Array(n - k).keys()].some((i) => args.has(k + i))) {
        blocked += n - k;
        continue;
      }
      const from = c.items[k]![0];
      cuts.push([from, c.items[n - 1]![1]]);
      edits.push([from, c.items[n - 1]![1] - from, Buffer.alloc(0)]);
      edits.push(c.small ? [c.at + 1, 1, Buffer.from([k])] : [c.at + 1, 4, u32(k)]);
      decoys += n - k;
    }
    if (decoys) findings.add("deceive", "pyc-decoy-code", "removed BLA's unused decoy code objects from co_consts", decoys);
    if (blocked) warnings.push(`${blocked} decoy code object(s) kept: bytecode may load them`);
  }

  // 3. BLA re-encodes every str as (short) ASCII with UTF-8 bytes, which CPython decodes as
  // Latin-1. In a proven BLA re-marshal, restore those strings as TYPE_UNICODE.
  if (found && !w.refs) {
    let fixed = 0;
    for (const [o, body, e] of w.mojibake) {
      if (cuts.some(([a, b]) => o >= a && o < b)) continue;
      edits.push([o, body - o, Buffer.concat([Buffer.from([0x75]), u32(e - body)])]);
      fixed++;
    }
    if (fixed) findings.add("deceive", "pyc-string-repair", "restored non-ASCII strings BLA's re-marshal had re-typed as ASCII (read back as Latin-1)", fixed);
  }

  if (!edits.length) return unchanged();
  edits.sort((a, b) => b[0] - a[0]);
  let out = input;
  for (const [at, del, rep] of edits) out = Buffer.concat([out.subarray(0, at), rep, out.subarray(at + del)]);
  return { output: out, findings, warnings, changed: true };
};
