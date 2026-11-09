import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/engine/run.js";

// One clean (never BLA-hardened) file per format: run() must route each to the right
// healer and leave it byte-identical.
const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const pad = (b: Buffer, n = 128) => Buffer.concat([b, Buffer.alloc(Math.max(0, n - b.length))]);

const CLEAN: [string, Buffer, string][] = [
  ["app.elf", pad(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])), "native"],
  ["tool.so", pad(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])), "native"],
  ["Lib.dll", pad(Buffer.from("MZ")), "dotnet"],
  ["fw.uf2", pad(Buffer.concat([u32le(0x0a324655), u32le(0x9e5d5157)]), 512), "uf2"],
  ["cap.pcap", pad(u32le(0xa1b2c3d4), 24), "pcap"],
  ["m.beam", pad(Buffer.concat([Buffer.from("FOR1"), Buffer.from([0, 0, 0, 4]), Buffer.from("BEAM")]), 12), "beam"],
  ["global-metadata.dat", pad(u32le(0xfab11baf)), "il2cpp"],
  ["classes.dex", pad(Buffer.from("dex\n035\0")), "dex"],
  ["Info.plist", Buffer.from('<?xml version="1.0"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict/></plist>\n'), "plist"],
  ["A.class", pad(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61])), "jvm"],
  ["k.ptx", Buffer.from(".version 7.0\n.target sm_80\n.address_size 64\n"), "ptx"],
  ["c.evm", Buffer.from([0x60, 0x80, 0x60, 0x40, 0x52]), "evm"],
  ["a.zip", Buffer.from("504b0506000000000000000000000000000000000000", "hex"), "unknown"],
  ["db.sqlite", pad(Buffer.from("SQLite format 3\0")), "sqlite"],
  ["m.gguf", pad(Buffer.from("GGUF")), "gguf"],
  ["w.safetensors", Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.from("{}")]), "safetensors"],
  ["notes.txt", Buffer.from("hello\n"), "unknown"],
];

const dir = mkdtempSync(join(tmpdir(), "lasik-dispatch-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("format dispatch", () => {
  for (const [name, bytes] of CLEAN) writeFileSync(join(dir, name), bytes);
  const report = run(dir, "heal", { outDir: join(dir, "..", `${dir.split(/[\\/]/).pop()}.out`) });

  for (const [name, bytes, format] of CLEAN) {
    it(`${name} → ${format}, unchanged`, () => {
      const f = report.files.find((x) => x.file === name)!;
      expect(f.format).toBe(format);
      expect(f.healed).toBe(false);
      expect(readFileSync(f.output!).equals(bytes)).toBe(true);
    });
  }

  it("reports BLA's public bind-scope lock without removing it", () => {
    const d = mkdtempSync(join(tmpdir(), "lasik-bind-"));
    try {
      writeFileSync(join(d, "entry.js"), "(function BLA_BIND_SCOPE_CHECK(){})();\nconsole.log(1);\n");
      const r = run(d, "scan");
      expect(r.files[0].findings.some((f) => f.technique === "bind-scope")).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
