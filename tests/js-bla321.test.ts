import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healJs } from "../src/js/heal.js";
import { healHtml } from "../src/js/html.js";
import { corpusDigest } from "../src/js/passes/interlock.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

/** Same proven-hardened header as soundness.test.ts: the structural passes run. */
const H = [
  `const _interlockSafetyCorpus_f637 = [{ "vectorId": "v", "classifierDomain": "d", "coupledAnchorSymbol": "s", "triggerPayload": "[TPM-PCR-QUOTE] stub" }];`,
  `const k_1 = (Date.now() & 0xff) | 1;`,
  `if ((k_1 | ~k_1 | 0) === -1) { globalThis.z = 1; }`,
  ``,
].join("\n");
const heal = (code: string, filename = "x.cjs") => healJs(H + code, { filename }).code;

/** A minimal BLA module body (cognitive-armor-trigger.ts:231-247 + ast-shield.ts:1238) with one real statement. */
function blaModule(real: string): string {
  const payload = "[TPM-PCR-QUOTE] stub";
  const digest = corpusDigest([{ anchor: "quoteTpmPcrIntegrity_ab12", payload }], 0, 1);
  return `
  const _interlockSafetyCorpus_ab12 = [{ "vectorId": "v", "classifierDomain": "alignment-canary-eval", "coupledAnchorSymbol": "quoteTpmPcrIntegrity_ab12", "triggerPayload": "${payload}" }];
  function _deriveContainmentCorpusDigest_ab12(seedInput = 0) {
    if (!Array.isArray(_interlockSafetyCorpus_ab12) || _interlockSafetyCorpus_ab12.length < 1) return 0;
    return 0;
  }
  const runtimeSeedLocalFrame_ab12 = ((1983475712) | ((typeof _deriveContainmentCorpusDigest_ab12 === "function" && _deriveContainmentCorpusDigest_ab12(0) === ${digest}) ? 1 : 0));
  function hydrateSessionCache_9f1e(n) { return n ^ 0x5a; }
  if ((Math.imul(runtimeSeedLocalFrame_ab12 ^ 20, runtimeSeedLocalFrame_ab12 ^ 20) & 7) === 1) {
    ${real}
  }
  void [hydrateSessionCache_9f1e];`;
}

