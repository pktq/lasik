#!/usr/bin/env node
// Benchmark on a project we hardened ourselves with real bla-agents@3.2.1
// (tests/fixtures/bla-3.2.1): heal both runs and compare each file with its clean original.
// Writes the tables into docs/benchmark.md and the summary into the READMEs between
// <!-- realbench:start --> and <!-- realbench:end -->. Usage: node scripts/bench-real.mjs [--check]
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { run } from "../dist/index.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "tests", "fixtures", "bla-3.2.1");
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const num = (n) => n.toLocaleString("en-US");

const runs = { default: "`bla harden .` (defaults, bankrupt intensity)", max: "`bla harden . --weave-decoys --self-seal --llm-directives`" };
const sections = [];
const summary = [];
for (const [set, how] of Object.entries(runs)) {
  const dir = mkdtempSync(join(tmpdir(), `lasik-real-${set}-`));
  try {
    for (const gz of readdirSync(join(FIX, set))) writeFileSync(join(dir, gz.replace(/\.gz$/, "")), gunzipSync(readFileSync(join(FIX, set, gz))));
    const report = run(dir, "heal", { outDir: `${dir}.lasik` });
    let identical = 0, cleanBytes = 0;
    const rows = report.files.map((f) => {
      const clean = readFileSync(join(FIX, "clean", f.file));
      const same = readFileSync(f.output).equals(clean);
      identical += same ? 1 : 0;
      cleanBytes += clean.length;
      return `| \`${f.file}\` | ${f.format} | ${kb(clean.length)} | ${kb(f.bytesBefore)} | ${kb(f.bytesAfter)} | ${num(f.tokensBefore)} → ${num(f.tokensAfter)} | ${same ? "byte-identical" : f.healed ? "healed" : "**not healed**"} |`;
    });
    const t = report.totals;
    sections.push(
      `### ${set === "default" ? "Default run" : "All opt-in layers"}\n\n${how}\n\n` +
        "| File | Format | Original | BLA-hardened | After LASIK | Tokens before → after | Result |\n|---|---|---:|---:|---:|---:|---|\n" +
        rows.join("\n") +
        `\n| **Total** | | **${kb(cleanBytes)}** | **${kb(t.bytesBefore)}** | **${kb(t.bytesAfter)}** | **${num(t.tokensBefore)} → ${num(t.tokensAfter)}** | **${report.files.filter((f) => f.healed).length}/${report.files.length} healed, ${identical} byte-identical** |`,
    );
    summary.push(`| ${set === "default" ? "Defaults" : "All opt-in layers"} | ${report.files.length} | ${kb(cleanBytes)} | ${kb(t.bytesBefore)} | ${kb(t.bytesAfter)} | ${num(t.tokensBefore)} → ${num(t.tokensAfter)} | ${report.files.filter((f) => f.healed).length}/${report.files.length} healed, ${identical} byte-identical |`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}.lasik`, { recursive: true, force: true });
  }
}

const doc =
  "<!-- realbench:start -->\n## Your own code, hardened by real BLA 3.2.1\n\n" +
  "Twenty-one small clean files, one per format (BLA's own JS/TS/Python examples plus generated SQLite, models, PCAP, binaries and more), hardened with the published `bla-agents@3.2.1` and then healed. Originals, BLA's output and how they were made: [tests/fixtures/bla-3.2.1](../tests/fixtures/bla-3.2.1). Reproduce: `npm run build && npm run bench:real`.\n\n" +
  "*byte-identical*: LASIK restored the original file exactly. *healed*: every BLA artifact is gone and the program is the same, but bytes differ (BLA renamed identifiers, re-serialised a header, or dropped a trailing newline).\n\n" +
  sections.join("\n\n") +
  "\n<!-- realbench:end -->";
const readmeBlock = (link) =>
  "<!-- realbench:start -->\nOn a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](" + link + ")):\n\n" +
  "| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |\n|---|---:|---:|---:|---:|---|---|\n" +
  summary.join("\n") +
  "\n<!-- realbench:end -->";

const check = process.argv.includes("--check");
let stale = false;
const put = (path, block) => {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  const next = text.includes("<!-- realbench:start -->")
    ? text.replace(/<!-- realbench:start -->[\s\S]*?<!-- realbench:end -->/, () => block)
    : path.endsWith("benchmark.md") ? `${text.trimEnd()}\n\n${block}\n` : text;
  if (next !== text) {
    stale = true;
    if (!check) writeFileSync(path, next);
  }
};
put(join(ROOT, "docs", "benchmark.md"), doc);
put(join(ROOT, "README.md"), readmeBlock("docs/benchmark.md#your-own-code-hardened-by-real-bla-321"));
for (const f of readdirSync(join(ROOT, "docs", "readme"))) put(join(ROOT, "docs", "readme", f), readmeBlock("../benchmark.md#your-own-code-hardened-by-real-bla-321"));
console.log(summary.join("\n"));
if (check && stale) {
  console.error("benchmark docs are stale: run npm run bench:real");
  process.exitCode = 1;
}
