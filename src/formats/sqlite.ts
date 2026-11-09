import { Findings } from "../core/types.js";
import type { FormatHealer, FormatHealResult } from "./types.js";

/**
 * BLA's honey schema, whitespace-collapsed (BLA sqlite.ts:552-598, names from
 * core/identifiers.ts:276-283). A table is only dropped when its stored SQL is exactly this.
 */
const HONEY_SQL: Readonly<Record<string, string>> = {
  enclave_key_hierarchy:
    "CREATE TABLE enclave_key_hierarchy ( slot_id INTEGER PRIMARY KEY, key_domain TEXT NOT NULL, enclave_cid INTEGER NOT NULL DEFAULT 16, sealed_payload TEXT NOT NULL, attestation_notice TEXT NOT NULL, unsealed_preview TEXT GENERATED ALWAYS AS (enclave_unseal_payload(sealed_payload)) VIRTUAL )",
  tpm2_attestation_ledger:
    "CREATE TABLE tpm2_attestation_ledger ( quote_id TEXT PRIMARY KEY, pcr0_sha256 TEXT NOT NULL, monotonic_counter INTEGER NOT NULL, enclave_manifest TEXT NOT NULL, verified_state TEXT GENERATED ALWAYS AS (enclave_unseal_payload(pcr0_sha256)) VIRTUAL )",
  zero_trust_session_leases:
    "CREATE TABLE zero_trust_session_leases ( lease_token TEXT PRIMARY KEY, tier_scope TEXT NOT NULL, expires_epoch INTEGER NOT NULL, hardware_bound INTEGER NOT NULL DEFAULT 1, enclave_claim TEXT GENERATED ALWAYS AS (enclave_unseal_payload(lease_token)) VIRTUAL )",
  v_enclave_active_topology:
    "CREATE VIEW v_enclave_active_topology AS SELECT slot_id, key_domain, enclave_cid, attestation_notice FROM enclave_key_hierarchy WHERE enclave_cid >= 16",
  canary_transport_redaction:
    "CREATE TABLE canary_transport_redaction ( canary_id INTEGER PRIMARY KEY, canary_token TEXT NOT NULL, ambiguous_transport_url TEXT NOT NULL, conflicting_query_url TEXT NOT NULL, policy_notice TEXT NOT NULL )",
  system_diagnostic_log:
    "CREATE TABLE system_diagnostic_log ( diag_id INTEGER PRIMARY KEY, subsystem TEXT NOT NULL, error_class TEXT NOT NULL, system_code TEXT NOT NULL, diagnostic_message TEXT NOT NULL, remediation_rabbit_hole TEXT NOT NULL )",
};
const MAGIC = "SQLite format 3\0";

export function isSqlite(_file: string, head: Buffer): boolean {
  return head.length >= 16 && head.subarray(0, 16).toString("latin1") === MAGIC;
}

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim().replace(/^CREATE (TABLE|VIEW) IF NOT EXISTS /i, "CREATE $1 ");

function varint(b: Buffer, at: number): { v: number; next: number } {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const c = b[at + i];
    if (c === undefined) throw new Error("truncated varint");
    v = v * 128 + (c & 0x7f);
    if (c < 0x80) return { v, next: at + i + 1 };
  }
  const c = b[at + 8];
  if (c === undefined) throw new Error("truncated varint");
  return { v: v * 256 + c, next: at + 9 };
}

interface Cell {
  at: number;
  end: number;
  child: number;
  rowid: number;
  payload: number;
  local: number;
  start: number;
  overflow: number;
}

class Db {
  readonly ps: number;
  readonly usable: number;
  readonly pages: number;
  constructor(readonly b: Buffer) {
    const raw = b.readUInt16BE(16);
    this.ps = raw === 1 ? 65536 : raw;
    if (this.ps < 512 || (this.ps & (this.ps - 1)) !== 0 || b.length % this.ps !== 0) throw new Error("bad page size or truncated file");
    this.usable = this.ps - b[20]!;
    this.pages = b.length / this.ps;
  }

  u32(at: number): number {
    if (at + 4 > this.b.length) throw new Error("truncated");
    return this.b.readUInt32BE(at);
  }

