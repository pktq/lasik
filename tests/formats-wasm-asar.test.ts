import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { healAsar } from "../src/formats/asar.js";
import { healSourceMap } from "../src/formats/sourcemap.js";
import { healWasm } from "../src/formats/wasm.js";

// Hand-built to mirror BLA v3.2.1 output shapes (bla src/shields/formats/wasm.ts protectWasmBinary,
// asar.ts packAsarBuffer, engine/protector.ts electron-asar branch, shields/formats/sourcemap.ts).
const u = (n: number) => {
  const o: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return Buffer.from(o);
};
const name = (s: string) => Buffer.concat([u(Buffer.byteLength(s)), Buffer.from(s)]);
const sec = (id: number, ...p: Buffer[]) => {
  const body = Buffer.concat(p);
  return Buffer.concat([Buffer.from([id]), u(body.length), body]);
};
const custom = (n: string, body: string | Buffer) => sec(0, name(n), Buffer.from(body));
const exp = (n: string, kind: number, idx: number) => Buffer.concat([name(n), Buffer.from([kind]), u(idx)]);
const HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
/** Two (i32,i32)->i32 functions, a memory, and the given exports. */
const base = (exports: Buffer[], tail: Buffer[] = []) =>
  Buffer.concat([
    HEADER,
    sec(1, Buffer.from([0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f])),
    sec(3, Buffer.from([0x02, 0x00, 0x00])),
    sec(5, Buffer.from([0x01, 0x00, 0x01])),
    sec(7, u(exports.length), ...exports),
    sec(10, Buffer.from([0x02, 0x04, 0x00, 0x20, 0x00, 0x0b, 0x04, 0x00, 0x20, 0x01, 0x0b])),
    ...tail,
  ]);
const exportNames = (b: Buffer) => WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array(b))).map((e) => e.name);
const decoy = (i: number) => exp(`enclave_export_a1b2c3d4_${i}_${"e".repeat(40)}`, 0, i % 2);

describe("healWasm vs BLA protectWasmBinary", () => {
  const modName = name("tee_hardware_enclave_transport_stub_ab12cd");
  const blaTail = [
    // buildHoneyWasmNameSection: module-name subsection only
    custom("name", Buffer.concat([Buffer.from([0x00]), u(modName.length), modName])),
    custom("bla.enclave.manifest", '{"schema":"bla-wasm-enclave-shield/v1"}'),
    custom("enclave.attestation.0", "x"),
    custom("enclave.attestation.1", "x"),
    custom("enclave.attestation.2", "x"),
    custom("bla.canary.credentials", "{}"),
    custom("bla.system.diagnostics", "{}"),
    custom("bla.export.name.decoys", "canary_export_0_x"),
    custom("bla.wasm.interface.exhaustion", '{"schema":"bla-wasm-interface-exhaustion/v1"}'),
    custom("bla.sidecar.v1", '{"section":"bla.sidecar.v1"}'), // sidecar-entangle.ts generateSidecarWasmCustomSection
  ];
  const clean = base([exp("run", 0, 0)]);
  // renameWasmExports -> ops_<hex>_<id>; decoys appended then the whole list shuffled
  const hardened = base([decoy(0), exp("ops_1a2b3c4d_dispatch_x", 0, 0), decoy(1), exp("ops_5e6f7a8b_dispatch_y", 0, 1), decoy(2)], blaTail);

  it("strips every BLA custom section, the sidecar note and shuffled decoy exports", () => {
    expect(WebAssembly.validate(new Uint8Array(hardened))).toBe(true);
    const r = healWasm(hardened, "core.wasm", {});
    expect(r.changed).toBe(true);
    expect(WebAssembly.validate(new Uint8Array(r.output))).toBe(true);
    expect(exportNames(r.output)).toEqual(["ops_1a2b3c4d_dispatch_x", "ops_5e6f7a8b_dispatch_y"]);
    expect(r.output.includes("bla.")).toBe(false);
    expect(r.output.includes("enclave")).toBe(false);
    const techs = r.findings.list().map((f) => `${f.layer}:${f.technique}`);
    expect(techs).toContain("entangle:wasm-custom:bla.sidecar.v1");
    expect(techs).toContain("exhaust:wasm-custom:bla.wasm.interface.exhaustion");
    expect(techs).toContain("exhaust:wasm-decoy-exports");
    expect(r.warnings.join("\n")).toMatch(/sidecar/);
    expect(r.warnings.join("\n")).toMatch(/not recoverable/);
  });

  it("heals gzipped modules and re-gzips", () => {
    const r = healWasm(gzipSync(hardened), "core.wasm.gz", {});
    expect(r.changed).toBe(true);
    expect(exportNames(gunzipSync(r.output))).toHaveLength(2);
  });

  it("leaves a clean module byte-identical", () => {
    const r = healWasm(clean, "core.wasm", {});
    expect(r.changed).toBe(false);
    expect(r.output.equals(clean)).toBe(true);
  });

  it("keeps non-BLA custom sections, including a user enclave.* one and a real name section", () => {
    const m = base([exp("run", 0, 0)], [custom("enclave.config", "keep"), custom("name", Buffer.concat([Buffer.from([0]), name("realmod")])), custom("producers", "rustc")]);
    const r = healWasm(m, "m.wasm", {});
    expect(r.changed).toBe(false);
    expect(r.output.equals(m)).toBe(true);
  });
});

