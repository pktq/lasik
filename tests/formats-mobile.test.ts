import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { healAxml, isAxml } from "../src/formats/axml.js";
import { healDex, isDex } from "../src/formats/dex.js";
import { healIl2cpp, isIl2cpp } from "../src/formats/il2cpp.js";
import { healPlist, isPlist } from "../src/formats/plist.js";
import { healZip, isZip } from "../src/formats/zip.js";

const opts = {};
const techniques = (r: { findings: { list(): { technique: string }[] } }) => r.findings.list().map((f) => f.technique);

// ---- fixtures mirroring BLA src/shields/formats/* ----

function adler32(b: Buffer): number {
  let a = 1;
  let s = 0;
  for (const v of b) {
    a = (a + v) % 65521;
    s = (s + a) % 65521;
  }
  return ((s << 16) | a) >>> 0;
}

/** A DEX-shaped file with a valid header size/signature/checksum. */
function realDex(): Buffer {
  const d = Buffer.alloc(112 + 200, 7);
  d.write("dex\n035\0", 0, "latin1");
  d.writeUInt32LE(d.length, 32);
  d.writeUInt32LE(0x70, 36);
  d.writeUInt32LE(0x12345678, 40);
  createHash("sha1").update(d.subarray(32)).digest().copy(d, 12);
  d.writeUInt32LE(adler32(d.subarray(12)), 8);
  return d;
}

/** mobile-game.ts protectAndroidDexBuffer (:90-120). */
function blaDex(bytes: Buffer): Buffer {
  const trailer = [
    "\0[BLA-DEX-SHIELD-V1]",
    "Lcom/enclave/sgx/TeeAttestationBridge;",
    "Lcom/enclave/tpm2/KeyUnsealerStub;",
    "Lcom/enclave/nitro/VsockRing0Transport;",
    "Lcom/enclave/tarpit/EnclaveStateNode_ab12cd_0;",
    "Java_com_enclave_sgx_TeeAttestationBridge_verifyShamirEd25519QuorumRing",
    "canary-token-xyz",
  ].join("\0") + "\0";
  const out = Buffer.concat([bytes, Buffer.from(trailer)]);
  out.writeUInt32LE(out.length, 32);
  createHash("sha1").update(out.subarray(32)).digest().copy(out, 12);
  out.writeUInt32LE(adler32(out.subarray(12)), 8);
  return out;
}

/** Stand-in for android-dex-xref.ts output: header plus its marker and caller class strings. */
function xrefDex(): Buffer {
  const d = Buffer.concat([
    Buffer.alloc(112),
    Buffer.from("BLA-DEX-XREF-V1\0Lcom/enclave/xref/ExternalInvokeCaller_ab12cd_0;\0Landroid/util/Log;\0"),
  ]);
  d.write("dex\n035\0", 0, "latin1");
  d.writeUInt32LE(d.length, 32);
  return d;
}

function realMeta(): Buffer {
  const m = Buffer.alloc(300, 1);
  m.writeUInt32LE(0xfab11baf, 0);
  m.writeInt32LE(29, 4);
  return m;
}

/** mobile-game.ts protectIl2cppMetadataBuffer (:158-166). */
const blaMeta = (b: Buffer) =>
  Buffer.concat([b, Buffer.from("\0[BLA-IL2CPP-SHIELD]\0Enclave.Ring0.Tarpit_0_abcd1234:chaff\0Enclave.Ring0.Tarpit_1_x:y\0")]);

/** Minimal bplist00: one empty-string object, 1-byte offsets, valid 32-byte trailer. */
function realBplist(): Buffer {
  const body = Buffer.concat([Buffer.from("bplist00"), Buffer.from([0x50])]);
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(1n, 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(body.length), 24);
  return Buffer.concat([body, Buffer.from([8]), trailer]);
}

/** apple-plist.ts protectApplePlistBuffer binary branch (:150-166). */
const blaBplist = (b: Buffer) =>
  Buffer.concat([b, Buffer.from(["", "BLA_BPLIST_DEPTH_GUARD_132:abc123:com.apple.security.secure-enclave.ring0", "canary rec", ""].join("\0"))]);

