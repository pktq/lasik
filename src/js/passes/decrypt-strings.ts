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
        // table[param]
        let table: string | undefined;
        t.traverseFast(fn.body, (n) => {
          if (t.isMemberExpression(n) && n.computed && t.isIdentifier(n.object) && tables.has(n.object.name) && t.isIdentifier(n.property, { name: param.name })) {
            table = n.object.name;
          }
        });
        let key: string | undefined;
        t.traverseFast(fn.body, (n) => {
          if (t.isIdentifier(n) && keys.has(n.name) && n.name !== table) key ??= n.name;
        });
        const xors = uses(fn.body, (n) => t.isBinaryExpression(n, { operator: "^" }));
        const modLen = uses(fn.body, (n) => t.isBinaryExpression(n, { operator: "%" }) && t.isMemberExpression(n.right) && t.isIdentifier(n.right.property, { name: "length" }));
        const utf8 = uses(fn.body, (n) => t.isStringLiteral(n, { value: "utf8" }) || (t.isIdentifier(n, { name: "TextDecoder" })));
        if (table && key && xors && modLen && utf8) decoders.set(fn.id!.name, { table, key });
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
