import type { Findings } from "../../core/types.js";
import { DECOY_DECL } from "../fingerprints.js";
import { t, traverse, type NodePath } from "../ast.js";

export interface ShakeOptions {
  /** Identifiers used from outside the file (e.g. HTML on* attributes). Always kept. */
  externalRoots?: Set<string>;
  /**
   * The file is proven BLA-hardened. In a plain script BLA keeps real
   * top-level names and only its own injections carry a `_<hex>` tag, so
   * unreachable tagged globals are BLA's too.
   */
  blaHardened?: boolean;
}

/** BLA's generated names: camelCase stem (`verbAdjNoun`) + `_` + 3–4 hex. Not `show_404` or `cache_add`. */
const BLA_TAG = /^_?[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*_[0-9a-f]{3,4}$/;

type DeclPath = NodePath<t.FunctionDeclaration> | NodePath<t.ClassDeclaration> | NodePath<t.VariableDeclarator>;

/** True when the file is a module (ESM/CJS), so unreferenced top-level code can't be used from elsewhere. */
function isModuleLike(ast: t.File): boolean {
  if (ast.program.sourceType === "module") return true;
  let cjs = false;
  let umd = false;
  traverse(ast, {
    Identifier(p) {
      const n = p.node.name;
      if ((n === "require" || n === "module" || n === "exports" || n === "define") && !p.scope.getBinding(n) && p.isReferencedIdentifier()) {
        // `typeof module !== "undefined"` / `define.amd`: a UMD wrapper that also runs as a browser script.
        if (p.parentPath?.isUnaryExpression({ operator: "typeof" }) || n === "define") umd = true;
        else cjs = true;
      }
    },
  });
  return cjs && !umd;
}

/** `eval`, `with`, `new Function`, string timers: names can be reached dynamically, so nothing is provably dead. */
function hasDynamicNameAccess(ast: t.File): boolean {
  let dyn = false;
  t.traverseFast(ast, (n) => {
    if (dyn) return;
    if (t.isWithStatement(n)) dyn = true;
    else if ((t.isCallExpression(n) || t.isNewExpression(n)) && t.isIdentifier(n.callee)) {
      const c = n.callee.name;
      if (c === "eval" || c === "Function") dyn = true;
      if ((c === "setTimeout" || c === "setInterval") && (t.isStringLiteral(n.arguments[0]) || t.isTemplateLiteral(n.arguments[0]))) dyn = true;
    }
  });
  return dyn;
}

/** Like scope.isPure, but also treats `Object.freeze(<pure>)` and literal containers as pure. */
function isPureInit(node: t.Node, scope: NodePath["scope"]): boolean {
  if (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.object, { name: "Object" }) &&
    t.isIdentifier(node.callee.property) &&
    (node.callee.property.name === "freeze" || node.callee.property.name === "seal") &&
    !scope.getBinding("Object")
  ) {
    return node.arguments.every((a) => t.isExpression(a) && isPureInit(a, scope));
  }
  if (t.isArrayExpression(node)) return node.elements.every((e) => e === null || (t.isExpression(e) && isPureInit(e, scope)));
  if (t.isObjectExpression(node)) {
    return node.properties.every((p) =>
      t.isObjectMethod(p) ? !p.computed : t.isObjectProperty(p) && !p.computed && t.isExpression(p.value) && isPureInit(p.value, scope),
    );
  }
  if (t.isNewExpression(node) || t.isCallExpression(node)) {
    if (isEffectFreeRead(node)) return true;
  }
  return scope.isPure(node) || isEffectFreeRead(node);
}

const PURE_METHODS = new Set(["split", "map", "join", "slice", "concat", "padEnd", "padStart", "repeat", "toString", "fill"]);

const GLOBAL_ROOTS = new Set(["process", "globalThis", "Date", "Math", "performance", "navigator", "window", "Number"]);

/**
 * Environment reads with no side effects that BLA uses to build runtime seeds:
 * `typeof x`, `process.pid`, `process.hrtime.bigint()`, `Date.now()`,
 * `Number(...)`, `new Array(32).fill(0)`, and arithmetic/conditionals over them.
 */
