import { describe, expect, it } from "vitest";
import { healBeam, isBeam } from "../src/formats/beam.js";
import { healEvm, isEvm } from "../src/formats/evm.js";
import { healJvm, isJvm } from "../src/formats/jvm.js";
import { healDotnet } from "../src/formats/dotnet.js";
import { healPtx, isPtx } from "../src/formats/ptx.js";

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const pad4 = (b: Buffer) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
const chunk = (name: string, payload: Buffer) => Buffer.concat([Buffer.from(name, "latin1"), u32(payload.length), pad4(payload)]);
const form = (...chunks: Buffer[]) => {
  const body = Buffer.concat([Buffer.from("BEAM"), ...chunks]);
  return Buffer.concat([Buffer.from("FOR1"), u32(body.length), body]);
};
const atoms = (names: string[]) => Buffer.concat([u32(names.length), ...names.map((n) => Buffer.concat([Buffer.from([n.length]), Buffer.from(n)]))]);
const run = (heal: typeof healBeam, buf: Buffer, file = "x") => heal(buf, file, {});

describe("beam", () => {
  const code = chunk("Code", Buffer.from("0123456789abcdef"));
  const clean = form(chunk("AtU8", atoms(["demo", "start"])), code, chunk("ExpT", u32(0)));
  // erlang-beam.ts: extras appended to AtU8, then Bla0.. decoy chunks past 64
  const extras = ["bla_beam_canary", "[BLA-BEAM-SHIELD]", "PROTECTED_CANARY_CREDENTIAL=abc", "bla_tarpit_atom_3_ab12"];
  const decoys = Array.from({ length: 70 }, (_, i) => chunk(`Bla${i % 10}`, Buffer.from(`[BLA-BEAM-SHIELD]\0x\0\nchunk=${i}\n`)));
  const hardened = form(chunk("AtU8", atoms(["demo", "start", ...extras])), code, chunk("ExpT", u32(0)), ...decoys);

  it("restores the original module", () => {
    const r = run(healBeam, hardened);
    expect(r.changed).toBe(true);
    expect(r.output.equals(clean)).toBe(true);
    expect(r.findings.list().map((f) => f.technique).sort()).toEqual(["beam-canary-atoms", "beam-decoy-chunks"]);
  });
  it("handles compact atom tables", () => {
    const compactAtoms = (names: string[]) =>
      Buffer.concat([Buffer.from(Buffer.alloc(4)), ...names.map((n) => Buffer.concat([Buffer.from(n.length < 16 ? [n.length << 4] : [0x08, n.length]), Buffer.from(n)]))]);
    const mk = (names: string[]) => {
      const p = compactAtoms(names);
      p.writeInt32BE(-names.length, 0);
      return form(chunk("AtU8", p), code);
    };
    const r = run(healBeam, mk(["demo", "start", ...extras]));
    expect(r.output.equals(mk(["demo", "start"]))).toBe(true);
  });
  it("is identity on clean modules and on spoofed atoms without the pair", () => {
    expect(run(healBeam, clean).changed).toBe(false);
    const spoof = form(chunk("AtU8", atoms(["demo", "bla_beam_canary"])), code);
    expect(run(healBeam, spoof).output).toBe(spoof);
    expect(isBeam("a.beam", Buffer.alloc(0))).toBe(true);
    expect(isBeam("a", clean.subarray(0, 64))).toBe(true);
  });
});

describe("evm", () => {
  const cbor = (entries: [string, string][]) => {
    const text = (s: string) => Buffer.concat([Buffer.from([0x60 | s.length]), Buffer.from(s)]);
    const body = Buffer.concat([Buffer.from([0xa0 | entries.length]), ...entries.flatMap(([k, v]) => [text(k), text(v)])]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);
    return Buffer.concat([body, len]);
  };
  const code = Buffer.from("6080604052348015600f57600080fd5b00", "hex");
  const trailer = cbor([["bla", "[BLA-EVM-SHIELD]"], ["bla_evm_canary", "x"]]);

  it("strips the trailer (balanced) and padding (maximum, bankrupt)", () => {
    expect(run(healEvm, Buffer.concat([code, trailer])).output.equals(code)).toBe(true);
    const max = run(healEvm, Buffer.concat([code, Buffer.alloc(64 * 1024, 0x5b), trailer]));
    expect(max.output.equals(code)).toBe(true);
    const target = 4 * 1024 * 1024 - 4096;
    const bank = run(healEvm, Buffer.concat([code, Buffer.alloc(target - code.length - trailer.length, 0x5b), trailer]));
    expect(bank.output.equals(code)).toBe(true);
  });
  it("keeps original compiler metadata and is identity on clean/non-BLA metadata", () => {
    const solc = cbor([["ipfs", "abc"]]);
    const original = Buffer.concat([code, solc]);
    expect(run(healEvm, Buffer.concat([original, trailer])).output.equals(original)).toBe(true);
    expect(run(healEvm, original).changed).toBe(false);
    expect(run(healEvm, code).changed).toBe(false);
    expect(isEvm("c.evm", Buffer.alloc(0))).toBe(true);
  });
});

