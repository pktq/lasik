import type { Findings } from "../../core/types.js";
import { t, traverse, type NodePath } from "../ast.js";

/** `"1,2,3".split(",").map(Number)` or `[1, 2, 3]` → bytes. */
function byteRow(node: t.Node | null | undefined): number[] | undefined {
  if (t.isArrayExpression(node)) {
    const out: number[] = [];
    for (const e of node.elements) {
      if (!t.isNumericLiteral(e)) return undefined;
      out.push(e.value);
    }
    return out;
  }
  // "...".split(",").map(Number)
  if (
    t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property, { name: "map" }) &&
    t.isIdentifier(node.arguments[0], { name: "Number" }) &&
    t.isCallExpression(node.callee.object) && t.isMemberExpression(node.callee.object.callee) &&
    t.isIdentifier(node.callee.object.callee.property, { name: "split" }) &&
    t.isStringLiteral(node.callee.object.callee.object) && t.isStringLiteral(node.callee.object.arguments[0], { value: "," })
  ) {
    const s = node.callee.object.callee.object.value;
    if (s === "") return [];
    const nums = s.split(",").map(Number);
    return nums.every((n) => Number.isInteger(n)) ? nums : undefined;
  }
  return undefined;
}

function byteTable(node: t.Node | null | undefined): number[][] | undefined {
  if (!t.isArrayExpression(node)) return undefined;
  const rows: number[][] = [];
  for (const e of node.elements) {
    const r = byteRow(e);
    if (!r) return undefined;
    rows.push(r);
  }
  return rows;
}

/** `x[i] = …`, `x.push(…)`, `x[i]++`: the binding's contents change. */
function isWriteTarget(ref: NodePath): boolean {
  const m = ref.parentPath;
  if (!m?.isMemberExpression() || m.node.object !== ref.node) return false;
  const p = m.parentPath;
  if (p?.isAssignmentExpression() && p.node.left === m.node) return true;
  if (p?.isUpdateExpression() || p?.isUnaryExpression({ operator: "delete" })) return true;
  const prop = m.node.property;
  return !m.node.computed && t.isIdentifier(prop) && ["push", "pop", "shift", "unshift", "splice", "fill", "copyWithin", "reverse", "sort", "set"].includes(prop.name) && !!p?.isCallExpression();
}

/**
 * Match BLA's decoder loop exactly:
 *   var e = TABLE[i], k = KEY, o = new Uint8Array(e.length);
 *   for (...) o[j] = (e[j] ^ k[j % k.length]) & 255;
 * (the same `j` in every position, `e` bound to TABLE[param], `k` to KEY).
 */
function matchDecoderLoop(
  fn: t.FunctionDeclaration,
  param: string,
  tables: Map<string, number[][]>,
  keys: Map<string, number[]>,
): { table: string; key: string } | undefined {
  const locals = new Map<string, t.Node>();
  t.traverseFast(fn.body, (n) => {
    if (t.isVariableDeclarator(n) && t.isIdentifier(n.id) && n.init) locals.set(n.id.name, n.init);
  });
  const resolve = (name: string, depth = 0): { row?: string; key?: string } | undefined => {
    if (depth > 4) return undefined;
    if (keys.has(name) && !locals.has(name)) return { key: name };
    const init = locals.get(name);
    if (t.isIdentifier(init)) return resolve(init.name, depth + 1);
    if (t.isMemberExpression(init) && init.computed && t.isIdentifier(init.object) && tables.has(init.object.name) && !locals.has(init.object.name) && t.isIdentifier(init.property, { name: param })) {
      return { row: init.object.name };
    }
    return undefined;
  };
  let found: { table: string; key: string } | undefined;
  t.traverseFast(fn.body, (n) => {
    if (found || !t.isAssignmentExpression(n, { operator: "=" }) || !t.isMemberExpression(n.left) || !n.left.computed || !t.isIdentifier(n.left.property)) return;
    const j = n.left.property.name;
    let rhs: t.Node = n.right;
    if (t.isBinaryExpression(rhs, { operator: "&" }) && t.isNumericLiteral(rhs.right, { value: 255 })) rhs = rhs.left;
    if (!t.isBinaryExpression(rhs, { operator: "^" })) return;
    const { left: a, right: b } = rhs;
    if (!t.isMemberExpression(a) || !a.computed || !t.isIdentifier(a.object) || !t.isIdentifier(a.property, { name: j })) return;
    if (!t.isMemberExpression(b) || !b.computed || !t.isIdentifier(b.object)) return;
    const idx = b.property;
    if (
      !t.isBinaryExpression(idx, { operator: "%" }) || !t.isIdentifier(idx.left, { name: j }) ||
      !t.isMemberExpression(idx.right) || idx.right.computed || !t.isIdentifier(idx.right.object, { name: b.object.name }) ||
      !t.isIdentifier(idx.right.property, { name: "length" })
    ) return;
    const row = resolve(a.object.name)?.row;
    const key = resolve(b.object.name)?.key;
    if (row && key) found = { table: row, key };
  });
  return found;
}

