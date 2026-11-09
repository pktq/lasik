import type { Findings } from "../../core/types.js";
import { firewallText } from "../../firewall/index.js";
import { t } from "../ast.js";

/**
 * Prompt firewall over everything an agent will read in the healed file:
 * string literals, template text and comments. Runs last, on what survived
 * the decoy passes, so redactions never feed a digest BLA still checks.
 */
export function firewallJs(ast: t.File, f: Findings): number {
  let n = 0;
  const apply = (s: string): string => {
    const r = firewallText(s);
    if (!r.redactions) return s;
    n += r.redactions;
    for (const h of r.hits) f.add("prompt", `firewall:${h.category}`, `redacted LLM-directed decoy text (${h.rule})`, h.count);
    return r.text;
  };
  t.traverseFast(ast, (node) => {
    if (t.isStringLiteral(node)) node.value = apply(node.value);
    else if (t.isTemplateElement(node)) {
      const v = apply(node.value.raw);
      if (v !== node.value.raw) node.value = { raw: v.replace(/`|\$\{/g, "\\$&"), cooked: v };
    }
    for (const list of [node.leadingComments, node.trailingComments, node.innerComments]) {
      for (const c of list ?? []) c.value = apply(c.value).replace(/\*\//g, "* /");
    }
  });
  return n;
}