function isEffectFreeRead(node: t.Node | null | undefined): boolean {
  if (!node) return true;
  switch (node.type) {
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "BigIntLiteral":
      return true;
    case "ArrayExpression":
      return node.elements.every((e) => e === null || (t.isExpression(e) && isEffectFreeRead(e)));
    case "ObjectExpression":
      return node.properties.every((p) => t.isObjectProperty(p) && !p.computed && t.isExpression(p.value) && isEffectFreeRead(p.value));
    case "Identifier":
      return GLOBAL_ROOTS.has(node.name) || node.name === "undefined";
    case "UnaryExpression":
      return node.operator === "typeof" ? true : isEffectFreeRead(node.argument);
    case "BinaryExpression":
      return node.left.type !== "PrivateName" && isEffectFreeRead(node.left) && isEffectFreeRead(node.right);
    case "LogicalExpression":
      return isEffectFreeRead(node.left) && isEffectFreeRead(node.right);
    case "ConditionalExpression":
      return isEffectFreeRead(node.test) && isEffectFreeRead(node.consequent) && isEffectFreeRead(node.alternate);
    case "MemberExpression":
    case "OptionalMemberExpression":
      return !node.computed && isEffectFreeRead(node.object);
    case "CallExpression":
    case "OptionalCallExpression": {
      const c = node.callee;
      const path = memberPath(c);
      // "1,2,3".split(",").map(Number) and friends: pure builtins on pure receivers.
      if (
        (t.isMemberExpression(c) || t.isOptionalMemberExpression(c)) && !c.computed && t.isIdentifier(c.property) &&
        PURE_METHODS.has(c.property.name) && !t.isIdentifier(c.object) && isEffectFreeRead(c.object)
      ) {
        return node.arguments.every((a) =>
          c.property.type === "Identifier" && c.property.name === "map"
            ? (t.isIdentifier(a) && ["Number", "String", "Boolean"].includes(a.name)) || isPureCallback(a)
            : t.isExpression(a) && isEffectFreeRead(a),
        );
      }
      const ok = ["Number", "Date.now", "process.hrtime.bigint", "performance.now"].includes(path ?? "") ||
        (path?.startsWith("Math.") ?? false) ||
        (t.isMemberExpression(c) && t.isIdentifier(c.property, { name: "fill" }) && t.isNewExpression(c.object) &&
          t.isIdentifier(c.object.callee, { name: "Array" }) && c.object.arguments.every((a) => t.isNumericLiteral(a)));
      return ok && node.arguments.every((a) => t.isExpression(a) && isEffectFreeRead(a));
    }
    default:
      return false;
  }
}

const PURE_FNS = new Set(["parseInt", "parseFloat", "Number", "String", "Boolean"]);

/** `function (n) { n = +n; return n | 0; }`: no calls (bar pure converters / Math), no member writes. */
function isPureCallback(a: t.Node): boolean {
  if (!t.isFunctionExpression(a) && !t.isArrowFunctionExpression(a)) return false;
  let ok = true;
  t.traverseFast(a.body, (n) => {
    if (!ok) return;
    if (t.isCallExpression(n)) {
      const p = memberPath(n.callee);
      if (!p || !(PURE_FNS.has(p) || p.startsWith("Math."))) ok = false;
    } else if (t.isNewExpression(n) || t.isThisExpression(n) || t.isAwaitExpression(n) || t.isYieldExpression(n)) {
      ok = false;
    } else if ((t.isAssignmentExpression(n) && !t.isIdentifier(n.left)) || (t.isUpdateExpression(n) && !t.isIdentifier(n.argument))) {
      ok = false;
    }
  });
  return ok;
}

function memberPath(n: t.Node): string | undefined {
  if (t.isIdentifier(n)) return n.name;
  if ((t.isMemberExpression(n) || t.isOptionalMemberExpression(n)) && !n.computed && t.isIdentifier(n.property)) {
    const o = memberPath(n.object);
    return o && `${o}.${n.property.name}`;
  }
  return undefined;
}

/** `void x;` / `void [x, y];` at top level: BLA's "keep this decoy referenced" anchors. */
function isAnchor(stmt: t.Statement): boolean {
  if (!t.isExpressionStatement(stmt) || !t.isUnaryExpression(stmt.expression, { operator: "void" })) return false;
  const arg = stmt.expression.argument;
  if (t.isIdentifier(arg)) return true;
  return t.isArrayExpression(arg) && arg.elements.every((e) => t.isIdentifier(e));
}