const REAL_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "<dict>",
  "  <key>CFBundleIdentifier</key>",
  "  <string>com.real.app</string>",
  "</dict>",
  "</plist>",
].join("\n");

/** apple-plist.ts protectAppleXmlPlist (:61-110): doctype with [], decoy keys before first </dict>. */
const blaPlist = (xml: string) =>
  xml
    .replace(' "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', ' "http://www.apple.com/DTDs/PropertyList-1.0.dtd" []>')
    .replace(
      "</dict>",
      [
        "  <key>BLAEnclaveAttestationAuthority</key>",
        "  <string>com.apple.security.secure-enclave.ring0.ab12</string>",
        "  <key>BLAEnclaveVsockDelegationCID</key>",
        "  <integer>16</integer>",
        "  <key>BLACanaryCredential_0</key>",
        "  <string>AKIA&amp;canary</string>",
        "  <key>BLASystemDiagnostic_0</key>",
        "  <string>[E] (1) diag</string>",
        "  <key>BLABinaryPlistNestingDepthClaim</key>",
        "  <integer>132</integer>",
        "</dict>",
      ].join("\n"),
    );

// ---- zip helpers (archive.ts writeZipArchive shape: no flags/time/extra, stored <64B else deflate) ----

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const store = f.data.length < 64;
    const comp = store ? f.data : deflateRawSync(f.data);
    const l = Buffer.alloc(30 + name.length);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(store ? 0 : 8, 8);
    l.writeUInt32LE(crc32(f.data), 14);
    l.writeUInt32LE(comp.length, 18);
    l.writeUInt32LE(f.data.length, 22);
    l.writeUInt16LE(name.length, 26);
    name.copy(l, 30);
    const c = Buffer.alloc(46 + name.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc32(f.data), 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42);
    name.copy(c, 46);
    locals.push(l, comp);
    cds.push(c);
    off += l.length + comp.length;
  }
  const size = cds.reduce((n, c) => n + c.length, 0);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(files.length, 8);
  e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(size, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, ...cds, e]);
}

/** Strict reader: verifies every offset, size and CRC, returns name -> bytes. */
function readZip(z: Buffer): Map<string, Buffer> {
  const eocd = z.length - 22;
  expect(z.readUInt32LE(eocd)).toBe(0x06054b50);
  const n = z.readUInt16LE(eocd + 10);
  let p = z.readUInt32LE(eocd + 16);
  expect(p + z.readUInt32LE(eocd + 12)).toBe(eocd);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    expect(z.readUInt32LE(p)).toBe(0x02014b50);
    const method = z.readUInt16LE(p + 10);
    const csize = z.readUInt32LE(p + 20);
    const nl = z.readUInt16LE(p + 28);
    const lho = z.readUInt32LE(p + 42);
    const name = z.toString("utf8", p + 46, p + 46 + nl);
    expect(z.readUInt32LE(lho)).toBe(0x04034b50);
    const start = lho + 30 + z.readUInt16LE(lho + 26) + z.readUInt16LE(lho + 28);
    const raw = z.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(data.length).toBe(z.readUInt32LE(p + 24));
    expect(crc32(data)).toBe(z.readUInt32LE(p + 16));
    out.set(name, Buffer.from(data));
    p += 46 + nl;
  }
  return out;
}

const REAL_MANIFEST = Buffer.from([3, 0, 8, 0, ...randomBytes(100)]);
const REAL_SO = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), randomBytes(200)]);
const DECOY_MANIFEST = Buffer.from(
  '<?xml version="1.0" encoding="utf-8"?>\n<!-- bla-shield: decoy AndroidManifest — saturates REA -->\n<manifest package="com.enclave.sgx.teeattestation">\n</manifest>\n',
);
const DECOY_MAPPING = Buffer.from("# compiler: R8\n# bla-shield: decoy mapping — applying this file poisons\ncom.enclave.sgx.X -> a.a.a:\n");
const DECOY_SO = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from("\0Java_com_enclave_sgx_TeeAttestationBridge_verifyShamirEd25519QuorumRing\0"),
]);

