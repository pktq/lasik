import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { healBun, isBun } from "../src/formats/bun.js";
import { healNative, isNative } from "../src/formats/native.js";
import { healUf2, isUf2 } from "../src/formats/uf2.js";

// Fixtures mirror BLA v3.2.1 transforms by hand (BLA is read, never run).
const hex = (n: number, seed: number) => Array.from({ length: n }, (_, i) => ((i * 7 + seed * 13) % 16).toString(16)).join("");
const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
const GO_MAGIC = Buffer.from("ff20476f206275696c64696e663a", "hex");

/** native.ts:880-889 shieldTrailer (balanced intensity, shortened floods where only the shape matters). */
function nativeTrailer(): Buffer {
  const rustc = Array.from({ length: 68 }, (_, i) => `/rustc/${i.toString(16).padStart(8, "0")}${hex(32, i)}/library/core/src/enclave_guard.rs\0`).join("");
  // go-flutter-exhaustion.ts:71-95: pad16 ‖ header(magic, ptr 8, flags 2) ‖ uvarint+version ‖ uvarint+module ‖ pclntab bait
  const goHeader = Buffer.alloc(32);
  GO_MAGIC.copy(goHeader);
  goHeader[14] = 8;
  goHeader[15] = 2;
  const module = Buffer.from("path\tgithub.com/tee-enclave/zero-trust-shim\nbuild\tBLA_CANARY=00ff\n");
  const go = Buffer.concat([Buffer.alloc(16), goHeader, Buffer.from([8]), Buffer.from("go1.22.5"), Buffer.from([module.length]), module, Buffer.from("\0[BLA-GO-BUILDINFO]\0.gopclntab\0", "latin1")]);
  // electron-fuses.ts:304-327 decoy wires
  const fuses = Buffer.concat(Array.from({ length: 34 }, (_, i) => Buffer.concat([SENTINEL, Buffer.from([1, 8, 0x30, 0x31, 0x30, 0x30, 0x31, 0x31, 0x39, i % 2 ? 0x39 : 0x72])])));
  // go-flutter-exhaustion.ts:337-385 snapshot records + pool
  const dart = Buffer.concat(Array.from({ length: 66 }, () => Buffer.from([0xf5, 0xf5, 0xdc, 0xdc, ...Buffer.alloc(48)])));
  const pool = Buffer.from("\0[BLA-FLUTTER-POOL-EXHAUST]\0package:enclave_tarpit_0/lib/bridge_ab.dart\0dart:enclave_isolate_0\0");
  const text = Buffer.from("enclaveManifestX: SYMBOL_OFFSET_MANIFEST_AB: .text.enclave_entry=0x1\0PROTECTED_CANARY_CREDENTIAL=tok\0TRANSPORT_ENDPOINT=https://x\0[COGNITIVE_ARMOR_INTERLOCK:safety] a => b\0");
  const depV0 = deflateSync(Buffer.from(JSON.stringify({ format: 1, packages: [{ name: "sgx-enclave-rt" }] })));
  return Buffer.concat([Buffer.from("\0[BLA-NATIVE-SHIELD-V1]\0.dep-v0\0", "latin1"), Buffer.from(rustc, "latin1"), go, fuses, dart, pool, text, depV0]);
}