/**
 * Remove top-level declarations nothing live can reach. Roots are every
 * statement that does something; decoy clusters that only call each other
 * (BLA's call-graph labyrinths, tarpits, honeypots) fall away together.
 */
export function shakeUnreachable(ast: t.File, f: Findings, opts: ShakeOptions = {}): number {
  let removed = 0;
  const programPath = (): NodePath<t.Program> => {
    let pp!: NodePath<t.Program>;
    traverse(ast, { Program(p) { pp = p; p.stop(); } });
    return pp;
  };

  let pp = programPath();
  for (const stmt of pp.get("body")) {
    if (isAnchor(stmt.node)) {
      stmt.remove();
      removed++;
      f.add("deceive", "keep-alive-anchor", "removed `void decoy;` keep-alive anchors");
    }
  }

  if (hasDynamicNameAccess(ast)) {
    f.add("deceive", "shake-skipped-dynamic", "unreachable-code removal skipped: file uses eval/with/new Function/string timers");
    return removed;
  }
  const moduleLike = isModuleLike(ast);
  const external = opts.externalRoots ?? new Set<string>();

  for (let round = 0; round < 8; round++) {
    pp = programPath();
    pp.scope.crawl();
    const decls = new Map<string, DeclPath>();
    const roots: NodePath[] = [];

    for (const stmt of pp.get("body")) {
      if (stmt.isFunctionDeclaration() || stmt.isClassDeclaration()) {
        const id = stmt.node.id?.name;
        if (id && !(stmt.isClassDeclaration() && !stmt.scope.isPure(stmt.node))) decls.set(id, stmt);
        else roots.push(stmt);
      } else if (stmt.isVariableDeclaration()) {
        for (const d of stmt.get("declarations")) {
          const id = d.node.id;
          const pure = !d.node.init || isPureInit(d.node.init, d.scope);
          if (t.isIdentifier(id) && pure) decls.set(id.name, d);
          else roots.push(d);
        }
      } else {
        roots.push(stmt); // expressions, exports, imports, control flow
      }
    }

    // In a plain script every global may be used by another script; only fingerprinted decoys are fair game.
    for (const [name, d] of decls) {
      const injected = DECOY_DECL.test(name) || (opts.blaHardened === true && BLA_TAG.test(name));
      if (external.has(name) || (!moduleLike && !injected)) roots.push(d);
    }

    const live = new Set<string>();
    const queue: NodePath[] = [...roots];
    const programScope = pp.scope;
    const markRefs = (p: NodePath) => {
      p.traverse({
        JSXIdentifier(jp) {
          // <Button/> references the Button binding.
          const name = jp.node.name;
          if (live.has(name) || !decls.has(name) || jp.scope.getBinding(name)?.scope !== programScope) return;
          live.add(name);
          queue.push(decls.get(name)!);
        },
        Identifier(ip) {
          const name = ip.node.name;
          if (live.has(name) || !decls.has(name)) return;
          const isRef = ip.isReferencedIdentifier();
          if (!isRef && !(ip as NodePath).parentPath?.isAssignmentExpression()) return;
          if (ip.scope.getBinding(name)?.scope !== programScope) return;
          live.add(name);
          queue.push(decls.get(name)!);
        },
      });
    };
    for (const r of roots) if (decls.has((r.node as { id?: t.Identifier }).id?.name ?? "")) live.add((r.node as { id: t.Identifier }).id.name);
    while (queue.length) {
      const p = queue.pop()!;
      if (p.isIdentifier()) continue;
      markRefs(p);
    }

    let thisRound = 0;
    for (const [name, d] of decls) {
      if (live.has(name)) continue;
      if (DECOY_DECL.test(name)) f.add("deceive", "fingerprinted-decoy", "removed BLA decoy declaration (known stem)");
      else f.add("deceive", "unreachable-decl", "removed top-level declaration unreachable from any live code");
      d.remove();
      thisRound++;
    }
    removed += thisRound;
    if (!thisRound) break;
  }
  return removed;
}
