import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

const BLOCK = 512;
const MAGIC0 = 0x0a324655;
const MAGIC1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;
/** firmware-uf2.ts: every decoy sets NOT_MAIN_FLASH | FAMILY_ID and starts its payload with this marker. */
const DECOY_FLAGS = 0x0000_2001;
const MARKER = Buffer.from("[BLA-UF2-SHIELD]\n", "latin1");

export function isUf2(_file: string, head: Buffer): boolean {
  return head.length >= 8 && head.readUInt32LE(0) === MAGIC0 && head.readUInt32LE(4) === MAGIC1;
}

function isDecoy(b: Buffer, at: number): boolean {
  return (
    b.readUInt32LE(at) === MAGIC0 &&
    b.readUInt32LE(at + 4) === MAGIC1 &&
    b.readUInt32LE(at + BLOCK - 4) === MAGIC_END &&
    (b.readUInt32LE(at + 8) & DECOY_FLAGS) === DECOY_FLAGS &&
    b.subarray(at + 32, at + 32 + MARKER.length).equals(MARKER)
  );
}

/**
 * UF2 firmware healer: BLA keeps every original block byte-exact and appends
 * not-main-flash / file-container decoy blocks (bootloaders ignore them). Cut the
 * trailing run of marked decoys.
 */
export const healUf2: FormatHealer = (input) => {
  const findings = new Findings();
  if (input.length % BLOCK !== 0) return { output: input, findings, warnings: [], changed: false };
  let end = input.length;
  while (end > BLOCK && isDecoy(input, end - BLOCK)) end -= BLOCK;
  const removed = (input.length - end) / BLOCK;
  if (removed === 0) return { output: input, findings, warnings: [], changed: false };
  findings.add("deceive", "uf2-decoy-blocks", "removed BLA not-main-flash / file-container decoy blocks (canary and diagnostic payloads)", removed);
  return { output: Buffer.from(input.subarray(0, end)), findings, warnings: [], changed: true };
};
