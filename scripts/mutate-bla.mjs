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

const COMMUTATIVE = new Set(["===", "!==", "==", "!=", "^", "&", "|", "*"]);
const isImul = (n) => n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.object.name === "Math" && n.callee.property.name === "imul";

/** No side effects and no evaluation-order dependence. */
function pure(n) {
  switch (n.type) {
    case "Identifier": case "NumericLiteral": case "StringLiteral": case "BooleanLiteral": case "NullLiteral": return true;
    case "UnaryExpression": return n.operator !== "delete" && pure(n.argument);
    case "BinaryExpression": return n.left.type !== "PrivateName" && pure(n.left) && pure(n.right);
    case "ParenthesizedExpression": return pure(n.expression);
    case "CallExpression": return isImul(n) && n.arguments.every(pure);
    default: return false;
  }
}

/** Words that occur in the clean original: those names are the user's, not BLA's. */
export function wordsOf(src) {
  return new Set(src.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/**
 * Rename every binding and rewrite every comment that the clean original (`clean`,
 * optional) does not contain. `keep` adds names that must stay.
 */
export function mutateJs(code, { seed = "lasik", clean = "", keep = new Set(), filename = "input.js", shuffle = true } = {}) {
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
  // Swap operands of commutative operators when both sides are side-effect free, so the
  // printed shape of every expression changes while its value does not.
  let swapped = 0;
  if (shuffle) {
    traverse(ast, {
      BinaryExpression(p) {
        const n = p.node;
        if (!COMMUTATIVE.has(n.operator) || !pure(n.left) || !pure(n.right) || pick(seed, `${n.start}`)[0] % 2) return;
        [n.left, n.right] = [n.right, n.left];
        swapped++;
      },
      CallExpression(p) {
        const n = p.node;
        if (!isImul(n) || n.arguments.length !== 2 || !n.arguments.every(pure) || pick(seed, `${n.start}`)[0] % 2) return;
        n.arguments.reverse();
        swapped++;
      },
    });
  }
  for (const c of ast.comments ?? []) {
    if (clean && clean.includes(c.value.trim())) continue;
    c.value = freshComment(seed, c.value);
    comments++;
  }
  return { code: printJs(ast), renamed, comments, swapped };
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

function leb(buf, pos) {
  let value = 0, shift = 0;
  for (;;) {
    const b = buf[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return { value, next: pos };
    shift += 7;
  }
}
function uleb(value) {
  const out = [];
  do {
    let b = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) b |= 0x80;
    out.push(b);
  } while (value);
  return Buffer.from(out);
}
const nameBytes = (s) => Buffer.concat([uleb(Buffer.byteLength(s)), Buffer.from(s)]);
const TOOL_SECTIONS = /^(?:name|producers|target_features|sourceMappingURL|\.debug_.+)$/;

/** Same length, letters only, nothing in common with the original spelling. */
function respell(seed, s) {
  let out = "";
  for (let i = 0; out.length < s.length; i++) out += freshName(seed, `${s}#${i}`);
  return out.slice(0, s.length);
}

/**
 * The same patch for a wasm module: every non-tool custom section gets a random name and
 * every long export name a random spelling of the same length. Code is untouched.
 */
export function mutateWasm(buf, { seed = "lasik" } = {}) {
  const parts = [buf.subarray(0, 8)];
  let renamed = 0;
  for (let pos = 8; pos < buf.length; ) {
    const id = buf[pos];
    const size = leb(buf, pos + 1);
    const end = size.next + size.value;
    const payload = buf.subarray(size.next, end);
    let out = payload;
    if (id === 0) {
      const n = leb(payload, 0);
      const name = payload.subarray(n.next, n.next + n.value).toString();
      if (!TOOL_SECTIONS.test(name)) {
        out = Buffer.concat([nameBytes(respell(seed, name)), payload.subarray(n.next + n.value)]);
        renamed++;
      }
    } else if (id === 7) {
      const count = leb(payload, 0);
      const items = [uleb(count.value)];
      let p = count.next;
      for (let i = 0; i < count.value; i++) {
        const n = leb(payload, p);
        let name = payload.subarray(n.next, n.next + n.value).toString();
        const after = leb(payload, n.next + n.value + 1).next;
        if (name.length > 64) { name = respell(seed, name); renamed++; }
        items.push(nameBytes(name), payload.subarray(n.next + n.value, after));
        p = after;
      }
      out = Buffer.concat(items);
    }
    parts.push(Buffer.from([id]), uleb(out.length), out);
    pos = end;
  }
  return { code: Buffer.concat(parts), renamed };
}

/** The same patch for an Electron asar: every directory and nested file gets a random name. */
export function mutateAsar(buf, { seed = "lasik" } = {}) {
  const headerSize = buf.readUInt32LE(4);
  const jsonSize = buf.readUInt32LE(12);
  const root = JSON.parse(buf.subarray(16, 16 + jsonSize).toString("utf8"));
  let renamed = 0;
  const walk = (files, depth) => {
    const out = {};
    for (const [name, node] of Object.entries(files)) {
      const ext = node.files ? "" : (name.match(/\.[^.]+$/)?.[0] ?? "");
      const fresh = depth === 0 && !node.files ? name : freshName(seed, name) + ext;
      if (fresh !== name) renamed++;
      out[fresh] = node.files ? { ...node, files: walk(node.files, depth + 1) } : node;
    }
    return out;
  };
  root.files = walk(root.files, 0);
  const json = Buffer.from(JSON.stringify(root), "utf8");
  const aligned = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(16 + aligned);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(aligned + 8, 4);
  header.writeUInt32LE(aligned + 4, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return { code: Buffer.concat([header, buf.subarray(8 + headerSize)]), renamed };
}
