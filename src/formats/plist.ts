import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** apple-plist.ts: REA's max nesting is 128, BLA claims 128 + 4. */
const BPLIST_GUARD = Buffer.from("\0BLA_BPLIST_DEPTH_GUARD_132:", "latin1");
const DOCTYPE_BLA = '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd" []>';
const DOCTYPE_APPLE = DOCTYPE_BLA.replace(" []>", ">");
const BLA_KEY_PAIR =
  /^[ \t]*<key>BLA(?:EnclaveAttestationAuthority|EnclaveVsockDelegationCID|CanaryCredential_\d+|TransportEndpoint_\d+|SystemDiagnostic_\d+|BinaryPlistNestingDepthClaim)<\/key>\r?\n[ \t]*<(string|integer)>[^<]*<\/\1>\r?\n?/gm;

export function isPlist(file: string, head: Buffer): boolean {
  const text = head.toString("latin1");
  return text.startsWith("bplist") || /\.(plist|entitlements)$/i.test(file) || text.includes("<!DOCTYPE plist");
}

/** Checks the 32-byte bplist trailer of `b` is self-consistent (offset table ends right before it). */
function bplistValid(b: Buffer): boolean {
  if (b.length < 40) return false;
  const t = b.length - 32;
  const intSize = b[t + 6]!;
  const objects = Number(b.readBigUInt64BE(t + 8));
  const table = Number(b.readBigUInt64BE(t + 24));
  return intSize >= 1 && intSize <= 8 && table + objects * intSize === t;
}

/**
 * Apple plist healer. XML: removes the BLA* decoy key/value pairs and the empty
 * `[]` internal subset (only when a BLA key proves the file was shielded).
 * Binary: cuts the appended depth-guard trailer when the remaining bplist trailer is consistent.
 */
export const healPlist: FormatHealer = (input, file) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = { output: input, findings, warnings, changed: false };

  if (input.subarray(0, 6).toString("latin1") === "bplist") {
    const at = input.indexOf(BPLIST_GUARD);
    if (at < 8) return unchanged;
    const out = Buffer.from(input.subarray(0, at));
    if (!bplistValid(out)) {
      warnings.push(`${file}: bplist guard trailer found but the remaining trailer is inconsistent; left unchanged`);
      return unchanged;
    }
    findings.add("exhaust", "bplist-depth-claim", "removed trailer claiming binary-plist nesting beyond the parser budget, plus canary text", 1);
    return { output: out, findings, warnings, changed: true };
  }

  const text = input.toString("utf8");
  let keys = 0;
  const stripped = text.replace(BLA_KEY_PAIR, () => (keys++, ""));
  if (!keys) return unchanged;
  const out = stripped.replace(DOCTYPE_BLA, () => {
    findings.add("exhaust", "plist-internal-subset", "removed empty DOCTYPE internal subset that trips the XML plist entity-expansion budget", 1);
    return DOCTYPE_APPLE;
  });
  findings.add("deceive", "plist-decoy-keys", "removed BLA decoy enclave entitlement, canary and diagnostic keys", keys);
  warnings.push(`${file}: BLA trimmed the original file, so a trailing newline may be missing`);
  return { output: Buffer.from(out, "utf8"), findings, warnings, changed: true };
};