describe("jvm", () => {
  const utf8 = (s: string) => {
    const b = Buffer.from(s);
    const e = Buffer.alloc(3 + b.length);
    e[0] = 1;
    e.writeUInt16BE(b.length, 1);
    b.copy(e, 3);
    return e;
  };
  const header = (count: number) => {
    const h = Buffer.alloc(10);
    h.writeUInt32BE(0xcafebabe, 0);
    h.writeUInt16BE(65, 6);
    h.writeUInt16BE(count, 8);
    return h;
  };
  // pool: #1 Utf8, #2 Class->1, #3-4 Long
  const pool = [utf8("Foo"), Buffer.from([7, 0, 1]), Buffer.from([5, 0, 0, 0, 1, 0, 0, 0, 2])];
  const rest = Buffer.alloc(32, 7); // access_flags..attributes_count stand-in
  const clean = Buffer.concat([header(5), ...pool, rest]);
  const decoys = ["BlaEnclaveDelegation", "com/enclave/sgx/TeeAttestationBridge", "[BLA-JVM-ENCLAVE:c1] x", "com/enclave/tarpit/StateNode_00_pc_1234"].map(utf8);
  const blob = Buffer.from(JSON.stringify({ schema: "bla-jvm-enclave-v1", enclaveBridge: "com.enclave.sgx.TeeAttestationBridge", tarpitNodes: 10, chaffCount: 2 }));

  it("restores structural-mode classes (pool entries, count, trailing blob)", () => {
    const hardened = Buffer.concat([header(5 + decoys.length), ...pool, ...decoys, rest, blob]);
    const r = run(healJvm, hardened);
    expect(r.output.equals(clean)).toBe(true);
    expect(r.findings.size).toBe(2);
  });
  it("restores trailer-mode classes", () => {
    const hardened = Buffer.concat([clean, Buffer.from("\0BLA_JVM_SHIELD_V1\0a\0b\0")]);
    expect(run(healJvm, hardened).output.equals(clean)).toBe(true);
  });
  it("is identity on clean classes and on lookalike constants", () => {
    expect(run(healJvm, clean).changed).toBe(false);
    const lone = Buffer.concat([header(6), ...pool, utf8("BlaEnclaveDelegation"), rest]);
    expect(run(healJvm, lone).changed).toBe(false);
    expect(isJvm("A.class", clean.subarray(0, 64))).toBe(true);
  });
});

describe("dotnet", () => {
  const pe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 1), Buffer.from("BSJB"), Buffer.alloc(32, 2)]);
  const overlay = Buffer.from(["", "BLA_DOTNET_CLR_SHIELD_V1", "enclave_pinvoke_unseal_ring0_slot_abc_0", "charge:123", "maxRepresentationBytes:67108864", "PROTECTED_CANARY_CREDENTIAL=x", ""].join("\0"));
  it("cuts the appended overlay", () => {
    const r = run(healDotnet, Buffer.concat([pe, overlay]));
    expect(r.output.equals(pe)).toBe(true);
  });
  it("is identity on clean assemblies and bare marker spoofs", () => {
    expect(run(healDotnet, pe).changed).toBe(false);
    const spoof = Buffer.concat([pe, Buffer.from("\0BLA_DOTNET_CLR_SHIELD_V1\0")]);
    expect(run(healDotnet, spoof).changed).toBe(false);
  });
});

describe("ptx", () => {
  const base = ".version 7.5\n.target sm_80\n.address_size 64\n.visible .entry realKernel()\n{\n  ret;\n}\n";
  const kernel = (i: number) => {
    const n = `bla_tarpit_kernel_${i}_ab1${i % 10}`;
    return `.visible .entry ${n}(.param .u64 ${n}_param_0)\n{\n  .reg .b64 %rd<2>;\n  ld.param.u64 %rd1, [${n}_param_0];\n  // canary=0123abcd\n  ret;\n}\n\n`;
  };
  const trailer = "\n// [BLA-PTX-SHIELD] Counter-REA GPU exhaustion trailer\n// DIAG: [X] fault (1): do a thing\n" + Array.from({ length: 16 }, (_, i) => kernel(i)).join("");
  it("removes marker, DIAG comments and decoy kernels", () => {
    const r = run(healPtx, Buffer.from(base + trailer));
    expect(r.output.toString()).toBe(base);
    expect(r.findings.list().map((f) => f.count).sort()).toEqual([1, 16]);
  });
  it("is identity on clean PTX and when real code follows the marker", () => {
    expect(run(healPtx, Buffer.from(base)).changed).toBe(false);
    const spoof = Buffer.from(base + "\n// [BLA-PTX-SHIELD] Counter-REA GPU exhaustion trailer\n.visible .entry mine()\n{\n  ret;\n}\n");
    expect(run(healPtx, spoof).changed).toBe(false);
    expect(isPtx("k.ptx", Buffer.alloc(0))).toBe(true);
  });
});
