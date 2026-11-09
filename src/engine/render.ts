import type { Finding, Report } from "../core/types.js";
import { EXPANSION, NAME, VERSION } from "../identity.js";

const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const pct = (before: number, after: number) => (before ? `${(100 * (1 - after / before)).toFixed(1)}%` : "0%");
const ratio = (before: number, after: number) => (after ? `${(before / after).toFixed(1)}×` : "∞");

function byLayer(r: Report): Map<string, Finding[]> {
  const m = new Map<string, Finding[]>();
  for (const f of r.files) {
    for (const x of f.findings) {
      const list = m.get(x.layer) ?? [];
      const same = list.find((y) => y.technique === x.technique);
      if (same) same.count += x.count;
      else list.push({ ...x });
      m.set(x.layer, list);
    }
  }
  return m;
}

const LAYER_TITLE: Record<string, string> = {
  tarpit: "Tarpit (opaque predicates, dead branches)",
  encrypt: "Encrypt (XOR strings, split literals)",
  deceive: "Deceive (decoys, honey data, fake comments)",
  entangle: "Entangle (anti-strip interlocks, self-seal)",
  exhaust: "Exhaust (analyser budget breakers)",
  runtime: "Runtime (shadow heap, Truman-show blocks)",
  prompt: "Prompt (text aimed at the model)",
};

/** Human-readable terminal report. */
export function renderText(r: Report, color = false): string {
  const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const t = r.totals;
  const lines: string[] = [];
  lines.push(c("1", `${NAME} ${VERSION}`) + c("2", ` · ${EXPANSION}`));
  lines.push(`${r.mode === "heal" ? "Healed" : "Scanned"} ${t.files} file(s) in ${r.target}`);
  const verdictColor = r.verdict === "blinded" ? "31" : r.verdict === "suspected" ? "33" : "32";
  lines.push(`Verdict: ${c(`1;${verdictColor}`, r.verdict.toUpperCase())}  ·  blindness ${r.blindness}/100  ·  ${t.blinded} file(s) carry BLA artifacts`);
  if (t.blinded) {
    lines.push(
      `Sight restored: ${kb(t.bytesBefore)} → ${kb(t.bytesAfter)} (${pct(t.bytesBefore, t.bytesAfter)} smaller), ` +
        `~${t.tokensBefore.toLocaleString("en-US")} → ~${t.tokensAfter.toLocaleString("en-US")} tokens (${ratio(t.tokensBefore, t.tokensAfter)} cheaper for an agent to read)`,
    );
  }
  const layers = byLayer(r);
  for (const [layer, list] of layers) {
    lines.push("");
    lines.push(c("1", LAYER_TITLE[layer] ?? layer));
    for (const x of list.sort((a, b) => b.count - a.count)) lines.push(`  ${String(x.count).padStart(6)}  ${x.detail}`);
  }
  const changed = r.files.filter((f) => f.findings.length || f.warnings.length);
  if (changed.length) {
    lines.push("");
    lines.push(c("1", "Files"));
    for (const f of changed) {
      lines.push(`  ${f.file}  ${c("2", `[${f.format}]`)}  ${kb(f.bytesBefore)} → ${kb(f.bytesAfter)}`);
      for (const w of f.warnings) lines.push(c("33", `      ! ${w}`));
    }
  }
  if (r.mode === "heal" && t.files) {
    const out = r.files[0]?.output;
    if (out) {
      lines.push("");
      lines.push(`Output: ${out.replace(/[\\/][^\\/]*$/, "")}`);
    }
  }
  return lines.join("\n");
}

/** Markdown report (for PRs, issues, agents). */
export function renderMarkdown(r: Report): string {
  const t = r.totals;
  const out: string[] = [];
  out.push(`## ${NAME} report: ${r.verdict} (blindness ${r.blindness}/100)`);
  out.push("");
  out.push(`| | Before | After | |`);
  out.push(`|---|---:|---:|---:|`);
  out.push(`| Bytes | ${kb(t.bytesBefore)} | ${kb(t.bytesAfter)} | ${pct(t.bytesBefore, t.bytesAfter)} smaller |`);
  out.push(`| Tokens (est.) | ${t.tokensBefore.toLocaleString("en-US")} | ${t.tokensAfter.toLocaleString("en-US")} | ${ratio(t.tokensBefore, t.tokensAfter)} cheaper |`);
  out.push("");
  for (const [layer, list] of byLayer(r)) {
    out.push(`**${LAYER_TITLE[layer] ?? layer}**`);
    out.push("");
    for (const x of list.sort((a, b) => b.count - a.count)) out.push(`- ${x.count} × ${x.detail}`);
    out.push("");
  }
  const files = r.files.filter((f) => f.findings.length);
  if (files.length) {
    out.push(`| File | Format | Before | After |`);
    out.push(`|---|---|---:|---:|`);
    for (const f of files) out.push(`| \`${f.file}\` | ${f.format} | ${kb(f.bytesBefore)} | ${kb(f.bytesAfter)} |`);
  }
  return out.join("\n") + "\n";
}
