import type { Findings } from "../../core/types.js";
import { t, traverse } from "../ast.js";
import { dynamicNameRoots } from "./tree-shake.js";

/** BLA's renamer appends a 3–6 hex-digit tag to every identifier it touches. */
const BLA_NAME = /_[0-9a-f]{3,6}$/;

function moduleIdent(spec: string): string | undefined {
  const base = spec.replace(/^node:/, "").split("/").pop()!.replace(/\.(c|m)?js$/, "");
  const camel = base.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9_$]/g, "");
  return /^[A-Za-z_$]/.test(camel) ? camel : undefined;
}

/**
 * `const attestTransientCursor_e36 = require("fs")` → `const fs = require("fs")`.
 * BLA's original names are gone, but module handles can be named after the
 * module they load, which is what a human would have called them.
 */
export function renameRequireHandles(ast: t.File, f: Findings): number {
  let n = 0;
  // A name an eval string mentions must keep its spelling.
  const evalNames = dynamicNameRoots(ast);
  traverse(ast, {
    Program(pp) {
      pp.scope.crawl();
      for (const stmt of pp.get("body")) {
        if (!stmt.isVariableDeclaration()) continue;
        for (const d of stmt.node.declarations) {
          if (!t.isIdentifier(d.id) || !BLA_NAME.test(d.id.name) || !evalNames || evalNames.has(d.id.name)) continue;
          const init = d.init;
          if (!t.isCallExpression(init) || !t.isIdentifier(init.callee, { name: "require" }) || !t.isStringLiteral(init.arguments[0])) continue;
          const name = moduleIdent(init.arguments[0].value);
          if (!name || !t.isValidIdentifier(name) || pp.scope.hasBinding(name) || pp.scope.hasGlobal(name)) continue;
          // A reference inside a scope that declares its own `name` would be captured.
          const binding = pp.scope.getBinding(d.id.name);
          if (!binding || binding.referencePaths.some((r) => r.scope.getBinding(name) !== undefined)) continue;
          pp.scope.rename(d.id.name, name);
          n++;
        }
      }
      pp.stop();
    },
  });
  if (n) f.add("deceive", "renamed-module-handle", "renamed BLA-renamed require() handles after their module", n);
  return n + renamePanelAbi(ast, f);
}

/** BLA's realistic identifiers: camelCase words plus a 3–6 hex tag (`primeSparseStack_719`). */
const BLA_REALISTIC = /^[a-z]+(?:[A-Z][a-z0-9]*)+_[0-9a-f]{3,6}$/;

/**
 * BLA replaces every local name with a plausible but meaningless one
 * (`reconcileSealedEnvelope_b10`), which misleads more than it hides. In a file proven
 * BLA-hardened:
 *  - a binding exported or destructured under a key gets the key back
 *    (`module.exports = { clampPan: primeSparseStack_719 }` → `clampPan`);
 *  - other BLA-named locals and parameters get neutral names (`p0`, `v0`).
 * Functions and classes are renamed only when nothing in the file can observe a name
 * (`.name`, `.toString()`, `.stack`); an eval/with file keeps every name.
 */
