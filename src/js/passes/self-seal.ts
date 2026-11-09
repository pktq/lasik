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
  let ownFile = false;
  let reads = false;
  // Only the function's own body counts: a wrapper that merely contains a seal is real code.
  traverseOwn(fn, (n) => {
    if (t.isStringLiteral(n) && SEAL_ERRORS.includes(n.value)) err = true;
    if (t.isIdentifier(n, { name: "createHash" }) || t.isStringLiteral(n, { value: "sha256" })) hash = true;
    if (t.isIdentifier(n) && SEAL_MARKERS.has(n.name)) marker = true;
    if (t.isIdentifier(n, { name: "__blaSidecarDigest" })) sidecar = true;
    if (t.isIdentifier(n, { name: "__filename" }) || (t.isMemberExpression(n) && t.isMetaProperty(n.object) && t.isIdentifier(n.property, { name: "url" }))) ownFile = true;
    if (t.isIdentifier(n, { name: "readFileSync" })) reads = true;
  });
  // A check that hashes the file's own bytes and throws on a mismatch fails on any healed
  // output, whoever wrote it, so it cannot survive healing. Otherwise only BLA's markers count.
  // The soft-fold sidecar preamble never throws (sidecar-entangle.ts:320-332) but is still BLA's.
  return hash && ((err && ownFile && reads) || ((err || sidecar) && marker));
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