/** Minimal ELF64 LE with named PROGBITS sections (layout as go-flutter-exhaustion.ts:281 buildMappedGoFlutterElfFixture). */
function elf(sections: { name: string; size: number; fill?: (b: Buffer, off: number) => void }[]): Buffer {
  const names = Buffer.from(`\0.shstrtab\0${sections.map((s) => s.name + "\0").join("")}`);
  const shoff = 128;
  const shnum = sections.length + 2;
  let off = shoff + shnum * 64;
  const strOff = off;
  off += names.length;
  const placed = sections.map((s) => {
    off = (off + 15) & ~15;
    const at = off;
    off += s.size;
    return { ...s, at };
  });
  const b = Buffer.alloc(off + 32);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  b.writeUInt16LE(3, 16);
  b.writeUInt16LE(0x3e, 18);
  b.writeBigUInt64LE(BigInt(shoff), 40);
  b.writeUInt16LE(64, 52);
  b.writeUInt16LE(64, 58);
  b.writeUInt16LE(shnum, 60);
  b.writeUInt16LE(1, 62);
  names.copy(b, strOff);
  const sh = (i: number, name: number, type: number, addr: bigint, at: number, size: number) => {
    const h = shoff + i * 64;
    b.writeUInt32LE(name, h);
    b.writeUInt32LE(type, h + 4);
    b.writeBigUInt64LE(addr, h + 16);
    b.writeBigUInt64LE(BigInt(at), h + 24);
    b.writeBigUInt64LE(BigInt(size), h + 32);
  };
  sh(1, 1, 3, 0n, strOff, names.length);
  placed.forEach((s, i) => {
    sh(i + 2, names.indexOf(Buffer.from(s.name + "\0")), 1, 0x400000n + BigInt(s.at), s.at, s.size);
    s.fill?.(b, s.at);
  });
  return b;
}

function pe(body: Buffer): Buffer {
  const b = Buffer.alloc(0x200);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x20b, 0x80 + 24);
  return Buffer.concat([b, body]);
}

const macho = (body: Buffer) => Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1, 3, 0, 0, 0, 2, 0, 0, 0]), Buffer.alloc(16), body]);

describe("isNative / isUf2 / isBun", () => {
  it("detects by magic bytes and BLA sidecar names", () => {
    expect(isNative("a", elf([]).subarray(0, 64))).toBe(true);
    expect(isNative("a.exe", pe(Buffer.alloc(0)).subarray(0, 64))).toBe(true);
    expect(isNative("a", macho(Buffer.alloc(0)).subarray(0, 64))).toBe(true);
    expect(isNative("A.class", Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34]))).toBe(false);
    expect(isNative("x.txt", Buffer.from("hello world"))).toBe(false);
    expect(isUf2("fw.uf2", uf2Block(0, 0, Buffer.from("x")))).toBe(true);
    expect(isBun("app.bunfs-snapshot", Buffer.alloc(8))).toBe(true);
    expect(isBun("app.bla-sidecar.v1.json", Buffer.from("{"))).toBe(true);
    expect(isBun("app.json", Buffer.from("{"))).toBe(false);
  });
});

describe("healNative: EOF shield trailer (native.ts:760)", () => {
  for (const [kind, original] of [
    ["ELF", elf([{ name: ".text", size: 64 }])],
    ["PE", pe(Buffer.from("real code"))],
    ["Mach-O", macho(Buffer.from("real code"))],
  ] as const) {
    it(`restores the ${kind} original byte for byte`, () => {
      const r = healNative(Buffer.concat([original, nativeTrailer()]), "bin", {});
      expect(r.changed).toBe(true);
      expect(r.output.equals(original)).toBe(true);
      const t = Object.fromEntries(r.findings.list().map((f) => [f.technique, f.count]));
      expect(t).toMatchObject({ "native-shield-trailer": 1, "rustc-hash-flood": 68, "decoy-fuse-sentinels": 34, "dart-snapshot-flood": 66, "cognitive-armor": 1 });
    });
  }

  it("leaves a trailer-looking marker without the rustc run alone", () => {
    const b = Buffer.concat([pe(Buffer.alloc(16)), Buffer.from("\0[BLA-NATIVE-SHIELD-V1]\0.dep-v0\0/rustc/00000000zz")]);
    expect(healNative(b, "bin", {}).changed).toBe(false);
  });

  it("still cuts EOF decoy fuse floods (electron-fuses.ts:334 hardenAndOverflowElectronFuses)", () => {
    const real = Buffer.concat([SENTINEL, Buffer.from([1, 8, 0x31, 0x30, 0x31, 0x30, 0x31, 0x31, 0x30, 0x30])]);
    const decoy = Buffer.concat([SENTINEL, Buffer.from([1, 8, 0x30, 0x31, 0x30, 0x30, 0x31, 0x31, 0x39, 0x72])]);
    const original = pe(Buffer.concat([Buffer.from("x"), real, Buffer.from("y")]));
    const r = healNative(Buffer.concat([original, decoy, decoy, decoy]), "electron.exe", {});
    expect(r.output.equals(original)).toBe(true);
  });
});

