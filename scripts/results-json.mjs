#!/usr/bin/env node
// Re-measure the CrackMe benchmark and write website/assets/results.json
// (schema used by the website: files[] of {set, file, original?, hardened, lasik}).
// Usage: npm run build && node scripts/results-json.mjs
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../dist/index.js";

const BENCH = "bench/bla-crackme";
const OUT = "website/assets/results.json";
const TEXT = new Set(["javascript", "html", "python"]);

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { files: [] };
const original = new Map(prev.files.filter((f) => f.original).map((f) => [`${f.set}/${f.file}`, f.original]));

const out = mkdtempSync(join(tmpdir(), "lasik-results-"));
const report = run(BENCH, "heal", { outDir: out });
const lines = (buf) => buf.toString("utf8").split("\n").length - (buf.at(-1) === 0x0a ? 1 : 0);

const files = report.files
  .filter((f) => f.findings.length && TEXT.has(f.format))
  .map((f) => {
    const [set, ...rest] = f.file.split("/");
    const file = rest.join("/");
    const before = readFileSync(join(BENCH, f.file));
    const after = readFileSync(f.output);
    const entry = { set, file, format: f.format };
    const o = original.get(`${set}/${file}`);
    if (o) entry.original = o;
    entry.hardened = { bytes: before.length, lines: lines(before), tokens: f.tokensBefore };
    entry.lasik = { bytes: after.length, lines: lines(after), tokens: f.tokensAfter };
    return entry;
  });

const doc = {
  measured: new Date().toISOString().slice(0, 10),
  status: "measured with the current LASIK build; tokens are estimates (~4 chars/token for code, 2 for hex/base64, 1 per byte for binary)",
  source: "BLA challenge/ CrackMe files v6–v9 (bla-agents v3.2.1), vendored in bench/bla-crackme",
  totals: {
    artifacts: report.totals.blinded,
    bytesBefore: report.totals.bytesBefore,
    bytesAfter: report.totals.bytesAfter,
    tokensBefore: report.totals.tokensBefore,
    tokensAfter: report.totals.tokensAfter,
    blindness: report.blindness,
    evasionTechniques: report.evasion.length,
  },
  files,
};
writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
console.log(`wrote ${OUT}: ${files.length} files, tokens ${doc.totals.tokensBefore} -> ${doc.totals.tokensAfter}`);
