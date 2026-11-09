import { RULES, type FirewallCategory } from "./rules.js";

export type { FirewallCategory } from "./rules.js";

export interface FirewallHit {
  rule: string;
  category: FirewallCategory;
  count: number;
}

export interface FirewallResult {
  text: string;
  redactions: number;
  hits: FirewallHit[];
}

const DEFAULT_PLACEHOLDER = "[LASIK: redacted BLA prompt decoy]";

function collect(text: string): { spans: Array<[number, number]>; hits: FirewallHit[] } {
  const spans: Array<[number, number]> = [];
  const hits: FirewallHit[] = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : rule.regex.flags + "g");
    let count = 0;
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0 || (rule.requires && !rule.requires.test(m[0]))) continue;
      count++;
      spans.push([m.index, m.index + m[0].length]);
    }
    if (count > 0) hits.push({ rule: rule.id, category: rule.category, count });
  }
  return { spans, hits };
}

/** Detection only: which decoy rules fire on this text. */
export function scanText(text: string): FirewallHit[] {
  return collect(text).hits;
}

/** Replace BLA prompt decoys (and generic agent-directed refusal bait) with a placeholder. */
export function firewallText(text: string, opts?: { placeholder?: string }): FirewallResult {
  const { spans, hits } = collect(text);
  if (spans.length === 0) return { text, redactions: 0, hits };
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const placeholder = opts?.placeholder ?? DEFAULT_PLACEHOLDER;
  let out = "";
  let pos = 0;
  for (const [s, e] of merged) {
    out += text.slice(pos, s) + placeholder;
    pos = e;
  }
  return { text: out + text.slice(pos), redactions: merged.length, hits };
}
