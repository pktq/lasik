import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseJs, t } from "../src/js/ast.js";
import { healJs } from "../src/js/heal.js";
import { healHtml } from "../src/js/html.js";
import { corpusDigest } from "../src/js/passes/interlock.js";
import { callPure } from "../src/js/pure-eval.js";
import { DIGEST_BODY } from "./bla-digest.js";

/**
 * v0.3: LASIK keys on what BLA's code does, not on what BLA calls it. Every fixture
 * here uses names BLA never emits.
 */

const fnOf = (src: string): t.FunctionDeclaration => parseJs(src).program.body[0] as t.FunctionDeclaration;

describe("pure-eval", () => {
  it("evaluates loops, strings and Math.imul over constant data", () => {
    const fn = fnOf(`function h(s = 0) { let a = s ^ 7; for (const c of xs) for (let i = 0; i < c.length; i++) a = Math.imul(a ^ c.charCodeAt(i), 31) >>> 0; return a; }`);
    const xs = ["ab", "c"];
    let a = 0 ^ 7;
    for (const c of xs) for (let i = 0; i < c.length; i++) a = Math.imul(a ^ c.charCodeAt(i), 31) >>> 0;
    expect(callPure(fn, [], (n) => (n === "xs" ? { value: xs } : undefined))).toEqual({ ok: true, value: a });
  });

  it("refuses writes, unknown calls, unknown globals and endless loops", () => {
    const g = (n: string) => (n === "xs" ? { value: [1] } : undefined);
    expect(callPure(fnOf(`function f() { xs[0] = 2; return 1; }`), [], g).ok).toBe(false);
    expect(callPure(fnOf(`function f() { return fetch("x"); }`), [], g).ok).toBe(false);
    expect(callPure(fnOf(`function f() { return Date.now(); }`), [], g).ok).toBe(false);
    expect(callPure(fnOf(`function f() { return unknownThing; }`), [], g).ok).toBe(false);
    expect(callPure(fnOf(`function f() { while (true) {} }`), [], g, 10_000).ok).toBe(false);
    expect(callPure(fnOf(`function f() { return xs.toString; }`), [], g).ok).toBe(false);
  });
});

/** An interlock with names BLA never uses, operands in either order. */
function interlock(opts: { mutate?: string; flip?: boolean; body?: string } = {}): string {
  const entries = [{ anchor: "qx", payload: "stub" }];
  const digest = corpusDigest(entries, 0, 1);
  const test = opts.flip ? `"function" === typeof zq && ${digest} === zq(0)` : `typeof zq === "function" && zq(0) === ${digest}`;
  return `
const plk = [{ "coupledAnchorSymbol": "qx", "triggerPayload": "stub" }];
${opts.mutate ?? ""}
function zq(seedInput = 0) {
  if (!Array.isArray(plk) || plk.length < 1) return 0;
  ${opts.body ?? DIGEST_BODY("plk")}
}
const s = (Date.now() & 0x7fffc) | (${test} ? 1 : 0);
module.exports = (Math.imul(s ^ 8, s ^ 8) & 7) === 1 ? "real" : "decoy";
`;
}

describe("interlock by shape", () => {
  it("folds a renamed interlock and frees its corpus", () => {
    for (const flip of [false, true]) {
      const r = healJs(interlock({ flip }), { filename: "x.cjs" });
      expect(r.code).toContain('module.exports = "real"');
      expect(r.code).not.toContain("plk");
    }
  });

  it("follows the file's own digest, not BLA's algorithm", () => {
    const r = healJs(interlock({ body: "return 0;" }), { filename: "x.cjs" });
    expect(r.code).toContain('module.exports = "decoy"');
  });

  it("leaves the interlock alone when the corpus can change", () => {
    const r = healJs(interlock({ mutate: `plk.push({ coupledAnchorSymbol: "y", triggerPayload: "z" });` }), { filename: "x.cjs" });
    expect(r.code).toContain("plk");
    expect(r.code).not.toContain('module.exports = "real"');
  });
});

