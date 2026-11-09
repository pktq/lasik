import type { Findings } from "../../core/types.js";
import { t, traverse, type NodePath } from "../ast.js";
import { callPure, evalPure, type Globals, type Val } from "../pure-eval.js";

interface Entry {
  anchor: string;
  payload: string;
}

/** BLA 3.2.1's corpus digest (cognitive-armor-trigger). Reference for tests; the pass evaluates whatever digest the file carries. */
export function corpusDigest(entries: Entry[], seedInput: number, minLength: number): number {
  if (entries.length < minLength) return 0;
  let acc = ((seedInput | 0) ^ 0x26b5c67b) >>> 0;
  for (const e of entries) {
    const text = e.anchor + "::" + e.payload;
    for (let j = 0; j < text.length; j++) {
      acc = Math.imul(acc ^ text.charCodeAt(j), 0x85ebca6b) >>> 0;
      acc = ((acc << 13) | (acc >>> 19)) >>> 0;
    }
  }
  return acc >>> 0;
}

function readCorpus(node: t.Node | null | undefined): Entry[] | undefined {
  if (!t.isArrayExpression(node)) return undefined;
  const out: Entry[] = [];
  for (const el of node.elements) {
    if (!t.isObjectExpression(el)) return undefined;
    let anchor: string | undefined;
    let payload: string | undefined;
    for (const p of el.properties) {
      if (!t.isObjectProperty(p) || !t.isStringLiteral(p.value)) continue;
      const key = t.isStringLiteral(p.key) ? p.key.value : t.isIdentifier(p.key) ? p.key.name : undefined;
      if (key === "coupledAnchorSymbol") anchor = p.value.value;
      if (key === "triggerPayload") payload = p.value.value;
    }
    if (anchor === undefined || payload === undefined) return undefined;
    out.push({ anchor, payload });
  }
  return out.length ? out : undefined;
}