function uses(fn: t.Node, pred: (n: t.Node) => boolean): boolean {
  let hit = false;
  t.traverseFast(fn, (n) => {
    if (!hit && pred(n)) hit = true;
  });
  return hit;
}

/**
 * BLA's `bla_encrypt_strings` replaces sensitive literals with `D(i)`, where
 * D XORs row i of a byte table with a repeating keystream, and ships both
 * the table and the keystream in the same file. Decode every `D(<literal>)`
 * statically and put the plaintext back.
 */
export function decryptStrings(ast: t.File, f: Findings): number {
  const tables = new Map<string, number[][]>();
  const keys = new Map<string, number[]>();
  const decoders = new Map<string, { table: string; key: string }>();

  traverse(ast, {
    Program(pp) {
      for (const stmt of pp.get("body")) {
        if (!stmt.isVariableDeclaration()) continue;
        for (const d of stmt.node.declarations) {
          if (!t.isIdentifier(d.id)) continue;
          const tbl = byteTable(d.init);
          if (tbl && tbl.length) tables.set(d.id.name, tbl);
          const row = byteRow(d.init);
          if (row && row.length) keys.set(d.id.name, row);
        }
      }
      for (const stmt of pp.get("body")) {
        if (!stmt.isFunctionDeclaration() || !stmt.node.id || stmt.node.params.length !== 1) continue;
        const fn = stmt.node;
        const param = fn.params[0];
        if (!t.isIdentifier(param)) continue;
        const m = matchDecoderLoop(fn, param.name, tables, keys);
        const utf8 = uses(fn.body, (n) => t.isStringLiteral(n, { value: "utf8" }) || t.isIdentifier(n, { name: "TextDecoder" }));
        // The decode is only exact if table and key can't change at runtime.
        const frozen = (name: string) => {
          const b = pp.scope.getBinding(name);
          return !!b && b.constant && b.referencePaths.every((r) => !isWriteTarget(r));
        };
        if (m && utf8 && frozen(m.table) && frozen(m.key)) decoders.set(fn.id!.name, m);
      }
      // var _blaS = D;  → alias
      for (const stmt of pp.get("body")) {
        if (!stmt.isVariableDeclaration()) continue;
        for (const d of stmt.node.declarations) {
          if (t.isIdentifier(d.id) && t.isIdentifier(d.init) && decoders.has(d.init.name)) decoders.set(d.id.name, decoders.get(d.init.name)!);
        }
      }
      pp.stop();
    },
  });
  if (!decoders.size) return 0;

  let n = 0;
  let failed = 0;
  traverse(ast, {
    CallExpression(p: NodePath<t.CallExpression>) {
      const c = p.node.callee;
      if (!t.isIdentifier(c) || !decoders.has(c.name) || p.node.arguments.length !== 1) return;
      const b = p.scope.getBinding(c.name);
      if (!b || !b.scope.path.isProgram()) return;
      const arg = p.node.arguments[0];
      if (!t.isNumericLiteral(arg)) { failed++; return; }
      const { table, key } = decoders.get(c.name)!;
      const row = tables.get(table)![arg.value];
      const k = keys.get(key)!;
      if (!row) { failed++; return; }
      const bytes = Uint8Array.from(row, (v, j) => v ^ k[j % k.length]!);
      p.replaceWith(t.stringLiteral(Buffer.from(bytes).toString("utf8")));
      n++;
    },
  });
  if (n) f.add("encrypt", "xor-keystream-strings", "decrypted XOR-keystream string table statically (key ships in the file)", n);
  if (failed) f.add("encrypt", "xor-keystream-dynamic-index", "decoder calls with a non-literal index left in place", failed);
  return n;
}
