import type { Findings } from "../../core/types.js";
import { t, traverse, type NodePath } from "../ast.js";

function truthiness(node: t.Node): boolean | undefined {
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value !== 0 && !Number.isNaN(node.value);
  if (t.isStringLiteral(node)) return node.value.length > 0;
  if (t.isNullLiteral(node)) return false;
  if (t.isUnaryExpression(node) && node.operator === "!") {
    const v = truthiness(node.argument);
    return v === undefined ? undefined : !v;
  }
  if (t.isUnaryExpression(node) && node.operator === "void" && t.isNumericLiteral(node.argument)) return false;
  return undefined;
}

function numValue(n: t.Node): number | undefined {
  if (t.isNumericLiteral(n)) return Number.isInteger(n.value) ? n.value : undefined;
  if (t.isUnaryExpression(n, { operator: "-" }) && t.isNumericLiteral(n.argument) && Number.isInteger(n.argument.value)) return -n.argument.value;
  return undefined;
}

/** Statements to splice in place of a branch body, keeping a block when it declares lexical bindings. */
function unwrap(stmt: t.Statement | null | undefined): t.Statement[] {
  if (!stmt) return [];
  if (!t.isBlockStatement(stmt)) return [stmt];
  const lexical = stmt.body.some(
    (s) => t.isClassDeclaration(s) || t.isFunctionDeclaration(s) || (t.isVariableDeclaration(s) && s.kind !== "var"),
  );
  return lexical ? [stmt] : stmt.body;
}

/** Remove branches whose condition is now a literal (after opaque folding). */
export function eliminateDeadBranches(ast: t.File, f: Findings): number {
  let n = 0;
  let joined = 0;
  traverse(ast, {
    BinaryExpression: {
      exit(path) {
        // "ab" + "c" → "abc": BLA splits secrets into per-character ternaries, folding leaves the pieces.
        const { left, right, operator } = path.node;
        if (operator === "+" && t.isStringLiteral(left) && t.isStringLiteral(right)) {
          path.replaceWith(t.stringLiteral(left.value + right.value));
          joined++;
        } else if (operator === "+" || operator === "-") {
          // 1543 + 505 → 2048, -a + -b → -(a+b): BLA splits integer constants into sums.
          const a = numValue(left);
          const b = numValue(right);
          if (a === undefined || b === undefined) return;
          const v = operator === "+" ? a + b : a - b;
          if (Number.isSafeInteger(v)) {
            path.replaceWith(t.valueToNode(v));
            joined++;
          }
        }
      },
    },
    CallExpression: {
      exit(path) {
        // "1,2,3".split(",").map(Number) → [1, 2, 3]; [a, b].concat([c, d]) → [a, b, c, d]
        const n = path.node;
        if (!t.isMemberExpression(n.callee) || n.callee.computed || !t.isIdentifier(n.callee.property)) return;
        const prop = n.callee.property.name;
        const obj = n.callee.object;
        if (prop === "map" && t.isIdentifier(n.arguments[0], { name: "Number" }) && !path.scope.getBinding("Number") &&
            t.isCallExpression(obj) && t.isMemberExpression(obj.callee) && t.isIdentifier(obj.callee.property, { name: "split" }) &&
            t.isStringLiteral(obj.callee.object) && t.isStringLiteral(obj.arguments[0], { value: "," })) {
          const nums = obj.callee.object.value.split(",").map(Number);
          if (nums.length > 0 && nums.every((x) => Number.isSafeInteger(x))) {
            path.replaceWith(t.arrayExpression(nums.map((x) => t.valueToNode(x) as t.Expression)));
            joined++;
          }
        } else if (prop === "concat" && t.isArrayExpression(obj) && n.arguments.length > 0 &&
                   n.arguments.every((a) => t.isArrayExpression(a) && a.elements.every((e) => e && !t.isSpreadElement(e)))) {
          path.replaceWith(t.arrayExpression([...obj.elements, ...n.arguments.flatMap((a) => (a as t.ArrayExpression).elements)]));
          joined++;
        }
      },
    },
    UnaryExpression: {
      exit(path) {
        if (path.node.operator !== "!") return;
        const v = truthiness(path.node.argument);
        if (v !== undefined && t.isBooleanLiteral(path.node.argument)) {
          path.replaceWith(t.booleanLiteral(!v));
        }
      },
    },
    LogicalExpression: {
      exit(path) {
        const { left, right, operator } = path.node;
        const l = truthiness(left);
        const r = truthiness(right);
        if (operator === "&&") {
          if (l === false) { path.replaceWith(left); n++; return; }
          if (l === true) { path.replaceWith(right); n++; return; }
          // x && false: falsy either way; safe to drop x only when it's pure.
          if (r === false && path.scope.isPure(left)) { path.replaceWith(t.booleanLiteral(false)); n++; }
        } else if (operator === "||") {
          if (l === true) { path.replaceWith(left); n++; return; }
          if (l === false) { path.replaceWith(right); n++; return; }
          if (r === true && path.scope.isPure(left)) { path.replaceWith(t.booleanLiteral(true)); n++; }
        }
      },
    },
    ConditionalExpression: {
      exit(path) {
        const v = truthiness(path.node.test);
        if (v === undefined) return;
        path.replaceWith(v ? path.node.consequent : path.node.alternate);
        n++;
      },
    },
    IfStatement: {
      exit(path: NodePath<t.IfStatement>) {
        const v = truthiness(path.node.test);
        if (v === undefined) return;
        const keep = unwrap(v ? path.node.consequent : path.node.alternate);
        if (!Array.isArray(path.container)) {
          // Single-statement slot (e.g. `else if`, loop body): must stay one statement.
          path.replaceWith(keep.length === 0 ? t.emptyStatement() : keep.length === 1 ? keep[0]! : t.blockStatement(keep));
        } else if (keep.length === 0) path.remove();
        else if (keep.length === 1) path.replaceWith(keep[0]!);
        else path.replaceWithMultiple(keep);
        n++;
      },
    },
    WhileStatement: {
      exit(path) {
        if (truthiness(path.node.test) !== false) return;
        if (Array.isArray(path.container)) path.remove();
        else path.replaceWith(t.emptyStatement());
        n++;
      },
    },
  });
  if (n) f.add("tarpit", "dead-branch", "removed branches made unreachable by folded predicates", n);
  if (joined) f.add("encrypt", "split-literal", "re-joined strings, integers and byte arrays BLA split into fragments", joined);
  return n + joined;
}
