import type { Findings } from "../../core/types.js";
import { CANARY_GUID, SCRAMBLED_COMMENT } from "../fingerprints.js";
import { t } from "../ast.js";

/** BLA's honey source maps point at a fake enclave tree. */
export function isHoneySourceMap(json: string): boolean {
  return json.includes("enclave://tee-runtime/") || json.includes(CANARY_GUID) || /src\/enclave\/(hardware-tpm2-bridge|vsock-attestation-client)-/.test(json);
}

function inlineMapJson(comment: string): string | undefined {
  const m = comment.match(/^[#@]\s*sourceMappingURL=data:application\/json[^,]*;base64,([A-Za-z0-9+/=]+)\s*$/);
  return m ? Buffer.from(m[1]!, "base64").toString("utf8") : undefined;
}

/**
 * Drop BLA's content-free replacement comments (`project quota policy (35c544)`)
 * and inline honey source maps that point analysers at a fictional source tree.
 */
export function stripScrambledComments(ast: t.File, f: Findings): number {
  let scrambled = 0;
  let honey = 0;
  const keep = (c: t.Comment) => {
    if (SCRAMBLED_COMMENT.test(c.value)) {
      scrambled++;
      return false;
    }
    const map = inlineMapJson(c.value.trim());
    if (map !== undefined && isHoneySourceMap(map)) {
      honey++;
      return false;
    }
    return true;
  };
  ast.comments = ast.comments?.filter(keep) ?? null;
  t.traverseFast(ast, (node) => {
    if (node.leadingComments) node.leadingComments = node.leadingComments.filter(keep);
    if (node.trailingComments) node.trailingComments = node.trailingComments.filter(keep);
    if (node.innerComments) node.innerComments = node.innerComments.filter(keep);
  });
  if (scrambled) f.add("deceive", "scrambled-comment", "removed BLA's content-free replacement comments", scrambled);
  if (honey) f.add("deceive", "honey-sourcemap", "removed inline honey source map (fake enclave source tree)", honey);
  return scrambled + honey;
}