/** Proven-hardened header without BLA names: 16 predicates only known-bits can prove. */
const PROVEN = Array.from({ length: 16 }, (_, i) => `if (((k${i} << 1) & 1) === 1) globalThis.d${i} = 1;`);
const HEADER = [...Array.from({ length: 16 }, (_, i) => `const k${i} = Date.now() | 0;`), ...PROVEN].join("\n");

describe("hardened-file gate", () => {
  it("opens on many proven-constant predicates, with no BLA name or shape", () => {
    const r = healJs(`${HEADER}\nfunction keep(){ return 1; }\nmodule.exports = keep;`, { filename: "x.cjs" });
    expect(r.code).not.toContain("globalThis.d3");
  });

  it("stays shut for clean code with a few constant checks", () => {
    const src = `// a real comment\nconst k = Date.now() | 0;\nif (((k << 1) & 1) === 1) console.log("never");\nmodule.exports = k;\n`;
    expect(healJs(src, { filename: "x.cjs" }).code).toBe(src);
  });
});

describe("page-local inline scripts", () => {
  const page = (scripts: string[], extra = "") => `<html><body${extra}>${scripts.map((s) => `<script>${s}</script>`).join("")}</body></html>`;
  const decoy = `function qqDecoy(){ return "decoy"; }`;

  it("drops globals nothing on the page uses", () => {
    const out = healHtml(page([`${HEADER}\n${decoy}\nfunction run(){ return 1; }\nrun();`])).code;
    expect(out).not.toContain("qqDecoy");
    expect(out).toContain("function run");
  });

  it("keeps globals used from attributes, other scripts, or window properties", () => {
    const out = healHtml(page([`${HEADER}\nfunction fromAttr(){}\nfunction fromOther(){}\nfunction viaWindow(){}\nwindow.viaWindow;`, `fromOther();`], ` onload="fromAttr()"`)).code;
    for (const name of ["fromAttr", "fromOther", "viaWindow"]) expect(out).toContain(`function ${name}`);
  });

  it("keeps every global when the page loads external scripts or reads globals by computed name", () => {
    const ext = healHtml(`<html><script src="lib.js"></script><script>${HEADER}\n${decoy}</script></html>`).code;
    expect(ext).toContain("qqDecoy");
    const dyn = healHtml(page([`${HEADER}\n${decoy}\nconst k = "qq" + "Decoy"; window[k]();`])).code;
    expect(dyn).toContain("qqDecoy");
  });
});

describe("self-seal without markers", () => {
  it("removes a renamed check that hashes its own file", () => {
    const seal = `(function(){ var c = require("node:crypto"); var b = require("node:fs").readFileSync(__filename); if (c.createHash("sha256").update(b).digest("hex") !== "ab") throw new Error("integrity check failed"); })();`;
    const r = healJs(`${HEADER}\n${seal}\nmodule.exports = 1;`, { filename: "x.cjs" });
    expect(r.code).not.toContain("readFileSync");
  });
});

describe("comments in hardened files", () => {
  it("keeps only comments tools read", () => {
    const src = `${HEADER}\n/*! MIT license */\n// @ts-ignore\nconst a = /*#__PURE__*/ make();\n// sync ledger 4c1a9e\n/* any wording at all */\nfunction make(){ return 1; }\nmodule.exports = a;`;
    const out = healJs(src, { filename: "x.cjs" }).code;
    for (const keep of ["MIT license", "@ts-ignore", "#__PURE__"]) expect(out).toContain(keep);
    for (const gone of ["sync ledger", "any wording"]) expect(out).not.toContain(gone);
  });
});

