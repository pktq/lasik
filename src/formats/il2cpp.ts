import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** BLA protectIl2cppMetadataBuffer (mobile-game.ts) appends this exact trailer head after the original file. */
const TRAILER = Buffer.from("\0[BLA-IL2CPP-SHIELD]\0Enclave.Ring0.Tarpit_0_", "utf8");

export function isIl2cpp(_file: string, head: Buffer): boolean {
  return head.length >= 4 && head.readUInt32LE(0) === 0xfab11baf;
}

/** IL2CPP global-metadata.dat healer: cuts the decoy-literal trailer; the original file is the exact prefix. */
export const healIl2cpp: FormatHealer = (input) => {
  const findings = new Findings();
  const at = isIl2cpp("", input) ? input.indexOf(TRAILER) : -1;
  if (at < 8) return { output: input, findings, warnings: [], changed: false };
  findings.add("deceive", "il2cpp-trailer-decoys", "removed decoy Enclave.Ring0.Tarpit literals appended to global-metadata.dat", 1);
  return { output: Buffer.from(input.subarray(0, at)), findings, warnings: [], changed: true };
};
