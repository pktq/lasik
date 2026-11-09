import { parse } from "@babel/parser";
import { generate } from "@babel/generator";
import type * as t from "@babel/types";

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