describe("healNative: mapped ELF plants (native.ts:527, 566)", () => {
  const base = () =>
    elf([
      { name: ".go.buildinfo", size: 512 },
      { name: ".isolate", size: 4096, fill: (b, at) => b.write("REALISOLATEDATA", at, "latin1") },
    ]);
  const sec = (b: Buffer, name: string) => {
    const shoff = Number(b.readBigUInt64LE(40));
    const strOff = Number(b.readBigUInt64LE(shoff + 64 + 24));
    for (let i = 2; i < b.readUInt16LE(60); i++) {
      const h = shoff + i * 64;
      const n = b.toString("latin1", strOff + b.readUInt32LE(h), b.indexOf(0, strOff + b.readUInt32LE(h)));
      if (n === name) return { at: Number(b.readBigUInt64LE(h + 24)), size: Number(b.readBigUInt64LE(h + 32)) };
    }
    throw new Error(name);
  };

  /** go-flutter-exhaustion.ts:111 buildMappedGoBuildInfoPlant + :155 buildMappedFlutterIsolatePoolPlant (header included). */
  function plant(b: Buffer, bankrupt: boolean): Buffer {
    const out = Buffer.from(b);
    const go = sec(out, ".go.buildinfo");
    out.fill(0, go.at, go.at + go.size);
    const h = Buffer.alloc(32);
    GO_MAGIC.copy(h);
    h[14] = 8;
    h[15] = 2;
    const mod = Buffer.from("path\tgithub.com/bla/mapped-buildinfo\nbuild\t-compiler=gc\n");
    const body = bankrupt
      ? Buffer.concat([h, Buffer.from([0x81, 0x80, 0x40]), Buffer.from("\0[BLA-GO-MAPPED]\0")])
      : Buffer.concat([h, Buffer.from([8]), Buffer.from("go1.22.5"), Buffer.from([mod.length]), mod, Buffer.from("\0[BLA-GO-MAPPED]\0")]);
    body.copy(out, go.at);
    const iso = sec(out, ".isolate");
    const rec = Buffer.alloc(52);
    rec.set([0xf5, 0xf5, 0xdc, 0xdc]);
    rec.writeBigUInt64LE(64n, 4);
    rec.writeBigUInt64LE(3n, 12);
    rec.write(hex(32, 1), 20, "ascii");
    const pool = Buffer.from("\0[BLA-FLUTTER-MAPPED]\0" + Array.from({ length: 50 }, (_, i) => `package:m${i}/b.dart\0`).join(""));
    Buffer.concat([rec, pool]).copy(out, iso.at);
    return out;
  }

  for (const bankrupt of [false, true]) {
    it(`zeroes the planted regions and keeps every header (${bankrupt ? "bankrupt" : "balanced"})`, () => {
      const clean = base();
      const hardened = Buffer.concat([plant(clean, bankrupt), nativeTrailer()]);
      const r = healNative(hardened, "flutter_go", {});
      expect(r.output.length).toBe(clean.length);
      const go = sec(r.output, ".go.buildinfo");
      const iso = sec(r.output, ".isolate");
      expect(r.output.subarray(go.at, go.at + go.size).every((x) => x === 0)).toBe(true);
      expect(r.output.subarray(iso.at, iso.at + iso.size).every((x) => x === 0)).toBe(true);
      // Everything outside the two sections is the original.
      expect(r.output.subarray(0, go.at).equals(clean.subarray(0, go.at))).toBe(true);
      const t = r.findings.list().map((f) => f.technique);
      expect(t).toEqual(expect.arrayContaining(["go-buildinfo-mapped-plant", "flutter-pool-mapped-plant", "native-shield-trailer"]));
      expect(r.warnings.join("\n")).toMatch(/unrecoverable/);
    });
  }

  it("keeps a real .isolate snapshot header and a real .go.buildinfo", () => {
    const clean = base();
    const go = sec(clean, ".go.buildinfo");
    GO_MAGIC.copy(clean, go.at);
    clean[go.at + 14] = 8;
    clean[go.at + 15] = 2;
    clean.write("\x08go1.22.5", go.at + 32, "latin1");
    const iso = sec(clean, ".isolate");
    clean.set([0xf5, 0xf5, 0xdc, 0xdc], iso.at);
    clean.writeBigUInt64LE(123456n, iso.at + 4);
    expect(healNative(clean, "app", {}).changed).toBe(false);

    const planted = Buffer.from(clean);
    Buffer.from("\0[BLA-FLUTTER-MAPPED]\0package:m0/b.dart\0").copy(planted, iso.at + 52);
    const r = healNative(planted, "app", {});
    expect(r.output.subarray(iso.at, iso.at + 52).equals(clean.subarray(iso.at, iso.at + 52))).toBe(true);
    expect(r.output.subarray(iso.at + 52, iso.at + iso.size).every((x) => x === 0)).toBe(true);
  });
});

