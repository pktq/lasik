import type { Findings } from "../../core/types.js";
import { t, traverse } from "../ast.js";

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
  traverse(ast, {
    Program(pp) {
      for (const stmt of pp.get("body")) {
        if (!stmt.isVariableDeclaration()) continue;
        for (const d of stmt.node.declarations) {
          if (!t.isIdentifier(d.id) || !BLA_NAME.test(d.id.name)) continue;
          const init = d.init;
          if (!t.isCallExpression(init) || !t.isIdentifier(init.callee, { name: "require" }) || !t.isStringLiteral(init.arguments[0])) continue;
          const name = moduleIdent(init.arguments[0].value);
          if (!name || pp.scope.hasBinding(name) || pp.scope.hasGlobal(name)) continue;
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