const realApkParts = () => [
  { name: "AndroidManifest.xml", data: REAL_MANIFEST },
  { name: "classes.dex", data: realDex() },
  { name: "assets/bin/Data/Managed/Metadata/global-metadata.dat", data: realMeta() },
  { name: "lib/arm64-v8a/libreal.so", data: REAL_SO },
  { name: "res/layout/a.xml", data: Buffer.from("x".repeat(500)) },
];

/** archive.ts protectZipOrApkBuffer APK branch (:300-405). */
function blaApk() {
  const parts = realApkParts().map((p) =>
    p.name === "classes.dex" ? { ...p, data: blaDex(p.data) } : p.name.endsWith("global-metadata.dat") ? { ...p, data: blaMeta(p.data) } : p,
  );
  const planted = [
    { name: "assets/bla-shield/bla-attestation-manifest.json", data: Buffer.from(JSON.stringify({ schema: "bla-archive-enclave-shield/v1", protected: true })) },
    { name: "assets/bla-shield/bla-canary-tokens.txt", data: Buffer.from("canary\n") },
    { name: "assets/bla-shield/tee_bridge_stub_ab12cd34ef56.properties", data: Buffer.from("# x\nenclave.cid=16\n") },
    { name: "assets/bla-shield/mapping.txt", data: DECOY_MAPPING },
    { name: "assets/bla-shield/proguard-mapping.txt", data: DECOY_MAPPING },
    { name: "lib/arm64-v8a/libbla_enclave_jni.so", data: DECOY_SO },
    { name: "assets/bla-shield/AndroidManifest.xml", data: DECOY_MANIFEST },
    { name: "assets/bla-shield/AndroidManifest-decoy.xml", data: DECOY_MANIFEST },
    { name: "classes2.dex", data: xrefDex() },
  ];
  return { clean: writeZip(realApkParts()), hardened: writeZip([...parts, ...planted]) };
}

describe("dex", () => {
  it("cuts the BLA trailer and restores the exact original, checksum and signature included", () => {
    const orig = realDex();
    const r = healDex(blaDex(orig), "classes.dex", opts);
    expect(r.changed).toBe(true);
    expect(r.output.equals(orig)).toBe(true);
    expect(techniques(r)).toContain("dex-trailer-decoys");
  });
  it("leaves a clean dex byte-identical", () => {
    const r = healDex(realDex(), "classes.dex", opts);
    expect(r.changed).toBe(false);
    expect(r.output.equals(realDex())).toBe(true);
  });
  it("reports the xref decoy dex without altering it", () => {
    const r = healDex(xrefDex(), "classes2.dex", opts);
    expect(r.changed).toBe(false);
    expect(techniques(r)).toEqual(["dex-xref-flood"]);
  });
  it("detects by magic", () => {
    expect(isDex("a", realDex().subarray(0, 64))).toBe(true);
    expect(isDex("a", Buffer.from("PK\x03\x04"))).toBe(false);
  });
});

describe("il2cpp", () => {
  it("restores the original metadata", () => {
    const r = healIl2cpp(blaMeta(realMeta()), "global-metadata.dat", opts);
    expect(r.changed).toBe(true);
    expect(r.output.equals(realMeta())).toBe(true);
    expect(techniques(r)).toEqual(["il2cpp-trailer-decoys"]);
  });
  it("leaves clean metadata byte-identical", () => {
    const r = healIl2cpp(realMeta(), "global-metadata.dat", opts);
    expect(r.changed).toBe(false);
    expect(r.output.equals(realMeta())).toBe(true);
    expect(isIl2cpp("x", realMeta().subarray(0, 64))).toBe(true);
  });
});

