import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

export const isPtx = (file: string, _head: Buffer): boolean => /\.ptx$/i.test(file);

const MARK = "\n// [BLA-PTX-SHIELD] Counter-REA GPU exhaustion trailer\n";
/** Exactly what gpu-ptx.ts emits after the marker: DIAG comments, then decoy kernels. */
const TRAILER =
  /^(?:\/\/ DIAG: [^\n]*\n)*(?:\.visible \.entry (bla_tarpit_kernel_\d+_[0-9a-f]{4})\(\.param \.u64 \1_param_0\)\n\{\n {2}\.reg \.b64 %rd<2>;\n {2}ld\.param\.u64 %rd1, \[\1_param_0\];\n {2}\/\/ canary=[0-9a-f]{8}\n {2}ret;\n\}\n\n)*$/;

/** BLA appends a marker comment, DIAG comments and decoy `.entry` kernels; the original module precedes them verbatim. */
export const healPtx: FormatHealer = (input) => {
  const findings = new Findings();
  const unchanged = { output: input, findings, warnings: [] as string[], changed: false };
  const text = input.toString("utf8");
  const at = text.lastIndexOf(MARK);
  if (at < 0) return unchanged;
  const rest = text.slice(at + MARK.length);
  if (!TRAILER.test(rest)) return unchanged;
  findings.add("deceive", "ptx-diag-comments", "removed DIAG canary comments after the BLA-PTX-SHIELD marker", (rest.match(/^\/\/ DIAG: /gm) ?? []).length);
  findings.add("tarpit", "ptx-decoy-kernels", "removed decoy bla_tarpit_kernel_* entry points (entry-count flood)", (rest.match(/^\.visible \.entry /gm) ?? []).length);
  return { output: Buffer.from(text.slice(0, at), "utf8"), findings, warnings: [], changed: true };
};