// The renamed-BLA bench on the real 3.2.1 fixtures (scripts/bench-renamed.mjs runs the full set).
const DIST = join(import.meta.dirname, "..", "dist", "js", "ast.js");
describe.skipIf(!existsSync(DIST))("renamed real BLA output", () => {
  it("heals about as well as the original", async () => {
    const { mutateJs } = await import("../scripts/mutate-bla.mjs");
    const R = join(import.meta.dirname, "fixtures", "bla-3.2.1");
    for (const set of ["default", "max"]) {
      for (const gz of readdirSync(join(R, set)).filter((f) => /\.(js|ts)\.gz$/.test(f))) {
        const file = gz.replace(/\.gz$/, "");
        const src = gunzipSync(readFileSync(join(R, set, gz))).toString("utf8");
        const clean = readFileSync(join(R, "clean", file), "utf8");
        const mutated = mutateJs(src, { clean, filename: file }).code;
        const original = healJs(src, { filename: file }).code;
        const renamed = healJs(mutated, { filename: file }).code;
        expect(renamed.length, `${set}/${file}`).toBeLessThan(Math.max(original.length * 1.6, original.length + 400));
        expect(renamed, `${set}/${file}`).not.toMatch(/coupledAnchorSymbol|triggerPayload|integrity check failed/);
      }
    }
  });
});

describe("wasm without BLA names", () => {
  const leb = (n: number): Buffer => {
    const out: number[] = [];
    do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
    return Buffer.from(out);
  };
  const str = (s: string) => Buffer.concat([leb(Buffer.byteLength(s)), Buffer.from(s)]);
  const custom = (name: string, size: number) => {
    const body = Buffer.concat([str(name), Buffer.alloc(size, 0x41)]);
    return Buffer.concat([Buffer.from([0]), leb(body.length), body]);
  };
  const clean = readFileSync(join(import.meta.dirname, "fixtures", "bla-3.2.1", "clean", "add.wasm"));

  it("drops an exhaustion section and its small companions whatever they are called", async () => {
    const { healWasm } = await import("../src/formats/wasm.js");
    const padded = Buffer.concat([clean, custom("qzvx.ledger", 2000), custom("kfrw", 400_000), custom("producers", 10)]);
    const r = healWasm(padded);
    expect(r.changed).toBe(true);
    expect(r.output.length).toBe(clean.length + custom("producers", 10).length);
  });

  it("leaves clean modules with tool or small unknown sections byte-identical", async () => {
    const { healWasm } = await import("../src/formats/wasm.js");
    for (const extra of [custom("qzvx.ledger", 2000), custom(".debug_info", 900_000), custom("name", 300)]) {
      const input = Buffer.concat([clean, extra]);
      expect(healWasm(input).output.equals(input)).toBe(true);
    }
  });

  it.skipIf(!existsSync(DIST))("heals renamed real BLA wasm to the same size", async () => {
    const { mutateWasm } = await import("../scripts/mutate-bla.mjs");
    const { healWasm } = await import("../src/formats/wasm.js");
    const src = gunzipSync(readFileSync(join(import.meta.dirname, "fixtures", "bla-3.2.1", "default", "add.wasm.gz")));
    const renamed = mutateWasm(src).code;
    expect(renamed.toString("latin1")).not.toMatch(/bla\.|enclave_export_/);
    expect(healWasm(renamed).output.length).toBe(healWasm(src).output.length);
  });
});

describe.skipIf(!existsSync(DIST))("asar without BLA paths", () => {
  it("drops a renamed shard flood and heals the renamed decoy bridge", async () => {
    const { mutateAsar } = await import("../scripts/mutate-bla.mjs");
    const { healAsar } = await import("../src/formats/asar.js");
    const src = gunzipSync(readFileSync(join(import.meta.dirname, "fixtures", "bla-3.2.1", "default", "app.asar.gz")));
    const renamed = mutateAsar(src).code;
    expect(renamed.toString("latin1", 0, 4096)).not.toMatch(/enclave|shards|ring0/);
    const r = healAsar(renamed, "app.asar", {});
    expect(r.output.length).toBeLessThan(2048);
    expect(r.findings.list().map((f) => f.technique)).toContain("asar-unreachable-entry");
  });
});
