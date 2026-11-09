import type { Findings } from "../../core/types.js";
import { firewallText, type FirewallHit } from "../../firewall/index.js";
import { t } from "../ast.js";

/** Rule categories specific enough to BLA that rewriting a string value can't hurt real code. */
const BLA_SPECIFIC = new Set<FirewallHit["category"]>(["canary", "false-claim", "dual-use-bait", "fake-compliance"]);

export interface FirewallJsOptions {
  /**
   * "safe" (default): comments always; string values only in BLA-hardened
   *   files and only for BLA-specific rules, so healed code behaves the same.
   * "strict": redact every match in strings too: an agent read view, not runnable.
   */
  mode?: "safe" | "strict";
  hardened: boolean;
}

/**
 * Prompt firewall over what an agent will read in the healed file: comments,
 * string literals and template text. Runs last, on what survived the decoy
 * passes. Matches it doesn't rewrite are still reported.
 */
export function firewallJs(ast: t.File, f: Findings, opts: FirewallJsOptions): number {
  let n = 0;
  let kept = 0;
  const record = (hits: FirewallHit[]) => {
    for (const h of hits) f.add("prompt", `firewall:${h.category}`, `redacted LLM-directed decoy text (${h.rule})`, h.count);
  };
  const apply = (s: string, isComment: boolean): string => {
    const r = firewallText(s);
    if (!r.redactions) return s;
    const allowed =
      isComment || opts.mode === "strict" || (opts.hardened && r.hits.every((h) => BLA_SPECIFIC.has(h.category)));
    if (!allowed) {
      kept += r.redactions;
      return s;
    }
    n += r.redactions;
    record(r.hits);
    return r.text;
  };
  t.traverseFast(ast, (node) => {
    if (t.isStringLiteral(node)) node.value = apply(node.value, false);
    else if (t.isTemplateElement(node) && node.value.cooked != null) {
      const cooked = apply(node.value.cooked, false);
      if (cooked !== node.value.cooked) {
        node.value = { cooked, raw: cooked.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") };
      }
    }
    for (const list of [node.leadingComments, node.trailingComments, node.innerComments]) {
      for (const c of list ?? []) c.value = apply(c.value, true).replace(/\*\//g, "* /");
    }
  });
  if (kept) f.add("prompt", "firewall-kept-runtime-string", "prompt-injection-shaped runtime strings left unchanged to keep behaviour (use lasik_read / --strict-firewall to redact)", kept);
  return n;
}
