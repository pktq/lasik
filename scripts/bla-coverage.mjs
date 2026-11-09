#!/usr/bin/env node
// BLA coverage ledger. Every BLA source file is accounted for in coverage/bla.json with the
// sha256 it had when LASIK last caught up. When BLA adds, removes or edits a file, `check`
// fails and lists exactly what to look at.
//
//   node scripts/bla-coverage.mjs check <bla-checkout> [--report out.md]   exit 1 on drift
//   node scripts/bla-coverage.mjs pin <bla-checkout>     record hashes + version after catching up
//   node scripts/bla-coverage.mjs docs                   regenerate docs/coverage.md + README block
//
// The BLA checkout is read as data only; nothing in it is run.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const LEDGER = join(ROOT, "coverage", "bla.json");
const STATUSES = ["healed", "partial", "detect-only", "unrecoverable", "n/a", "pending"];
const COVERED = new Set(["healed", "partial", "detect-only", "unrecoverable", "n/a"]);

const sha = (buf) => createHash("sha256").update(buf.toString("utf8").replace(/\r\n/g, "\n")).digest("hex");

function blaFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mts|cts|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
    }
  };
  walk(join(dir, "src"));
  return new Map(out.map((p) => [relative(dir, p).replace(/\\/g, "/"), sha(readFileSync(p))]));
}

