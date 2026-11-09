import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healPython } from "../src/formats/python.js";

const heal = (src: string) => healPython(Buffer.from(src), "x.py", {});

const P1 = (s: string) => `(((7 * ((${s} | 74) ** 2) - 1) & 0xFFFFFFFF) == (((${s} ^ 77) ** 2) & 0xFFFFFFFF) and ((${s} * (${s} + 1)) & 1) == 1)`;

describe("python healer", () => {
  it("removes tarpit guards, slot churn and the unreferenced prelude", () => {
    const src = [
      "# runtime attestation boundary",
      "STATE_AB12 = 0xb2cef8 | 1",
      'SLOT_CD34: dict = {"epoch": 0, "peer": 0, "tag": 0}',
      "def decoy_x_ef56(seed: int = 0, depth: int = 0) -> int:",
      `    if depth > 0 and ${P1("STATE_AB12")}:`,
      "        return decoy_x_ef56(seed, depth - 1)",
      "    return seed",
      "",
      "decoy_x_ef56(STATE_AB12 & 0xFF)",
      "",
      "def real(a, b):",
      '    SLOT_CD34["epoch"] = (SLOT_CD34.get("epoch", 0) ^ 1) & 0xFFFFFFFF',
      `    if ${P1("STATE_AB12")}:`,
      "        _ = decoy_x_ef56(1, 0)",
      "    return a + b",
      "",
    ].join("\n");
    const r = heal(src);
    expect(r.changed).toBe(true);
    const out = r.output.toString();
    expect(out).toBe("def real(a, b):\n    return a + b\n");
  });

  it("keeps prelude names that real code still uses", () => {
    const src = ["LIMIT_AB12 = 5", `X = ${P1("S")}`, "def real():", "    return LIMIT_AB12", ""].join("\n");
    const out = heal(src).output.toString();
    expect(out).toContain("LIMIT_AB12 = 5");
  });

  it("leaves ordinary Python untouched", () => {
    const src = "def f(x):\n    if x:\n        return 1\n    return 0\n";
    expect(heal(src).changed).toBe(false);
  });

  const v9 = join(import.meta.dirname, "..", "bench", "bla-crackme", "v9", "policy.py");
  it.skipIf(!existsSync(v9))("heals BLA CrackMe v9 policy.py to its real functions", () => {
    const out = heal(readFileSync(v9, "utf8")).output.toString();
    expect(out.length).toBeLessThan(1_000);
    expect(out).toContain("def evaluate_tenant_quota(seat_count, tier_weight):");
    expect(out).not.toMatch(/SHARD_ENVELOPE|CANARY_TOKENS|_[0-9a-fA-F]{4}\b/);
  });
});
