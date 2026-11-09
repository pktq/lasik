// Builds the generated parts of the site from the real tool: benchmark numbers, the scan
// transcript and docs/how-it-works.md. Run after `npm run build`:  node website/build.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = dirname(fileURLToPath(import.meta.url));
const root = join(site, "..");
const cli = join(root, "dist", "cli.js");
const corpus = "bench/bla-crackme";
const REPO = "https://github.com/pktq/lasik";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
const sh = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

// 1. Benchmark data, straight from `lasik bench --json`.
const bench = JSON.parse(sh("bench", corpus, "--json"));
const files = bench.files.filter((f) => f.findings.length);
const tech = new Map();
for (const f of files) for (const x of f.findings) {
  const k = `${x.layer}\u0000${x.technique}`;
  const t = tech.get(k) ?? { layer: x.layer, technique: x.technique, detail: x.detail, count: 0 };
  t.count += x.count;
  tech.set(k, t);
}
const count = (...ids) => [...tech.values()].filter((t) => ids.includes(t.technique)).reduce((s, t) => s + t.count, 0);
const T = bench.totals;
const data = {
  generated: new Date().toISOString().slice(0, 10),
  version: bench.version,
  corpus,
  verdict: bench.verdict,
  blindness: bench.blindness,
  evasionTechniques: bench.evasion.length,
  totals: T,
  files: files.map((f) => ({ file: f.file, format: f.format, bytesBefore: f.bytesBefore, bytesAfter: f.bytesAfter, tokensBefore: f.tokensBefore, tokensAfter: f.tokensAfter })),
  techniques: [...tech.values()].sort((a, b) => a.layer.localeCompare(b.layer) || b.count - a.count),
};
writeFileSync(join(site, "assets", "bench.json"), JSON.stringify(data, null, 1) + "\n");

// 2. The real scan transcript (layer summary; the per-file list is on the results page).
const scan = sh("scan", corpus).split(/\r?\n/);
const cut = scan.findIndex((l) => l.trim() === "Files");
const transcript = scan.slice(0, cut > 0 ? cut : scan.length).join("\n").trimEnd();
const colour = (line) => {
  let s = esc(line);
  if (/^Verdict:/.test(line)) return s.replace(/(BLINDED|SUSPECTED|CLEAN)/, '<span class="v">$1</span>');
  if (/^AI-evasion/.test(line)) return s.replace(/(\d+)/, '<span class="n">$1</span>');
  if (/^Sight restored/.test(line)) return `<span class="g">${s}</span>`;
  if (/^[A-Z][a-z]+ \(/.test(line)) return `<span class="h">${s}</span>`;
  if (/^LASIK |^Scanned /.test(line)) return `<span class="d">${s}</span>`;
  return s.replace(/^(\s+)(\d+)/, '$1<span class="n">$2</span>');
};

const ratio = T.tokensBefore / T.tokensAfter;
const gen = {
  scan: `<div class="term" data-ui><div class="title">$ npx lasik-agents scan ${corpus}</div><pre>${transcript.split("\n").map(colour).join("\n")}</pre></div>`,
  nums: `<div class="nums">
  <div><b>${fmt(ratio)}×</b><span>fewer tokens for an agent to read (estimate)</span></div>
  <div><b>${fmt(count("opaque-predicate", "seed-bit-predicate"))}</b><span>opaque predicates proven constant</span></div>
  <div><b>${fmt(count("fingerprinted-decoy", "unreachable-decl"))}</b><span>decoy declarations removed</span></div>
  <div><b>0</b><span>lines of the target executed</span></div>
</div>`,
  "results-table": `<div class="table"><table>
<thead><tr><th>Artifact</th><th>Format</th><th class="num">Before</th><th class="num">After</th><th class="num">Est. tokens before → after</th><th class="num">Cheaper</th></tr></thead>
<tbody>
${data.files.map((f) => `<tr><td><code>${esc(f.file)}</code></td><td><span class="fmt">${f.format}</span></td><td class="num">${kb(f.bytesBefore)}</td><td class="num">${kb(f.bytesAfter)}</td><td class="num">${fmt(f.tokensBefore)} → ${fmt(f.tokensAfter)}</td><td class="num">${fmt(f.tokensBefore / f.tokensAfter)}×</td></tr>`).join("\n")}
</tbody>
<tfoot><tr><td>${data.files.length} hardened artifacts</td><td></td><td class="num">${kb(T.bytesBefore)}</td><td class="num">${kb(T.bytesAfter)}</td><td class="num">${(T.tokensBefore / 1e6).toFixed(1)} M → ${fmt(T.tokensAfter / 1000)} k</td><td class="num">${fmt(ratio)}×</td></tr></tfoot>
</table></div>`,
  techniques: [...new Set(data.techniques.map((t) => t.layer))].map((layer) => `<h3>${layer[0].toUpperCase() + layer.slice(1)}</h3>
<div class="table"><table><tbody>
${data.techniques.filter((t) => t.layer === layer).map((t) => `<tr><td class="num">${fmt(t.count)}</td><td>${esc(t.detail).replace(/`([^`]+)`/g, "<code>$1</code>")} <span class="fmt">${esc(t.technique)}</span></td></tr>`).join("\n")}
</tbody></table></div>`).join("\n"),
  help: `<div class="term" data-ui><div class="title">$ lasik --help</div><pre>${esc(sh("--help").trimEnd())}</pre></div>`,
  stamp: `Generated ${data.generated} with LASIK ${esc(data.version)} on <code>${corpus}</code>: BLA's published CrackMe outputs v6–v9 (MIT), vendored unchanged. Verdict <strong>${data.verdict}</strong>, blindness ${data.blindness}/100, ${data.evasionTechniques} AI-evasion techniques.`,
};

