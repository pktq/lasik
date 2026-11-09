import { generate } from "@babel/generator";
import type { Findings } from "../../core/types.js";
import { evalInt, freeIdents, identsAreInt32Coerced } from "../int-eval.js";
import { isLowBitClosed, knownBits, UNKNOWN, type KnownBits } from "../known-bits.js";
import { t, traverse, type NodePath } from "../ast.js";

const ID = String.raw`[A-Za-z_$][\w$]*`;

/**
 * Proven-constant predicate families BLA's tarpit emits (compact-printed).
 * Each is an identity over int32 for ANY seed value and constant, so a
 * structural match is a proof. `value(op, lit)` gives the constant result.
 */
interface Family {
  name: string;
  re: RegExp;
  value: (m: RegExpMatchArray) => boolean | undefined;
}

export const FAMILIES: Family[] = [
  {
    // 7x^2 - 1 is 6 or 7 mod 8, never a square mod 2^32.
    name: "7x²−1 ≠ y² (mod 2³²)",
    re: new RegExp(String.raw`^Math\.imul\(7,Math\.imul\((${ID})\|(\d+),\1\|\2\)\)-1(===|!==)Math\.imul\(\1\^(\d+),\1\^\4\)$`),
    value: (m) => m[3] === "!==",
  },
  {
    // (x ^ y) + ((x & y) << 1) === x + y  (carry-save addition).
    name: "xor+carry = add",
    re: new RegExp(String.raw`^\(\((${ID})\^(\d+)\)\+\(\(\1&\2\)<<1\|0\)\|0\)(===|!==)\(\1\+\2\|0\)$`),
    value: (m) => m[3] === "===",
  },
  {
    // x(x+1) is always even.
    name: "x(x+1) is even",
    re: new RegExp(String.raw`^\(Math\.imul\((${ID})\|(\d+),\(\1\|\2\)\+1(?:\|0)?\)&1\)(===|!==)([01])$`),
    value: (m) => (m[3] === "===") === (m[4] === "0"),
  },
  {
    // x | ~x is always -1.
    name: "x | ~x = −1",
    re: new RegExp(String.raw`^\((${ID})\|~\1\|0\)(===|!==)-1$`),
    value: (m) => m[2] === "===",
  },
];

const EDGE = [0, 1, -1, 2, 7, 0x7fffffff, -0x80000000, 0x55555555, -0x55555556, 0x26b5c67b];

/** Deterministic int32 samples (edges + xorshift). */
function samples(n: number): number[] {
  const out = [...EDGE];
  let s = 0x9e3779b9 | 0;
  while (out.length < n) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    out.push(s | 0);
  }
  return out;
}
const SAMPLES = samples(512);

/** Value of `node` if it's constant over every sample, else undefined. */
function constantOverSamples(node: t.Node, vars: string[]): boolean | undefined {
  let first: boolean | undefined;
  for (let i = 0; i < SAMPLES.length; i++) {
    const env = new Map<string, number>();
    vars.forEach((v, j) => env.set(v, SAMPLES[(i + j * 131) % SAMPLES.length]!));
    const r = evalInt(node, env);
    if (typeof r !== "boolean") return undefined;
    if (first === undefined) first = r;
    else if (r !== first) return undefined;
  }
  return first;
}

/** Known bits of every top-level `const`/never-reassigned binding (BLA's runtime seeds). */
function topLevelKnownBits(ast: t.File): Map<string, KnownBits> {
  const seeds = new Map<string, KnownBits>();
  traverse(ast, {
    Program(p) {
      p.scope.crawl();
      for (const stmt of p.get("body")) {
        if (!stmt.isVariableDeclaration()) continue;
        // Only `const` (a `var` can be rewritten by other scripts or eval), and only
        // int32-valued initialisers, so the seed really is the int32 the bits describe.
        if (stmt.node.kind !== "const") continue;
        for (const d of stmt.node.declarations) {
          if (!t.isIdentifier(d.id) || !d.init || !int32Result(d.init)) continue;
          const kb = knownBits(d.init, (n) => seeds.get(n));
          if (kb.mask) seeds.set(d.id.name, kb);
        }
      }
      p.stop();
    },
  });
  return seeds;
}

function int32Result(e: t.Node): boolean {
  if (t.isNumericLiteral(e)) return Number.isInteger(e.value) && (e.value | 0) === e.value;
  if (t.isUnaryExpression(e, { operator: "~" })) return true;
  if (t.isBinaryExpression(e)) return ["|", "&", "^", "<<", ">>"].includes(e.operator);
  return t.isCallExpression(e) && isLowBitClosed(e);
}

/** Literal mask of `x & m`, only when 0 ≤ m < 2^31 (so ToInt32 leaves it unchanged). */
function maskOf(e: t.Node): number | undefined {
  if (!t.isBinaryExpression(e, { operator: "&" })) return undefined;
  const ok = (n: t.Node): n is t.NumericLiteral => t.isNumericLiteral(n) && Number.isInteger(n.value) && n.value >= 0 && n.value <= 0x7fffffff;
  if (ok(e.right)) return e.right.value;
  if (ok(e.left)) return e.left.value;
  return undefined;
}

