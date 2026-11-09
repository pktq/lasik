import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

const DECOY_PREFIX = Buffer.from("[BLA-BEAM-SHIELD]\0", "latin1");

export const isBeam = (file: string, head: Buffer): boolean =>
  (head.length >= 12 && head.toString("latin1", 0, 4) === "FOR1" && head.toString("latin1", 8, 12) === "BEAM") ||
  /\.beam$/i.test(file);

/** Compact `u` tag decoder (OTP 28+ AtU8 lengths). */
function compactU(p: Buffer, at: number): { value: number; next: number } | null {
  const first = p[at];
  if (first === undefined || (first & 7) !== 0) return null;
  if ((first & 8) === 0) return { value: first >> 4, next: at + 1 };
  if ((first & 0x10) === 0) return at + 1 < p.length ? { value: ((first >> 5) << 8) | p[at + 1]!, next: at + 2 } : null;
  const code = first >> 5;
  if (code === 7 || at + 1 + code + 2 > p.length) return null;
  let value = 0;
  for (let i = 0; i < code + 2; i++) value = value * 256 + p[at + 1 + i]!;
  return { value, next: at + 1 + code + 2 };
}

/**
 * Cut BLA's appended canary atoms from an AtU8 payload. They start at the atom
 * `bla_beam_canary` immediately followed by `[BLA-BEAM-SHIELD]`; the original
 * atoms (and their indices) are kept byte for byte.
 */
function trimAtoms(payload: Buffer): { payload: Buffer; removed: number } | null {
  if (payload.length < 4) return null;
  const declared = payload.readInt32BE(0);
  const compact = declared < 0;
  const count = Math.abs(declared);
  const starts: number[] = [];
  const names: string[] = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    let len: number;
    starts.push(at);
    if (compact) {
      const d = compactU(payload, at);
      if (!d) return null;
      len = d.value;
      at = d.next;
    } else {
      if (at >= payload.length) return null;
      len = payload[at]!;
      at += 1;
    }
    if (at + len > payload.length) return null;
    names.push(payload.toString("utf8", at, at + len));
    at += len;
  }
  const cut = names.findIndex((n, i) => n === "bla_beam_canary" && names[i + 1] === "[BLA-BEAM-SHIELD]");
  if (cut < 0) return null;
  const head = Buffer.from(payload.subarray(0, starts[cut]));
  head.writeInt32BE(compact ? -cut : cut, 0);
  return { payload: head, removed: count - cut };
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

/**
 * BLA appends canary atoms to AtU8 and decoy IFF chunks whose payload starts
 * with `[BLA-BEAM-SHIELD]\0` (erlang-beam.ts). Remove both and rebuild the
 * chunk table and FOR1 size; every other chunk is copied byte for byte.
 */
export const healBeam: FormatHealer = (input) => {
  const findings = new Findings();
  const unchanged = { output: input, findings, warnings: [] as string[], changed: false };
  if (input.length < 12 || input.toString("latin1", 0, 4) !== "FOR1" || input.toString("latin1", 8, 12) !== "BEAM") return unchanged;
  const formEnd = 8 + input.readUInt32BE(4);
  if (formEnd > input.length) return unchanged;

  const parts: Buffer[] = [];
  let decoyChunks = 0;
  let atoms = 0;
  let at = 12;
  while (at + 8 <= formEnd) {
    const name = input.toString("latin1", at, at + 4);
    const size = input.readUInt32BE(at + 4);
    const end = at + 8 + size + ((4 - (size % 4)) % 4);
    if (end > formEnd) return unchanged; // malformed table: do not guess
    const payload = input.subarray(at + 8, at + 8 + size);
    if (payload.subarray(0, DECOY_PREFIX.length).equals(DECOY_PREFIX)) {
      decoyChunks++;
    } else {
      const trimmed = name === "AtU8" ? trimAtoms(payload) : null;
      if (trimmed) {
        atoms += trimmed.removed;
        const pad = (4 - (trimmed.payload.length % 4)) % 4;
        parts.push(Buffer.from(name, "latin1"), u32(trimmed.payload.length), trimmed.payload, Buffer.alloc(pad));
      } else parts.push(input.subarray(at, end));
    }
    at = end;
  }
  if (decoyChunks === 0 && atoms === 0) return unchanged;

  findings.add("deceive", "beam-canary-atoms", "removed canary/diagnostic atoms appended to the AtU8 table", atoms);
  findings.add("exhaust", "beam-decoy-chunks", "removed decoy IFF chunks carrying the BLA-BEAM-SHIELD marker (chunk-budget flood)", decoyChunks);
  const body = Buffer.concat([Buffer.from("BEAM", "latin1"), ...parts]);
  const output = Buffer.concat([Buffer.from("FOR1", "latin1"), u32(body.length), body, input.subarray(formEnd)]);
  return { output, findings, warnings: [], changed: true };
};
