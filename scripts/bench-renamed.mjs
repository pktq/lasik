#!/usr/bin/env node
// The "renamed BLA" bench: heal real BLA output as-is and after mutate-bla.mjs gave every
// BLA identifier and comment a fresh spelling. A LASIK that keys on what the code does
// heals both the same; one that keys on BLA's names falls over on the second.
// Usage: node scripts/bench-renamed.mjs [--json]
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { run } from "../dist/index.js";
import { mutateHtml, mutateJs } from "./mutate-bla.mjs";

const ROOT = join(import.meta.dirname, "..");
const REAL = join(ROOT, "tests", "fixtures", "bla-3.2.1");
const CRACKME = join(ROOT, "bench", "bla-crackme");
const JS = /\.(?:c|m)?[jt]s$/;
const HTML = /\.html?$/;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

/** [{ set, file, src, clean? }] for every JS/HTML target. */
function targets() {
  const out = [];
  for (const set of ["default", "max"]) {
    for (const gz of readdirSync(join(REAL, set))) {
      const file = gz.replace(/\.gz$/, "");
      if (!JS.test(file) && !HTML.test(file)) continue;
      out.push({ set: `bla-3.2.1/${set}`, file, src: gunzipSync(readFileSync(join(REAL, set, gz))).toString("utf8"), clean: readFileSync(join(REAL, "clean", file), "utf8") });
    }
  }
  for (const f of walk(CRACKME)) {
    if (!JS.test(f) && !HTML.test(f)) continue;
    const rel = relative(CRACKME, f).replaceAll("\\", "/");
    out.push({ set: `crackme/${rel.split("/")[0]}`, file: rel.split("/").slice(1).join("/"), src: readFileSync(f, "utf8") });
  }
  return out;
}

function heal(items) {
  const dir = mkdtempSync(join(tmpdir(), "lasik-renamed-"));
  try {
    items.forEach((it, i) => {
      const p = join(dir, String(i), it.file);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, it.code);
    });
    const report = run(dir, "heal", { outDir: `${dir}.lasik` });
    return items.map((it, i) => {
      const key = `${i}/${it.file}`;
      const f = report.files.find((x) => x.file.replaceAll("\\", "/") === key);
      return { before: f?.tokensBefore ?? 0, after: f?.tokensAfter ?? 0, out: f?.output ? readFileSync(f.output, "utf8") : it.code };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}.lasik`, { recursive: true, force: true });
  }
}

const list = targets();
const mutated = list.map((t) => {
  const r = (HTML.test(t.file) ? mutateHtml : mutateJs)(t.src, { clean: t.clean, filename: t.file });
  return { ...t, code: r.code, renamed: r.renamed };
});
const a = heal(list.map((t) => ({ ...t, code: t.src })));
const b = heal(mutated);

const rows = list.map((t, i) => ({
  target: `${t.set}/${t.file}`,
  renamed: mutated[i].renamed,
  before: a[i].before,
  healed: a[i].after,
  renamedBefore: b[i].before,
  renamedHealed: b[i].after,
}));
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const totals = { before: sum("before"), healed: sum("healed"), renamedBefore: sum("renamedBefore"), renamedHealed: sum("renamedHealed") };
// Share of each input LASIK removes; renaming reprints the input, so compare shares, not counts.
totals.reduction = 1 - totals.healed / totals.before;
totals.renamedReduction = 1 - totals.renamedHealed / totals.renamedBefore;

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({ rows, totals }, null, 2) + "\n");
} else {
  const n = (x) => x.toLocaleString("en-US");
  const w = Math.max(...rows.map((r) => r.target.length));
  console.log(`${"target".padEnd(w)}  renamed  original: before → healed     renamed: before → healed`);
  for (const r of rows) console.log(`${r.target.padEnd(w)}  ${String(r.renamed).padStart(7)}  ${n(r.before).padStart(10)} → ${n(r.healed).padEnd(10)}  ${n(r.renamedBefore).padStart(10)} → ${n(r.renamedHealed)}`);
  console.log(`\ntotal original ${n(totals.before)} → ${n(totals.healed)}; renamed ${n(totals.renamedBefore)} → ${n(totals.renamedHealed)}; removed ${(totals.reduction * 100).toFixed(2)}% vs ${(totals.renamedReduction * 100).toFixed(2)}%`);
}
