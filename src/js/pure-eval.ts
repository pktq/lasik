import { t } from "./ast.js";

/**
 * Evaluator for a closed, side-effect-free subset of JS: numbers, strings, plain
 * arrays/objects, local variables, loops, and a few whitelisted builtins. It walks the
 * AST itself and never runs target code; anything outside the subset (calls to unknown
 * functions, property writes, getters, prototype lookups) makes it give up.
 */
export type Val = number | string | boolean | null | undefined | Val[] | { [k: string]: Val };

/** Resolves a free identifier (a top-level binding proven constant) or returns undefined to refuse. */
export type Globals = (name: string) => { value: Val } | undefined;

class Refuse extends Error {}
const refuse = (): never => { throw new Refuse(); };

class Return { constructor(readonly value: Val) {} }
const BREAK = Symbol("break");
const CONTINUE = Symbol("continue");
type Flow = Return | typeof BREAK | typeof CONTINUE | undefined;

class Scope {
  private vars = new Map<string, { value: Val; mutable: boolean }>();
  constructor(readonly parent?: Scope) {}
  declare(name: string, value: Val, mutable: boolean): void { this.vars.set(name, { value, mutable }); }
  find(name: string): { value: Val; mutable: boolean } | undefined { return this.vars.get(name) ?? this.parent?.find(name); }
}

