import type { Findings } from "../../core/types.js";
import { knownBits, type KnownBits } from "../known-bits.js";
import { t, traverse, type NodePath } from "../ast.js";

const intersect = (a: KnownBits, b: KnownBits): KnownBits => {
  const same = a.mask & b.mask & ~(a.value ^ b.value);
  return { mask: same, value: a.value & same };
};

const BITWISE_ASSIGN = new Set(["|=", "&=", "^=", "<<=", ">>="]);

function fieldOf(node: t.Node, obj: string): string | undefined {
  return t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object, { name: obj }) && t.isIdentifier(node.property)
    ? node.property.name
    : undefined;
}

/**
 * BLA's "structural weave" has the host agent add a state slot
 * (`const ledger = { epoch: 1, ... }`) whose fields are only ever written
 * as `ledger.epoch = ... | 1`, then guard real code with
 * `(ledger.epoch & 1) !== 0` and mix `ledger.cursor & 0` into results.
 * Known-bits over every write proves those guards constant; `x & 0` is 0.
 */
export function foldWeaveInvariants(ast: t.File, f: Findings): number {
  let n = 0;
  traverse(ast, {
    Program(pp) {
      pp.scope.crawl();
      for (const stmt of pp.get("body")) {
        if (!stmt.isVariableDeclaration()) continue;
        for (const d of stmt.node.declarations) {
          if (!t.isIdentifier(d.id) || !t.isObjectExpression(d.init)) continue;
          const obj = d.id.name;
          const binding = pp.scope.getBinding(obj);
          if (!binding?.constant) continue;

          const fields = new Map<string, KnownBits>();
          let ok = true;
          for (const p of d.init.properties) {
            // Methods can write through `this`, which this analysis can't see.
            if (!t.isObjectProperty(p) || p.computed || !t.isIdentifier(p.key) || t.isFunction(p.value)) { ok = false; break; }
            fields.set(p.key.name, t.isExpression(p.value) ? knownBits(p.value, () => undefined) : { mask: 0, value: 0 });
          }
          if (!ok) continue;

          // Every reference must be `obj.field`; writes must be plain `obj.field = rhs`.
          const reads: NodePath<t.MemberExpression>[] = [];
          for (const ref of binding.referencePaths) {
            const m = ref.parentPath;
            const field = m && fieldOf(m.node, obj);
            if (!m || !field || !fields.has(field) || (m.node as t.MemberExpression).object !== ref.node) { ok = false; break; }
            const parent = m.parentPath!;
            if (parent.isAssignmentExpression() && parent.node.left === m.node) {
              if (parent.node.operator !== "=") { ok = false; break; }
              fields.set(field, intersect(fields.get(field)!, knownBits(parent.node.right, () => undefined)));
            } else if (parent.isUpdateExpression()) {
              ok = false;
              break;
            } else {
              reads.push(m as NodePath<t.MemberExpression>);
            }
          }
          if (!ok) continue;

          for (const m of reads) {
            const bin = m.parentPath;
            if (!bin?.isBinaryExpression({ operator: "&" }) || bin.node.left !== m.node || !t.isNumericLiteral(bin.node.right)) continue;
            const cmp = bin.parentPath;
            if (!cmp?.isBinaryExpression() || !["===", "!==", "==", "!="].includes(cmp.node.operator) || cmp.node.left !== bin.node || !t.isNumericLiteral(cmp.node.right)) continue;
            const kb = fields.get(fieldOf(m.node, obj)!)!;
            const mask = bin.node.right.value | 0;
            if ((kb.mask & mask) !== mask) continue;
            const eq = (kb.value & mask) === (cmp.node.right.value | 0);
            cmp.replaceWith(t.booleanLiteral(cmp.node.operator.startsWith("=") ? eq : !eq));
            n++;
          }
        }
      }
      pp.stop();
    },
  });

  // `x & 0` → 0 when x has no side effects (weave "entanglement" that is algebraically zero).
  let zeros = 0;
  traverse(ast, {
    BinaryExpression(p) {
      const { left, right, operator } = p.node;
      if (operator !== "&" || !t.isExpression(left)) return;
      const zeroSide = t.isNumericLiteral(right, { value: 0 }) ? left : t.isNumericLiteral(left, { value: 0 }) ? right : undefined;
      if (!zeroSide) return;
      const pure = t.isIdentifier(zeroSide) || (t.isMemberExpression(zeroSide) && !zeroSide.computed && t.isIdentifier(zeroSide.object)) || p.scope.isPure(zeroSide);
      if (!pure) return;
      p.replaceWith(t.numericLiteral(0));
      zeros++;
    },
    // What that leaves behind: `acc |= 0` on an accumulator that is int32 already is a no-op.
    ExpressionStatement: {
      exit(p) {
        const e = p.node.expression;
        if (!t.isAssignmentExpression(e) || !BITWISE_ASSIGN.has(e.operator) || e.operator === "&=" || !t.isNumericLiteral(e.right, { value: 0 }) || !t.isIdentifier(e.left)) return;
        const b = p.scope.getBinding(e.left.name);
        const init = b?.path.isVariableDeclarator() ? b.path.node.init : undefined;
        // int32 from the start, and every write is a compound bitwise op (which yields int32).
        if (!b || !t.isNumericLiteral(init) || (init.value | 0) !== init.value) return;
        if (!b.constantViolations.every((v) => v.isAssignmentExpression() && BITWISE_ASSIGN.has(v.node.operator))) return;
        if (Array.isArray(p.container)) p.remove();
        else p.replaceWith(t.emptyStatement());
        zeros++;
      },
    },
  });
  if (n) f.add("tarpit", "weave-invariant", "folded agent-woven state-slot invariant guards (known bits over every write)", n);
  if (zeros) f.add("tarpit", "weave-zero-entanglement", "folded `x & 0` entanglement terms to 0", zeros);
  return n + zeros;
}
