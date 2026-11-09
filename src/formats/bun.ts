import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** bun-standalone.ts BUN_TRAILER and the 32-byte Offsets block before it. */
const TRAILER = Buffer.from("\n---- Bun! ----\n", "latin1");
const SUFFIX = 32 + TRAILER.length;
const RECORD = 52; // Bun 1.3.9 module record
/** generateBunStandaloneDecoyGraph: module 0 name and its decoy bytecode prefix. */
const DECOY_ENTRY = "/$bunfs/root/enclave-attestation-main.js";
const DECOY_BYTECODE = Buffer.from("JSC\0BLA-DECOY-BYTECODE\0", "latin1");
const SNAPSHOT = /\.bunfs-snapshot$/i;
const COMPANION = /\.bla-sidecar\.v1\.json$/i;

/** BLA's Bun sidecars: `<bin>.bunfs-snapshot` decoy graph and `<bin>.bla-sidecar.v1.json` companion note. */
export function isBun(file: string, head: Buffer): boolean {
  return SNAPSHOT.test(file) || COMPANION.test(file) || head.toString("latin1").startsWith("/$bunfs/");
}

/** Module count when `b` is exactly BLA's decoy graph (whole file = data ‖ Offsets ‖ trailer), else 0. */
function decoyModules(b: Buffer): number {
  if (b.length < SUFFIX || !b.subarray(b.length - TRAILER.length).equals(TRAILER)) return 0;
  const o = b.length - SUFFIX;
  const tableOff = b.readUInt32LE(o + 8);
  const tableLen = b.readUInt32LE(o + 12);
  if (b.readBigUInt64LE(o) !== BigInt(o) || tableLen < RECORD || tableLen % RECORD !== 0 || tableOff + tableLen > o) return 0;
  const field = (n: number) => b.subarray(b.readUInt32LE(tableOff + n), b.readUInt32LE(tableOff + n) + b.readUInt32LE(tableOff + n + 4));
  const proven = field(0).toString("latin1") === DECOY_ENTRY && field(24).subarray(0, DECOY_BYTECODE.length).equals(DECOY_BYTECODE);
  return proven ? tableLen / RECORD : 0;
}

/**
 * Bun standalone (bun-standalone.ts + sidecar-entangle.ts). BLA never rewrites a
 * Bun binary; it writes a REA-admissible honeypot module graph next to it as
 * `<bin>.bunfs-snapshot`, optionally bound by a `.bla-sidecar.v1.json` note.
 * The snapshot is decoy end to end, so it is emptied. The note only feeds a
 * host-side check (the binary never reads it), so it is reported and kept.
 */
export const healBun: FormatHealer = (input, file) => {
  const findings = new Findings();
  const warnings: string[] = [];

  if (COMPANION.test(file) || input.subarray(0, 1).toString() === "{") {
    try {
      const note = JSON.parse(input.toString("utf8")) as { schema?: unknown; kind?: unknown; sidecarPaths?: unknown };
      if (note.schema === "bla-sidecar-entangle/v1" && note.kind === "bun-companion-note") {
        const paths = Array.isArray(note.sidecarPaths) ? note.sidecarPaths.filter((p) => typeof p === "string") : [];
        findings.add("entangle", "bun-sidecar-companion", "BLA strip-fail companion note binding sidecar digests (host-side check only)", 1);
        warnings.push(`${file}: binds ${paths.join(", ") || "no paths"}; healing those files makes BLA's host-side verifyBunSidecarCompanionNote fail (the Bun binary itself never checks)`);
      }
    } catch {
      /* not JSON: not BLA's note */
    }
    return { output: input, findings, warnings, changed: false };
  }

  const modules = decoyModules(input);
  if (modules === 0) return { output: input, findings, warnings, changed: false };
  findings.add("deceive", "bun-decoy-module-graph", "emptied BLA honeypot Bun module graph sidecar (canary/diagnostic/deep-path modules)", modules);
  warnings.push(`${file}: whole file is a BLA decoy graph (not read by the Bun binary); emptied`);
  return { output: Buffer.alloc(0), findings, warnings, changed: true };
};
