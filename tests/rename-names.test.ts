import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { healJs } from "../src/js/heal.js";

// Real BLA 3.2.1 output of BLA's own sound-pan example.
const hardened = gunzipSync(readFileSync(join(import.meta.dirname, "fixtures", "bla-3.2.1", "default", "sound-pan.js.gz"))).toString();
const heal = (code: string) => healJs(code, { filename: "sound-pan.js" }).code;

describe("renameBlaNames", () => {
  it("restores exported names and neutralises the rest", () => {
    const out = heal(hardened);
    expect(out).toMatch(/function clampPan\(p0\)/);
    expect(out).not.toMatch(/[a-z][A-Za-z]+_[0-9a-f]{3}\b/);
  });

  it("keeps function names when the program can observe them", () => {
    const out = heal(hardened + "\nmodule.exports.label = module.exports.clampPan.name;\n");
    expect(out).not.toMatch(/function clampPan\(/);
    expect(out).toMatch(/function [a-z][A-Za-z]+_[0-9a-f]{3}\(p0\)/);
  });

  it("renames nothing when eval could reach a name", () => {
    const out = heal(hardened + "\nmodule.exports.run = (s) => eval(s);\n");
    expect(out).not.toMatch(/\bp0\b/);
  });

  it("leaves clean code byte-identical", () => {
    const clean = "function clampPan_abc(v) { return v | 0; }\nmodule.exports = { clampPan: clampPan_abc };\n";
    expect(heal(clean)).toBe(clean);
  });
});
