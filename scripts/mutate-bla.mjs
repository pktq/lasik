// Simulates the cheapest BLA patch against LASIK: every BLA-generated identifier and
// comment gets a fresh random spelling, nothing else changes. Behaviour is preserved:
// renames go through Babel's scope tracker, and names that also occur inside a string
// (eval/Function bodies, property lookups) are left alone.
import { createHash } from "node:crypto";
import { parseJs, printJs, traverse } from "../dist/js/ast.js";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const WORDS = ["sync", "frame", "ledger", "cursor", "batch", "probe", "relay", "shard", "pivot", "token", "quota", "epoch", "vault", "trace", "mesh", "drift"];

function pick(seed, s) {
  return createHash("sha256").update(`${seed}\0${s}`).digest();
}

/** A deterministic, plain-looking name that shares nothing with the original. */
export function freshName(seed, name) {
  const h = pick(seed, name);
  let out = "";
  for (let i = 0; i < 8; i++) out += LETTERS[h[i] % 26];
  return out;
}

function freshComment(seed, text) {
  const h = pick(seed, text);
  return ` ${WORDS[h[0] % 16]} ${WORDS[h[1] % 16]} ${h.subarray(2, 5).toString("hex")} `;
}

/** Words that occur in the clean original: those names are the user's, not BLA's. */
export function wordsOf(src) {
  return new Set(src.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/**
 * Rename every binding and rewrite every comment that the clean original (`clean`,
 * optional) does not contain. `keep` adds names that must stay.
 */
export function mutateJs(code, { seed = "lasik", clean = "", keep = new Set(), filename = "input.js" } = {}) {
  keep = new Set([...keep, ...wordsOf(clean)]);
  const ast = parseJs(code, filename);
  const inStrings = new Set();
  traverse(ast, {
    StringLiteral(p) { for (const w of p.node.value.match(/[A-Za-z_$][\w$]*/g) ?? []) inStrings.add(w); },
    TemplateElement(p) { for (const w of p.node.value.raw.match(/[A-Za-z_$][\w$]*/g) ?? []) inStrings.add(w); },
  });
  let renamed = 0, comments = 0;
  const done = new Set();
  traverse(ast, {
    Scopable(p) {
      if (done.has(p.scope)) return;
      done.add(p.scope);
      for (const name of Object.keys(p.scope.bindings)) {
        if (keep.has(name) || inStrings.has(name) || name === "arguments") continue;
        p.scope.rename(name, freshName(seed, name));
        renamed++;
      }
    },
  });
  for (const c of ast.comments ?? []) {
    if (clean && clean.includes(c.value.trim())) continue;
    c.value = freshComment(seed, c.value);
    comments++;
  }
  return { code: printJs(ast), renamed, comments };
}

const SCRIPT = /(<script(?:\s[^>]*)?>)([\s\S]*?)(<\/script\s*>)/gi;

/** Same for every inline script; one seed keeps shared globals consistent across scripts. */
export function mutateHtml(html, opts = {}) {
  const keep = new Set([...(opts.keep ?? []), ...(html.match(/\son[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi) ?? []).flatMap((a) => a.match(/[A-Za-z_$][\w$]*/g) ?? [])]);
  let renamed = 0, comments = 0;
  const code = html.replace(SCRIPT, (all, open, body, close) => {
    if (/\stype\s*=\s*["']?(?!module|text\/javascript|application\/javascript)[^"'\s>]/i.test(open) || !body.trim()) return all;
    const r = mutateJs(body, { ...opts, keep });
    renamed += r.renamed;
    comments += r.comments;
    return open + r.code + close;
  });
  return { code, renamed, comments };
}