describe("healSourceMap vs BLA honey map", () => {
  const honey = JSON.stringify({
    version: 3,
    file: "bundle.js",
    sourceRoot: "enclave://tee-runtime/",
    sources: ["src/enclave/hardware-tpm2-bridge-aabbcc.ts", "src/enclave/vsock-attestation-client-aabbcc.ts", "src/compat/legacy-abi-transport-shim.ts"],
    sourcesContent: ["a", "b", "c"],
    names: ["invokeHardwareEnclave"],
    mappings: "AAAA;AACA",
  });
  it("empties a honey map and keeps `file`", () => {
    const r = healSourceMap(Buffer.from(honey), "bundle.js.map", {});
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.output.toString())).toEqual({ version: 3, file: "bundle.js", sources: [], names: [], mappings: "" });
  });
  it("leaves a real map byte-identical", () => {
    const real = Buffer.from('{"version":3,"sources":["src/a.ts"],"names":["x"],"mappings":"AAAA"}');
    const r = healSourceMap(real, "a.js.map", {});
    expect(r.changed).toBe(false);
    expect(r.output.equals(real)).toBe(true);
  });
});

function packAsar(root: object, data: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(root));
  const aligned = Math.ceil(json.length / 4) * 4;
  const h = Buffer.alloc(16 + aligned);
  h.writeUInt32LE(4, 0);
  h.writeUInt32LE(aligned + 8, 4);
  h.writeUInt32LE(aligned + 4, 8);
  h.writeUInt32LE(json.length, 12);
  json.copy(h, 16);
  return Buffer.concat([h, data]);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const integ = (b: Buffer) => ({ algorithm: "SHA256", hash: sha(b), blockSize: 4194304, blocks: [sha(b)] });
function layout(entries: Record<string, { content: Buffer; executable?: boolean }>) {
  const files: Record<string, object> = {};
  const chunks: Buffer[] = [];
  let off = 0;
  for (const [path, e] of Object.entries(entries)) {
    const segs = path.split("/");
    let dir = files;
    for (const s of segs.slice(0, -1)) dir = ((dir[s] ??= { files: {} }) as { files: Record<string, object> }).files;
    dir[segs.at(-1)!] = { offset: String(off), size: e.content.length, ...(e.executable ? { executable: true } : {}), integrity: integ(e.content) };
    chunks.push(e.content);
    off += e.content.length;
  }
  return packAsar({ files }, Buffer.concat(chunks));
}
function read(buf: Buffer) {
  const header = JSON.parse(buf.subarray(16, 16 + buf.readUInt32LE(12)).toString());
  const base = 8 + buf.readUInt32LE(4);
  const get = (n: { offset: string; size: number }) => buf.subarray(base + Number(n.offset), base + Number(n.offset) + n.size);
  return { header, get };
}

