#!/usr/bin/env node
// Side-by-side "BLA-hardened vs after LASIK" image for the README.
// Both panels are real lines from BLA's CrackMe v6 vault.cjs and LASIK's output for it.
// Usage: node scripts/before-after-svg.mjs [out.svg]
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "docs/assets/before-after.svg";

const before = [
  'const attestTransientCursor_e36 = require("fs");',
  'const traceLazyEdge_261 = require("crypto");',
  "function decodeRemoteBundle_e2a(mirrorDurableSensor_d6c) {",
  "  stepShadowHeapActiveGraph_a301(3056);",
  "  if ((Math.imul(runtimeSeedPrimaryHandle_be53 ^ 100, runtimeSeedPrimar…",
  "    _verifyEnclaveAttestationService_8589(175, 2) ^ _auditMonotonicCou…",
  "  }",
  "  return traceLazyEdge_261.createHash(((Math.imul(runtimeSeedPrimaryHa…",
  '    | 15) + 1) & 1) === 0 ? "s" : "b") + ((Math.imul(runtimeSeedPrimar…',
  '    124, runtimeSeedPrimaryHandle_be53 ^ 124) & 7) === 0 ? "1" : "h") …',
  "}",
  "function transformInlineSample_6bd() {",
  "  stepShadowHeapActiveGraph_a301(2754);",
  "  if ((Math.imul(runtimeSeedPrimaryHandle_be53 ^ 88, runtimeSeedPrimary…",
  "    _deriveHardwareKdfSchedulQueue_b7a5(107, 2) ^ _negotiateVsockChann…",
  "  }",
  "  const decodeInlineBuffer_e42 = attestTransientCursor_e36.readFileSyn…",
];

const after = [
  'const fs = require("fs");',
  'const path = require("path");',
  'const crypto = require("crypto");',
  "function decodeRemoteBundle_e2a(mirrorDurableSensor_d6c) {",
  "  return crypto.createHash(\"sha256\")",
  '    .update(mirrorDurableSensor_d6c).digest("hex");',
  "}",
  "function transformInlineSample_6bd() {",
  "  const decodeInlineBuffer_e42 = fs.readFileSync(",
  '    path.join(__dirname, "core.wasm"));',
  "  return WebAssembly.instantiate(decodeInlineBuffer_e42)",
  "    .then(schedulePrivateWorker_1ef =>",
  "      schedulePrivateWorker_1ef.instance.exports);",
  "}",
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tiny highlighter: strings, numbers, keywords, BLA noise. Returns tspans. */
function highlight(line, noisy) {
  const tokens = line.split(/("(?:[^"\\]|\\.)*"|\b(?:const|function|return|if|require)\b|\b\d+\b|Math\.imul|stepShadowHeap\w*|runtimeSeed\w*|_\w+_[0-9a-f]{4}\b)/g);
  return tokens
    .map((tok) => {
      if (!tok) return "";
      let fill = noisy ? "#9aa4b5" : "#d7dce5";
      if (/^"/.test(tok)) fill = "#9ece6a";
      else if (/^(const|function|return|if|require)$/.test(tok)) fill = "#bb9af7";
      else if (/^\d+$/.test(tok)) fill = "#ff9e64";
      else if (noisy && /^(Math\.imul|stepShadowHeap|runtimeSeed|_\w+_[0-9a-f]{4})/.test(tok)) fill = "#f7768e";
      return `<tspan fill="${fill}">${esc(tok)}</tspan>`;
    })
    .join("");
}

const W = 1280;
const pad = 28;
const gap = 24;
const pw = (W - 2 * pad - gap) / 2;
const lh = 21;
const top = 92;
const rows = Math.max(before.length, after.length);
const H = top + rows * lh + 34;

const panel = (x, title, meta, lines, noisy, accent) => `
  <rect x="${x}" y="${pad}" width="${pw}" height="${H - 2 * pad + 8}" rx="12" fill="#0d1117" stroke="#30363d"/>
  <circle cx="${x + 20}" cy="${pad + 22}" r="5" fill="${accent}"/>
  <text x="${x + 34}" y="${pad + 27}" fill="#e6edf3" font-size="14" font-weight="600" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${esc(title)}</text>
  <text x="${x + pw - 18}" y="${pad + 27}" fill="#8b949e" font-size="13" text-anchor="end" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${esc(meta)}</text>
  <line x1="${x}" x2="${x + pw}" y1="${pad + 44}" y2="${pad + 44}" stroke="#30363d"/>
  <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12.5" style="white-space:pre" xml:space="preserve">
${lines
  // Indent by x offset (0.6em per space): renderers collapse leading spaces in SVG text.
  .map((l, i) => `    <text x="${(x + 18 + (l.length - l.trimStart().length) * 7.5).toFixed(1)}" y="${top + i * lh}">${highlight(l.trimStart(), noisy)}</text>`)
  .join("\n")}
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The same two functions of BLA CrackMe v6, BLA-hardened on the left and after LASIK on the right">
  <rect width="${W}" height="${H}" rx="16" fill="#010409"/>${panel(pad, "BLA-hardened", "vault.cjs · 164 KB · 2,680 lines", before, true, "#f7768e")}${panel(pad + pw + gap, "After lasik heal", "5.5 KB · 99 lines", after, false, "#73daca")}
</svg>
`;
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes)`);