export function renameBlaNames(ast: t.File, f: Findings): number {
  const evalNames = dynamicNameRoots(ast);
  if (!evalNames) return 0;
  let nameObservable = false;
  t.traverseFast(ast, (x) => {
    if ((t.isMemberExpression(x) || t.isOptionalMemberExpression(x)) && !x.computed && t.isIdentifier(x.property, { name: "name" })) nameObservable = true;
    if ((t.isMemberExpression(x) || t.isOptionalMemberExpression(x)) && !x.computed && t.isIdentifier(x.property) && /^(toString|stack)$/.test(x.property.name)) nameObservable = true;
  });

  // Keys a binding is published or imported under.
  const keyFor = new Map<string, string>();
  const claim = (local: t.Node | null | undefined, key: t.Node) => {
    if (!t.isIdentifier(local) || !BLA_REALISTIC.test(local.name)) return;
    const k = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : undefined;
    if (!k || !t.isValidIdentifier(k)) return;
    const prev = keyFor.get(local.name);
    keyFor.set(local.name, prev === undefined || prev === k ? k : "");
  };
  const isModuleExports = (n: t.Node) => t.isMemberExpression(n) && t.isIdentifier(n.object, { name: "module" }) && t.isIdentifier(n.property, { name: "exports" });
  t.traverseFast(ast, (x) => {
    if (t.isAssignmentExpression(x) && x.operator === "=") {
      if (isModuleExports(x.left) && t.isObjectExpression(x.right)) {
        for (const p of x.right.properties) if (t.isObjectProperty(p) && !p.computed) claim(p.value, p.key);
      } else if (t.isMemberExpression(x.left) && !x.left.computed && (isModuleExports(x.left.object) || t.isIdentifier(x.left.object, { name: "exports" }))) {
        claim(x.right, x.left.property);
      }
    }
    if (t.isVariableDeclarator(x) && t.isObjectPattern(x.id) && t.isCallExpression(x.init) && t.isIdentifier(x.init.callee, { name: "require" })) {
      for (const p of x.id.properties) if (t.isObjectProperty(p) && !p.computed) claim(p.value, p.key);
    }
  });

  let n = 0;
  let recovered = 0;
  const restored = new Set<string>();
  const countersByFn = new WeakMap<object, { p: number; v: number; f: number }>();
  traverse(ast, {
    Scope(path) {
      const owner = path.scope.getFunctionParent() ?? path.scope.getProgramParent();
      let counters = countersByFn.get(owner);
      if (!counters) countersByFn.set(owner, (counters = { p: 0, v: 0, f: 0 }));
      for (const [name, binding] of Object.entries(path.scope.bindings)) {
        if (!BLA_REALISTIC.test(name) || evalNames.has(name)) continue;
        const named = binding.kind === "hoisted" || t.isClassDeclaration(binding.path.node) || t.isFunctionExpression(binding.path.node) || t.isClassExpression(binding.path.node);
        if (named && nameObservable) continue;
        const free = (cand: string) =>
          t.isValidIdentifier(cand) && !path.scope.hasBinding(cand) && !path.scope.hasGlobal(cand) &&
          binding.referencePaths.every((r) => !r.scope.hasBinding(cand)) && binding.constantViolations.every((r) => !r.scope.hasBinding(cand));
        const key = keyFor.get(name);
        let next = key && free(key) ? key : undefined;
        if (next) {
          recovered++;
          restored.add(next);
        } else {
          const kind = binding.kind === "param" ? "p" : named ? "f" : "v";
          do next = `${kind}${counters[kind]++}`; while (!free(next));
        }
        path.scope.rename(name, next);
        n++;
      }
    },
  });
  // `{ clampPan: clampPan }` → `{ clampPan }` for the names just restored.
  t.traverseFast(ast, (x) => {
    if (t.isObjectProperty(x) && !x.computed && t.isIdentifier(x.key) && t.isIdentifier(x.value) && x.key.name === x.value.name && restored.has(x.key.name)) x.shorthand = true;
  });
  if (recovered) f.add("deceive", "recovered-export-name", "restored BLA-renamed bindings to the key they are exported or imported under", recovered);
  if (n - recovered) f.add("deceive", "neutral-rename", "replaced BLA's misleading realistic names with neutral ones (p0, v0, f0)", n - recovered);
  return n;
}

/**
 * BLA hashes the cross-file panel ABI name to `_blaPd_<10 hex>` (and
 * `_blaPdLocal_<10 hex>`), identically in the HTML panel and the JS that
 * reads it. A fixed mapping keeps every file consistent.
 */
function renamePanelAbi(ast: t.File, f: Findings): number {
  let n = 0;
  const fix = (s: string) => s.replace(/_blaPdLocal_[0-9a-f]{10}/g, "deriveLocal").replace(/_blaPd_[0-9a-f]{10}/g, "panelDerive");
  t.traverseFast(ast, (x) => {
    if (t.isIdentifier(x) && /_blaPd(Local)?_[0-9a-f]{10}/.test(x.name)) {
      x.name = fix(x.name);
      n++;
    } else if (t.isStringLiteral(x) && /_blaPd(Local)?_[0-9a-f]{10}/.test(x.value)) {
      x.value = fix(x.value);
      n++;
    }
  });
  if (n) f.add("deceive", "panel-abi-rename", "restored the hashed cross-file panel ABI name (_blaPd_*) to panelDerive/deriveLocal", n);
  return n;
}
