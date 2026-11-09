import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/**
 * BLA's Python tarpit predicate (always false: x(x+1) is even for every int,
 * so the last conjunct can never hold):
 *   (((7 * ((S | k) ** 2) - 1) & 0xFFFFFFFF) == (((S ^ j) ** 2) & 0xFFFFFFFF) and ((S * (S + 1)) & 1) == 1)
 */
const P1 = /\(\(([A-Za-z_]\w*) \* \(\1 \+ 1\)\) & 1\) == 1/;
const P1_HEAD = /\(\(\(7 \* \(\(([A-Za-z_]\w*) \| \d+\) \*\* 2\) - 1\) & 0xFFFFFFFF\) == \(\(\(\1 \^ \d+\) \*\* 2\) & 0xFFFFFFFF\)/;

/** Names BLA generates: stem + 4-hex tag (`_cff1`, `_CE31`), plus its fixed honeypot names. */
const BLA_NAME = /^[A-Za-z_]\w*_[0-9a-fA-F]{4}$/;
const HONEYPOT_NAMES = new Set([
  "CANARY_TOKENS", "AMBIGUOUS_TRANSPORT", "CONFLICTING_QUERY", "SYSTEM_DIAGNOSTICS",
  "ALIGNMENT_EVAL_CANARY_GUID", "COGNITIVE_ARMOR_CORPUS", "probe_canary_honeypot",
]);

interface Block {
  start: number;
  end: number; // exclusive
  defines: string[];
  text: string;
}

const indentOf = (l: string) => l.length - l.trimStart().length;

/** Bracket depth change of one line, ignoring brackets inside simple string literals and comments. */
function depthDelta(line: string): number {
  const code = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""').replace(/#.*$/, "");
  let d = 0;
  for (const ch of code) {
    if (ch === "(" || ch === "[" || ch === "{") d++;
    else if (ch === ")" || ch === "]" || ch === "}") d--;
  }
  return d;
}

/** Split a module into top-level statements (a def/class with its body, or one possibly multi-line statement). */
function topLevelBlocks(lines: string[]): Block[] | undefined {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trimStart().startsWith("#")) { i++; continue; }
    if (indentOf(line) !== 0) return undefined; // not a shape we understand: don't touch the file
    const start = i;
    let depth = depthDelta(line);
    let tripleOpen = (line.match(/"""|'''/g)?.length ?? 0) % 2 === 1;
    i++;
    const compound = /^(def|class|async\s+def|if|for|while|with|try|@)/.test(line) || line.trimEnd().endsWith(":");
    while (i < lines.length) {
      const l = lines[i]!;
      if (depth > 0 || tripleOpen) {
        depth += depthDelta(l);
        if ((l.match(/"""|'''/g)?.length ?? 0) % 2 === 1) tripleOpen = !tripleOpen;
        i++;
        continue;
      }
      if (compound && (l.trim() === "" || indentOf(l) > 0 || /^(elif|else|except|finally)\b/.test(l))) {
        depth += depthDelta(l);
        if ((l.match(/"""|'''/g)?.length ?? 0) % 2 === 1) tripleOpen = !tripleOpen;
        i++;
        continue;
      }
      break;
    }
    let end = i;
    while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
    const head = lines[start]!;
    const defines: string[] = [];
    const def = head.match(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/);
    if (def) defines.push(def[1]!);
    const asg = head.match(/^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/);
    if (asg) defines.push(asg[1]!);
    blocks.push({ start, end, defines, text: lines.slice(start, end).join("\n") });
  }
  return blocks;
}

const words = (s: string) => new Set(s.match(/[A-Za-z_]\w*/g) ?? []);

/**
 * Heal a BLA-hardened Python module: drop `if` blocks guarded by the
 * always-false tarpit predicate, drop writes to BLA's private slot, then
 * remove the prepended tarpit/honeypot blocks once no real code refers to them.
 * Text-structural (BLA's emitter is regular); never imports or runs the module.
 */
