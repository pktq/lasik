import { parse } from "@babel/parser";
import { generate } from "@babel/generator";
import type * as t from "@babel/types";
import { VISITOR_KEYS, isFunction } from "@babel/types";

export type { NodePath } from "@babel/traverse";
export { default as traverse } from "@babel/traverse";
export * as t from "@babel/types";

export function parseJs(code: string, filename = "input.js"): ReturnType<typeof parse> {
  const ts = /\.(c|m)?tsx?$/i.test(filename);
  return parse(code, {
    sourceType: "unambiguous",
    sourceFilename: filename,
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    plugins: ts ? ["typescript", "jsx"] : ["jsx"],
  });
}

export function printJs(ast: t.File): string {
  return generate(ast, { comments: true, jsescOption: { minimal: true } }).code + "\n";
}

/**
 * Visit `root` and its descendants, but not the bodies of functions nested
 * inside it. A marker found this way belongs to `root` itself, not to some
 * inner function (e.g. a bundler wrapper that merely contains a BLA block).
 */
export function traverseOwn(root: t.Node, visit: (n: t.Node) => void): void {
  const walk = (n: t.Node, top: boolean): void => {
    visit(n);
    if (!top && isFunction(n)) return;
    for (const key of VISITOR_KEYS[n.type] ?? []) {
      const child = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) for (const c of child) { if (c && typeof c === "object") walk(c as t.Node, false); }
      else if (child && typeof child === "object") walk(child as t.Node, false);
    }
  };
  walk(root, true);
}