function blaMeta(dir) {
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  let commit = null;
  try {
    commit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  return { version, commit };
}

const load = () => JSON.parse(readFileSync(LEDGER, "utf8"));
const save = (l) => writeFileSync(LEDGER, JSON.stringify(l, null, 2) + "\n");

function validate(ledger) {
  const errs = [];
  for (const e of ledger.files) {
    if (!STATUSES.includes(e.status)) errs.push(`${e.path}: bad status ${e.status}`);
    for (const f of e.lasik ?? []) if (!existsSync(join(ROOT, f))) errs.push(`${e.path}: LASIK file missing: ${f}`);
    if (e.status !== "n/a" && e.status !== "pending" && !(e.lasik ?? []).length) errs.push(`${e.path}: status ${e.status} but no LASIK file`);
  }
  return errs;
}

function check(dir, reportPath) {
  const ledger = load();
  const upstream = blaFiles(dir);
  const meta = blaMeta(dir);
  const known = new Map(ledger.files.map((e) => [e.path, e]));
  const added = [...upstream.keys()].filter((p) => !known.has(p));
  const removed = [...known.keys()].filter((p) => !upstream.has(p));
  const changed = [...upstream].filter(([p, h]) => known.has(p) && known.get(p).sha256 !== h).map(([p]) => p);
  const uncovered = ledger.files.filter((e) => upstream.has(e.path) && !COVERED.has(e.status)).map((e) => e.path);
  const errs = validate(ledger);

  const lines = [`# BLA drift: ${ledger.bla.version} (pinned) vs ${meta.version} (upstream${meta.commit ? " " + meta.commit.slice(0, 7) : ""})`, ""];
  const section = (title, list, hint) => {
    if (!list.length) return;
    lines.push(`## ${title} (${list.length})`, "", hint, "");
    for (const p of list) {
      const e = known.get(p);
      lines.push(`- \`${p}\`${e?.lasik?.length ? ` → ${e.lasik.map((f) => `\`${f}\``).join(", ")}` : ""}`);
    }
    lines.push("");
  };
  section("New BLA files", added, "Read each one; add a LASIK healer (or mark n/a with a reason) in coverage/bla.json.");
  section("Changed since pin", changed, "Diff against the pinned commit; extend the listed LASIK healer if output shape changed.");
  section("Removed upstream", removed, "Keep the healer (old hardened artifacts still exist); drop the ledger entry when convenient.");
  section("Not covered yet", uncovered, "Status is still pending.");
  if (errs.length) lines.push("## Ledger errors", "", ...errs.map((e) => `- ${e}`), "");

  const drift = added.length + changed.length + removed.length + uncovered.length + errs.length;
  if (!drift) lines.push(`No drift: all ${upstream.size} BLA source files accounted for.`);
  if (meta.commit && ledger.bla.commit && meta.commit !== ledger.bla.commit) lines.push("", `Diff: https://github.com/qybaihe/bla/compare/${ledger.bla.commit}...${meta.commit}`);
  const report = lines.join("\n");
  if (reportPath) writeFileSync(reportPath, report + "\n");
  console.log(report);
  process.exitCode = drift ? 1 : 0;
}

function pin(dir) {
  const ledger = load();
  const upstream = blaFiles(dir);
  const byPath = new Map(ledger.files.map((e) => [e.path, e]));
  ledger.bla = blaMeta(dir);
  ledger.files = [...upstream].sort(([a], [b]) => a.localeCompare(b)).map(([path, h]) => {
    const prev = byPath.get(path);
    return prev ? { ...prev, sha256: h } : { path, sha256: h, surface: "", status: "pending", lasik: [], note: "" };
  });
  save(ledger);
  const pending = ledger.files.filter((e) => e.status === "pending").length;
  console.log(`pinned BLA ${ledger.bla.version} (${ledger.files.length} files, ${pending} pending)`);
}

function docs() {
  const ledger = load();
  const errs = validate(ledger);
  if (errs.length) throw new Error(errs.join("\n"));
  const rows = ledger.files.filter((e) => e.status !== "n/a");
  const na = ledger.files.filter((e) => e.status === "n/a");
  const md = [
    "# BLA coverage",
    "",
    `Generated by \`scripts/bla-coverage.mjs docs\` from [coverage/bla.json](../coverage/bla.json). Pinned to BLA **${ledger.bla.version}**${ledger.bla.commit ? ` (\`${ledger.bla.commit.slice(0, 7)}\`)` : ""}.`,
    "",
    "Every BLA source file is listed. A weekly CI job re-hashes upstream BLA and opens an issue when a file is added, removed or changed.",
    "",
    "Status: **healed** = undone, output valid · **partial** = some techniques undone, rest reported · **detect-only** = found and reported, not rewritten · **unrecoverable** = BLA destroyed the information; reported.",
    "",
    "| BLA file | Surface | Status | LASIK | Note |",
    "|---|---|---|---|---|",
    ...rows.map((e) => `| \`${e.path.replace(/^src\//, "")}\` | ${e.surface} | ${e.status} | ${(e.lasik ?? []).map((f) => `\`${f.replace(/^src\//, "")}\``).join("<br>")} | ${e.note ?? ""} |`),
    "",
    `<details><summary>${na.length} BLA files that emit nothing into hardened artifacts (CLI, MCP, setup, lints, reporting)</summary>`,
    "",
    ...na.map((e) => `- \`${e.path}\`${e.note ? `: ${e.note}` : ""}`),
    "",
    "</details>",
    "",
  ].join("\n");
  writeFileSync(join(ROOT, "docs", "coverage.md"), md);

  // README block: one row per surface.
  const surfaces = new Map();
  for (const e of rows) {
    const s = surfaces.get(e.surface) ?? { statuses: new Set(), files: 0 };
    s.statuses.add(e.status);
    s.files++;
    surfaces.set(e.surface, s);
  }
  const worst = (set) => ["pending", "detect-only", "partial", "unrecoverable", "healed"].find((s) => set.has(s)) ?? "healed";
  const icon = { healed: "✅ healed", partial: "🟡 partial", "detect-only": "🔎 detect-only", unrecoverable: "⚪ reported", pending: "⏳ pending" };
  const healed = rows.filter((e) => e.status === "healed").length;
  const block = [
    "<!-- coverage:start -->",
    `Pinned to BLA **${ledger.bla.version}**. ${healed}/${rows.length} BLA shield files fully healed; ${na.length} more emit nothing into artifacts. Full per-file table: [docs/coverage.md](docs/coverage.md).`,
    "",
    "| Surface | Status |",
    "|---|---|",
    ...[...surfaces].sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => `| ${name} | ${icon[worst(s.statuses)]} |`),
    "<!-- coverage:end -->",
  ].join("\n");
  const readmes = [ROOT, join(ROOT, "docs", "readme")].flatMap((d) =>
    existsSync(d) ? readdirSync(d).filter((n) => /^README(\..+)?\.md$/.test(n)).map((n) => join(d, n)) : [],
  );
  for (const p of readmes) {
    const text = readFileSync(p, "utf8");
    const link = relative(join(p, ".."), join(ROOT, "docs", "coverage.md")).replace(/\\/g, "/");
    const next = text.replace(/<!-- coverage:start -->[\s\S]*?<!-- coverage:end -->/, () => block.replace("(docs/coverage.md)", `(${link})`));
    if (next !== text) writeFileSync(p, next);
  }
  console.log(`docs/coverage.md: ${rows.length} shield files, ${na.length} n/a; ${healed} healed`);
}

const [cmd, arg, flag, flagVal] = process.argv.slice(2);
if (cmd === "check" && arg) check(resolve(arg), flag === "--report" ? flagVal : undefined);
else if (cmd === "pin" && arg) pin(resolve(arg));
else if (cmd === "docs") docs();
else {
  console.error("usage: bla-coverage.mjs check <bla-dir> [--report out.md] | pin <bla-dir> | docs");
  process.exitCode = 2;
}
