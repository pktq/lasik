import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** android-manifest.ts emits this comment and package in every decoy sidecar manifest. */
const MARKER = "<!-- bla-shield: decoy AndroidManifest";
const PACKAGE = 'package="com.enclave.sgx.teeattestation"';

export function isAxml(file: string, head: Buffer): boolean {
  return (head.length >= 4 && head.readUInt32LE(0) === 0x00080003) || /(^|[\\/])AndroidManifest[^\\/]*\.xml$/i.test(file);
}

/** True for BLA's text decoy manifest (assets/bla-shield/AndroidManifest*.xml). */
export function isDecoyManifest(buf: Buffer): boolean {
  const text = buf.toString("utf8");
  return text.includes(MARKER) && text.includes(PACKAGE);
}

/**
 * BLA never edits binary AXML or the real root manifest (android-manifest.ts red line);
 * it only plants a text decoy sidecar. That decoy is a whole-file plant, so it is
 * reported here and dropped by the zip healer; everything else stays byte-identical.
 */
export const healAxml: FormatHealer = (input, file) => {
  const findings = new Findings();
  const warnings: string[] = [];
  if (isDecoyManifest(input)) {
    findings.add("exhaust", "manifest-decoy", "whole file is a BLA decoy AndroidManifest (component/intent-filter flood); ignore it", 1);
    warnings.push(`${file}: decoy manifest, not the app's real manifest`);
  }
  return { output: input, findings, warnings, changed: false };
};
