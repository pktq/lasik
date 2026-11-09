import { parseJs, printJs, t, traverse } from "../ast.js";

/** Every BLA JS output declares this corpus at the top of the program it hardened. */
const CORPUS = /^_interlockSafetyCorpus_[0-9a-f]{3,6}$/;

/** A function body BLA treated as its whole program: it declares the corpus as a direct statement. */
function isBlaModuleBody(body: t.BlockStatement): boolean {
  return body.body.some((s) => t.isVariableDeclaration(s) && s.declarations.some((d) => t.isIdentifier(d.id) && CORPUS.test(d.id.name)));
}

export interface NestedHeal {
  code: string;
  changed: boolean;
}

/**
 * BLA's esbuild plugin (bla/src/bundler/index.ts, `blaEsbuildPlugin` onLoad)
 * hardens each source module before bundling, so the bundle wraps every
 * hardened module in a function (`__commonJS({ "a.cjs"(exports, module) { … } })`,
 * an IIFE, a webpack module factory). The JS passes work on a program's top
 * level, so heal each such body as its own program (`heal`, run with closure
 * semantics: nothing outside the function can name its locals) and splice the
 * result back. Returns how many bodies changed.
 */
export function healNestedModules(ast: t.File, filename: string | undefined, heal: (code: string) => NestedHeal): number {
  let changed = 0;
  traverse(ast, {
    Function(p) {
      const body = p.node.body;
      if (!t.isBlockStatement(body) || !isBlaModuleBody(body)) return;
      p.skip(); // the recursive heal handles anything nested deeper
      const code = printJs(t.file(t.program(body.body, body.directives)));
      // `yield`, `super`, `new.target` only parse inside their function: leave such bodies alone.
      if (parseJs(code, filename).errors?.length) return;
      const r = heal(code);
      if (!r.changed) return;
      const healed = parseJs(r.code, filename);
      if (healed.errors?.length) return;
      body.body = healed.program.body;
      body.directives = healed.program.directives;
      changed++;
    },
  });
  return changed;
}