/** Methods that return a primitive, so their result cannot alias the binding. */
const READ_METHODS = new Set(["charCodeAt", "codePointAt", "indexOf", "includes", "startsWith", "endsWith"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self", "top", "parent", "frames"]);
/** Builtins pure-eval models; a program that declares or patches one gets no folds through it. */
const BUILTINS = new Set(["Math", "String", "Array", "Number", "Object", "NaN", "undefined", "Infinity"]);

/**
 * True when this reference cannot change what the binding holds: `void x`, `typeof x`,
 * `!x`, `Array.isArray(x)`, or a read chain like `x[i].a.length` used as an operand or
 * a test. A `const` alias (`const e = x[i]`) is followed. Writes, deletes, escapes and
 * unknown method calls are not read-only.
 */
function isReadOnlyUse(ref: NodePath, depth = 0): boolean {
  let p: NodePath = ref;
  while (p.parentPath?.isMemberExpression() && p.parentPath.node.object === p.node) p = p.parentPath;
  const parent = p.parentPath;
  if (!parent) return false;
  if (parent.isUnaryExpression()) return parent.node.operator !== "delete";
  if (parent.isArrayExpression()) return parent.parentPath?.isUnaryExpression({ operator: "void" }) === true;
  if (parent.isCallExpression()) {
    if (parent.node.callee === p.node) return p !== ref && t.isMemberExpression(p.node) && !p.node.computed && t.isIdentifier(p.node.property) && READ_METHODS.has(p.node.property.name);
    const c = parent.node.callee;
    return t.isMemberExpression(c) && t.isIdentifier(c.object, { name: "Array" }) && t.isIdentifier(c.property, { name: "isArray" }) && !parent.scope.getBinding("Array");
  }
  if (parent.isTemplateLiteral()) return !parent.parentPath?.isTaggedTemplateExpression();
  if (parent.isBinaryExpression()) return true;
  if ((parent.isIfStatement() || parent.isConditionalExpression() || parent.isWhileStatement() || parent.isForStatement()) && (parent.node as { test?: t.Node }).test === p.node) return true;
  if (parent.isVariableDeclarator() && parent.node.init === p.node && t.isIdentifier(parent.node.id) && depth < 3) {
    const decl = parent.parentPath;
    const b = parent.scope.getBinding(parent.node.id.name);
    return decl?.isVariableDeclaration({ kind: "const" }) === true && !!b && b.referencePaths.every((r) => isReadOnlyUse(r, depth + 1));
  }
  return false;
}

/** Name D in `typeof D === "function"` (either operand order), else undefined. */
function typeofFunctionOf(n: t.Node): string | undefined {
  if (!t.isBinaryExpression(n) || (n.operator !== "===" && n.operator !== "==")) return undefined;
  const [a, b] = t.isUnaryExpression(n.left, { operator: "typeof" }) ? [n.left, n.right] : [n.right, n.left];
  return t.isUnaryExpression(a, { operator: "typeof" }) && t.isIdentifier(a.argument) && t.isStringLiteral(b, { value: "function" }) ? a.argument.name : undefined;
}

/**
 * Anti-strip interlocks: real code reads `typeof D === "function" && D(s) === N`, where D
 * is a pure function over a constant decoy corpus, so deleting the corpus flips the
 * result. Evaluate D(s) statically (pure-eval walks the AST; nothing is executed) and fold
 * the comparison to the value it has in the unmodified program, which frees the corpus.
 * Keyed on that shape and on proof, not on BLA's names or its digest algorithm.
 */
export function cutCorpusInterlocks(ast: t.File, f: Findings): { folded: number; unresolved: number } {
  let program!: NodePath<t.Program>;
  traverse(ast, { Program(p) { program = p; p.stop(); } });
  const scope = program.scope;
  const body = program.node.body;
  const topIndex = (p: NodePath): number => {
    let q: NodePath | null = p;
    while (q && !q.parentPath?.isProgram()) q = q.parentPath;
    return q ? body.indexOf(q.node as t.Statement) : -1;
  };

  // Names the file writes through the global object, and whether it patches a builtin.
  const globalWrites = new Set<string>();
  let anyGlobalWrite = false;
  let builtinsPatched = false;
  const rootOf = (n: t.Node): t.Node => (t.isMemberExpression(n) ? rootOf(n.object) : n);
  const noteWrite = (target: t.Node, p: NodePath): void => {
    if (!t.isMemberExpression(target)) return;
    const root = rootOf(target);
    if (t.isIdentifier(root) && BUILTINS.has(root.name) && !p.scope.getBinding(root.name)) builtinsPatched = true;
    const obj = target.object;
    const isGlobal = (t.isIdentifier(obj) && GLOBAL_OBJECTS.has(obj.name) && !p.scope.getBinding(obj.name)) || (t.isThisExpression(obj) && !p.getFunctionParent());
    if (!isGlobal) return;
    const key = !target.computed && t.isIdentifier(target.property) ? target.property.name : t.isStringLiteral(target.property) ? target.property.value : undefined;
    if (key === undefined) anyGlobalWrite = true;
    else globalWrites.add(key);
  };
  traverse(ast, {
    AssignmentExpression(p) { noteWrite(p.node.left, p); },
    UpdateExpression(p) { noteWrite(p.node.argument, p); },
    UnaryExpression(p) { if (p.node.operator === "delete") noteWrite(p.node.argument, p); },
    CallExpression(p) {
      // Object.defineProperty(window, …), Reflect.set(String.prototype, …) and friends.
      const c = p.node.callee;
      const a = p.node.arguments[0];
      if (!t.isMemberExpression(c) || !t.isIdentifier(c.object, { name: "Object" }) && !t.isIdentifier(c.object, { name: "Reflect" }) || !a) return;
      const root = rootOf(a);
      if (t.isIdentifier(root) && BUILTINS.has(root.name)) builtinsPatched = true;
      if (t.isIdentifier(root) && GLOBAL_OBJECTS.has(root.name)) anyGlobalWrite = true;
    },
  });
  const shadowed = (name: string): boolean => BUILTINS.has(name) && (builtinsPatched || !!scope.getBinding(name));

  // Top-level bindings that provably always hold their literal initializer.
  const constant = new Map<string, { value: Val } | null>();
  const globals: Globals = (name) => {
    if (constant.has(name)) return constant.get(name) ?? undefined;
    const b = scope.getBinding(name);
    let out: { value: Val } | undefined;
    // Only a top-level `const`: `var`/`let` can be rewritten from another script or through the global object.
    if (b && b.kind === "const" && b.path.isVariableDeclarator() && b.path.parentPath?.parentPath?.isProgram() && b.path.node.init && t.isIdentifier(b.path.node.id) && b.referencePaths.every((r) => isReadOnlyUse(r))) {
      const r = evalPure(b.path.node.init);
      if (r.ok) out = { value: r.value };
    }
    constant.set(name, out ?? null);
    return out;
  };
  const topFunction = (name: string): t.FunctionDeclaration | undefined => {
    const b = scope.getBinding(name);
    return b && b.kind === "hoisted" && b.constantViolations.length === 0 && b.path.isFunctionDeclaration() && b.path.parentPath?.isProgram() ? b.path.node : undefined;
  };

  let folded = 0;
  let unresolved = 0;
  const foldedFns = new Set<string>();
  const corpusInterlocks = new Set<string>();
  traverse(ast, {
    BinaryExpression(p) {
      const { operator, left, right } = p.node;
      if (operator !== "===" && operator !== "!==" && operator !== "==" && operator !== "!=") return;
      const call = t.isCallExpression(left) ? left : t.isCallExpression(right) ? right : undefined;
      const lit = call === left ? right : left;
      if (!call || !(t.isNumericLiteral(lit) || t.isStringLiteral(lit)) || !t.isIdentifier(call.callee)) return;
      const name = call.callee.name;
      if (p.scope.getBinding(name)?.scope !== scope) return;
      const fn = topFunction(name);
      if (!fn) return;
      const interlock = t.isLogicalExpression(p.parent, { operator: "&&" }) && p.parent.right === p.node && typeofFunctionOf(p.parent.left) === name;
      const args: Val[] = [];
      for (const a of call.arguments) {
        const r = t.isExpression(a) ? evalPure(a) : { ok: false as const };
        if (!r.ok) { if (interlock) unresolved++; return; }
        args.push(r.value);
      }
      const reads = new Map<string, Val>();
      const r = anyGlobalWrite || globalWrites.has(name)
        ? { ok: false as const }
        : callPure(fn, args, (g) => { const v = globals(g); if (v) reads.set(g, v.value); return v; }, { shadowed });
      // Every constant read must be initialised before the statement that makes the call (no TDZ, no reorder),
      // and none may be rewritten through the global object.
      const site = topIndex(p);
      const ordered = [...reads.keys()].every((g) => !globalWrites.has(g) && topIndex(scope.getBinding(g)!.path) < site);
      if (!r.ok || !ordered || (typeof r.value === "object" && r.value !== null)) {
        if (interlock) unresolved++;
        return;
      }
      const v = r.value;
      const want = lit.value;
      const holds = operator === "===" ? v === want : operator === "!==" ? v !== want : operator === "==" ? v == want : v != want;
      p.replaceWith(t.booleanLiteral(holds));
      if (interlock) foldedFns.add(name);
      // Evidence of an anti-strip interlock only when the check hashes a constant corpus.
      if (interlock && [...reads.values()].some((v) => Array.isArray(v) && v.length > 0)) corpusInterlocks.add(name);
      folded++;
    },
  });
  // `typeof D === "function" && <folded>`: D is a constant top-level function, so the guard holds.
  traverse(ast, {
    LogicalExpression(p) {
      if (p.node.operator !== "&&" || !t.isBooleanLiteral(p.node.right)) return;
      const name = typeofFunctionOf(p.node.left);
      if (name && foldedFns.has(name)) p.replaceWith(p.node.right);
    },
  });

  let corpora = 0;
  traverse(ast, { VariableDeclarator(p) { if (readCorpus(p.node.init)) corpora++; } });
  if (corpusInterlocks.size) f.add("entangle", "corpus-digest-interlock", "evaluated the anti-strip interlock statically and folded it to its unmodified value", corpusInterlocks.size);
  if (corpora) f.add("prompt", "interlock-safety-corpus", "LLM-directed decoy corpus (vectorId / classifierDomain / triggerPayload)", corpora);
  return { folded, unresolved };
}
