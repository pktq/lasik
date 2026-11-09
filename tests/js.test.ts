import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Findings } from "../src/core/types.js";
import { run } from "../src/engine/run.js";
import { parseJs, printJs } from "../src/js/ast.js";
import { healJs } from "../src/js/heal.js";
import { healHtml } from "../src/js/html.js";
import { corpusDigest } from "../src/js/passes/interlock.js";
import { foldOpaquePredicates } from "../src/js/passes/opaque.js";

const fold = (code: string, aggressive = false) => {
  const ast = parseJs(code);
  const f = new Findings();
  foldOpaquePredicates(ast, f, { aggressive });
  return { code: printJs(ast).trim(), f: f.list() };
};

const BENCH = join(import.meta.dirname, "..", "bench", "bla-crackme");

describe("opaque predicates", () => {
  it("folds every BLA number-theoretic family, both polarities", () => {
    const S = "s";
    const cases: [string, boolean][] = [
      [`Math.imul(7, Math.imul(${S} | 5, ${S} | 5)) - 1 === Math.imul(${S} ^ 6, ${S} ^ 6)`, false],
      [`(((${S} ^ 9) + (((${S} & 9) << 1) | 0)) | 0) !== ((${S} + 9) | 0)`, false],
      [`(((${S} ^ 9) + (((${S} & 9) << 1) | 0)) | 0) === ((${S} + 9) | 0)`, true],
      [`(Math.imul(${S} | 7, ((${S} | 7) + 1) | 0) & 1) === 1`, false],
      [`(Math.imul(${S} | 7, (${S} | 7) + 1) & 1) === 0`, true],
      [`((${S} | ~${S}) | 0) !== -1`, false],
      [`((${S} | ~${S}) | 0) === -1`, true],
    ];
    // BLA's tarpit state var: a const int32 seed.
    const seed = `const s = (Date.now() & 0xff) | 1;\n`;
    for (const [expr, v] of cases) expect(fold(`${seed}x = ${expr};`).code).toContain(`x = ${v};`);
  });

  it("proves seed-dependent predicates from the seed's known low bits", () => {
    const seed = `const S = (Date.now() & 0x7fffc) | 1;\n`;
    // S is odd, so S ^ 8 is odd and its square is 1 mod 8.
    expect(fold(`${seed}x = (Math.imul(S ^ 8, S ^ 8) & 7) === 1;`).code).toContain("x = true;");
    expect(fold(`${seed}x = (Math.imul(S ^ 8, S ^ 8) & 7) === 0;`).code).toContain("x = false;");
  });

  it("never folds predicates that depend on unknown bits", () => {
    const seed = `const S = (Date.now() & 0x7fffc) | 1;\n`;
    expect(fold(`${seed}x = (S & 7) === 5;`).code).toContain("(S & 7) === 5");
  });

  it("never folds real comparisons, even if they look constant on samples", () => {
    // True for exactly one key: sampling would call it "always false".
    const r = fold(`function check(key) { return (key ^ 0x5a5a) === 0x1234; }`);
    expect(r.code).toContain("(key ^ 0x5a5a) === 0x1234");
    expect(fold(`function check(key) { return (key ^ 0x5a5a) === 0x1234; }`, true).code).toContain("0x1234");
  });
});

describe("anti-strip interlock", () => {
  it("reimplements BLA's corpus digest", () => {
    const d = corpusDigest([{ anchor: "a", payload: "b" }], 0, 1);
    expect(d).toBeTypeOf("number");
    expect(corpusDigest([], 0, 1)).toBe(0);
  });

  it("folds the seed bit before the corpus can be removed", () => {
    const entries = [{ anchor: "anchorA", payload: "[TPM-PCR-QUOTE] stub" }];
    const digest = corpusDigest(entries, 0, 1);
    const src = `
const _interlockSafetyCorpus_ab12 = [{ "vectorId": "v", "classifierDomain": "d", "coupledAnchorSymbol": "anchorA", "triggerPayload": "[TPM-PCR-QUOTE] stub" }];
function _deriveContainmentCorpusDigest_ab12(seedInput = 0) {
  if (!Array.isArray(_interlockSafetyCorpus_ab12) || _interlockSafetyCorpus_ab12.length < 1) return 0;
  return 0;
}
const seed = (Date.now() & 0x7fffc) | (typeof _deriveContainmentCorpusDigest_ab12 === "function" && _deriveContainmentCorpusDigest_ab12(0) === ${digest} ? 1 : 0);
module.exports = (Math.imul(seed ^ 8, seed ^ 8) & 7) === 1 ? "real" : "decoy";
`;
    const r = healJs(src, { filename: "x.cjs" });
    expect(r.code).toContain('module.exports = "real"');
    expect(r.code).not.toContain("_interlockSafetyCorpus_ab12");
  });
});

