import type { FileReport, Layer, Report } from "../core/types.js";

/** How much each BLA layer, once seen, contributes to the 0–100 blindness score. */
const LAYER_WEIGHT: Record<Layer, number> = {
  tarpit: 25,
  entangle: 20,
  deceive: 15,
  encrypt: 15,
  prompt: 15,
  exhaust: 15,
  runtime: 10,
};

/** Techniques that also appear in ordinary code and say nothing about BLA on their own. */
const WEAK = new Set(["shake-skipped-dynamic", "dead-branch", "split-literal", "renamed-module-handle", "seed-bit-predicate", "opaque-predicate-suspected", "weave-zero-entanglement", "unreachable-decl"]);

/** Generic prompt-injection shapes (chat markers, "refuse" phrasing) also occur in real chat apps. */
export const isWeak = (technique: string) =>
  WEAK.has(technique) || technique === "firewall-kept-runtime-string" || /^detected:(fake-role|refusal-bait)$/.test(technique);

/**
 * Blindness = which BLA layers were found anywhere in the target, weighted.
 * It measures how hard BLA tried, not file size: one layer → ~15–25,
 * the full Poison/Exhaust/Hallucinate stack → 100.
 */
export function scoreBlindness(files: FileReport[]): { blindness: number; verdict: Report["verdict"] } {
  const layers = new Set<Layer>();
  let strong = 0;
  for (const f of files) {
    for (const x of f.findings) {
      if (isWeak(x.technique)) continue;
      layers.add(x.layer);
      strong += x.count;
    }
  }
  const blindness = Math.min(100, [...layers].reduce((s, l) => s + LAYER_WEIGHT[l], 0));
  const verdict = strong === 0 ? "clean" : blindness >= 40 ? "blinded" : "suspected";
  return { blindness, verdict };
}

/**
 * Distinct AI-evasion techniques present: a risk signal in its own right.
 * Code that plants refusal bait or tarpits for AI analysts is hiding
 * something, whoever wrote it.
 */
export function evasionTechniques(files: FileReport[]): string[] {
  const out = new Set<string>();
  for (const f of files) for (const x of f.findings) if (!isWeak(x.technique)) out.add(`${x.layer}/${x.technique.replace(/^firewall:/, "prompt-")}`);
  return [...out].sort();
}
