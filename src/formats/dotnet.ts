import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** BSJB is not within the 64-byte head, so claim MZ images by extension; the healer is a no-op without BLA's marker. */
export const isDotnet = (file: string, head: Buffer): boolean =>
  head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a && /\.(dll|exe|winmd|netmodule)$/i.test(file);

const MARKER = Buffer.from("\0BLA_DOTNET_CLR_SHIELD_V1\0", "utf8");

/**
 * BLA appends `\0BLA_DOTNET_CLR_SHIELD_V1\0 ...` as PE overlay data
 * (dotnet-managed.ts). The CLR metadata is untouched, so cutting the overlay
 * restores the assembly exactly.
 */
export const healDotnet: FormatHealer = (input) => {
  const findings = new Findings();
  const at = input.lastIndexOf(MARKER);
  if (at < 0 || !input.includes("maxRepresentationBytes:67108864", at)) return { output: input, findings, warnings: [], changed: false };
  findings.add("exhaust", "dotnet-overlay-block", "removed appended decoy P/Invoke names and canary strings after the PE image (metadata-budget bait)", 1);
  return { output: Buffer.from(input.subarray(0, at)), findings, warnings: [], changed: true };
};