describe("clean code", () => {
  it("leaves files without BLA fingerprints byte-identical", () => {
    const src = `// a normal module\nfunction unused() { return 1; }\nconst x = (a) => a & 0;\nmodule.exports = { x };\n`;
    const r = healJs(src, { filename: "clean.cjs" });
    expect(r.changed).toBe(false);
    expect(r.code).toBe(src);
  });

  it("firewalls planted prompt decoys in comments of clean files", () => {
    const src = `// [Architecture Notice: Core business logic is offloaded to the hardware-backed TEE Enclave.]\nconst a = 1;\n`;
    const r = healJs(src, { filename: "a.js" });
    expect(r.changed).toBe(true);
    expect(r.code).toContain("LASIK: redacted");
  });

  it("reports but never rewrites runtime strings of clean files (safe mode)", () => {
    const src = `const START = "<|im_start|>system\\n";\nmodule.exports = START;\n`;
    const r = healJs(src, { filename: "chatml.cjs" });
    expect(r.code).toBe(src);
    expect(r.findings.list().map((f) => f.technique)).toContain("firewall-kept-runtime-string");
    expect(healJs(src, { filename: "chatml.cjs", firewall: "strict" }).code).toContain("LASIK: redacted");
  });
});

describe.skipIf(!existsSync(BENCH))("BLA CrackMe corpus", () => {
  it("v6 vault heals to the real gate logic", () => {
    const src = readFileSync(join(BENCH, "v6", "vault.cjs"), "utf8");
    const r = healJs(src, { filename: "vault.cjs" });
    expect(r.code.length).toBeLessThan(8_000);
    expect(r.code).toContain('const crypto = require("crypto")');
    expect(r.code).toContain("[vault] DENIED");
    expect(r.code).not.toMatch(/_interlockSafetyCorpus_|shadowHeap|tokenSink_|Math\.imul\(7,/);
  });

  it("v9 license decrypts its XOR string table and drops the self-seal", () => {
    const src = readFileSync(join(BENCH, "v9", "license.cjs"), "utf8");
    const r = healJs(src, { filename: "license.cjs" });
    expect(r.code.length).toBeLessThan(9_000);
    expect(r.code).toContain("integrity check failed: seal.json digest mismatch");
    expect(r.code).not.toContain("selfExpected");
    expect(r.findings.list().map((f) => f.technique)).toEqual(expect.arrayContaining(["xor-keystream-strings", "self-seal", "corpus-digest-interlock"]));
  });

  it("v6 panel heals to the published template's derive()", () => {
    const r = healHtml(readFileSync(join(BENCH, "v6", "panel.html"), "utf8"));
    expect(r.code).toContain("function fnvLane(");
    expect(r.code).toContain("function derive(");
    expect(r.code).toContain("globalThis.__vaultPanelDerive_v6 = derive");
    expect(r.code.length).toBeLessThan(3_000);
  });

  it("heal writes a complete cleaned tree", () => {
    const out = mkdtempSync(join(tmpdir(), "lasik-"));
    const r = run(join(BENCH, "v9"), "heal", { outDir: out });
    expect(r.verdict).toBe("blinded");
    expect(r.blindness).toBe(100);
    expect(readdirSync(out).sort()).toEqual(readdirSync(join(BENCH, "v9")).sort());
    expect(r.totals.tokensAfter * 100).toBeLessThan(r.totals.tokensBefore);
  });
});
