import { createHash } from "node:crypto";
import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** BLA protectAndroidDexBuffer (mobile-game.ts) appends this exact trailer head after the original DEX. */
const TRAILER = Buffer.from(
  "\0[BLA-DEX-SHIELD-V1]\0Lcom/enclave/sgx/TeeAttestationBridge;\0Lcom/enclave/tpm2/KeyUnsealerStub;\0Lcom/enclave/nitro/VsockRing0Transport;\0",
  "latin1",
);
const XREF_MARKER = Buffer.from("BLA-DEX-XREF-V1", "latin1");
const XREF_CLASS = Buffer.from("Lcom/enclave/xref/ExternalInvokeCaller_", "latin1");

export function isDex(_file: string, head: Buffer): boolean {
  return head.length >= 8 && head.subarray(0, 4).equals(Buffer.from("dex\n")) && head[7] === 0;
}

/** True for the standalone decoy DEX of android-dex-xref.ts (a whole file of Log.d callers). */
export function isBlaXrefDex(dex: Buffer): boolean {
  return dex.length >= 112 && isDex("", dex) && dex.includes(XREF_MARKER) && dex.includes(XREF_CLASS);
}

function adler32(b: Buffer): number {
  let a = 1;
  let s = 0;
  for (let i = 0; i < b.length; i++) {
    a = (a + b[i]!) % 65521;
    s = (s + a) % 65521;
  }
  return ((s << 16) | a) >>> 0;
}

/**
 * DEX healer: cuts BLA's pool-pollution trailer and recomputes file_size, SHA-1
 * signature and Adler-32 checksum (the trailer sits past every map section, so
 * no section sizes change; a DEX with a valid original header round-trips exactly).
 * A whole-file xref decoy DEX is reported only; the zip healer drops it.
 */
export const healDex: FormatHealer = (input, file) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = { output: input, findings, warnings, changed: false };
  if (!isDex(file, input) || input.length < 112) return unchanged;

  if (isBlaXrefDex(input)) {
    findings.add("exhaust", "dex-xref-flood", "whole file is a BLA decoy DEX of Log.d caller classes; drop it from the archive", 1);
    warnings.push(`${file}: standalone xref decoy DEX cannot be healed in place`);
    return unchanged;
  }
  const at = input.indexOf(TRAILER);
  if (at < 112 || input.readUInt32LE(32) !== input.length) return unchanged;

  const out = Buffer.from(input.subarray(0, at));
  out.writeUInt32LE(out.length, 32);
  createHash("sha1").update(out.subarray(32)).digest().copy(out, 12);
  out.writeUInt32LE(adler32(out.subarray(12)), 8);
  findings.add("deceive", "dex-trailer-decoys", "removed decoy TEE/SGX class descriptors, JNI names and canary text appended to the DEX", 1);
  warnings.push(`${file}: DEX header file_size, SHA-1 and Adler-32 recomputed`);
  return { output: out, findings, warnings, changed: true };
};
