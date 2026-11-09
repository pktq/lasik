import type { Findings } from "../../core/types.js";
import { t, traverse, type NodePath } from "../ast.js";

/** String literals only BLA's runtime-deception blocks contain. */
const RUNTIME_DECOY_STRINGS = [
  "decorative-deception-signal",
  "HARDWARE_ENCLAVE_DELEGATED",
  "TEE-ENCLAVE-SOVEREIGN:",
  "enclave:vsock:attestation-ready",
  "none-client-side-only",
];
const RUNTIME_DECOY_NAME = /^_initRuntimeDeception\w*_[0-9a-f]{3,6}$/;

function iifeCallee(stmt: t.Statement): t.FunctionExpression | t.ArrowFunctionExpression | undefined {
  if (!t.isExpressionStatement(stmt)) return undefined;
  let e: t.Expression = stmt.expression;
  if (t.isUnaryExpression(e) && (e.operator === "!" || e.operator === "void")) e = e.argument;
  if (!t.isCallExpression(e) || e.arguments.length) return undefined;
  const c = e.callee;
  return t.isFunctionExpression(c) || t.isArrowFunctionExpression(c) ? c : undefined;
}

/**
 * Remove BLA's runtime "Truman show" IIFEs: self-contained blocks that
 * publish fake enclave status objects, decoy globals and event listeners
 * for debuggers to find. Only removed when the block touches no top-level
 * binding of the program, so real code can't depend on it.
 */
export function stripRuntimeDecoys(ast: t.File, f: Findings): number {
  let n = 0;
  traverse(ast, {
    Program(pp) {
      for (const stmt of pp.get("body")) {
        const fn = iifeCallee(stmt.node);
        if (!fn) continue;
        let marked = t.isFunctionExpression(fn) && !!fn.id && RUNTIME_DECOY_NAME.test(fn.id.name);
        let closed = true;
        stmt.traverse({
          StringLiteral(p) {
            if (RUNTIME_DECOY_STRINGS.some((s) => p.node.value.includes(s))) marked = true;
          },
          Identifier(p: NodePath<t.Identifier>) {
            if (!p.isReferencedIdentifier()) return;
            const b = p.scope.getBinding(p.node.name);
            if (b && b.scope === pp.scope) closed = false;
          },
        });
        if (marked && closed) {
          stmt.remove();
          n++;
        }
      }
      pp.stop();
    },
  });
  if (n) f.add("runtime", "runtime-deception-block", "removed self-contained runtime decoy block (fake enclave status, decoy globals/listeners)", n);
  return n + stripBindScope(ast, f);
}

/**
 * `bla_bind_scope`: a public domain/date lock IIFE that throws outside its
 * contract. It is real behaviour, so report the contract, then remove the
 * gate so the code can be analysed (and run) anywhere.
 */
function stripBindScope(ast: t.File, f: Findings): number {
  let n = 0;
  traverse(ast, {
    Program(pp) {
      for (const stmt of pp.get("body")) {
        const fn = iifeCallee(stmt.node);
        if (!fn) continue;
        let contract: t.ObjectExpression | undefined;
        let bind = false;
        t.traverseFast(fn, (x) => {
          if (t.isStringLiteral(x, { value: "bla-bind-scope/v1" })) bind = true;
          if (t.isIdentifier(x, { name: "BLA_BIND_HOST" }) || t.isStringLiteral(x, { value: "BLA_BIND_HOST" })) bind = true;
          if (t.isObjectExpression(x) && x.properties.some((p) => t.isObjectProperty(p) && t.isStringLiteral(p.value, { value: "bla-bind-scope/v1" }))) contract = x;
        });
        if (!bind) continue;
        const terms: string[] = [];
        for (const p of contract?.properties ?? []) {
          if (!t.isObjectProperty(p)) continue;
          const k = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : "";
          if (["domains", "validFrom", "validUntil", "hosts"].includes(k)) {
            const v = t.isStringLiteral(p.value) ? p.value.value : t.isArrayExpression(p.value) ? p.value.elements.map((e) => (t.isStringLiteral(e) ? e.value : "?")).join(", ") : "?";
            terms.push(`${k}=${v}`);
          }
        }
        stmt.remove();
        n++;
        f.add("entangle", "bind-scope", `removed bla_bind_scope domain/date lock${terms.length ? ` (${terms.join("; ")})` : ""}`);
      }
      pp.stop();
    },
  });
  return n;
}