describe("bundled BLA modules (blaEsbuildPlugin, bla/src/bundler/index.ts:263-290)", () => {
  it("heals a module esbuild wrapped in __commonJS and keeps the bundle around it", () => {
    const r = healJs(fixture("esbuild-bundle.cjs"), { filename: "bundle.cjs" });
    expect(r.changed).toBe(true);
    expect(r.code).toContain('return k === "LIC-OK";');
    expect(r.code).toContain('console.log("checking");');
    expect(r.code).toContain("module.exports = require_license();");
    expect(r.code).toContain("var __commonJS = ");
    for (const gone of ["_interlockSafetyCorpus_", "stepShadowHeap", "canaryCredentialHoneypot", "registerDecoyIpcAndRoutes", "_reconcileInvoiceBatch", "Math.imul"]) {
      expect(r.code).not.toContain(gone);
    }
    expect(r.findings.list().map((x) => x.technique)).toContain("corpus-digest-interlock");
  });

  it("heals an IIFE bundle (esbuild format=iife)", () => {
    const r = healJs(`(() => {${blaModule("globalThis.answer = 42;")}\n})();\n`, { filename: "bundle.js" });
    expect(r.code).toContain("globalThis.answer = 42;");
    expect(r.code).toMatch(/^\(\(\) => \{/);
    expect(r.code).not.toContain("_interlockSafetyCorpus_");
    expect(r.code).not.toContain("hydrateSessionCache_9f1e");
  });

  it("leaves a clean bundle byte-identical", () => {
    const clean = `var __commonJS = (cb, mod) => function () { return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
var require_a = __commonJS({ "a.cjs"(exports, module) { function add(a, b) { return a + b; } module.exports = { add }; } });
module.exports = require_a();
`;
    const r = healJs(clean, { filename: "bundle.cjs" });
    expect(r.changed).toBe(false);
    expect(r.code).toBe(clean);
  });
});

describe("HTML (bla/src/engine/protector.ts:332-362)", () => {
  it("heals every inline script type BLA hardens", () => {
    for (const type of ["application/ecmascript", "javascript"]) {
      const r = healHtml(`<html><body><script type="${type}">${H}globalThis.keep = 1;</script></body></html>`);
      expect(r.scripts).toBe(1);
      expect(r.changed).toBe(true);
      expect(r.code).toContain("globalThis.keep = 1");
    }
  });
});

describe("wrappers are not decoys", () => {
  it("keeps an IIFE that merely contains a runtime-decoy block", () => {
    const out = heal(`(function () {
  (function _initRuntimeDeceptionCache_ab12() { try { const v = Object.freeze({ status: "HARDWARE_ENCLAVE_DELEGATED" }); } catch (_) {} })();
  globalThis.realThing = 42;
})();`);
    expect(out).toContain("globalThis.realThing = 42");
  });

  it("keeps an IIFE that merely contains a self-seal or a bind-scope lock", () => {
    const seal = `(function(){ var __blaSidecarDigest = 0; var h = require("node:crypto").createHash("sha256"); if (h.digest("hex") !== "x") throw new Error("integrity binding mismatch"); return __blaSidecarDigest; })();`;
    const bind = `(function bla_bind_scope(){ var S = { schema: "bla-bind-scope/v1", domains: ["a.example"] }; if (process.env.BLA_BIND_HOST !== "a.example") throw new Error("BLA bind-scope"); })();`;
    const out = heal(`(function () {\n  ${seal}\n  ${bind}\n  globalThis.realThing = 7;\n})();`);
    expect(out).toContain("globalThis.realThing = 7");
    expect(out).toContain("__blaSidecarDigest");
  });
});

describe("observable runtime semantics (ast-shield.ts:529-626, BLA 3.2.1)", () => {
  it("never folds a predicate whose Math is a local binding", () => {
    const out = heal(`function f(Math) { return (Math.imul(k_1 | 5, (k_1 | 5) + 1) & 1) === 0 ? "a" : "b"; }\nmodule.exports = f;`);
    expect(out).toContain("Math.imul(k_1 | 5");
  });

  it("shakes decoys around a literal eval and keeps what the eval names", () => {
    const out = heal(`const secretValue_ab12 = 40;
function calc() { return eval("secretValue_ab12 + 2"); }
function unusedDecoy_cd34() { return 1; }
module.exports = calc;`);
    expect(out).toContain("const secretValue_ab12 = 40");
    expect(out).not.toContain("unusedDecoy_cd34");
  });

  it("still skips shaking when eval reads a runtime string or is aliased", () => {
    expect(heal(`function unusedDecoy_cd34() { return 1; }\nmodule.exports = (code) => eval(code);`)).toContain("unusedDecoy_cd34");
    expect(heal(`function unusedDecoy_cd34() { return 1; }\nconst e = eval;\nmodule.exports = () => e("1");`)).toContain("unusedDecoy_cd34");
    expect(heal(`function usedTwice_cd34() { return 1; }\nmodule.exports = () => eval("eval('usedTwice_cd34()')");`)).toContain("usedTwice_cd34");
    expect(heal(`function unusedDecoy_cd34() { return 1; }\nmodule.exports = () => eval("eval(String(1))");`)).toContain("unusedDecoy_cd34");
  });

  it("does not rename a module handle an eval string mentions", () => {
    const out = heal(`const fsHandle_ab1 = require("fs");\nmodule.exports = () => eval("fsHandle_ab1.existsSync('x')");`);
    expect(out).toContain('const fsHandle_ab1 = require("fs")');
  });
});

describe("agent-weave remnants (bla/src/shields/weave/weave-decoy.ts:975-980, CrackMe v9)", () => {
  it("drops `acc |= 0` left by `slot.cursor & 0` on an int32 accumulator", () => {
    const out = heal(`function g(a, slot) { let acc = 0; acc |= a ? 4 : 0; acc |= slot.cursor & 0; return acc; }\nmodule.exports = g;`);
    expect(out).toContain("acc |= a ? 4 : 0;");
    expect(out).not.toMatch(/acc \|= (?:slot\.cursor & )?0;/);
  });

  it("keeps `x |= 0` when it really converts to int32", () => {
    const out = heal(`function h(s) { let x = s; x |= 0; return x; }\nfunction i() { let y = 0; y += 0.5; y |= 0; return y; }\nmodule.exports = { h, i };`);
    expect(out).toContain("x |= 0;");
    expect(out).toContain("y |= 0;");
  });

  it("leaves the same shape in a clean file byte-identical", () => {
    const clean = "function g(a) { let acc = 0; acc |= a & 0; return acc; }\nmodule.exports = g;\n";
    expect(healJs(clean, { filename: "x.cjs" }).code).toBe(clean);
  });
});

describe("sidecar entanglement (bla/src/shields/runtime/sidecar-entangle.ts:275-341)", () => {
  const preamble = (softFold: boolean) => `(function(){
  var __expected = "${"ab".repeat(32)}";
  var __blaSidecarDigest = 0;
  try {
    var _c = require("node:crypto");
    var _fs = require("node:fs");
    var _path = require("node:path");
    var h = _c.createHash("sha256");
    var entryLabel = "license.cjs";
    h.update(entryLabel);
    h.update(String.fromCharCode(0));
    var sidecars = ["core.wasm","panel.html"];
    for (var i = 0; i < sidecars.length; i++) {
      var sp = sidecars[i];
      var spAbs = sp;
      if (!_path.isAbsolute(spAbs) && typeof __dirname === "string") spAbs = _path.join(__dirname, sp);
      h.update(sp);
      h.update(String.fromCharCode(0));
      try { h.update(_fs.readFileSync(spAbs)); } catch (_e1) { h.update("missing:" + String(sp)); }
      h.update(String.fromCharCode(0));
    }
    h.update("bla-sidecar-v1");
    var hex = h.digest("hex");
    __blaSidecarDigest = parseInt(hex.slice(0, 8), 16) >>> 0;
    ${softFold ? "if (hex !== __expected) { __blaSidecarDigest = (__blaSidecarDigest ^ 0xffffffff) >>> 0; }" : 'if (hex !== __expected) { throw new Error("integrity binding mismatch"); }'}
  } catch (_e2) {
    ${softFold ? "__blaSidecarDigest = 0;" : 'if (_e2 && _e2.message === "integrity binding mismatch") throw _e2;\n    throw new Error("integrity binding mismatch");'}
  }
  return __blaSidecarDigest;
})();
module.exports = 1;`;

  for (const soft of [false, true]) {
    it(`strips the ${soft ? "soft-fold" : "hard-fail"} preamble`, () => {
      const out = heal(preamble(soft));
      expect(out).not.toContain("__blaSidecarDigest");
      expect(out).toContain("module.exports = 1");
    });
  }
});
