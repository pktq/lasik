#!/usr/bin/env node
// Render `lasik scan` output as a terminal-window SVG for the README.
// Usage: node scripts/terminal-svg.mjs <path> <out.svg> [maxLines]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [target = "bench/bla-crackme", out = "docs/assets/scan.svg", maxLines = "40"] = process.argv.slice(2);
const text = execFileSync(process.execPath, ["dist/cli.js", "scan", target], { encoding: "utf8" });
const lines = text.trimEnd().split("\n").slice(0, Number(maxLines));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const color = (line, i) => {
  if (i === 0) return "#7dd3fc";
  if (/^Verdict/.test(line)) return "#fca5a5";
  if (/^Sight restored/.test(line)) return "#86efac";
  if (/^\S/.test(line)) return "#e2e8f0";
  return "#94a3b8";
};

const lh = 19;
const w = 1100;
const h = 56 + lines.length * lh + 20;
const body = lines
  .map((l, i) => {
    const y = 68 + i * lh;
    // "   1962  folded …": count right-aligned in its own column (SVG collapses leading spaces).
    const m = l.match(/^\s+(\d+)\s{2}(.*)$/);
    if (m) return `<text x="74" y="${y}" fill="#fbbf24" text-anchor="end">${m[1]}</text><text x="88" y="${y}" fill="#94a3b8">${esc(m[2])}</text>`;
    return `<text x="24" y="${y}" fill="${color(l, i)}"${/^\S/.test(l) && i > 1 ? ' font-weight="700"' : ""}>${esc(l.trim())}</text>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="lasik scan output">
<rect width="${w}" height="${h}" rx="12" fill="#0b1020"/>
<rect width="${w}" height="36" rx="12" fill="#111a33"/>
<rect y="24" width="${w}" height="12" fill="#111a33"/>
<circle cx="22" cy="18" r="6" fill="#f87171"/><circle cx="42" cy="18" r="6" fill="#fbbf24"/><circle cx="62" cy="18" r="6" fill="#34d399"/>
<text x="${w / 2}" y="23" fill="#94a3b8" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="13">$ npx lasik-agents scan ${esc(target)}</text>
<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="13.5" xml:space="preserve" style="white-space:pre">
${body}
</g>
</svg>
`;
writeFileSync(out, svg);
console.log(`wrote ${out} (${lines.length} lines, ${svg.length} bytes)`);
