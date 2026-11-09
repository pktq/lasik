import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Findings } from "../src/core/types.js";
import { parseJs, printJs } from "../src/js/ast.js";
import { healJs } from "../src/js/heal.js";
import { evalInt, freeIdents, identsAreInt32Coerced } from "../src/js/int-eval.js";
import { isLowBitClosed, knownBits } from "../src/js/known-bits.js";
import { eliminateDeadBranches } from "../src/js/passes/dead-code.js";
import { shakeUnreachable } from "../src/js/passes/tree-shake.js";
import { t } from "../src/js/ast.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const expr = (code: string) => (parseJs(`(${code});`).program.body[0] as t.ExpressionStatement).expression;
const run = (code: string, pass: (ast: t.File, f: Findings) => number) => {
  const ast = parseJs(code, "x.cjs");
  pass(ast, new Findings());
  return printJs(ast).trim();
};

describe("int-eval", () => {
  it("evaluates the closed integer subset with JS semantics", () => {
    expect(evalInt(expr("Math.imul(0x7fffffff, 3) | 0"), new Map())).toBe(Math.imul(0x7fffffff, 3));
    expect(evalInt(expr("(x ^ 5) >>> 0"), new Map([["x", -1]]))).toBe((-1 ^ 5) >>> 0);
    expect(evalInt(expr("x === 3 && y !== 2"), new Map([["x", 3], ["y", 1]]))).toBe(true);
  });

  it("refuses anything outside the subset", () => {
    expect(evalInt(expr("foo(1)"), new Map())).toBeUndefined();
    expect(evalInt(expr("x / 2"), new Map([["x", 4]]))).toBeUndefined();
    expect(freeIdents(expr("a.b + 1"))).toBeUndefined();
  });

  it("knows when every free variable is coerced to int32", () => {
    expect(identsAreInt32Coerced(expr("(x | 3) + 1"))).toBe(true);
    expect(identsAreInt32Coerced(expr("x + 1"))).toBe(false);
  });
});

describe("known-bits", () => {
  it("tracks fixed bits through &, |, ^ and conditionals", () => {
    const kb = knownBits(expr("(Date.now() & 0x7fffc) | 1"), () => undefined);
    expect(kb.mask & 3).toBe(3);
    expect(kb.value & 3).toBe(1);
    const c = knownBits(expr("p ? 5 : 7"), () => undefined);
    expect(c.mask & 0b111).toBe(0b101); // bit 1 differs
  });

  it("only accepts ops whose low bits depend on low bits", () => {
    expect(isLowBitClosed(expr("Math.imul(x ^ 3, x + 1) & 7"))).toBe(true);
    expect(isLowBitClosed(expr("(x >> 3) & 7"))).toBe(false);
    expect(isLowBitClosed(expr("(x * x) & 7"))).toBe(false);
  });
});

describe("dead-code", () => {
  it("drops literal-false branches and unwraps literal-true ones", () => {
    expect(run("if (false) { a(); } else { b(); }", eliminateDeadBranches)).toBe("b();");
    expect(run("x = true ? 1 : 2;", eliminateDeadBranches)).toBe("x = 1;");
    expect(run("while (false) { a(); }", eliminateDeadBranches)).toBe("");
  });

  it("keeps a block when the kept branch declares lexical bindings", () => {
    expect(run("if (true) { let a = 1; f(a); }", eliminateDeadBranches)).toContain("{");
  });

  it("re-joins split strings, integers and CSV byte arrays", () => {
    expect(run('x = "sh" + "a2" + "56";', eliminateDeadBranches)).toBe('x = "sha256";');
    expect(run("x = 1543 + 505;", eliminateDeadBranches)).toBe("x = 2048;");
    expect(run("x = -5 + -6;", eliminateDeadBranches)).toBe("x = -11;");
    expect(run('x = "1,2,3".split(",").map(Number);', eliminateDeadBranches)).toBe("x = [1, 2, 3];");
    expect(run("x = [1, 2].concat([3, 4]);", eliminateDeadBranches)).toBe("x = [1, 2, 3, 4];");
  });
});

describe("tree-shake", () => {
  it("removes unreachable decoy clusters in modules but keeps live code", () => {
    const out = run(
      `function a_1f2(){ return b_3e4(); } function b_3e4(){ return a_1f2(); } function live(){ return 1; } module.exports = live;`,
      (ast, f) => shakeUnreachable(ast, f),
    );
    expect(out).not.toContain("a_1f2");
    expect(out).toContain("function live");
  });

  it("keeps unreferenced globals in plain scripts (another script may use them)", () => {
    const out = run(`function helper(){ return 1; }`, (ast, f) => shakeUnreachable(ast, f));
    expect(out).toContain("helper");
  });

  it("keeps declarations with side effects", () => {
    const out = run(`const x = sideEffect(); module.exports = 1;`, (ast, f) => shakeUnreachable(ast, f));
    expect(out).toContain("sideEffect()");
  });
});

describe("fixtures", () => {
  it("decrypts XOR-keystream string tables, including aliased decoders", () => {
    const r = healJs(fixture("xor-strings.cjs"), { filename: "x.cjs" });
    expect(r.code).toContain('a: "sha256"');
    expect(r.code).toContain('b: "license-key"');
    expect(r.code).not.toContain("split(");
  });

  it("removes shadow-heap churn, token sinks and keep-alive anchors", () => {
    const r = healJs(fixture("shadow-heap.cjs"), { filename: "x.cjs" });
    expect(r.code).not.toMatch(/shadowHeap|stepShadowHeap|tokenSink|void \[/);
    expect(r.code).toContain("return a + b");
  });

  it("removes self-seal tamper checks but never the real check", () => {
    const r = healJs(fixture("self-seal.cjs"), { filename: "x.cjs" });
    expect(r.code).not.toMatch(/integrity (check failed|binding mismatch)|measureIntegrity/);
    expect(r.code).toContain("(key ^ 0x5a5a) === 0x1234");
  });

  it("folds agent-woven slot invariants and zero entanglement", () => {
    const r = healJs(fixture("weave.cjs"), { filename: "x.cjs" });
    expect(r.code).not.toMatch(/sessionLedgerState|emitWorker/);
    expect(r.code).toContain("key.length !== 16");
  });
});