export const healPython: FormatHealer = (input) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = { output: input, findings, warnings, changed: false };
  const src = input.toString("utf8");
  if (!P1.test(src) && !/ALIGNMENT_EVAL_CANARY_GUID|SHARD_ENVELOPE_MANIFEST_TABLE_/.test(src)) return unchanged;

  let lines = src.split(/\r?\n/);

  // BLA's private slot: `NAME_XXXX: dict = {"epoch": 0, "peer": 0, "tag": 0}`
  const slots = new Set<string>();
  for (const l of lines) {
    const m = l.match(/^([A-Z][A-Z0-9_]*_[0-9A-F]{4})\s*:\s*dict\s*=\s*\{"epoch": 0, "peer": 0, "tag": 0\}\s*$/);
    if (m) slots.add(m[1]!);
  }

  // 1. Inside function bodies: dead tarpit ifs and slot writes.
  let deadIfs = 0;
  let slotWrites = 0;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const ind = indentOf(l);
    const ifm = l.match(/^\s+if (.*):\s*$/);
    if (ifm && P1.test(ifm[1]!) && P1_HEAD.test(ifm[1]!) && !/\bor\b/.test(ifm[1]!.replace(P1, "").replace(P1_HEAD, ""))) {
      // A conjunction containing an always-false term is false; skip the guarded body.
      let j = i + 1;
      while (j < lines.length && (lines[j]!.trim() === "" || indentOf(lines[j]!) > ind)) j++;
      if (j < lines.length && /^\s*(elif|else)\b/.test(lines[j]!) && indentOf(lines[j]!) === ind) {
        kept.push(l); // has an else branch: leave it for a reader rather than restructure
        continue;
      }
      deadIfs++;
      i = j - 1;
      continue;
    }
    const slotm = ind > 0 && [...slots].some((s) => l.trimStart().startsWith(`${s}[`) && /\]\s*=\s*/.test(l) && depthDelta(l) === 0);
    if (slotm) {
      slotWrites++;
      continue;
    }
    kept.push(l);
  }
  lines = kept;

  // 2. Top-level tarpit / honeypot blocks no real code refers to.
  const blocks = topLevelBlocks(lines);
  let removedBlocks = 0;
  if (blocks) {
    const isBla = (b: Block) =>
      (b.defines.length > 0 && b.defines.every((n) => BLA_NAME.test(n) || HONEYPOT_NAMES.has(n))) ||
      // top-level calls into BLA code: `warm_xxxx(STATE & 0xFF)`, `_ = probe_canary_honeypot(0)`
      (b.defines.length === 0 && [...words(b.text)].some((w) => BLA_NAME.test(w) || HONEYPOT_NAMES.has(w)) &&
        /^[A-Za-z_]\w*\(/.test(b.text.trim())) ||
      /^_\s*=\s*probe_canary_honeypot\(/.test(b.text.trim());
    const removable = new Set(blocks.filter(isBla));
    // Anything a kept block mentions stays.
    let grew = true;
    while (grew) {
      grew = false;
      const keptWords = new Set<string>();
      for (const b of blocks) if (!removable.has(b)) for (const w of words(b.text)) keptWords.add(w);
      for (const b of [...removable]) {
        if (b.defines.some((n) => keptWords.has(n))) {
          removable.delete(b);
          grew = true;
        }
      }
    }
    if (removable.size) {
      const drop = new Set<number>();
      for (const b of removable) for (let k = b.start; k < b.end; k++) drop.add(k);
      lines = lines.filter((_, k) => !drop.has(k));
      removedBlocks = removable.size;
    }
  } else {
    warnings.push("module has a top-level shape LASIK does not parse; tarpit prelude left in place");
  }

  if (!deadIfs && !slotWrites && !removedBlocks) return unchanged;
  // Collapse the blank runs left behind.
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\s*# runtime attestation boundary\s*\n/m, "").replace(/^\s*# --- [^\n]*\(inert\) ---\s*\n/gm, "");
  if (deadIfs) findings.add("tarpit", "python-opaque-guard", "removed blocks guarded by BLA's always-false Python tarpit predicate", deadIfs);
  if (slotWrites) findings.add("runtime", "python-slot-churn", "removed writes to BLA's private tarpit slot from real functions", slotWrites);
  if (removedBlocks) findings.add("deceive", "python-tarpit-prelude", "removed BLA's prepended Python tarpit, chaff tables and honeypots (unreferenced by real code)", removedBlocks);
  return { output: Buffer.from(out.trimStart(), "utf8"), findings, warnings, changed: true };
};
