import type { Findings } from "../../core/types.js";
import { t, traverse, type NodePath } from "../ast.js";

const MATH_PURE = new Set(["imul", "abs", "min", "max", "floor", "ceil", "round", "trunc", "clz32", "sign"]);

/**
 * True when `fn` only touches its own locals, the single top-level `state`
 * binding, and pure Math helpers: no other calls, no globals, no `this`.
 */
function isClosedOver(fn: NodePath<t.FunctionDeclaration>, state: string, programScope: NodePath["scope"]): boolean {
  let ok = true;
  // Locals that alias part of the state (`const _w = state.slots[i].words`): writes through them stay private.
  const aliases = new Set<string>([state]);
  fn.traverse({
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id) && p.node.init && aliases.has(rootName(p.node.init) ?? "")) aliases.add(p.node.id.name);
    },
  });
  const privateTarget = (target: t.Node, scope: NodePath["scope"]): boolean => {
    if (t.isIdentifier(target)) {
      // Plain locals (incl. block-scoped loop vars) are fine; parameters and outer bindings are not.
      const b = scope.getBinding(target.name);
      return !!b && b.scope !== programScope && b.kind !== "param";
    }
    const root = rootName(target);
    if (!root || !aliases.has(root)) return false;
    const b = scope.getBinding(root);
    return root === state ? b?.scope === programScope : !!b && b.kind !== "param";
  };
  fn.traverse({
    AssignmentExpression(p) { if (!privateTarget(p.node.left, p.scope)) ok = false; },
    UpdateExpression(p) { if (!privateTarget(p.node.argument, p.scope)) ok = false; },
    UnaryExpression(p) { if (p.node.operator === "delete" && !privateTarget(p.node.argument, p.scope)) ok = false; },
  });
  fn.traverse({
    ThisExpression() { ok = false; },
    NewExpression() { ok = false; },
    AwaitExpression() { ok = false; },
    YieldExpression() { ok = false; },
    ThrowStatement() { ok = false; },
    CallExpression(p) {
      const c = p.node.callee;
      const mathCall =
        t.isMemberExpression(c) && !c.computed && t.isIdentifier(c.object, { name: "Math" }) &&
        t.isIdentifier(c.property) && MATH_PURE.has(c.property.name) && !p.scope.getBinding("Math");
      if (!mathCall) ok = false;
    },
    Identifier(p) {
      if (!p.isReferencedIdentifier()) return;
      const name = p.node.name;
      if (name === "Math" || name === "undefined" || name === "arguments") {
        if (name === "arguments") ok = false;
        return;
      }
      const b = p.scope.getBinding(name);
      if (!b) { ok = false; return; } // unknown global
      if (b.scope === programScope && name !== state) ok = false;
    },
  });
  return ok;
}

/** `a.b[c].d` → "a" (the base identifier of a member chain). */
function rootName(n: t.Node): string | undefined {
  while (t.isMemberExpression(n) || t.isOptionalMemberExpression(n)) n = n.object;
  return t.isIdentifier(n) ? n.name : undefined;
}

/** Literals, identifiers, `x.length`, and arithmetic over them: evaluating them has no effect. */
function isSafeArg(a: t.Expression): boolean {
  if (t.isLiteral(a) && !t.isTemplateLiteral(a)) return true;
  if (t.isIdentifier(a)) return true;
  if (t.isMemberExpression(a)) return !a.computed && t.isIdentifier(a.property, { name: "length" }) && t.isExpression(a.object) && isSafeArg(a.object);
  if (t.isBinaryExpression(a)) return t.isExpression(a.left) && isSafeArg(a.left) && isSafeArg(a.right);
  if (t.isUnaryExpression(a)) return a.operator !== "delete" && isSafeArg(a.argument);
  return false;
}

/**
 * BLA's memory-diff shield: a top-level state object plus a "step" function
 * called (result discarded) from every real function so memory snapshots
 * churn. If the function only mutates that private object, those calls are
 * unobservable: drop them and let the shaker remove the rest.
 */
export function stripPrivateStateSinks(ast: t.File, f: Findings): number {
  let removed = 0;
  traverse(ast, {
    Program(pp) {
      pp.scope.crawl();
      const fns = new Map<string, NodePath<t.FunctionDeclaration>>();
      for (const s of pp.get("body")) if (s.isFunctionDeclaration() && s.node.id) fns.set(s.node.id.name, s);

      // Candidate sinks: functions whose only outer reference is one top-level state binding,
      // and whose every call is a discarded statement with side-effect-free arguments.
      const byState = new Map<string, { name: string; fn: NodePath<t.FunctionDeclaration>; calls: NodePath[] }[]>();
      for (const [name, fn] of fns) {
        const binding = pp.scope.getBinding(name);
        if (!binding || !binding.constant) continue;
        const calls = binding.referencePaths.map((r) => r.parentPath!);
        if (!calls.length) continue;
        const allDiscarded = calls.every(
          (c) =>
            !!c && c.isCallExpression() && t.isIdentifier(c.node.callee, { name }) && !!c.parentPath?.isExpressionStatement() &&
            c.node.arguments.every((a) => t.isExpression(a) && isSafeArg(a)),
        );
        if (!allDiscarded) continue;
        const outer = new Set<string>();
        fn.traverse({
          Identifier(p) {
            if (!p.isReferencedIdentifier()) return;
            const b = p.scope.getBinding(p.node.name);
            if (b && b.scope === pp.scope && p.node.name !== name) outer.add(p.node.name);
          },
        });
        if (outer.size !== 1) continue;
        const state = [...outer][0]!;
        if (!isClosedOver(fn, state, pp.scope)) continue;
        const group = byState.get(state) ?? [];
        group.push({ name, fn, calls });
        byState.set(state, group);
      }

      // The state must be used only inside its sink group; then nothing can observe it.
      for (const [state, group] of byState) {
        const sb = pp.scope.getBinding(state);
        if (!sb || !sb.referencePaths.every((r) => group.some((g) => r.findParent((x) => x === g.fn)))) continue;
        for (const g of group) {
          for (const c of g.calls) c.parentPath!.remove();
          removed += g.calls.length;
        }
      }
      pp.stop();
    },
  });
  if (removed) f.add("runtime", "memory-diff-churn", "removed calls to a private-state churn function (shadow heap) that nothing observes", removed);
  return removed;
}