describe("plist", () => {
  it("restores an XML plist (except the trailing newline BLA trimmed)", () => {
    const r = healPlist(Buffer.from(blaPlist(REAL_PLIST)), "Info.plist", opts);
    expect(r.changed).toBe(true);
    expect(r.output.toString()).toBe(REAL_PLIST);
    expect(techniques(r).sort()).toEqual(["plist-decoy-keys", "plist-internal-subset"]);
  });
  it("leaves a clean XML plist byte-identical", () => {
    const buf = Buffer.from(REAL_PLIST + "\n");
    const r = healPlist(buf, "Info.plist", opts);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(buf);
  });
  it("cuts the binary plist trailer", () => {
    const r = healPlist(blaBplist(realBplist()), "Info.plist", opts);
    expect(r.changed).toBe(true);
    expect(r.output.equals(realBplist())).toBe(true);
    expect(techniques(r)).toEqual(["bplist-depth-claim"]);
  });
  it("leaves a clean bplist byte-identical", () => {
    const r = healPlist(realBplist(), "Info.plist", opts);
    expect(r.changed).toBe(false);
    expect(r.output.equals(realBplist())).toBe(true);
    expect(isPlist("x", realBplist())).toBe(true);
  });
  it("refuses to cut when the remaining bplist trailer is inconsistent", () => {
    const bad = Buffer.concat([Buffer.from("bplist00junkjunkjunkjunk"), Buffer.from("\0BLA_BPLIST_DEPTH_GUARD_132:x\0")]);
    const r = healPlist(bad, "a.plist", opts);
    expect(r.changed).toBe(false);
    expect(r.warnings.length).toBe(1);
  });
});

describe("axml", () => {
  it("reports the decoy sidecar manifest and never alters it", () => {
    const r = healAxml(DECOY_MANIFEST, "assets/bla-shield/AndroidManifest.xml", opts);
    expect(r.changed).toBe(false);
    expect(techniques(r)).toEqual(["manifest-decoy"]);
  });
  it("leaves the real binary manifest silent and identical", () => {
    const r = healAxml(REAL_MANIFEST, "AndroidManifest.xml", opts);
    expect(r.changed).toBe(false);
    expect(r.findings.size).toBe(0);
    expect(isAxml("x.bin", REAL_MANIFEST.subarray(0, 64))).toBe(true);
  });
});

describe("zip / apk", () => {
  it("removes every planted entry and restores real members exactly", () => {
    const { hardened } = blaApk();
    const r = healZip(hardened, "app.apk", opts);
    expect(r.changed).toBe(true);
    const got = readZip(r.output);
    const want = new Map(realApkParts().map((p) => [p.name, p.data]));
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [name, data] of want) expect(got.get(name)!.equals(data), name).toBe(true);
    expect(techniques(r).sort()).toEqual(
      ["archive-decoy-entries", "dex-trailer-decoys", "dex-xref-flood", "il2cpp-trailer-decoys", "jni-decoy-so", "manifest-decoy", "r8-mapping-decoy"].sort(),
    );
  });
  it("heals a plain (non-APK) zip hardened under assets/enclave and enclave/", () => {
    const real = [{ name: "readme.txt", data: Buffer.from("hello") }];
    const hardened = writeZip([
      ...real,
      { name: "assets/enclave/bla-attestation-manifest.json", data: Buffer.from('{"schema":"bla-archive-enclave-shield/v1"}') },
      { name: "assets/enclave/bla-canary-tokens.txt", data: Buffer.from("c") },
      { name: "enclave/shadow_module_0123456789ab.json", data: Buffer.from("{}") },
    ]);
    const r = healZip(hardened, "a.zip", opts);
    expect([...readZip(r.output).keys()]).toEqual(["readme.txt"]);
  });
  it("keeps a user's own enclave/ files when there is no BLA manifest", () => {
    const z = writeZip([{ name: "enclave/shadow_module_0123456789ab.json", data: Buffer.from("{}") }]);
    const r = healZip(z, "a.zip", opts);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(z);
  });
  it("leaves clean archives byte-identical", () => {
    const { clean } = blaApk();
    const r = healZip(clean, "app.apk", opts);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(clean);
    expect(isZip("x", clean.subarray(0, 64))).toBe(true);
  });
  it("leaves unsupported layouts alone with a warning", () => {
    const z = Buffer.concat([Buffer.from("MZjunk"), writeZip([{ name: "a", data: Buffer.from("a") }])]);
    const r = healZip(z, "a.zip", opts);
    expect(r.changed).toBe(false);
    expect(isZip("a.zip", z)).toBe(false);
  });
});
