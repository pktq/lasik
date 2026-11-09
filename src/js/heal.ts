import { Findings } from "../core/types.js";
import { parseJs, printJs } from "./ast.js";
import { stripHardenedComments, stripScrambledComments } from "./passes/comments.js";
import { firewallJs } from "./passes/firewall.js";
import { eliminateDeadBranches } from "./passes/dead-code.js";
import { cutCorpusInterlocks } from "./passes/interlock.js";
import { foldOpaquePredicates } from "./passes/opaque.js";
import { decryptStrings } from "./passes/decrypt-strings.js";
import { stripPrivateStateSinks } from "./passes/private-state.js";
import { stripSelfSeal } from "./passes/self-seal.js";
import { foldWeaveInvariants } from "./passes/weave.js";
import { renameBlaNames, renameRequireHandles } from "./passes/rename.js";
import { healNestedModules } from "./passes/nested-modules.js";
import { stripRuntimeDecoys } from "./passes/runtime-decoys.js";
import { shakeUnreachable } from "./passes/tree-shake.js";

/** Evidence only BLA produces: one is enough. */
const UNIQUE = new Set(["corpus-digest-interlock", "interlock-safety-corpus", "runtime-deception-block", "bind-scope", "honey-sourcemap"]);
/** Proven BLA shapes that could, rarely, occur by coincidence: need several. */
const REPEATED = new Set(["opaque-predicate", "fingerprinted-decoy"]);

/** A file is treated as BLA-hardened (and gets the structural passes) only on this evidence. */
function isHardened(f: Findings): boolean {
  let repeated = 0;
  for (const x of f.list()) {
    if (UNIQUE.has(x.technique)) return true;
    if (REPEATED.has(x.technique)) repeated += x.count;
  }
  return repeated >= 3;
}

export interface JsHealOptions {
  filename?: string;
  aggressive?: boolean;
  externalRoots?: Set<string>;
  /**
   * The code is a function body healed as a program (a bundled BLA module):
   * its top-level names are closure locals nobody outside can reach.
   */
  closure?: boolean;
  /** Inline script of a page without external scripts (see ShakeOptions.pageLocal). */
  pageLocal?: boolean;
  /** Rename BLA-renamed module handles (default true). */
  rename?: boolean;
  /**
   * Prompt firewall. true/"safe" (default): behaviour-preserving (comments, plus
   * BLA-specific strings in hardened files). "strict": redact every match, for
   * an agent read view. false: off.
   */
  firewall?: boolean | "safe" | "strict";
}

export interface JsHealResult {
  code: string;
  findings: Findings;
  warnings: string[];
  changed: boolean;
}

/** Run every JS pass to a fixpoint. Never executes the input. */
export function healJs(code: string, opts: JsHealOptions = {}): JsHealResult {
  const findings = new Findings();
  const warnings: string[] = [];
  let ast = parseJs(code, opts.filename);
  if (ast.errors?.length) warnings.push(`parsed with ${ast.errors.length} recoverable syntax error(s)`);

  // Bundled BLA modules first, each as its own program; the outer file is judged on its own evidence.
  const inner = new Findings();
  const nested = healNestedModules(ast, opts.filename, (body) => {
    const r = healJs(body, { ...opts, closure: true, externalRoots: undefined, pageLocal: undefined });
    for (const x of r.findings.list()) inner.add(x.layer, x.technique, x.detail, x.count);
    warnings.push(...r.warnings.map((w) => `bundled module: ${w}`));
    return r;
  });
  if (nested) {
    code = printJs(ast);
    ast = parseJs(code, opts.filename);
  }
  const withInner = (f: Findings): Findings => {
    for (const x of inner.list()) f.add(x.layer, x.technique, x.detail, x.count);
    return f;
  };

  let changes = 0;
  const lock = cutCorpusInterlocks(ast, findings);
  changes += lock.folded;
  if (lock.unresolved) warnings.push(`${lock.unresolved} corpus interlock(s) could not be resolved statically; decoy corpus kept`);
  changes += stripScrambledComments(ast, findings);
  changes += stripRuntimeDecoys(ast, findings);

  for (let i = 0; i < 6; i++) {
    let round = foldOpaquePredicates(ast, findings, { aggressive: opts.aggressive });
    round += eliminateDeadBranches(ast, findings);
    round += foldWeaveInvariants(ast, findings);
    round += stripPrivateStateSinks(ast, findings);
    round += decryptStrings(ast, findings);
    round += stripSelfSeal(ast, findings);
    round += shakeUnreachable(ast, findings, { externalRoots: opts.externalRoots, blaHardened: isHardened(findings), closure: opts.closure, pageLocal: opts.pageLocal });
    changes += round;
    if (!round) break;
  }

  const mode = opts.firewall === "strict" ? "strict" : "safe";
  // Structural passes only touch files proven BLA-hardened; clean code is left byte-identical.
  const hardened = isHardened(findings);
  if (!hardened && !opts.aggressive) {
    const clean = new Findings();
    if (opts.firewall === false) return { code, findings: withInner(clean), warnings, changed: nested > 0 };
    const fresh = parseJs(code, opts.filename);
    const redacted = firewallJs(fresh, clean, { mode, hardened: false });
    return { code: redacted ? printJs(fresh) : code, findings: withInner(clean), warnings, changed: redacted > 0 || nested > 0 };
  }

  changes += stripHardenedComments(ast, findings);
  if (opts.rename !== false) changes += renameRequireHandles(ast, findings);
  if (opts.rename !== false && hardened) changes += renameBlaNames(ast, findings);
  if (opts.firewall !== false) changes += firewallJs(ast, findings, { mode, hardened: true });

  return { code: changes ? printJs(ast) : code, findings: withInner(findings), warnings, changed: changes > 0 || nested > 0 };
}