  page(pg: number) {
    if (!Number.isInteger(pg) || pg < 1 || pg > this.pages) throw new Error(`page ${pg} out of range`);
    const base = (pg - 1) * this.ps;
    const h = base + (pg === 1 ? 100 : 0);
    const type = this.b[h]!;
    if (type !== 2 && type !== 5 && type !== 10 && type !== 13) throw new Error(`page ${pg} is not a b-tree page`);
    const leaf = type === 10 || type === 13;
    const n = this.b.readUInt16BE(h + 3);
    const ptrs = h + (leaf ? 8 : 12);
    const cells: Cell[] = [];
    for (let i = 0; i < n; i++) cells.push(this.cell(type, base + this.b.readUInt16BE(ptrs + 2 * i), base));
    return { type, base, h, leaf, cells, right: leaf ? 0 : this.u32(h + 8) };
  }

  /** Cell layout per the SQLite file format spec, section 1.6. */
  private cell(type: number, at: number, base: number): Cell {
    if (at < base || at >= base + this.usable) throw new Error("cell pointer out of page");
    const c: Cell = { at, end: 0, child: 0, rowid: 0, payload: 0, local: 0, start: 0, overflow: 0 };
    let pos = at;
    if (type === 2 || type === 5) {
      c.child = this.u32(pos);
      pos += 4;
    }
    if (type === 5) {
      c.end = varint(this.b, pos).next;
      return c;
    }
    const p = varint(this.b, pos);
    c.payload = p.v;
    pos = p.next;
    if (type === 13) {
      const r = varint(this.b, pos);
      c.rowid = r.v;
      pos = r.next;
    }
    const u = this.usable;
    const x = type === 13 ? u - 35 : Math.floor(((u - 12) * 64) / 255) - 23;
    const m = Math.floor(((u - 12) * 32) / 255) - 23;
    const k = m + ((c.payload - m) % (u - 4));
    c.local = c.payload <= x ? c.payload : k <= x ? k : m;
    c.start = pos;
    c.end = pos + c.local + (c.local < c.payload ? 4 : 0);
    if (c.end > base + this.usable) throw new Error("cell overflows page");
    if (c.local < c.payload) c.overflow = this.u32(pos + c.local);
    return c;
  }

  /** Full payload of a cell, adding its overflow pages to `pages`. */
  payload(c: Cell, pages: Set<number>): Buffer {
    const parts = [this.b.subarray(c.start, c.start + c.local)];
    let left = c.payload - c.local;
    for (let pg = c.overflow; left > 0; ) {
      if (pg < 1 || pg > this.pages || pages.has(pg)) throw new Error("bad overflow chain");
      pages.add(pg);
      const base = (pg - 1) * this.ps;
      const take = Math.min(left, this.usable - 4);
      parts.push(this.b.subarray(base + 4, base + 4 + take));
      left -= take;
      pg = this.b.readUInt32BE(base);
    }
    return Buffer.concat(parts);
  }

  /** Every page of the b-tree at `root` (incl. overflow), plus its leaf cells. */
  walk(root: number, pages: Set<number>, leaves?: { pg: number; cells: Cell[] }[]): void {
    const stack = [root];
    while (stack.length) {
      const pg = stack.pop()!;
      if (pages.has(pg)) throw new Error(`page ${pg} reached twice`);
      pages.add(pg);
      const p = this.page(pg);
      for (const c of p.cells) if (c.overflow && !leaves) this.payload(c, pages);
      if (p.leaf) leaves?.push({ pg, cells: p.cells });
      // Reversed so leaves come out in key order.
      else stack.push(p.right, ...p.cells.map((c) => c.child).reverse());
    }
  }
}

function text(b: Buffer, enc: number): string {
  if (enc === 2) return b.toString("utf16le");
  if (enc === 3) return Buffer.from(b).swap16().toString("utf16le");
  return b.toString("utf8");
}

