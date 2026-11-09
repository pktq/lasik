import type { Findings } from "../../core/types.js";
import { t, traverse, traverseOwn, type NodePath } from "../ast.js";

const SEAL_ERRORS = ["integrity check failed", "integrity binding mismatch"];

/** Names only BLA's seal emitter uses (it injects them after renaming, so they survive). */
const SEAL_MARKERS = new Set(["__blaSidecarDigest", "selfExpected", "envNote"]);

function isSealFunction(fn: t.Function): boolean {
  let err = false;
  let hash = false;
  let marker = false;
  let sidecar = false;
  // Only the function's own body counts: a wrapper that merely contains a seal is real code.
  traverseOwn(fn, (n) => {
    if (t.isStringLiteral(n) && SEAL_ERRORS.includes(n.value)) err = true;
    if (t.isIdentifier(n, { name: "createHash" }) || t.isStringLiteral(n, { value: "sha256" })) hash = true;
    if (t.isIdentifier(n) && SEAL_MARKERS.has(n.name)) marker = true;
    if (t.isIdentifier(n, { name: "__blaSidecarDigest" })) sidecar = true;
  });
  // The soft-fold sidecar preamble never throws (sidecar-entangle.ts:320-332) but is still BLA's.
  if (hash && (err || sidecar) && marker) return true;
  // Without markers: a check that hashes the file's own bytes and throws on a mismatch fails on
  // any healed output, and BLA's rewrite would already have broken a user's own such check. It
  // goes only if it does nothing else (no writes outside itself, no side-effecting calls).
  return hash && err && readsOwnFile(fn) && onlyChecks(fn);
}

/**
 * BLA's self-seal / sidecar entanglement: the file hashes its own bytes and
 * its sibling artifacts and throws if anything changed, so any analysis
 * edit kills it. The digests are path- and environment-dependent, so real
 * logic can't depend on their value; once other passes fold the seeds they
 * fed, the checks are pure tamper detection. Remove them.
 */
export function stripSelfSeal(ast: t.File, f: Findings): number {
  let n = 0;
  const sealFns = new Set<string>();
  const siblings = new Set<string>();
  traverse(ast, {
    Program(pp) {
      pp.scope.crawl();
      for (const stmt of pp.get("body")) {
        if (stmt.isFunctionDeclaration() && stmt.node.id && isSealFunction(stmt.node)) sealFns.add(stmt.node.id.name);
      }
      for (const stmt of pp.get("body")) {
        // (function () { ...seal... })();
        if (stmt.isExpressionStatement()) {
          const e = stmt.node.expression;
          if (t.isCallExpression(e) && (t.isFunctionExpression(e.callee) || t.isArrowFunctionExpression(e.callee)) && isSealFunction(e.callee)) {
            collectSiblings(e.callee, siblings);
            stmt.remove();
            n++;
          }
          continue;
        }
        // var digest = (sealA() ^ sealB()) >>> 0;  with digest unused
        if (stmt.isVariableDeclaration()) {
          for (const d of stmt.get("declarations")) {
            const id = d.node.id;
            if (!t.isIdentifier(id) || !d.node.init) continue;
            let onlySeal = true;
            let any = false;
            t.traverseFast(d.node.init, (x) => {
              if (t.isCallExpression(x)) {
                if (t.isIdentifier(x.callee) && sealFns.has(x.callee.name)) any = true;
                else onlySeal = false;
              }
            });
            if (any && onlySeal && !pp.scope.getBinding(id.name)?.referenced) {
              d.remove();
              n++;
            }
          }
        }
      }
      for (const name of sealFns) {
        const fn = pp.scope.getBinding(name)?.path as NodePath<t.FunctionDeclaration> | undefined;
        if (fn?.node) collectSiblings(fn.node, siblings);
      }
      pp.stop();
    },
  });
  if (n) {
    const sib = siblings.size ? ` (own bytes + ${[...siblings].join(", ")})` : "";
    f.add("entangle", "self-seal", `removed SHA-256 self-integrity / sidecar tamper checks${sib}`, n);
  }
  return n;
}

function collectSiblings(fn: t.Node, out: Set<string>): void {
  t.traverseFast(fn, (n) => {
    if (t.isArrayExpression(n) && n.elements.length && n.elements.every((e) => t.isStringLiteral(e) && /^[\w.-]+\.(wasm|html|py|json|js|cjs|node)$/.test(e.value))) {
      for (const e of n.elements) out.add((e as t.StringLiteral).value);
    }
  });
}

