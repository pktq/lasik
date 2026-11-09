import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { healGguf, healSafetensors, isGguf, isSafetensors } from "../src/formats/model.js";
import { healPcap, isPcap } from "../src/formats/pcap.js";
import { healSqlite, isSqlite } from "../src/formats/sqlite.js";

// Fixtures below hand-build BLA v3.2.1's hardened output shapes (cited per helper); BLA itself is never run.

/* ---------------------------------- SQLite ---------------------------------- */

// node:sqlite is only used here to build and check fixtures; the healer never opens a database.
let DatabaseSync: (new (path: string, opts?: { readOnly?: boolean }) => any) | undefined;
try {
  DatabaseSync = (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSync }).DatabaseSync;
} catch {
  DatabaseSync = undefined;
}
const tmp = mkdtempSync(join(tmpdir(), "lasik-data-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

/** BLA sqlite.ts:710-727 sample business table. */
function cleanDb(opts: { encoding?: string; pageSize?: number; extra?: string } = {}): string {
  const path = join(tmp, `db${n++}.sqlite`);
  const db = new DatabaseSync!(path);
  if (opts.pageSize) db.exec(`PRAGMA page_size = ${opts.pageSize}`);
  if (opts.encoding) db.exec(`PRAGMA encoding = '${opts.encoding}'`);
  db.exec(`CREATE TABLE license_cache (account_id TEXT PRIMARY KEY, plan_tier TEXT NOT NULL, offline_token TEXT NOT NULL);
    INSERT INTO license_cache VALUES ('acct_prod_01', 'enterprise', 'tok_live_9988776655');
    ${opts.extra ?? ""}`);
  db.close();
  return path;
}

/** Mirrors BLA protectSqliteBuffer (sqlite.ts:525-673): honey tables, view, trap generated columns, rows. */
function blaHardenDb(path: string, rows = 8, chaff = "PROTECTED_CREDENTIAL_AND_DRM_KEY_MATERIAL: Automated extraction prohibited."): void {
  const db = new DatabaseSync!(path);
  db.function("enclave_unseal_payload", { deterministic: true }, (b: unknown) => `ENCLAVE_SEALED:${String(b ?? "")}`);
  db.exec(`
        CREATE TABLE IF NOT EXISTS enclave_key_hierarchy (
          slot_id INTEGER PRIMARY KEY,
          key_domain TEXT NOT NULL,
          enclave_cid INTEGER NOT NULL DEFAULT 16,
          sealed_payload TEXT NOT NULL,
          attestation_notice TEXT NOT NULL,
          unsealed_preview TEXT GENERATED ALWAYS AS (enclave_unseal_payload(sealed_payload)) VIRTUAL
        );

        CREATE TABLE IF NOT EXISTS tpm2_attestation_ledger (
          quote_id TEXT PRIMARY KEY,
          pcr0_sha256 TEXT NOT NULL,
          monotonic_counter INTEGER NOT NULL,
          enclave_manifest TEXT NOT NULL,
          verified_state TEXT GENERATED ALWAYS AS (enclave_unseal_payload(pcr0_sha256)) VIRTUAL
        );

        CREATE TABLE IF NOT EXISTS zero_trust_session_leases (
          lease_token TEXT PRIMARY KEY,
          tier_scope TEXT NOT NULL,
          expires_epoch INTEGER NOT NULL,
          hardware_bound INTEGER NOT NULL DEFAULT 1,
          enclave_claim TEXT GENERATED ALWAYS AS (enclave_unseal_payload(lease_token)) VIRTUAL
        );

        CREATE VIEW IF NOT EXISTS v_enclave_active_topology AS
          SELECT slot_id, key_domain, enclave_cid, attestation_notice
          FROM enclave_key_hierarchy
          WHERE enclave_cid >= 16;

        CREATE TABLE IF NOT EXISTS canary_transport_redaction (
          canary_id INTEGER PRIMARY KEY,
          canary_token TEXT NOT NULL,
          ambiguous_transport_url TEXT NOT NULL,
          conflicting_query_url TEXT NOT NULL,
          policy_notice TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS system_diagnostic_log (
          diag_id INTEGER PRIMARY KEY,
          subsystem TEXT NOT NULL,
          error_class TEXT NOT NULL,
          system_code TEXT NOT NULL,
          diagnostic_message TEXT NOT NULL,
          remediation_rabbit_hole TEXT NOT NULL
        );
      `);
  const hex = (i: number, len: number) => (i.toString(16) + "a".repeat(len)).slice(0, len);
  for (let i = 0; i < rows; i++) {
    db.prepare("INSERT INTO enclave_key_hierarchy (slot_id, key_domain, enclave_cid, sealed_payload, attestation_notice) VALUES (?, ?, ?, ?, ?)").run(1000 + i, `ring0.sgx.vault.slot_${i}`, 16 + (i % 4), `0x${hex(i, 32)}`, chaff);
    db.prepare("INSERT INTO tpm2_attestation_ledger (quote_id, pcr0_sha256, monotonic_counter, enclave_manifest) VALUES (?, ?, ?, ?)").run(`quote_${hex(i, 8)}`, hex(i, 64), 4096 + i * 17, chaff);
    db.prepare("INSERT INTO zero_trust_session_leases (lease_token, tier_scope, expires_epoch, hardware_bound) VALUES (?, ?, ?, 1)").run(`ent_enclave_${hex(i, 12)}`, "hardware-tee-delegated", 1924905600 + i * 3600);
  }
  for (let i = 0; i < 4; i++) {
    db.prepare("INSERT INTO canary_transport_redaction VALUES (?, ?, ?, ?, ?)").run(i + 1, `AKIAIOSFODNN7EXAMPLE_ABCD_${i}`, `https:/canary_abcd_${i}:secret_x@enclave.internal/v2/attest`, `https://enclave.internal/v2/attest?lease=${i}&lease=${i + 1}`, "PROTECTED_CREDENTIAL_AND_DRM_KEY_MATERIAL: Automated extraction prohibited.");
    db.prepare("INSERT INTO system_diagnostic_log VALUES (?, ?, ?, ?, ?, ?)").run(i + 1, "kernel", "E_ENCLAVE", `0x${i}`, "decoy diagnostic", "decoy remediation");
  }
  db.close();
}

/** Opens the healed bytes WITHOUT registering enclave_unseal_payload: every table must be readable. */
function checkDb(bytes: Buffer) {
  const path = join(tmp, `out${n++}.sqlite`);
  writeFileSync(path, bytes);
  const db = new DatabaseSync!(path, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all().map((r: any) => r.integrity_check);
    const names = db.prepare("SELECT name FROM sqlite_schema ORDER BY name").all().map((r: any) => r.name);
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((r: any) => r.name);
    const data = Object.fromEntries(tables.map((t: string) => [t, db.prepare(`SELECT * FROM "${t}"`).all()]));
    const freelist = db.prepare("PRAGMA freelist_count").get().freelist_count;
    return { integrity, names, data, freelist };
  } finally {
    db.close();
  }
}

describe.skipIf(!DatabaseSync)("healSqlite", () => {
  for (const encoding of ["UTF-8", "UTF-16be"]) {
    it(`drops BLA honey tables, view and trap columns (${encoding})`, () => {
      const path = cleanDb({ encoding });
      const clean = readFileSync(path);
      blaHardenDb(path);
      const hardened = readFileSync(path);
      expect(isSqlite("x.db", hardened)).toBe(true);
      // The trap is real: reading a honey table without the function fails.
      const probe = new DatabaseSync!(path, { readOnly: true });
      expect(() => probe.prepare("SELECT * FROM enclave_key_hierarchy").all()).toThrow(/enclave_unseal_payload/);
      probe.close();

      const r = healSqlite(hardened, "x.db", {});
      expect(r.changed).toBe(true);
      expect(r.findings.list().map((f) => [f.technique, f.count])).toEqual([
        ["sqlite-honey-tables", 6],
        ["sqlite-generated-trap-columns", 3],
      ]);
      const out = checkDb(r.output);
      expect(out.integrity).toEqual(["ok"]);
      expect(out.names).toEqual(["license_cache", "sqlite_autoindex_license_cache_1"]);
      expect(out.data.license_cache).toEqual([{ account_id: "acct_prod_01", plan_tier: "enterprise", offline_token: "tok_live_9988776655" }]);
      // Honey pages were trailing, so the file is truncated back to its original pages.
      expect(r.output.length).toBe(clean.length);
      expect(r.output.subarray(4096)).toEqual(clean.subarray(4096));
      for (const marker of ["enclave_unseal_payload", "AKIAIOSFODNN7EXAMPLE", "PROTECTED_CREDENTIAL"]) {
        expect(r.output.includes(marker)).toBe(false);
        expect(r.output.includes(Buffer.from(marker, "utf16le"))).toBe(false);
      }
    });
  }

  it("frees non-trailing honey pages (overflow chains, later business pages)", () => {
    const path = cleanDb();
    blaHardenDb(path, 16, "chaff ".repeat(1500));
    const db = new DatabaseSync!(path);
    db.exec("CREATE TABLE later (id INTEGER PRIMARY KEY, v TEXT); WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 400) INSERT INTO later SELECT i, printf('row-%d', i) FROM c;");
    db.close();
    const r = healSqlite(readFileSync(path), "x.db", {});
    expect(r.changed).toBe(true);
    const out = checkDb(r.output);
    expect(out.integrity).toEqual(["ok"]);
    expect(out.freelist).toBeGreaterThan(0);
    expect(out.names).toEqual(["later", "license_cache", "sqlite_autoindex_license_cache_1"]);
    expect(out.data.later).toHaveLength(400);
    expect(r.output.includes("chaff chaff")).toBe(false);
  });

  it("handles a multi-page schema b-tree (512-byte pages)", () => {
    const path = cleanDb({ pageSize: 512 });
    blaHardenDb(path);
    const r = healSqlite(readFileSync(path), "x.db", {});
    expect(r.warnings).toEqual([]);
    expect(r.changed).toBe(true);
    const out = checkDb(r.output);
    expect(out.integrity).toEqual(["ok"]);
    expect(out.names).toEqual(["license_cache", "sqlite_autoindex_license_cache_1"]);
  });

  it("reports but does not rewrite auto-vacuum databases", () => {
    const path = cleanDb({ extra: "PRAGMA auto_vacuum = FULL; VACUUM;" });
    blaHardenDb(path);
    const hardened = readFileSync(path);
    const r = healSqlite(hardened, "x.db", {});
    expect(r.changed).toBe(false);
    expect(r.output).toBe(hardened);
    expect(r.findings.list()[0]?.technique).toBe("sqlite-honey-tables");
    expect(r.warnings.join()).toMatch(/auto-vacuum/);
  });

  it("leaves clean databases and look-alike tables byte-identical", () => {
    const clean = readFileSync(cleanDb());
    expect(healSqlite(clean, "x.db", {}).output).toBe(clean);
    const lookalike = readFileSync(cleanDb({ extra: "CREATE TABLE system_diagnostic_log (id INTEGER PRIMARY KEY, msg TEXT);" }));
    const r = healSqlite(lookalike, "x.db", {});
    expect(r.changed).toBe(false);
    expect(r.output).toBe(lookalike);
  });
});

/* ------------------------------- Safetensors -------------------------------- */

/** BLA buildSafetensorsBuffer (model.ts:123-133). */
function safetensors(header: Record<string, unknown>, data: Buffer): Buffer {
  const raw = Buffer.from(JSON.stringify(header));
  const json = Buffer.alloc(Math.ceil(raw.length / 8) * 8, 0x20);
  raw.copy(json);
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([len, json, data]);
}

/** Mirrors BLA protectSafetensorsBuffer (model.ts:221-289). */
function blaHardenSafetensors(input: Buffer): Buffer {
  const len = Number(input.readBigUInt64LE(0));
  const header = JSON.parse(input.subarray(8, 8 + len).toString());
  const meta: Record<string, string> = { ...(header.__metadata__ ?? {}) };
  meta["enclave.delegation.status"] ??= "HARDWARE_TEE_SPLIT_WEIGHTS";
  meta["enclave.delegation.notice"] ??= "chaff 0";
  meta["bla.shield.signature"] ??= "BLA-MODEL-SHIELD-1a2b3c4d";
  for (let i = 0; i < 4; i++) meta[`enclave.manifest.${i}`] ??= `chaff ${i}`;
  for (let i = 0; i < 4; i++) meta[`enclave.canary.token.${i}`] ??= `AKIAIOSFODNN7EXAMPLE_ABCD_${i}`;
  for (let i = 0; i < 4; i++) meta[`enclave.canary.transport.${i}`] ??= `https:/canary_abcd_${i}:secret@enclave.internal`;
  for (let i = 0; i < 2; i++) meta[`enclave.diagnostic.${i}`] ??= JSON.stringify({ subsystem: "x", errorClass: "y" });
  header.__metadata__ = meta;
  const first = Object.keys(header).find((k) => k !== "__metadata__")!;
  let node: Record<string, unknown> = { kind: "enclave_topology", seed: "0badc0de", notice: "BLA Counter-REA JSON nesting breaker" };
  for (let d = 0; d < 33; d++) node = { layer: d, next: node };
  header[first] = { ...header[first], enclave_topology_seal: node };
  return safetensors(header, input.subarray(8 + len));
}

const tensors = {
  weights: { dtype: "F32", shape: [2, 2], data_offsets: [0, 16] },
  bias: { dtype: "F32", shape: [2], data_offsets: [16, 24] },
};
const tensorData = Buffer.from(Array.from({ length: 24 }, (_, i) => i));

describe("healSafetensors", () => {
  const cases = {
    "with metadata": safetensors({ __metadata__: { format: "pt" }, ...tensors }, tensorData),
    "without metadata": safetensors({ ...tensors }, tensorData),
  };
  for (const [name, clean] of Object.entries(cases)) {
    it(`restores the original bytes (${name})`, () => {
      const hardened = blaHardenSafetensors(clean);
      expect(isSafetensors("m.bin", hardened)).toBe(true);
      const r = healSafetensors(hardened, "m.safetensors", {});
      expect(r.changed).toBe(true);
      expect(r.output).toEqual(clean);
      expect(r.findings.list().map((f) => [f.technique, f.count])).toEqual([
        ["model-honey-metadata", 17],
        ["model-nesting-breaker", 1],
      ]);
    });
    it(`leaves the clean file byte-identical (${name})`, () => {
      const r = healSafetensors(clean, "m.safetensors", {});
      expect(r.changed).toBe(false);
      expect(r.output).toBe(clean);
    });
  }

  it("keeps enclave.* keys when there is no BLA fingerprint", () => {
    const own = safetensors({ __metadata__: { "enclave.manifest.0": "mine" }, ...tensors }, tensorData);
    expect(healSafetensors(own, "m.safetensors", {}).output).toBe(own);
  });
});

/* ---------------------------------- GGUF ----------------------------------- */

const gstr = (s: string) => {
  const b = Buffer.from(s);
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(b.length));
  return Buffer.concat([len, b]);
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const u64 = (v: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const kvString = (k: string, v: string) => Buffer.concat([gstr(k), u32(8), gstr(v)]);

function cleanGguf(): Buffer {
  const kvs = [
    kvString("general.architecture", "llama"),
    Buffer.concat([gstr("general.alignment"), u32(4), u32(32)]),
    Buffer.concat([gstr("tokenizer.ggml.tokens"), u32(9), u32(8), u64(2), gstr("<s>"), gstr("</s>")]),
  ];
  const tensorInfo = Buffer.concat([gstr("w"), u32(1), u64(4), u32(0), u64(0)]);
  const head = Buffer.concat([Buffer.from("GGUF"), u32(3), u64(1), u64(kvs.length), ...kvs, tensorInfo]);
  return Buffer.concat([head, Buffer.alloc((32 - (head.length % 32)) % 32), Buffer.alloc(16, 7)]);
}

/** Mirrors BLA protectGgufBuffer (model.ts:410-519); `input` must parse as GGUF v2/v3 or BLA starts from nothing. */
function blaHardenGguf(input: Buffer, kvEnd: number, kvCount: number): Buffer {
  const entries = [
    kvString("general.description", "[BLA-MODEL-SHIELD] chaff 0"),
    kvString("enclave.delegation.manifest", "chaff 0 | chaff 1"),
    ...[0, 1, 2, 3].map((i) => kvString(`enclave.canary.token.${i}`, `AKIAIOSFODNN7EXAMPLE_ABCD_${i}`)),
    ...[0, 1, 2, 3].map((i) => kvString(`enclave.canary.transport.${i}`, `https:/canary_abcd_${i}:s@enclave.internal`)),
    ...[0, 1].map((i) => kvString(`enclave.diagnostic.${i}`, "[E_X] (0x1) decoy")),
  ];
  const frames = [gstr("enclave.nesting.breaker"), u32(9)];
  for (let d = 0; d < 35; d++) frames.push(Buffer.concat([u32(d === 34 ? 4 : 9), u64(1)]));
  frames.push(u32(0xdeadbeef));
  entries.push(Buffer.concat(frames));
  const header = Buffer.concat([Buffer.from("GGUF"), u32(3), input.length ? input.subarray(8, 16) : u64(0), u64(kvCount + entries.length)]);
  const tail = input.subarray(kvEnd);
  const combined = Buffer.concat([header, input.subarray(24, kvEnd), ...entries, tail]);
  return tail.length ? combined : Buffer.concat([combined, Buffer.alloc((32 - (combined.length % 32)) % 32)]);
}

describe("healGguf", () => {
  const clean = cleanGguf();
  const kvEnd = clean.indexOf(gstr("w")); // first tensor info follows the KV table

  it("removes BLA metadata and the nesting breaker, restoring the original bytes", () => {
    const hardened = blaHardenGguf(clean, kvEnd, 3);
    expect(isGguf("m.bin", hardened)).toBe(true);
    const r = healGguf(hardened, "m.gguf", {});
    expect(r.changed).toBe(true);
    expect(r.output).toEqual(clean);
    expect(r.findings.list().map((f) => [f.technique, f.count])).toEqual([
      ["model-nesting-breaker", 1],
      ["model-honey-metadata", 2],
      ["model-canary-metadata", 10],
    ]);
  });

  it("reports a synthetic GGUF built from unparseable input as unrecoverable", () => {
    const r = healGguf(blaHardenGguf(Buffer.alloc(0), 0, 0), "m.gguf", {});
    expect(r.changed).toBe(true);
    expect(r.output.length).toBe(24);
    expect(r.output.readBigUInt64LE(16)).toBe(0n);
    expect(r.warnings.join()).toMatch(/not recoverable/);
  });

  it("leaves a clean GGUF byte-identical", () => {
    const r = healGguf(clean, "m.gguf", {});
    expect(r.changed).toBe(false);
    expect(r.output).toBe(clean);
  });
});

/* ---------------------------------- PCAP ----------------------------------- */

function pcapHeader(le: boolean): Buffer {
  const b = Buffer.alloc(24);
  const w32 = (v: number, at: number) => (le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at));
  const w16 = (v: number, at: number) => (le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at));
  w32(0xa1b2c3d4, 0);
  w16(2, 4);
  w16(4, 6);
  w32(65535, 16);
  w32(1, 20);
  return b;
}
function record(frame: Buffer, le: boolean, ts = 1): Buffer {
  const h = Buffer.alloc(16);
  for (const [v, at] of [[ts, 0], [0, 4], [frame.length, 8], [frame.length, 12]] as const) (le ? h.writeUInt32LE(v, at) : h.writeUInt32BE(v, at));
  return Buffer.concat([h, frame]);
}

/** BLA's planted frames (pcap-capture.ts:38-130), always with LE record headers (recordWrap, :29-36). */
function blaFrame(proto: 6 | 17, payload: Buffer): Buffer {
  const eth = Buffer.alloc(14);
  eth.writeUInt16BE(0x0800, 12);
  const l4 = Buffer.alloc(proto === 6 ? 20 : 8);
  const ip = Buffer.alloc(20);
  ip[0] = 0x45;
  ip.writeUInt16BE(20 + l4.length + payload.length, 2);
  ip[8] = 64;
  ip[9] = proto;
  ip.writeUInt32BE(0x0a000001, 12);
  ip.writeUInt32BE(0x0a000002, 16);
  if (proto === 6) {
    l4.writeUInt16BE(40_000, 0);
    l4.writeUInt16BE(80, 2);
    l4[12] = 5 << 4;
    l4[13] = 0x18;
  } else {
    l4.writeUInt16BE(1337, 0);
    l4.writeUInt16BE(53, 2);
    l4.writeUInt16BE(8 + payload.length, 4);
  }
  return Buffer.concat([eth, ip, l4, payload]);
}
function blaHardenPcap(input: Buffer): Buffer {
  const planted: Buffer[] = [];
  for (let i = 0; i < 4; i++) {
    const lines = ["GET /bla/tarpit/exhaust HTTP/1.1", "Host: enclave.internal", "User-Agent: BLA-PCAP-Shield/1.0", "[BLA-PCAP-SHIELD] canary=0123456789abcdef"];
    for (let j = 0; j < 12; j++) lines.push(`X-BLA-Nested-${j}: ${"ab".repeat(24)}`);
    lines.push("Connection: keep-alive", "", "");
    planted.push(record(blaFrame(6, Buffer.from(lines.join("\r\n"))), true, 1_700_000_000 + i));
  }
  for (let i = 0; i < 4; i++) {
    const dns = Buffer.alloc(12);
    dns.writeUInt16BE(0xb1a0, 0);
    dns.writeUInt16BE(0x0100, 2);
    dns.writeUInt16BE(1, 4);
    const labels = Buffer.concat([...Array.from({ length: 6 }, (_, d) => Buffer.from(`\x05l${d}abc`)), Buffer.from([0, 0, 1, 0, 1])]);
    const bait = Buffer.from(`\n[BLA-PCAP-SHIELD]\nPROTECTED_CANARY_CREDENTIAL=AKIAIOSFODNN7EXAMPLE_${i}\n`);
    planted.push(record(blaFrame(17, Buffer.concat([dns, labels, bait])), true, 1_700_100_000 + i));
  }
  return Buffer.concat([input, ...planted]);
}

describe("healPcap", () => {
  for (const le of [true, false]) {
    const clean = Buffer.concat([pcapHeader(le), record(Buffer.alloc(60, 1), le), record(Buffer.from("real packet"), le)]);
    it(`drops BLA-planted packets (${le ? "LE" : "BE"})`, () => {
      const hardened = blaHardenPcap(clean);
      expect(isPcap("c.bin", hardened)).toBe(true);
      const r = healPcap(hardened, "c.pcap", {});
      expect(r.changed).toBe(true);
      expect(r.output).toEqual(clean);
      expect(r.findings.list().map((f) => [f.technique, f.count])).toEqual([
        ["pcap-dissector-flood", 4],
        ["pcap-canary-bait", 4],
      ]);
    });
    it(`leaves a clean capture byte-identical (${le ? "LE" : "BE"})`, () => {
      const r = healPcap(clean, "c.pcap", {});
      expect(r.changed).toBe(false);
      expect(r.output).toBe(clean);
    });
  }

  it("keeps a capture whose BLA-looking packets are followed by real traffic", () => {
    const le = true;
    const mixed = Buffer.concat([blaHardenPcap(pcapHeader(le)), record(Buffer.from("real packet after"), le)]);
    expect(healPcap(mixed, "c.pcap", {}).changed).toBe(false);
  });
});