/**
 * Exact proof for predicates over +, -, imul, bitwise ops and literal shifts:
 * bit i of such an expression depends only on input bits 0..i, so when the
 * comparison only sees bits 0..h, enumerating every unknown input bit in
 * 0..h (known bits come from the seed's definition) decides it for every
 * runtime value. Returns undefined when it can't prove anything.
 */
function proveByLowBits(node: t.BinaryExpression, vars: string[], bitsOf: (n: string) => KnownBits): boolean | undefined {
  const { left, right } = node;
  if (left.type === "PrivateName" || !isLowBitClosed(left) || !isLowBitClosed(right)) return undefined;
  if (!int32Result(left) || !int32Result(right)) return undefined;
  const ml = maskOf(left);
  const mr = maskOf(right);
  let h = 31;
  if (ml !== undefined && (mr !== undefined || t.isNumericLiteral(right))) h = 31 - Math.clz32(Math.max(ml, mr ?? 0));
  else if (mr !== undefined && t.isNumericLiteral(left)) h = 31 - Math.clz32(mr);
  const low = h >= 31 ? -1 : (1 << (h + 1)) - 1;

  const unknown: { v: string; bit: number }[] = [];
  const base = new Map<string, number>();
  for (const v of vars) {
    const kb = bitsOf(v);
    base.set(v, kb.value & kb.mask & low);
    for (let i = 0; i <= h; i++) if (((kb.mask >>> i) & 1) === 0) unknown.push({ v, bit: i });
  }
  if (unknown.length > 16) return undefined;

  let first: boolean | undefined;
  for (let combo = 0; combo < 1 << unknown.length; combo++) {
    const env = new Map(base);
    unknown.forEach((u, j) => {
      if ((combo >>> j) & 1) env.set(u.v, env.get(u.v)! | (1 << u.bit));
    });
    const r = evalInt(node, env);
    if (typeof r !== "boolean") return undefined;
    if (first === undefined) first = r;
    else if (first !== r) return undefined;
  }
  return first;
}

export interface OpaqueOptions {
  /** Also fold predicates that are constant on 512 samples but match no known family. */
  aggressive?: boolean;
}

/** Replace BLA opaque predicates with their constant value. */
export function foldOpaquePredicates(ast: t.File, f: Findings, opts: OpaqueOptions = {}): number {
  let folded = 0;
  let suspected = 0;
  const seeds = topLevelKnownBits(ast);
  const visit = (path: NodePath<t.BinaryExpression>) => {
    const node = path.node;
    if (!["===", "!==", "==", "!="].includes(node.operator)) return;
    const vars = freeIdents(node);
    if (!vars || vars.size === 0 || vars.size > 2) return;
    // The identities hold over int32. A raw `x + k` term sees x itself, so x must be an int32 seed.
    const int32Vars = identsAreInt32Coerced(node) || [...vars].every((v) => {
      const b = path.scope.getBinding(v);
      return !!b && b.scope.path.isProgram() && seeds.has(v);
    });
    if (!int32Vars) return;
    const code = generate(node, { compact: true }).code;
    for (const fam of FAMILIES) {
      const m = code.match(fam.re);
      if (!m) continue;
      const v = fam.value(m);
      // Belt and braces: the proof and the samples must agree.
      if (v === undefined || constantOverSamples(node, [...vars]) !== v) return;
      path.replaceWith(t.booleanLiteral(v));
      folded++;
      f.add("tarpit", "opaque-predicate", "folded number-theoretic opaque predicate (proven int32 identity family)");
      return;
    }
    if (!identsAreInt32Coerced(node)) return;
    const bitsOf = (name: string): KnownBits => {
      const b = path.scope.getBinding(name);
      return b && b.constant && b.scope.path.isProgram() ? (seeds.get(name) ?? UNKNOWN) : UNKNOWN;
    };
    const proved = proveByLowBits(node, [...vars], bitsOf);
    if (proved !== undefined) {
      path.replaceWith(t.booleanLiteral(proved));
      folded++;
      f.add("tarpit", "seed-bit-predicate", "folded predicate proved constant by exhaustive enumeration of the low bits it depends on");
      return;
    }
    const v = constantOverSamples(node, [...vars]);
    if (v === undefined) return;
    // Sampling is not a proof: a real check like `(key ^ K) === C` is false on
    // every sample but true for one key. Only ever fold over top-level
    // constants (BLA's seeds), never over parameters or other inputs.
    const seedsOnly = [...vars].every((name) => {
      const b = path.scope.getBinding(name);
      return !!b && b.constant && b.scope.path.isProgram() && b.kind !== "param";
    });
    if (opts.aggressive && seedsOnly) {
      path.replaceWith(t.booleanLiteral(v));
      folded++;
      f.add("tarpit", "opaque-predicate-heuristic", "folded predicate constant on 512 int32 samples (--aggressive)");
    } else {
      suspected++;
    }
  };
  traverse(ast, { BinaryExpression: { exit: visit } });
  if (suspected) f.add("tarpit", "opaque-predicate-suspected", "int32 predicate constant on 512 samples but not a known BLA family; left in place (use --aggressive to fold)", suspected);
  return folded;
}