// 3. docs/how-it-works.md as a page, with an on-page index.
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\- ]/g, "").replace(/ /g, "-");
const link = (href) => /^(https?:|#|mailto:)/.test(href) ? href : href.startsWith("../") ? `${REPO}/blob/main/${href.slice(3)}` : `${REPO}/blob/main/docs/${href}`;
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${link(h)}">${t}</a>`);
const certainty = (html) => html.replace(/<strong>(Exact(?: proof)?|exact)<\/strong>/g, '<span class="cert cert--exact">$1</span>');

function markdown(md) {
  const lines = md.split(/\r?\n/), out = [], toc = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^Contents:/.test(l) || !l.trim()) continue;
    let m;
    if ((m = l.match(/^(#{1,4}) (.*)$/))) {
      const n = m[1].length, text = inline(m[2]), id = slug(m[2].replace(/`/g, ""));
      if (n === 2 || n === 3) toc.push({ n, id, text: inline(m[2].replace(/\s*\(`[^)]*`\)\s*$/, "")) });
      out.push(`<h${n} id="${id}">${text}</h${n}>`);
    } else if (l.startsWith("```")) {
      const lang = l.slice(3).trim(), buf = [];
      while (++i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i]);
      out.push(`<div class="code"${lang ? ` data-lang="${lang}"` : ""}><pre><code>${esc(buf.join("\n"))}</code></pre></div>`);
    } else if (l.startsWith("|")) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i].slice(1, -1).split("|").map((c) => c.trim()));
      i--;
      const align = rows[1].map((c) => (c.endsWith(":") ? ' class="num"' : ""));
      out.push(`<div class="table"><table><thead><tr>${rows[0].map((c, j) => `<th${align[j]}>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${r.map((c, j) => `<td${align[j]}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l), items = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, ""));
      i--;
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
    } else {
      const buf = [l];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\||- |\d+\. )/.test(lines[i + 1])) buf.push(lines[++i]);
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
  }
  return { html: certainty(out.join("\n")), toc };
}

// Shared chrome lives in index.html between chrome markers.
const index = readFileSync(join(site, "index.html"), "utf8");
const between = (s, name) => s.match(new RegExp(`<!-- ${name} -->([\\s\\S]*?)<!-- /${name} -->`))[1];
const head = between(index, "chrome:head"), top = between(index, "chrome:top"), foot = between(index, "chrome:foot");
const withTitle = (h, title, desc) => h.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/(<meta name="description" content=")[^"]*/, `$1${esc(desc)}`);
const current = (t, href) => t.replace(`href="${href}"`, `href="${href}" aria-current="page"`);

const doc = markdown(readFileSync(join(root, "docs", "how-it-works.md"), "utf8"));
const tocHtml = `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${doc.toc.map((t) => `<li${t.n === 3 ? ' class="sub"' : ""}><a href="#${t.id}">${t.text}</a></li>`).join("")}</ul></nav>`;
writeFileSync(join(site, "how-it-works.html"), `<!doctype html>
<html lang="en">
<head><!-- chrome:head -->${withTitle(head, "How LASIK works", "Pass order, the known-bits prover, format healers, the prompt firewall and the blindness score.")}<!-- /chrome:head --></head>
<body>
<!-- chrome:top -->${current(top, "how-it-works.html")}<!-- /chrome:top -->
<main id="main" class="container docs">
${tocHtml}
<article class="doc">
${doc.html}
<p class="muted" style="margin-top:48px">This page is generated from <a href="${REPO}/blob/main/docs/how-it-works.md">docs/how-it-works.md</a>.</p>
</article>
</main>
<!-- chrome:foot -->${foot}<!-- /chrome:foot -->
</body>
</html>
`);

// 4. Fill generated regions and shared chrome in the hand-written pages.
for (const page of ["index.html", "docs.html", "crackme.html"]) {
  const path = join(site, page);
  let s = readFileSync(path, "utf8");
  for (const [name, html] of Object.entries(gen)) s = s.replace(new RegExp(`(<!-- gen:${name} -->)[\\s\\S]*?(<!-- /gen:${name} -->)`, "g"), `$1${html}$2`);
  if (page !== "index.html") {
    const title = s.match(/<title>([^<]*)<\/title>/)[1], desc = s.match(/<meta name="description" content="([^"]*)"/)[1];
    s = s.replace(/<head><title>[^<]*<\/title>\s*<meta name="description"[^>]*>\s*/, "<head>");
    s = s.replace(/<!-- chrome:head -->[\s\S]*?<!-- \/chrome:head -->/, `<!-- chrome:head -->${withTitle(head, title, desc)}<!-- /chrome:head -->`)
      .replace(/<!-- chrome:top -->[\s\S]*?<!-- \/chrome:top -->/, `<!-- chrome:top -->${current(top, page)}<!-- /chrome:top -->`)
      .replace(/<!-- chrome:foot -->[\s\S]*?<!-- \/chrome:foot -->/, `<!-- chrome:foot -->${foot}<!-- /chrome:foot -->`);
  }
  writeFileSync(path, s);
}
console.log(`site built: ${data.files.length} artifacts, ${fmt(ratio)}× tokens, ${doc.toc.length} doc sections`);