const unbound = (n: t.Node, name: string) => t.isIdentifier(n, { name });
const isImportMetaUrl = (n: t.Node) => t.isMemberExpression(n) && t.isMetaProperty(n.object) && t.isIdentifier(n.property, { name: "url" });

/** `__filename`, `import.meta.url`, `fileURLToPath(import.meta.url)`, or a guard choosing one of them or null. */
function isOwnPath(n: t.Node | null | undefined): boolean {
  if (!n) return false;
  if (unbound(n, "__filename") || isImportMetaUrl(n)) return true;
  if (t.isCallExpression(n) && n.arguments.length === 1 && isImportMetaUrl(n.arguments[0]!)) return true;
  if (t.isNewExpression(n) && t.isIdentifier(n.callee, { name: "URL" }) && n.arguments.length === 1 && isImportMetaUrl(n.arguments[0]!)) return true;
  if (t.isConditionalExpression(n)) return [n.consequent, n.alternate].every((b) => t.isNullLiteral(b) || isOwnPath(b));
  return false;
}

/** Some `readFileSync` in the function reads the file's own path (directly or through a local initialised to it). */
function readsOwnFile(fn: t.Function): boolean {
  const inits = new Map<string, t.Node | null | undefined>();
  t.traverseFast(fn.body, (n) => { if (t.isVariableDeclarator(n) && t.isIdentifier(n.id)) inits.set(n.id.name, n.init); });
  let own = false;
  t.traverseFast(fn.body, (n) => {
    if (!t.isCallExpression(n)) return;
    const c = n.callee;
    const name = t.isIdentifier(c) ? c.name : t.isMemberExpression(c) && t.isIdentifier(c.property) ? c.property.name : "";
    if (name !== "readFileSync") return;
    const a = n.arguments[0];
    if (isOwnPath(a) || (t.isIdentifier(a) && isOwnPath(inits.get(a.name)))) own = true;
  });
  return own;
}

/** Calls that act on the world rather than compute a digest. */
const EFFECT_CALL = /^(?:write|append|unlink|rm|mkdir|rename|copyFile|chmod|chown|symlink|send|postMessage|exit|abort|kill|spawn|exec|fork|fetch|request|connect|listen|setTimeout|setInterval|setImmediate|queueMicrotask|addEventListener|removeEventListener|dispatchEvent|emit|on|once|defineProperty|defineProperties|assign|setPrototypeOf|push|unshift|splice|log|warn|error|info|debug|open|close|eval|Function|require\.cache)/;

/** The function only computes: it writes nothing but its own locals and calls nothing with effects. */
function onlyChecks(fn: t.Function): boolean {
  const locals = new Set<string>();
  const collect = (n: t.Node) => t.traverseFast(n, (x) => { if (t.isIdentifier(x)) locals.add(x.name); });
  for (const p of fn.params) collect(p);
  t.traverseFast(fn.body, (n) => {
    if (t.isVariableDeclarator(n)) collect(n.id);
    if (t.isCatchClause(n) && n.param) collect(n.param);
    if (t.isFunctionDeclaration(n) && n.id) locals.add(n.id.name);
  });
  const root = (n: t.Node): t.Node => (t.isMemberExpression(n) ? root(n.object) : n);
  let ok = true;
  t.traverseFast(fn.body, (n) => {
    if (!ok) return;
    const target = t.isAssignmentExpression(n) ? n.left : t.isUpdateExpression(n) ? n.argument : t.isUnaryExpression(n, { operator: "delete" }) ? n.argument : undefined;
    if (target) {
      const r = root(target);
      if (!t.isIdentifier(r) || !locals.has(r.name) || t.isMemberExpression(target)) ok = t.isIdentifier(target) && locals.has(target.name);
    }
    if (t.isCallExpression(n) || t.isNewExpression(n)) {
      const c = n.callee;
      const name = t.isIdentifier(c) ? c.name : t.isMemberExpression(c) && t.isIdentifier(c.property) ? c.property.name : "";
      if (EFFECT_CALL.test(name)) ok = false;
    }
    if (t.isFunction(n) && n !== fn) ok = false; // a callback could be registered and run later
  });
  return ok;
}
