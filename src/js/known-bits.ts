import { t } from "./ast.js";

/** Bits of an int32 value known at analysis time: where `mask` has a 1, the bit equals the one in `value`. */
export interface KnownBits {
  mask: number;
  value: number;
}

export const UNKNOWN: KnownBits = { mask: 0, value: 0 };

const lit = (n: number): KnownBits => ({ mask: -1, value: n | 0 });

/**
 * Known-bits of an expression under int32 coercion. `lookup` resolves
 * identifiers (e.g. other top-level consts). Unknown → mask 0.
 */
export function knownBits(node: t.Node, lookup: (name: string) => KnownBits | undefined, depth = 0): KnownBits {
  if (depth > 64) return UNKNOWN;
  const kb = (n: t.Node) => knownBits(n, lookup, depth + 1);
  switch (node.type) {
    case "NumericLiteral":
      return Number.isInteger(node.value) && Math.abs(node.value) <= 0xffffffff ? lit(node.value) : UNKNOWN;
    case "BooleanLiteral":
      return lit(node.value ? 1 : 0);
    case "Identifier":
      return lookup(node.name) ?? UNKNOWN;
    case "ParenthesizedExpression":
      return kb(node.expression);
    case "UnaryExpression": {
      if (node.operator !== "~") return UNKNOWN;
      const a = kb(node.argument);
      return { mask: a.mask, value: ~a.value & a.mask };
    }
    case "ConditionalExpression": {
      const a = kb(node.consequent);
      const b = kb(node.alternate);
      const same = a.mask & b.mask & ~(a.value ^ b.value);
      return { mask: same, value: a.value & same };
    }
    case "BinaryExpression": {
      if (node.left.type === "PrivateName") return UNKNOWN;
      const a = kb(node.left);
      const b = kb(node.right);
      switch (node.operator) {
        case "&": {
          const zero = (a.mask & ~a.value) | (b.mask & ~b.value);
          const one = a.mask & a.value & b.mask & b.value;
          return { mask: zero | one, value: one };
        }
        case "|": {
          const one = (a.mask & a.value) | (b.mask & b.value);
          const zero = a.mask & ~a.value & b.mask & ~b.value;
          return { mask: zero | one, value: one };
        }
        case "^": {
          const m = a.mask & b.mask;
          return { mask: m, value: (a.value ^ b.value) & m };
        }
        case "<<": {
          if (b.mask !== -1) return UNKNOWN;
          const s = b.value & 31;
          return { mask: (a.mask << s) | ((1 << s) - 1), value: a.value << s };
        }
        default:
          return UNKNOWN;
      }
    }
    default:
      return UNKNOWN;
  }
}

/**
 * Highest result bit an expression can depend on when its inputs' bits
 * 0..h are fixed, i.e. it only uses ops whose bit i depends on input bits
 * 0..i (+, -, imul, &, |, ^, ~, << by a literal). Returns false if the
 * expression uses anything else (>>, division, comparisons inside, ...).
 */
export function isLowBitClosed(node: t.Node): boolean {
  switch (node.type) {
    case "NumericLiteral":
      return Number.isInteger(node.value);
    case "Identifier":
      return true;
    case "ParenthesizedExpression":
      return isLowBitClosed(node.expression);
    case "UnaryExpression":
      return (node.operator === "~" || node.operator === "-") && isLowBitClosed(node.argument);
    case "BinaryExpression":
      if (node.left.type === "PrivateName") return false;
      if (node.operator === "<<") return isLowBitClosed(node.left) && t.isNumericLiteral(node.right);
      return ["+", "-", "&", "|", "^"].includes(node.operator) && isLowBitClosed(node.left) && isLowBitClosed(node.right);
    case "CallExpression": {
      const c = node.callee;
      const imul =
        t.isMemberExpression(c) && !c.computed && t.isIdentifier(c.object, { name: "Math" }) && t.isIdentifier(c.property, { name: "imul" });
      return imul && node.arguments.length === 2 && node.arguments.every((a) => t.isExpression(a) && isLowBitClosed(a));
    }
    default:
      return false;
  }
}
