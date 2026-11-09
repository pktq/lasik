#!/usr/bin/env node
// README visual for the resilience benchmark: docs/assets/renamed.svg (examples of what the
// benchmark respells, and tokens left per format).
// Numbers come from a fresh `scripts/bench-renamed.mjs --json` run; the renames are the real
// spellings mutate-bla.mjs produces. Usage: node scripts/renamed-svg.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshName } from "./mutate-bla.mjs";

const ROOT = join(import.meta.dirname, "..");
const SANS = "ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const C = { bg: "#0b1020", panel: "#111833", line: "#1e293b", ink: "#e6edff", muted: "#94a3b8", faint: "#64748b", grey: "#475569", accent: "#22d3ee", accentSoft: "#67e8f9" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x, y, s, { size = 13, fill = C.ink, font = SANS, weight = 400, anchor = "start", extra = "" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`;
const n = (x) => x.toLocaleString("en-US");
const short = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : n(x));

// ---- data ------------------------------------------------------------------------------------
const bench = JSON.parse(execFileSync(process.execPath, [join(ROOT, "scripts", "bench-renamed.mjs"), "--json"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString());
const kinds = [
  ["JavaScript / TS", (t) => /\.(?:c|m)?[jt]s$/.test(t)],
  ["HTML", (t) => /\.html?$/.test(t)],
  ["WebAssembly", (t) => /\.wasm$/.test(t)],
  ["Electron ASAR", (t) => /\.asar$/.test(t)],
];
const groups = kinds.map(([label, test]) => {
  const rows = bench.rows.filter((r) => test(r.target));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  return { label, files: rows.length, before: sum("before"), healed: sum("healed"), renamed: sum("renamedHealed") };
});

// ---- renamed.svg -----------------------------------------------------------------------------
{
  const W = 1100, H = 540;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Respelled builds heal to nearly the same size as the originals">`];
  out.push(`<rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>`);
  out.push(text(32, 44, "Resilience: same result on respelled builds", { size: 20, weight: 600 }));
  out.push(text(32, 66, "Real protected builds and the public CrackMes, healed as shipped and with every generated name respelled.", { size: 13, fill: C.muted }));

  // Left: the patch, with the spellings mutate-bla.mjs really produces.
  const L = 32, top = 100;
  out.push(`<rect x="${L}" y="${top}" width="476" height="${H - top - 32}" rx="10" fill="${C.panel}"/>`);
  out.push(text(L + 20, top + 30, "RESPELLED BY THE BENCHMARK", { size: 11, fill: C.faint, weight: 600, extra: ' letter-spacing="1.2"' }));
  const pairs = [
    ["_interlockSafetyCorpus_f637", freshName("lasik", "_interlockSafetyCorpus_f637"), "identifier"],
    ["typeof D === \"function\" && D(0) === N", "\"function\" === typeof zq && N === zq(0)", "operands"],
    ["/* project quota policy (35c544) */", "/* drift pivot b42f2e */", "comment"],
    ["bla.wasm.interface.exhaustion", freshName("lasik", "bla.wasm.interface.exhaustion") + "…", "wasm section"],
    ["enclave/shards/ring0-slot-0007.json", `${freshName("lasik", "enclave")}/${freshName("lasik", "ring0-slot-0007.json")}.json`, "asar path"],
  ];
  pairs.forEach(([from, to, tag], i) => {
    const y = top + 70 + i * 72;
    out.push(text(L + 20, y, from, { size: 12.5, fill: C.faint, font: MONO, extra: ' text-decoration="line-through"' }));
    out.push(text(L + 20, y + 22, `→ ${to}`, { size: 12.5, fill: C.ink, font: MONO }));
    out.push(text(L + 456, y, tag, { size: 11, fill: C.faint, anchor: "end" }));
  });

  // Right: tokens left per format (log scale), hardened vs healed vs renamed+healed.
  const R = 540, cw = W - R - 32, x0 = R + 128, x1 = R + cw - 70;
  out.push(`<rect x="${R}" y="${top}" width="${cw}" height="${H - top - 32}" rx="10" fill="${C.panel}"/>`);
  out.push(text(R + 20, top + 30, "TOKENS AN AGENT MUST READ (LOG SCALE)", { size: 11, fill: C.faint, weight: 600, extra: ' letter-spacing="1.2"' }));
  const lx = (v) => x0 + ((Math.log10(Math.max(v, 10)) - 2) / (8 - 2)) * (x1 - x0);
  for (let e = 2; e <= 8; e += 2) {
    const x = lx(10 ** e);
    out.push(`<line x1="${x.toFixed(1)}" y1="${top + 48}" x2="${x.toFixed(1)}" y2="${H - 82}" stroke="${C.line}"/>`);
    out.push(text(x.toFixed(1), H - 66, e === 2 ? "100" : e === 4 ? "10k" : e === 6 ? "1M" : "100M", { size: 11, fill: C.faint, anchor: "middle" }));
  }
  groups.forEach((g, i) => {
    const y = top + 66 + i * 84;
    out.push(text(R + 20, y + 12, g.label, { size: 13, fill: C.ink }));
    out.push(text(R + 20, y + 30, `${g.files} files`, { size: 11, fill: C.faint }));
    const bar = (v, dy, fill, stroke = "") => {
      out.push(`<rect x="${x0}" y="${y + dy}" width="${(lx(v) - x0).toFixed(1)}" height="11" rx="2" fill="${fill}"${stroke}/>`);
      out.push(text((lx(v) + 6).toFixed(1), y + dy + 10, short(v), { size: 11, fill: fill === C.grey ? C.muted : C.accentSoft }));
    };
    bar(g.before, 0, C.grey);
    bar(g.healed, 15, C.accent);
    bar(g.renamed, 30, "none", ` stroke="${C.accent}" stroke-width="1.5" stroke-dasharray="3 2"`);
  });
  const ly = H - 46;
  const key = (x, fill, label, stroke = "") => {
    out.push(`<rect x="${x}" y="${ly - 10}" width="12" height="12" rx="2" fill="${fill}"${stroke}/>`);
    out.push(text(x + 18, ly, label, { size: 12, fill: C.muted }));
  };
  key(R + 20, C.grey, "BLA-hardened");
  key(R + 140, C.accent, "healed");
  key(R + 220, "none", "respelled, then healed", ` stroke="${C.accent}" stroke-width="1.5" stroke-dasharray="3 2"`);
  out.push("</svg>");
  writeFileSync(join(ROOT, "docs", "assets", "renamed.svg"), out.join("\n") + "\n");
}

console.log(groups.map((g) => `${g.label}: ${n(g.before)} → ${n(g.healed)} (renamed ${n(g.renamed)})`).join("\n"));