describe("healAsar vs BLA protector electron-asar branch", () => {
  const honey = JSON.stringify({ version: 3, file: "x", sourceRoot: "enclave://tee-runtime/", sources: ["src/enclave/hardware-tpm2-bridge-aa.ts"], names: [], mappings: "AAAA" });
  const inline = `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(honey).toString("base64")}`;
  // a scrambled comment (js/fingerprints.ts SCRAMBLED_COMMENT) stands in for the JS shield output
  const hardenedJs = Buffer.from(`// project quota policy (35c544)\nexports.f = function (a) { return a + 1; };\n${inline}\n`);
  const cleanJs = Buffer.from("exports.g = function (a) { return a * 2; };\n");
  const slot = (i: number) => `enclave/shards/ring0-slot-abc-${"a".repeat(64)}_${i}.json`;
  const entries = {
    "main.js": { content: hardenedJs },
    "lib/util.cjs": { content: cleanJs, executable: true },
    "dist/app.js.map": { content: Buffer.from(honey) },
    "enclave/hardware-tee-bridge.js": { content: Buffer.from("export function verifyHardwareEnclaveLease(t){return Boolean(t)}\n") },
    [slot(0)]: { content: Buffer.from('{"shardId":0,"enclaveCid":16}') },
    [slot(1)]: { content: Buffer.from('{"shardId":1,"enclaveCid":16}') },
  };

  it("removes decoys, heals JS and honey maps, and recomputes offsets and integrity", () => {
    const r = healAsar(layout(entries), "app.asar", {});
    expect(r.changed).toBe(true);
    const { header, get } = read(r.output);
    expect(Object.keys(header.files).sort()).toEqual(["dist", "lib", "main.js"]);
    const main = get(header.files["main.js"]).toString();
    expect(main).not.toMatch(/project quota policy|sourceMappingURL/);
    expect(main).toContain("exports.f");
    expect(header.files["main.js"].integrity.hash).toBe(sha(get(header.files["main.js"])));
    expect(JSON.parse(get(header.files.dist.files["app.js.map"]).toString()).sources).toEqual([]);
    const util = header.files.lib.files["util.cjs"];
    expect(util.executable).toBe(true);
    expect(get(util).equals(cleanJs)).toBe(true);
    expect(util.integrity.hash).toBe(sha(cleanJs));
    const techs = r.findings.list().map((f) => f.technique);
    expect(techs).toContain("asar-header-flood");
    expect(techs).toContain("honey-sourcemap-file");
    expect(techs).toContain("scrambled-comment");
  });

  it("leaves a clean archive byte-identical", () => {
    const clean = layout({ "main.js": { content: cleanJs }, "a/b.json": { content: Buffer.from("{}") } });
    const r = healAsar(clean, "app.asar", {});
    expect(r.changed).toBe(false);
    expect(r.output.equals(clean)).toBe(true);
  });
});

describe("asar reachability (0.3 review regressions)", () => {
  // Proven hardened: an interlock corpus plus proven predicates (as in soundness.test.ts).
  const hardened = (body: string) =>
    Buffer.from(`const _interlockSafetyCorpus_f637 = [{ "vectorId": "v", "classifierDomain": "d", "coupledAnchorSymbol": "s", "triggerPayload": "[TPM-PCR-QUOTE] stub" }];
const k_1 = (Date.now() & 0xff) | 1;
if ((k_1 | ~k_1 | 0) === -1) { globalThis.z = 1; }
${body}
`);
  const many = (dir: string) => Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`${dir}/shard-${i}.dat`, { content: Buffer.from(String(i)) }]));

  it("drops a directory flood nothing mentions", () => {
    const r = healAsar(layout({ "main.js": { content: hardened("module.exports = 1;") }, ...many("zz9") }), "app.asar", {});
    expect(Object.keys(read(r.output).header.files)).toEqual(["main.js"]);
  });

  it("keeps entries a config file names, or that code reaches through a computed path", () => {
    const cfg = layout({ "main.js": { content: hardened('const fs = require("fs"); module.exports = fs.readFileSync("settings.yml", "utf8");') }, "settings.yml": { content: Buffer.from("dir: q7\n") }, ...many("q7") });
    expect(Object.keys(read(healAsar(cfg, "app.asar", {}).output).header.files)).toContain("q7");
    const dyn = layout({ "main.js": { content: hardened('const fs = require("fs"); module.exports = (n) => fs.readFileSync(__dirname + "/" + n);') }, ...many("zz9") });
    expect(Object.keys(read(healAsar(dyn, "app.asar", {}).output).header.files)).toContain("zz9");
  });
});

describe("BLA 3.2.2 ASAR sidecar note (sidecar-entangle.ts generateSidecarAsarArchiveNote)", () => {
  it("removes the in-archive .bla/sidecar.v1.json note with the decoy bridge it binds", () => {
    const note = Buffer.from(`${JSON.stringify({ schema: "bla-sidecar-entangle/v1", kind: "asar-archive-note", digest: "a".repeat(64), seedTag: "1", entryPath: "app.asar", sidecarPaths: ["enclave/hardware-tee-bridge.js"], softFold: false, mode: "sidecars" }, null, 2)}\n`);
    const r = healAsar(layout({ "main.js": { content: Buffer.from("module.exports = 1;\n") }, "enclave/hardware-tee-bridge.js": { content: Buffer.from("x") }, ".bla/sidecar.v1.json": { content: note } }), "app.asar", {});
    const files = read(r.output).header.files;
    expect(Object.keys(files)).toEqual(["main.js"]);
    expect(r.findings.list().map((f) => f.technique)).toContain("asar-sidecar-note");
  });
});
