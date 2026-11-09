import { Findings } from "../core/types.js";
import { isHoneySourceMap } from "../js/passes/comments.js";
import type { FormatHealer } from "./types.js";

export { isHoneySourceMap };

/**
 * BLA replaces every source map with a "honey" map pointing at a fictional
 * enclave source tree. The original map is not recoverable, so the best we can
 * do is hand analysers an empty (but valid) map instead of the decoy one.
 */
export const healSourceMap: FormatHealer = (input) => {
  const findings = new Findings();
  const text = input.toString("utf8");
  if (!isHoneySourceMap(text)) return { output: input, findings, warnings: [], changed: false };

  let file: unknown;
  try {
    file = (JSON.parse(text) as { file?: unknown }).file;
  } catch {
    // Malformed honey map: still replace it, just without `file`.
  }
  const healed = {
    version: 3,
    ...(typeof file === "string" ? { file } : {}),
    sources: [],
    names: [],
    mappings: "",
  };
  findings.add("deceive", "honey-sourcemap", "replaced BLA honey source map (fake enclave source tree) with an empty map", 1);
  return {
    output: Buffer.from(JSON.stringify(healed), "utf8"),
    findings,
    warnings: ["original source map is gone (BLA overwrote it); recover sources from the code itself"],
    changed: true,
  };
};
