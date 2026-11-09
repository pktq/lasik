import type { Findings } from "../../core/types.js";
import { t, traverse } from "../ast.js";

interface Entry {
  anchor: string;
  payload: string;
}

/** BLA's corpus digest (cognitive-armor-trigger), reimplemented so nothing from the target is executed. */
export function corpusDigest(entries: Entry[], seedInput: number, minLength: number): number {
  if (entries.length < minLength) return 0;
  let acc = ((seedInput | 0) ^ 0x26b5c67b) >>> 0;
  for (const e of entries) {
    const text = e.anchor + "::" + e.payload;
    for (let j = 0; j < text.length; j++) {
      acc = Math.imul(acc ^ text.charCodeAt(j), 0x85ebca6b) >>> 0;
      acc = ((acc << 13) | (acc >>> 19)) >>> 0;
    }
  }
  return acc >>> 0;
}

function readCorpus(node: t.Node | null | undefined): Entry[] | undefined {
  if (!t.isArrayExpression(node)) return undefined;
  const out: Entry[] = [];
  for (const el of node.elements) {
    if (!t.isObjectExpression(el)) return undefined;
    let anchor: string | undefined;
    let payload: string | undefined;
    for (const p of el.properties) {
      if (!t.isObjectProperty(p) || !t.isStringLiteral(p.value)) continue;
      const key = t.isStringLiteral(p.key) ? p.key.value : t.isIdentifier(p.key) ? p.key.name : undefined;
      if (key === "coupledAnchorSymbol") anchor = p.value.value;
      if (key === "triggerPayload") payload = p.value.value;
    }
    if (anchor === undefined || payload === undefined) return undefined;
    out.push({ anchor, payload });
  }
  return out;
}

/** BLA's minimum-entries guard `xs.length < N` inside the digest function. */
function minLengthOf(fn: t.FunctionDeclaration): number {
  let min = 0;
  const visit = (n: t.Node | null | undefined): void => {
    if (!n || typeof n !== "object") return;
    if (
      t.isBinaryExpression(n, { operator: "<" }) &&
      t.isMemberExpression(n.left) &&
      t.isIdentifier(n.left.property, { name: "length" }) &&
      t.isNumericLiteral(n.right)
    ) {
      min = Math.max(min, n.right.value);
    }
    for (const key of t.VISITOR_KEYS[n.type] ?? []) {
      const child = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach((c) => visit(c as t.Node));
      else visit(child as t.Node);
    }
  };
  visit(fn.body);
  return min;
}

/**
 * BLA ties its decoy corpus to real code: a runtime seed's low bit is
 * `typeof D === "function" && D(s) === N ? 1 : 0`, so deleting the corpus
 * flips the bit. Recompute D(s) statically and fold the expression to the
 * value it has in the unmodified program, which frees the corpus for removal.
 */
export function cutCorpusInterlocks(ast: t.File, f: Findings): { folded: number; unresolved: number } {
  const corpora = new Map<string, Entry[]>();
  const digests = new Map<string, { corpus: string; min: number }>();

  traverse(ast, {
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id) && /^_interlockSafetyCorpus_[0-9a-f]{3,6}$/.test(p.node.id.name)) {
        const c = readCorpus(p.node.init);
        if (c) corpora.set(p.node.id.name, c);
      }
    },
    FunctionDeclaration(p) {
      const id = p.node.id?.name;
      if (!id || !/^_deriveContainmentCorpusDigest_[0-9a-f]{3,6}$/.test(id)) return;
      digests.set(id, { corpus: `_interlockSafetyCorpus_${id.slice(id.lastIndexOf("_") + 1)}`, min: minLengthOf(p.node) });
    },
  });

  let folded = 0;
  let unresolved = 0;
  traverse(ast, {
    ConditionalExpression(p) {
      const { test, consequent, alternate } = p.node;
      if (!t.isLogicalExpression(test, { operator: "&&" })) return;
      const cmp = test.right;
      if (!t.isBinaryExpression(cmp, { operator: "===" }) || !t.isCallExpression(cmp.left) || !t.isNumericLiteral(cmp.right)) return;
      const callee = cmp.left.callee;
      if (!t.isIdentifier(callee)) return;
      const d = digests.get(callee.name);
      if (!d) return;
      const corpus = corpora.get(d.corpus);
      const arg = cmp.left.arguments[0];
      const seed = arg === undefined ? 0 : t.isNumericLiteral(arg) ? arg.value : undefined;
      if (!corpus || seed === undefined) {
        unresolved++;
        return;
      }
      // `typeof D === "function"` is true in the unmodified program.
      const holds = corpusDigest(corpus, seed, d.min) === cmp.right.value;
      p.replaceWith(holds ? consequent : alternate);
      folded++;
    },
  });
  if (folded) f.add("entangle", "corpus-digest-interlock", "recomputed the decoy-corpus digest statically and folded the anti-strip seed bit", folded);
  if (corpora.size) f.add("prompt", "interlock-safety-corpus", "LLM-directed decoy corpus (vectorId / classifierDomain / triggerPayload)", corpora.size);
  return { folded, unresolved };
}