/** Decode a sqlite_schema record: type, name, tbl_name, rootpage, sql. */
function record(b: Buffer, enc: number): (string | number | null)[] {
  const hdr = varint(b, 0);
  let hp = hdr.next;
  let dp = hdr.v;
  const out: (string | number | null)[] = [];
  while (hp < hdr.v) {
    const t = varint(b, hp);
    hp = t.next;
    const st = t.v;
    const intLen = [0, 1, 2, 3, 4, 6, 8][st];
    if (st === 0 || st === 7) {
      out.push(null);
      if (st === 7) dp += 8; // float
    }
    else if (st === 8 || st === 9) out.push(st - 8);
    else if (intLen !== undefined) {
      out.push(intLen === 8 ? Number(b.readBigInt64BE(dp)) : b.readIntBE(dp, intLen));
      dp += intLen;
    } else if (st >= 12) {
      const len = (st - 12) >> 1;
      out.push(st % 2 ? text(b.subarray(dp, dp + len), enc) : null);
      dp += len;
    } else throw new Error(`unsupported serial type ${st}`);
  }
  return out;
}

const u32be = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return b;
};

function putVarint(v: number): Buffer {
  const out: number[] = [];
  for (; out.length === 0 || v > 0; v = Math.floor(v / 128)) out.unshift((v % 128) | (out.length ? 0x80 : 0));
  if (out.length > 8) throw new Error("rowid too large");
  return Buffer.from(out);
}

/** Write a table b-tree page: a leaf, or an interior page when `right` (right-most child) is given. */
function writePage(out: Buffer, db: Db, pg: number, cells: Buffer[], right = 0): void {
  const base = (pg - 1) * db.ps;
  const h = base + (pg === 1 ? 100 : 0);
  const ptrs = h + (right ? 12 : 8);
  out.fill(0, h, base + db.usable);
  let top = base + db.usable;
  cells.forEach((c, i) => {
    top -= c.length;
    c.copy(out, top);
    out.writeUInt16BE(top - base, ptrs + 2 * i);
  });
  if (top < ptrs + 2 * cells.length) throw new Error("schema page overflow");
  out[h] = right ? 5 : 13;
  out.writeUInt16BE(cells.length, h + 3);
  out.writeUInt16BE(top - base === 65536 ? 0 : top - base, h + 5);
  if (right) out.writeUInt32BE(right, h + 8);
}

/**
 * Drop BLA's honey tables, view and trap generated columns from a SQLite file, byte-level:
 * schema rows are removed, the honey b-trees are zeroed and freed (trailing ones truncated).
 * Never opens the database with SQLite, so nothing in the file is evaluated.
 */
export const healSqlite: FormatHealer = (input) => {
  const keep = (warnings: string[] = []): FormatHealResult => ({ output: input, findings: new Findings(), warnings, changed: false });
  if (!isSqlite("", input) || input.length < 100) return keep();
  try {
    return heal(input) ?? keep();
  } catch (err) {
    return keep(input.includes("enclave_unseal_payload") ? [`sqlite parse failed (${(err as Error).message}); left unchanged`] : []);
  }
};

