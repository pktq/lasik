import { Findings } from "../core/types.js";
import { parseJs, printJs } from "./ast.js";
import { stripScrambledComments } from "./passes/comments.js";
import { firewallJs } from "./passes/firewall.js";
import { eliminateDeadBranches } from "./passes/dead-code.js";
import { cutCorpusInterlocks } from "./passes/interlock.js";
import { foldOpaquePredicates } from "./passes/opaque.js";
import { decryptStrings } from "./passes/decrypt-strings.js";
import { stripPrivateStateSinks } from "./passes/private-state.js";
import { stripSelfSeal } from "./passes/self-seal.js";
import { foldWeaveInvariants } from "./passes/weave.js";
import { renameRequireHandles } from "./passes/rename.js";
import { stripRuntimeDecoys } from "./passes/runtime-decoys.js";
import { shakeUnreachable } from "./passes/tree-shake.js";

/** Findings that only a BLA-hardened file produces. */
const STRONG = new Set([
  "corpus-digest-interlock", "interlock-safety-corpus", "opaque-predicate", "fingerprinted-decoy",
  "xor-keystream-strings", "runtime-deception-block", "bind-scope", "honey-sourcemap", "self-seal",
]);

export interface JsHealOptions {
  filename?: string;
  aggressive?: boolean;
  externalRoots?: Set<string>;
  /** Rename BLA-renamed module handles (default true). */
  rename?: boolean;
  /** Redact LLM-directed decoy text in strings and comments (default true). */
  firewall?: boolean;
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
  const ast = parseJs(code, opts.filename);
  if (ast.errors?.length) warnings.push(`parsed with ${ast.errors.length} recoverable syntax error(s)`);

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
    const blaHardened = findings.list().some((x) => STRONG.has(x.technique));
    round += shakeUnreachable(ast, findings, { externalRoots: opts.externalRoots, blaHardened });
    changes += round;
    if (!round) break;
  }

  // Structural passes only touch files proven BLA-hardened; clean code is left byte-identical.
  const hardened = findings.list().some((x) => STRONG.has(x.technique));
  if (!hardened && !opts.aggressive) {
    const clean = new Findings();
    if (opts.firewall === false) return { code, findings: clean, warnings, changed: false };
    const fresh = parseJs(code, opts.filename);
    const redacted = firewallJs(fresh, clean);
    return { code: redacted ? printJs(fresh) : code, findings: clean, warnings, changed: redacted > 0 };
  }

  if (opts.rename !== false) changes += renameRequireHandles(ast, findings);
  if (opts.firewall !== false) changes += firewallJs(ast, findings);

  return { code: changes ? printJs(ast) : code, findings, warnings, changed: changes > 0 };
}