const isPrim = (v: Val): v is number | string | boolean | null | undefined => v === null || typeof v !== "object";
const isRecord = (v: Val): v is { [k: string]: Val } => v !== null && typeof v === "object" && !Array.isArray(v);
const OBJECT_PROTO = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Evaluate `fn(...args)`; undefined result means "could not prove a value" (use `ok`). */
export function callPure(fn: t.Function, args: Val[], globals: Globals, fuel = 5_000_000): { ok: true; value: Val } | { ok: false } {
  let steps = 0;
  const tick = (): void => { if (++steps > fuel) refuse(); };

  const prim = (v: Val): number | string | boolean | null | undefined => (isPrim(v) ? v : refuse());

  const lookup = (s: Scope, name: string): Val => {
    const v = s.find(name);
    if (v) return v.value;
    if (name === "undefined") return undefined;
    if (name === "NaN") return NaN;
    if (name === "Infinity") return Infinity;
    const g = globals(name);
    return g ? g.value : refuse();
  };

  const assign = (s: Scope, name: string, value: Val): void => {
    const v = s.find(name);
    if (!v || !v.mutable) refuse();
    v!.value = value;
  };

  const member = (obj: Val, key: Val): Val => {
    if (typeof obj === "string") {
      if (key === "length") return obj.length;
      if (typeof key === "number") return Number.isInteger(key) && key >= 0 ? obj[key] : undefined;
      return refuse();
    }
    if (Array.isArray(obj)) {
      if (key === "length") return obj.length;
      if (typeof key === "number") return Number.isInteger(key) && key >= 0 && key < obj.length ? obj[key] : undefined;
      return refuse();
    }
    if (isRecord(obj)) {
      const k = String(prim(key));
      if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
      return OBJECT_PROTO.has(k) ? refuse() : undefined;
    }
    return refuse();
  };

  const call = (node: t.CallExpression, s: Scope): Val => {
    const c = node.callee;
    const args = node.arguments.map((a) => (t.isExpression(a) ? expr(a, s) : refuse()));
    if (t.isMemberExpression(c) && !c.computed && t.isIdentifier(c.property)) {
      const m = c.property.name;
      if (t.isIdentifier(c.object) && !s.find(c.object.name) && !globals(c.object.name)) {
        const o = c.object.name;
        if (o === "Array" && m === "isArray") return Array.isArray(args[0]);
        const n = args.map((a) => prim(a));
        if (o === "Math" && m === "imul") return Math.imul(Number(n[0]), Number(n[1]));
        if (o === "Math" && (m === "abs" || m === "floor" || m === "ceil" || m === "trunc" || m === "sign")) return Math[m](Number(n[0]));
        if (o === "Math" && (m === "min" || m === "max")) return Math[m](...n.map(Number));
        if (o === "Array" && m === "isArray") return Array.isArray(args[0]);
        if (o === "String" && m === "fromCharCode") return String.fromCharCode(...n.map(Number));
        return refuse();
      }
      const self = t.isExpression(c.object) ? expr(c.object, s) : refuse();
      if (typeof self === "string" && m === "charCodeAt") return self.charCodeAt(Number(prim(args[0] ?? 0)));
      return refuse();
    }
    return refuse();
  };

  const binary = (op: string, a: Val, b: Val): Val => {
    if (op === "===") return a === b;
    if (op === "!==") return a !== b;
    const x = prim(a);
    const y = prim(b);
    switch (op) {
      case "==": return x == y;
      case "!=": return x != y;
      case "+": return typeof x === "string" || typeof y === "string" ? String(x) + String(y) : Number(x) + Number(y);
      case "-": return Number(x) - Number(y);
      case "*": return Number(x) * Number(y);
      case "/": return Number(x) / Number(y);
      case "%": return Number(x) % Number(y);
      case "**": return Number(x) ** Number(y);
      case "|": return Number(x) | Number(y);
      case "&": return Number(x) & Number(y);
      case "^": return Number(x) ^ Number(y);
      case "<<": return Number(x) << Number(y);
      case ">>": return Number(x) >> Number(y);
      case ">>>": return Number(x) >>> Number(y);
      case "<": return (x as number) < (y as number);
      case "<=": return (x as number) <= (y as number);
      case ">": return (x as number) > (y as number);
      case ">=": return (x as number) >= (y as number);
    }
    return refuse();
  };

  const expr = (n: t.Expression, s: Scope): Val => {
    tick();
    if (t.isNumericLiteral(n) || t.isStringLiteral(n) || t.isBooleanLiteral(n)) return n.value;
    if (t.isNullLiteral(n)) return null;
    if (t.isParenthesizedExpression(n)) return expr(n.expression, s);
    if (t.isIdentifier(n)) return lookup(s, n.name);
    if (t.isTemplateLiteral(n)) {
      let out = n.quasis[0]!.value.cooked ?? refuse();
      n.expressions.forEach((e, i) => { out += String(prim(expr(e as t.Expression, s))) + (n.quasis[i + 1]!.value.cooked ?? refuse()); });
      return out;
    }
    if (t.isArrayExpression(n)) return n.elements.map((e) => (e && t.isExpression(e) ? expr(e, s) : refuse()));
    if (t.isObjectExpression(n)) {
      const o: { [k: string]: Val } = {};
      for (const p of n.properties) {
        if (!t.isObjectProperty(p) || p.computed || !t.isExpression(p.value)) return refuse();
        const k = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) || t.isNumericLiteral(p.key) ? String(p.key.value) : refuse();
        if (k === "__proto__") return refuse();
        o[k as string] = expr(p.value, s);
      }
      return o;
    }
    if (t.isMemberExpression(n)) {
      const key = n.computed ? expr(n.property as t.Expression, s) : t.isIdentifier(n.property) ? n.property.name : refuse();
      return member(t.isExpression(n.object) ? expr(n.object, s) : refuse(), key);
    }
    if (t.isCallExpression(n)) return call(n, s);
    if (t.isUnaryExpression(n)) {
      if (n.operator === "typeof") {
        if (t.isIdentifier(n.argument) && !s.find(n.argument.name) && !globals(n.argument.name)) return refuse();
        const v = expr(n.argument, s);
        return v === null ? "object" : typeof v;
      }
      const v = expr(n.argument, s);
      if (n.operator === "void") return undefined;
      if (n.operator === "!") return !v;
      const x = prim(v);
      if (n.operator === "-") return -Number(x);
      if (n.operator === "+") return Number(x);
      if (n.operator === "~") return ~Number(x);
      return refuse();
    }
    if (t.isBinaryExpression(n)) {
      if (!t.isExpression(n.left)) return refuse();
      return binary(n.operator, expr(n.left, s), expr(n.right, s));
    }
    if (t.isLogicalExpression(n)) {
      const a = expr(n.left, s);
      if (n.operator === "&&") return a ? expr(n.right, s) : a;
      if (n.operator === "||") return a ? a : expr(n.right, s);
      return a ?? expr(n.right, s);
    }
    if (t.isConditionalExpression(n)) return expr(n.test, s) ? expr(n.consequent, s) : expr(n.alternate, s);
    if (t.isSequenceExpression(n)) { let v: Val; for (const e of n.expressions) v = expr(e, s); return v; }
    if (t.isAssignmentExpression(n)) {
      if (!t.isIdentifier(n.left)) return refuse();
      const name = n.left.name;
      const rhs = expr(n.right, s);
      const v = n.operator === "=" ? rhs : binary(n.operator.slice(0, -1), lookup(s, name), rhs);
      assign(s, name, v);
      return v;
    }
    if (t.isUpdateExpression(n)) {
      if (!t.isIdentifier(n.argument)) return refuse();
      const old = Number(prim(lookup(s, n.argument.name)));
      const v = n.operator === "++" ? old + 1 : old - 1;
      assign(s, n.argument.name, v);
      return n.prefix ? v : old;
    }
    return refuse();
  };

  const declare = (d: t.VariableDeclaration, s: Scope, values?: Val[]): void => {
    d.declarations.forEach((x, i) => {
      if (!t.isIdentifier(x.id)) refuse();
      const v = values ? values[i] : x.init ? expr(x.init, s) : undefined;
      s.declare((x.id as t.Identifier).name, v, d.kind !== "const");
    });
  };

  const loopBody = (body: t.Statement, s: Scope): Flow | "next" => {
    const f = stmt(body, new Scope(s));
    if (f instanceof Return) return f;
    if (f === BREAK) return undefined;
    return "next";
  };

  const stmt = (n: t.Statement, s: Scope): Flow => {
    tick();
    if (t.isBlockStatement(n)) {
      const inner = new Scope(s);
      for (const x of n.body) { const f = stmt(x, inner); if (f) return f; }
      return undefined;
    }
    if (t.isEmptyStatement(n)) return undefined;
    if (t.isExpressionStatement(n)) { expr(n.expression, s); return undefined; }
    if (t.isVariableDeclaration(n)) { if (n.kind === "var") refuse(); declare(n, s); return undefined; }
    if (t.isReturnStatement(n)) return new Return(n.argument ? expr(n.argument, s) : undefined);
    if (t.isIfStatement(n)) return expr(n.test, s) ? stmt(n.consequent, s) : n.alternate ? stmt(n.alternate, s) : undefined;
    if (t.isBreakStatement(n)) return n.label ? refuse() : BREAK;
    if (t.isContinueStatement(n)) return n.label ? refuse() : CONTINUE;
    if (t.isForStatement(n)) {
      const ls = new Scope(s);
      if (t.isVariableDeclaration(n.init)) { if (n.init.kind === "var") refuse(); declare(n.init, ls); }
      else if (n.init) expr(n.init, ls);
      for (;;) {
        tick();
        if (n.test && !expr(n.test, ls)) return undefined;
        // A fresh copy per iteration matches let-per-iteration semantics for closures; we have none.
        const r = loopBody(n.body, ls);
        if (r !== "next") return r;
        if (n.update) expr(n.update, ls);
      }
    }
    if (t.isWhileStatement(n)) {
      for (;;) {
        tick();
        if (!expr(n.test, s)) return undefined;
        const r = loopBody(n.body, s);
        if (r !== "next") return r;
      }
    }
    if (t.isForOfStatement(n)) {
      if (n.await || !t.isVariableDeclaration(n.left) || n.left.kind === "var") return refuse();
      const it = expr(n.right, s);
      const items: Val[] = typeof it === "string" ? [...it] : Array.isArray(it) ? it : refuse();
      for (const v of items) {
        const ls = new Scope(s);
        declare(n.left as t.VariableDeclaration, ls, [v]);
        const r = loopBody(n.body, ls);
        if (r !== "next") return r;
      }
      return undefined;
    }
    return refuse();
  };

  try {
    if (fn.async || fn.generator) return { ok: false };
    const s = new Scope();
    fn.params.forEach((p, i) => {
      if (t.isIdentifier(p)) s.declare(p.name, args[i], true);
      else if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) s.declare(p.left.name, args[i] === undefined ? expr(p.right, s) : args[i], true);
      else refuse();
    });
    if (!t.isBlockStatement(fn.body)) return { ok: true, value: expr(fn.body, s) };
    const f = stmt(fn.body, s);
    return { ok: true, value: f instanceof Return ? f.value : undefined };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false };
    throw e;
  }
}

/** Evaluate a closed expression (a literal initializer) with the same rules. */
export function evalPure(node: t.Expression, globals: Globals = () => undefined): { ok: true; value: Val } | { ok: false } {
  return callPure(t.arrowFunctionExpression([], node), [], globals);
}