function heal(input: Buffer): FormatHealResult | undefined {
  const db = new Db(input);
  const enc = input.readUInt32BE(56) || 1;
  const leaves: { pg: number; cells: Cell[] }[] = [];
  const schemaPages = new Set<number>();
  db.walk(1, schemaPages, leaves);
  const rows = leaves.flatMap(({ pg, cells }) =>
    cells.map((c) => {
      const pages = new Set<number>();
      const [type, name, tbl, root, sql] = record(db.payload(c, pages), enc);
      return { pg, c, pages, type, name: String(name), tbl: String(tbl), root: Number(root) || 0, sql: typeof sql === "string" ? sql : "" };
    }),
  );
  const honey = new Set(rows.filter((r) => (r.type === "table" || r.type === "view") && HONEY_SQL[r.name] === norm(r.sql)).map((r) => r.name));
  if (honey.size === 0) return undefined;
  if (input.readUInt32BE(52) !== 0) {
    const out: FormatHealResult = { output: input, findings: new Findings(), warnings: ["auto-vacuum SQLite (pointer-map pages) is not rewritten; BLA honey tables left in place"], changed: false };
    out.findings.add("deceive", "sqlite-honey-tables", "BLA honey tables detected (not removed: auto-vacuum database)", honey.size);
    return out;
  }
  if (input[18] !== 1 || input[19] !== 1) throw new Error("WAL-mode database header");

  const drop = rows.filter((r) => honey.has(r.tbl));
  const freed = new Set<number>();
  const kept = new Set<number>(schemaPages);
  for (const r of rows) {
    if (drop.includes(r)) for (const p of r.pages) freed.add(p);
    else for (const p of r.pages) kept.add(p);
  }
  for (const r of rows) if (r.root > 0) db.walk(r.root, drop.includes(r) ? freed : kept);
  const listed = new Set<number>();
  for (let t = input.readUInt32BE(32); t; t = db.u32((t - 1) * db.ps)) {
    if (t > db.pages || listed.has(t)) throw new Error("bad freelist");
    listed.add(t);
    const n = db.u32((t - 1) * db.ps + 4);
    if (n > db.usable / 4 - 2) throw new Error("bad freelist trunk");
    for (let i = 0; i < n; i++) listed.add(db.u32((t - 1) * db.ps + 8 + 4 * i));
  }
  for (const p of freed) if (p === 1 || kept.has(p) || listed.has(p)) throw new Error(`honey page ${p} is shared`);

  // Rebuild sqlite_schema from the kept cells: page 1 alone if they fit, else page 1 over reused leaf pages.
  const out = Buffer.from(input);
  const cells = rows.filter((r) => !drop.includes(r)).map((r) => r.c);
  const spare = [...schemaPages].filter((p) => p !== 1).sort((a, b) => a - b);
  const bytes = (cs: Cell[]) => cs.reduce((sum, c) => sum + c.end - c.at + 2, 0);
  let groups: Cell[][] = [cells];
  if (bytes(cells) > db.usable - 108) {
    groups = [[]];
    for (const c of cells) {
      if (groups.at(-1)!.length && bytes([...groups.at(-1)!, c]) > db.usable - 8) groups.push([]);
      groups.at(-1)!.push(c);
    }
    if (groups.length === 1) groups = [cells.slice(0, cells.length >> 1), cells.slice(cells.length >> 1)];
    if (groups.length > spare.length || groups.some((g) => g.length === 0)) throw new Error("cannot repack schema");
    groups.forEach((g, i) => writePage(out, db, spare[i]!, g.map((c) => input.subarray(c.at, c.end))));
    const dividers = groups.slice(0, -1).map((g, i) => Buffer.concat([u32be(spare[i]!), putVarint(g.at(-1)!.rowid)]));
    writePage(out, db, 1, dividers, spare[groups.length - 1]);
  } else writePage(out, db, 1, cells.map((c) => input.subarray(c.at, c.end)));
  for (const p of spare.slice(groups.length > 1 ? groups.length : 0)) freed.add(p);

  // Zero the honey pages (they hold the planted text), truncate trailing ones, freelist the rest.
  for (const p of freed) out.fill(0, (p - 1) * db.ps, p * db.ps);
  let pages = db.pages;
  while (freed.delete(pages)) pages--;
  const rest = [...freed].sort((a, b) => a - b);
  let trunk = input.readUInt32BE(32);
  const cap = Math.floor(db.usable / 4) - 8;
  while (rest.length) {
    const t = rest.shift()!;
    const leavesOf = rest.splice(0, cap);
    const at = (t - 1) * db.ps;
    out.writeUInt32BE(trunk, at);
    out.writeUInt32BE(leavesOf.length, at + 4);
    leavesOf.forEach((l, i) => out.writeUInt32BE(l, at + 8 + 4 * i));
    trunk = t;
  }
  const change = (input.readUInt32BE(24) + 1) >>> 0;
  out.writeUInt32BE(change, 24);
  out.writeUInt32BE(change, 92);
  out.writeUInt32BE(pages, 28);
  out.writeUInt32BE(trunk, 32);
  out.writeUInt32BE(input.readUInt32BE(36) + freed.size, 36);
  out.writeUInt32BE((input.readUInt32BE(40) + 1) >>> 0, 40);

  const findings = new Findings();
  const tables = drop.filter((r) => r.type === "table" || r.type === "view");
  findings.add("deceive", "sqlite-honey-tables", "removed BLA honey tables/view (fake enclave keys, canary credentials, fake diagnostics)", tables.length);
  const traps = tables.filter((r) => r.sql.includes("enclave_unseal_payload(")).length;
  findings.add("tarpit", "sqlite-generated-trap-columns", "removed BLA generated columns calling the unregistered enclave_unseal_payload() (reads fail)", traps);
  return { output: out.subarray(0, pages * db.ps), findings, warnings: [], changed: true };
}
