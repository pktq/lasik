import type * as t from "@babel/types";

/**
 * Tiny evaluator for the integer/bitwise expressions BLA builds opaque
 * predicates from. Never runs target code: it walks the AST itself and
 * refuses (returns undefined) on anything outside this closed set.
 */
export type Env = Map<string, number>;

type V = number | boolean;

export function evalInt(node: t.Node, env: Env): V | undefined {
  switch (node.type) {
    case "NumericLiteral":
      return node.value;
    case "BooleanLiteral":
      return node.value;
    case "Identifier":
      return env.get(node.name);
    case "ParenthesizedExpression":
      return evalInt(node.expression, env);
    case "UnaryExpression": {
      const a = evalInt(node.argument, env);
      if (a === undefined) return undefined;
      if (node.operator === "~") return ~num(a);
      if (node.operator === "-") return -num(a);
      if (node.operator === "+") return num(a);
      if (node.operator === "!") return !a;
      return undefined;
    }
    case "BinaryExpression": {
      if (node.left.type === "PrivateName") return undefined;
      const a = evalInt(node.left, env);
      const b = evalInt(node.right, env);
      if (a === undefined || b === undefined) return undefined;
      const x = num(a);
      const y = num(b);
      switch (node.operator) {
        case "|": return x | y;
        case "&": return x & y;
        case "^": return x ^ y;
        case "<<": return x << y;
        case ">>": return x >> y;
        case ">>>": return x >>> y;
        case "+": return x + y;
        case "-": return x - y;
        case "*": return x * y;
        case "%": return y === 0 ? undefined : x % y;
        case "===": case "==": return x === y;
        case "!==": case "!=": return x !== y;
        case "<": return x < y;
        case "<=": return x <= y;
        case ">": return x > y;
        case ">=": return x >= y;
        default: return undefined;
      }
    }
    case "LogicalExpression": {
      const a = evalInt(node.left, env);
      if (a === undefined) return undefined;
      if (node.operator === "&&") return a ? evalInt(node.right, env) : a;
      if (node.operator === "||") return a ? a : evalInt(node.right, env);
      return undefined;
    }
    case "CallExpression": {
      // Math.imul(a, b)
      const c = node.callee;
      if (
        c.type === "MemberExpression" && !c.computed &&
        c.object.type === "Identifier" && c.object.name === "Math" &&
        c.property.type === "Identifier" && c.property.name === "imul" &&
        node.arguments.length === 2
      ) {
        const [p, q] = node.arguments;
        if (!p || !q || p.type === "SpreadElement" || q.type === "SpreadElement" || p.type === "ArgumentPlaceholder" || q.type === "ArgumentPlaceholder") return undefined;
        const a = evalInt(p, env);
        const b = evalInt(q, env);
        if (a === undefined || b === undefined) return undefined;
        return Math.imul(num(a), num(b));
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function num(v: V): number {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

/** Free identifiers referenced by an expression, or undefined if it contains anything evalInt can't handle. */
export function freeIdents(node: t.Node, out = new Set<string>()): Set<string> | undefined {
  switch (node.type) {
    case "NumericLiteral":
    case "BooleanLiteral":
      return out;
    case "Identifier":
      if (node.name === "undefined" || node.name === "NaN" || node.name === "Infinity") return undefined;
      out.add(node.name);
      return out;
    case "ParenthesizedExpression":
      return freeIdents(node.expression, out);
    case "UnaryExpression":
      return ["~", "-", "+", "!"].includes(node.operator) ? freeIdents(node.argument, out) : undefined;
    case "BinaryExpression":
      if (node.left.type === "PrivateName") return undefined;
      return freeIdents(node.left, out) && freeIdents(node.right, out);
    case "LogicalExpression":
      return node.operator === "??" ? undefined : freeIdents(node.left, out) && freeIdents(node.right, out);
    case "CallExpression": {
      const c = node.callee;
      const isImul =
        c.type === "MemberExpression" && !c.computed && c.object.type === "Identifier" &&
        c.object.name === "Math" && c.property.type === "Identifier" && c.property.name === "imul";
      if (!isImul || node.arguments.length !== 2) return undefined;
      for (const a of node.arguments) if (a.type === "SpreadElement" || a.type === "ArgumentPlaceholder" || !freeIdents(a, out)) return undefined;
      return out;
    }
    default:
      return undefined;
  }
}

/**
 * True when every use of a free identifier sits directly under an operator
 * that coerces it to int32 (|, &, ^, ~, shifts, Math.imul). Then the
 * expression depends only on ToInt32(x), so sampling int32 values is a
 * faithful model of every runtime value of x.
 */
export function identsAreInt32Coerced(node: t.Node, parentCoerces = false): boolean {
  switch (node.type) {
    case "Identifier":
      return parentCoerces;
    case "NumericLiteral":
    case "BooleanLiteral":
      return true;
    case "ParenthesizedExpression":
      return identsAreInt32Coerced(node.expression, parentCoerces);
    case "UnaryExpression":
      return identsAreInt32Coerced(node.argument, node.operator === "~");
    case "BinaryExpression": {
      if (node.left.type === "PrivateName") return false;
      const c = ["|", "&", "^", "<<", ">>", ">>>"].includes(node.operator);
      return identsAreInt32Coerced(node.left, c) && identsAreInt32Coerced(node.right, c);
    }
    case "LogicalExpression":
      return identsAreInt32Coerced(node.left, false) && identsAreInt32Coerced(node.right, false);
    case "CallExpression":
      return node.arguments.every((a) => a.type !== "SpreadElement" && a.type !== "ArgumentPlaceholder" && identsAreInt32Coerced(a, true));
    default:
      return false;
  }
}
