import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/engine/run.js";

// Real bla-agents@3.2.1 output (tests/fixtures/bla-3.2.1/README.md), healed and compared
// with the clean originals.
const FIX = join(import.meta.dirname, "fixtures", "bla-3.2.1");
const clean = (f: string) => readFileSync(join(FIX, "clean", f));

/** Formats where BLA only appends or inserts, so the original comes back byte for byte. */
const EXACT = ["Pricing.class", "Pricing.dll", "bundle.zip", "capture.pcap", "contract.evm", "firmware.uf2", "hello.exe", "kernel.ptx", "model.safetensors", "tiny.gguf"];
/** BLA strings that must not survive healing (none occur in the clean inputs). */
const LEFTOVER = /\[BLA-|BLA_[A-Z]|bla\.(?:shield|enclave|canary|sidecar)|enclave_|_interlockSafetyCorpus_|system-reminder|<\|im_start\|>|tee_hardware/;

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

function heal(set: "default" | "max") {
  const dir = mkdtempSync(join(tmpdir(), `lasik-bla321-${set}-`));
  tmp.push(dir, `${dir}.lasik`);
  for (const gz of readdirSync(join(FIX, set))) writeFileSync(join(dir, gz.replace(/\.gz$/, "")), gunzipSync(readFileSync(join(FIX, set, gz))));
  const report = run(dir, "heal", { outDir: `${dir}.lasik` });
  const out = (f: string) => readFileSync(report.files.find((x) => x.file === f)!.output!);
  return { report, out };
}

for (const set of ["default", "max"] as const) {
  describe(`real BLA 3.2.1 output (${set})`, () => {
    const { report, out } = heal(set);

    it("every hardened file is detected and healed", () => {
      for (const f of report.files) expect(f.healed, f.file).toBe(true);
    });

    for (const f of EXACT) {
      it(`${f} comes back byte-identical`, () => expect(out(f).equals(clean(f))).toBe(true));
    }

    it("no BLA marker or prompt decoy survives", () => {
      for (const f of report.files) expect(out(f.file).toString("latin1"), f.file).not.toMatch(LEFTOVER);
    });

    it("healed files are about the size of the originals", () => {
      for (const f of report.files) expect(f.bytesAfter, f.file).toBeLessThanOrEqual(Math.max(clean(f.file).length * 4, 600));
    });

    it("SQLite keeps exactly the original schema and rows", async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const dir = mkdtempSync(join(tmpdir(), "lasik-sqlite-"));
      tmp.push(dir);
      const rows = (buf: Buffer, name: string) => {
        const p = join(dir, name);
        writeFileSync(p, buf);
        const db = new DatabaseSync(p, { readOnly: true });
        const r = [db.prepare("select type, name, sql from sqlite_schema").all(), db.prepare("select * from users").all(), db.prepare("pragma integrity_check").get()];
        db.close();
        return JSON.stringify(r);
      };
      expect(rows(out("local.sqlite"), "healed.db")).toBe(rows(clean("local.sqlite"), "clean.db"));
    });

    it("JS logic and exported names come back", () => {
      const pan = out("sound-pan.js").toString();
      expect(pan).toMatch(/function clampPan\(p0\)/);
      expect(pan).toMatch(/function calculateSoundPan\(/);
      expect(pan).toMatch(/module\.exports = \{\s*clampPan,\s*calculateSoundPan\s*\}/);
      const bridge = out("electron-bridge.js").toString();
      expect(bridge).toMatch(/const \{\s*contextBridge,\s*ipcRenderer,\s*ipcMain\s*\} = require\("electron"\)/);
      expect(bridge).toContain("notion:clipboard:read-rich");
      const lic = out("license-validator.ts").toString();
      expect(lic).toContain("Math.imul(v0, 16777619)");
      expect(lic).toContain("enterprise-v4");
    });
  });
}
