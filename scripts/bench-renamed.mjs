#!/usr/bin/env node
// The "renamed BLA" bench: heal real BLA output as-is and after mutate-bla.mjs gave every
// BLA identifier and comment a fresh spelling. A LASIK that keys on what the code does
// heals both the same; one that keys on BLA's names falls over on the second.
// Usage: node scripts/bench-renamed.mjs [--json] [--check]
// --check exits 1 when the renamed run removes more than a point less than the original (overall or JS/HTML).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { run } from "../dist/index.js";
import { mutateAsar, mutateHtml, mutateJs, mutateWasm } from "./mutate-bla.mjs";

const ROOT = join(import.meta.dirname, "..");
const REAL = join(ROOT, "tests", "fixtures", "bla-3.2.1");
const CRACKME = join(ROOT, "bench", "bla-crackme");
const JS = /\.(?:c|m)?[jt]s$/;
const HTML = /\.html?$/;
const WASM = /\.wasm(?:\.gz)?$/;
const ASAR = /\.asar$/;
const read = (path) => {
  const raw = readFileSync(path);
  return raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
};

function walk(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

/** [{ set, file, src, clean? }] for every JS/HTML target. */
function targets() {
  const out = [];
  for (const set of ["default", "max"]) {
    for (const gz of readdirSync(join(REAL, set))) {
      const file = gz.replace(/\.gz$/, "");
      if (WASM.test(file) || ASAR.test(file)) out.push({ set: `bla-3.2.1/${set}`, file, src: read(join(REAL, set, gz)) });
      if (!JS.test(file) && !HTML.test(file)) continue;
      out.push({ set: `bla-3.2.1/${set}`, file, src: read(join(REAL, set, gz)).toString("utf8"), clean: readFileSync(join(REAL, "clean", file), "utf8") });
    }
  }
  for (const f of walk(CRACKME)) {
    const rel = relative(CRACKME, f).replaceAll("\\", "/");
    const set = `crackme/${rel.split("/")[0]}`;
    const file = rel.split("/").slice(1).join("/").replace(/\.gz$/, "");
    if (WASM.test(f)) out.push({ set, file, src: read(f) });
    if (!JS.test(f) && !HTML.test(f)) continue;
    out.push({ set, file, src: readFileSync(f, "utf8") });
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
      return { before: f?.tokensBefore ?? 0, after: f?.tokensAfter ?? 0 };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}.lasik`, { recursive: true, force: true });
  }
}

const list = targets();
const mutated = list.map((t) => {
  const r = (ASAR.test(t.file) ? mutateAsar : WASM.test(t.file) ? mutateWasm : HTML.test(t.file) ? mutateHtml : mutateJs)(t.src, { clean: t.clean, filename: t.file });
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
const share = (subset) => {
  const sum = (k) => subset.reduce((s, r) => s + r[k], 0);
  const t = { before: sum("before"), healed: sum("healed"), renamedBefore: sum("renamedBefore"), renamedHealed: sum("renamedHealed") };
  // Share of each input LASIK removes; renaming reprints the input, so compare shares, not counts.
  t.reduction = 1 - t.healed / t.before;
  t.renamedReduction = 1 - t.renamedHealed / t.renamedBefore;
  return t;
};
const totals = share(rows);
const js = share(rows.filter((r) => JS.test(r.target) || HTML.test(r.target)));
const pct = (x) => `${(x * 100).toFixed(2)}%`;

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ rows, totals, js }, null, 2)}\n`);
} else {
  const n = (x) => x.toLocaleString("en-US");
  const w = Math.max(...rows.map((r) => r.target.length));
  console.log(`${"target".padEnd(w)}  renamed  original: before → healed     renamed: before → healed`);
  for (const r of rows) console.log(`${r.target.padEnd(w)}  ${String(r.renamed).padStart(7)}  ${n(r.before).padStart(10)} → ${n(r.healed).padEnd(10)}  ${n(r.renamedBefore).padStart(10)} → ${n(r.renamedHealed)}`);
  console.log(`\nJS/HTML  original ${n(js.before)} → ${n(js.healed)}; renamed ${n(js.renamedBefore)} → ${n(js.renamedHealed)}; removed ${pct(js.reduction)} vs ${pct(js.renamedReduction)}`);
  console.log(`all      original ${n(totals.before)} → ${n(totals.healed)}; renamed ${n(totals.renamedBefore)} → ${n(totals.renamedHealed)}; removed ${pct(totals.reduction)} vs ${pct(totals.renamedReduction)}`);
}
// --check: renamed BLA may cost at most one point of reduction, overall and on JS/HTML alone.
if (process.argv.includes("--check")) {
  for (const [label, t] of [["all", totals], ["JS/HTML", js]]) {
    if (t.renamedReduction < t.reduction - 0.01) {
      console.error(`${label}: renamed BLA heals worse than the original: ${pct(t.renamedReduction)} vs ${pct(t.reduction)}`);
      process.exitCode = 1;
    }
  }
}