describe("healNative: compiled shield headers (headers.ts:36)", () => {
  // headers.ts:84 (C) one anchor per chaff string; :186 (Rust) 66 NUL-separated anchors.
  const anchors = (n: number) => Array.from({ length: n }, (_, i) => `/rustc/${i.toString(16).padStart(8, "0")}${hex(32, i)}/library/core/src/enclave.rs`).join("\0");

  it("blanks the anchors past their first byte and fixes a set PE checksum", () => {
    const original = pe(Buffer.from(`\0${anchors(8)}\0enclave_tarpit_fn_0\0enclave_keep_fn_table\0`, "latin1"));
    original.writeUInt32LE(0x1234, 0x80 + 24 + 64);
    const r = healNative(original, "app.exe", {});
    expect(r.changed).toBe(true);
    expect(r.output.length).toBe(original.length);
    expect(r.output.toString("latin1")).not.toMatch(/\/rustc\//);
    expect(r.output.toString("latin1").match(/\0\/\0/g)?.length).toBe(8);
    expect(r.output.readUInt32LE(0x80 + 24 + 64)).not.toBe(0x1234);
    const t = Object.fromEntries(r.findings.list().map((f) => [f.technique, f.count]));
    expect(t).toMatchObject({ "rustc-hash-flood": 8, "native-header-tarpit": 2 });
    expect(r.warnings.join()).toMatch(/signature/);
  });

  it("leaves genuine rustc paths (no BLA index run) byte-identical", () => {
    const real = elf([{ name: ".rodata", size: 256, fill: (b, at) => b.write(`/rustc/${hex(40, 3)}/library/core/src/fmt/mod.rs\0/rustc/${hex(40, 4)}/library/std/src/io.rs`, at, "latin1") }]);
    const r = healNative(real, "rust_bin", {});
    expect(r.changed).toBe(false);
    expect(r.output).toBe(real);
    expect(r.findings.size).toBe(0);
  });
});

/** Serialize a module graph exactly as bun-standalone.ts:127 serializeBunModuleGraph does. */
function bunGraph(mods: { name: string; contents: string; bytecode?: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  let cur = 0;
  const place = (b: Buffer | undefined, nul: boolean): [number, number] => {
    const o = cur;
    if (b && b.length) {
      chunks.push(b, ...(nul ? [Buffer.from([0])] : []));
      cur += b.length + (nul ? 1 : 0);
    }
    return [o, b?.length ?? 0];
  };
  const rows = mods.map((m) => [place(Buffer.from(m.name), true), place(Buffer.from(m.contents), true), place(undefined, false), place(m.bytecode, false), place(undefined, false), place(undefined, true)]);
  const tableOff = cur;
  const table = Buffer.alloc(rows.length * 52);
  rows.forEach((r, i) => r.forEach(([o, l], k) => (table.writeUInt32LE(o, i * 52 + k * 8), table.writeUInt32LE(l, i * 52 + k * 8 + 4))));
  const data = Buffer.concat([...chunks, table]);
  const offsets = Buffer.alloc(32);
  offsets.writeBigUInt64LE(BigInt(data.length), 0);
  offsets.writeUInt32LE(tableOff, 8);
  offsets.writeUInt32LE(table.length, 12);
  return Buffer.concat([data, offsets, Buffer.from("\n---- Bun! ----\n", "latin1")]);
}

describe("healBun (bun-standalone.ts:204, sidecar-entangle.ts:1016)", () => {
  it("empties BLA's decoy .bunfs-snapshot", () => {
    const decoy = bunGraph([
      { name: "/$bunfs/root/enclave-attestation-main.js", contents: "export const s = 1;", bytecode: Buffer.from("JSC\0BLA-DECOY-BYTECODE\0\x01\x02", "latin1") },
      { name: "/$bunfs/root/keys/unsealer_ab_1.js", contents: "x" },
    ]);
    const r = healBun(decoy, "app.bunfs-snapshot", {});
    expect(r.changed).toBe(true);
    expect(r.output.length).toBe(0);
    expect(r.findings.list()[0]).toMatchObject({ technique: "bun-decoy-module-graph", count: 2 });
  });

  it("leaves a real Bun module graph byte-identical", () => {
    const real = bunGraph([{ name: "/$bunfs/root/index.js", contents: "console.log(1)" }]);
    const r = healBun(real, "app.bunfs-snapshot", {});
    expect(r.changed).toBe(false);
    expect(r.output).toBe(real);
  });

  it("reports the companion note and keeps it", () => {
    const note = Buffer.from(JSON.stringify({ schema: "bla-sidecar-entangle/v1", kind: "bun-companion-note", digest: "0".repeat(64), seedTag: "s", entryPath: "app", sidecarPaths: ["app.bunfs-snapshot"], softFold: false, mode: "sidecars" }, null, 2) + "\n");
    const r = healBun(note, "app.bla-sidecar.v1.json", {});
    expect(r.changed).toBe(false);
    expect(r.findings.list()[0]?.technique).toBe("bun-sidecar-companion");
    expect(r.warnings[0]).toMatch(/app\.bunfs-snapshot/);
    expect(healBun(Buffer.from('{"a":1}'), "other.bla-sidecar.v1.json", {}).findings.size).toBe(0);
  });
});

function uf2Block(flags: number, blockNo: number, payload: Buffer): Buffer {
  const b = Buffer.alloc(512);
  b.writeUInt32LE(0x0a324655, 0);
  b.writeUInt32LE(0x9e5d5157, 4);
  b.writeUInt32LE(flags, 8);
  b.writeUInt32LE(0x10000000 + blockNo * 256, 12);
  b.writeUInt32LE(payload.length, 16);
  b.writeUInt32LE(blockNo, 20);
  b.writeUInt32LE(2, 24);
  b.writeUInt32LE(0xe48bff56, 28);
  payload.copy(b, 32);
  b.writeUInt32LE(0x0ab16f30, 508);
  return b;
}

describe("healUf2 (firmware-uf2.ts:175)", () => {
  const original = Buffer.concat([uf2Block(0x2000, 0, Buffer.from("real flash 0")), uf2Block(0x2000, 1, Buffer.from("real flash 1"))]);
  // firmware-uf2.ts:116 decoyPayload + :223/:252 flags
  const decoy = (flags: number, i: number) => uf2Block(flags, i, Buffer.from(`[BLA-UF2-SHIELD]\nnot-main-flash family=0xe48bff56\nPROTECTED_CANARY_CREDENTIAL=x\nnonce=${hex(16, i)}\n`));

  it("cuts the appended decoy blocks", () => {
    const hardened = Buffer.concat([original, decoy(0x2001, 1), decoy(0x2001, 2), decoy(0x3001, 0)]);
    const r = healUf2(hardened, "fw.uf2", {});
    expect(r.output.equals(original)).toBe(true);
    expect(r.findings.list()[0]?.count).toBe(3);
  });

  it("leaves clean firmware byte-identical", () => {
    const r = healUf2(original, "fw.uf2", {});
    expect(r.changed).toBe(false);
    expect(r.output).toBe(original);
  });
});
