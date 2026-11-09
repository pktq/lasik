import { createHash } from "node:crypto";
import { Findings } from "../core/types.js";
import { healJs, isHardened } from "../js/heal.js";
import { isHoneySourceMap } from "../js/passes/comments.js";
import { healSourceMap } from "./sourcemap.js";
import type { FormatHealer } from "./types.js";

/** REA refuses asar headers above this (DEFAULT_ASAR_MAX_HEADER_BYTES). */
const REA_MAX_HEADER = 16 * 1024 * 1024;
const DEFAULT_BLOCK = 4 * 1024 * 1024;
/** Unreachable entries in one directory needed to call it a header flood. */
const FLOOD = 64;
/**
 * Live code that names files at runtime could reach any entry: `require(x)`, `import(x)`,
 * directory listings, or a file API whose path is not a plain string literal.
 */
const DYNAMIC_FILE_ACCESS = /\b(?:require|import)\s*\(\s*[^'"`\s)]|readdir|opendir|\bglob(?:Sync)?\s*\(|\b(?:readFileSync|readFile|createReadStream|openSync|open|loadFile|loadURL|statSync|existsSync|accessSync)\s*\(\s*(?!["'][^"'\n]*["']\s*[,)])/;
const INLINE_MAP = /^[ \t]*\/\/[#@][ \t]*sourceMappingURL=data:application\/json[^,\n]*;base64,([A-Za-z0-9+/=]+)[ \t]*\r?\n?/gm;

interface Integrity {
  algorithm: string;
  hash: string;
  blockSize: number;
  blocks: string[];
}

interface AsarNode {
  files?: Record<string, AsarNode>;
  offset?: string;
  size?: number;
  unpacked?: boolean;
  link?: string;
  integrity?: Integrity;
  [k: string]: unknown;
}

function isDecoyPath(path: string): boolean {
  return path === "enclave/hardware-tee-bridge.js" || /^enclave\/shards\/ring0-slot-[^/]*$/.test(path);
}

/** BLA ≥ 3.2.2 opt-in sidecar entanglement: an in-archive digest note binding the decoy bridge (sidecar-entangle.ts). */
const SIDECAR_NOTE = ".bla/sidecar.v1.json";

function integrity(content: Buffer, blockSize: number): Integrity {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const blocks: string[] = [];
  for (let off = 0; off < content.length; off += blockSize) blocks.push(sha(content.subarray(off, off + blockSize)));
  if (blocks.length === 0) blocks.push(sha(Buffer.alloc(0)));
  return { algorithm: "SHA256", hash: sha(content), blockSize, blocks };
}

/** Remove inline honey source-map directives; returns undefined when nothing was stripped. */
function stripHoneyInlineMaps(content: Buffer): { content: Buffer; count: number } | undefined {
  let count = 0;
  const text = content.toString("utf8").replace(INLINE_MAP, (line, b64: string) => {
    if (!isHoneySourceMap(Buffer.from(b64, "base64").toString("utf8"))) return line;
    count++;
    return "";
  });
  return count ? { content: Buffer.from(text, "utf8"), count } : undefined;
}

/**
 * Electron asar healer: drops BLA's header-flood shard entries and decoy
 * enclave bridge, strips inline honey source maps from .js entries, empties
 * honey .map entries, and repacks with fresh offsets. Unpacked and link
 * entries are kept as-is (their bytes live outside the archive).
 */
export const healAsar: FormatHealer = (input, file, opts) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = () => ({ output: input, findings: new Findings(), warnings, changed: false });

  if (input.length < 16 || input.readUInt32LE(0) !== 4) return unchanged();
  const headerSize = input.readUInt32LE(4);
  const jsonSize = input.readUInt32LE(12);
  const dataBase = 8 + headerSize;
  if (16 + jsonSize > dataBase || dataBase > input.length) {
    warnings.push("asar header exceeds file bounds; left unchanged");
    return unchanged();
  }
  let root: AsarNode;
  try {
    root = JSON.parse(input.subarray(16, 16 + jsonSize).toString("utf8")) as AsarNode;
  } catch {
    warnings.push("asar header is not valid JSON; left unchanged");
    return unchanged();
  }

  const contentOf = (node: AsarNode, path: string): Buffer => {
    const start = dataBase + Number(node.offset);
    const size = node.size ?? 0;
    if (!Number.isSafeInteger(start) || start + size > input.length) throw new Error(`entry out of bounds: ${path}`);
    return input.subarray(start, start + size);
  };
  const healCache = new Map<string, ReturnType<typeof healJs>>();
  const healedJs = (path: string, content: Buffer) => {
    let r = healCache.get(path);
    if (!r) healCache.set(path, (r = healJs(content.toString("utf8"), { filename: path, aggressive: opts.aggressive })));
    return r;
  };

  /**
   * Flood entries nothing left in a proven-hardened archive can reach. Roots are package.json, its
   * `main`, and every top-level file; a reached text reaches each entry whose file name, stem or
   * directory it mentions. Code that names files at runtime (`require(x)`, `import(x)`,
   * `readdir`) could reach anything, so then nothing is dropped.
   */
  const unreachableEntries = (files: Record<string, AsarNode>): Set<string> => {
    const entries: { path: string; node: AsarNode }[] = [];
    const list = (dir: Record<string, AsarNode>, prefix: string): void => {
      for (const [name, node] of Object.entries(dir)) {
        if (node.files) list(node.files, `${prefix + name}/`);
        else if (node.link === undefined && node.unpacked !== true && !isDecoyPath(prefix + name) && prefix + name !== SIDECAR_NOTE) entries.push({ path: prefix + name, node });
      }
    };
    list(files, "");
    let hardened = false;
    const text = new Map<string, string>();
    for (const { path, node } of entries) {
      if (/\.[cm]?js$/.test(path)) {
        const r = healedJs(path, contentOf(node, path));
        hardened ||= isHardened(r.findings);
        text.set(path, r.code);
      } else {
        // Any entry can name another (a YAML config, a binary index): scan every byte.
        text.set(path, contentOf(node, path).toString("latin1"));
      }
    }
    if (!hardened) return new Set();
    const main = (() => {
      try {
        const m = (JSON.parse(text.get("package.json") ?? "{}") as { main?: unknown }).main;
        return typeof m === "string" ? m.replace(/^\.\//, "") : undefined;
      } catch {
        return undefined;
      }
    })();
    const reached = new Set(entries.filter((e) => !e.path.includes("/") || e.path === main || e.path === `${main}.js`).map((e) => e.path));
    const queue = [...reached];
    while (queue.length) {
      const path = queue.pop()!;
      const t = text.get(path);
      if (t === undefined) continue;
      if (/\.[cm]?js$/.test(path) && DYNAMIC_FILE_ACCESS.test(t)) return new Set();
      for (const e of entries) {
        if (reached.has(e.path)) continue;
        const parts = e.path.split("/");
        const file = parts[parts.length - 1]!;
        const names = [file, file.replace(/\.[^.]+$/, ""), ...parts.slice(0, -1)];
        if (names.some((n) => n && t.includes(n))) {
          reached.add(e.path);
          queue.push(e.path);
        }
      }
    }
    // Only floods: a lone unreachable file may still be worth reading, thousands of them never are.
    const byDir = new Map<string, string[]>();
    for (const e of entries) {
      if (reached.has(e.path)) continue;
      const dir = e.path.slice(0, e.path.lastIndexOf("/") + 1);
      byDir.set(dir, [...(byDir.get(dir) ?? []), e.path]);
    }
    return new Set([...byDir.values()].filter((paths) => paths.length >= FLOOD).flat());
  };

  let unreachable = new Set<string>();
  let unreachableDropped = 0;
  const chunks: Buffer[] = [];
  let offset = 0;
  let decoys = 0;
  let sidecarNotes = 0;
  let inlineMaps = 0;
  let honeyMaps = 0;
  let jsHealed = 0;

  // Rebuilds `dir` in place, returning false when it ended up empty only because decoys were removed.
  const walk = (dir: Record<string, AsarNode>, prefix: string): boolean => {
    const hadEntries = Object.keys(dir).length > 0;
    for (const [name, node] of Object.entries(dir)) {
      const path = prefix + name;
      if (node.files) {
        if (!walk(node.files, `${path}/`)) delete dir[name];
        continue;
      }
      if (node.link !== undefined || node.unpacked === true) continue;
      if (isDecoyPath(path)) {
        decoys++;
        delete dir[name];
        continue;
      }
      if (path === SIDECAR_NOTE) {
        sidecarNotes++;
        delete dir[name];
        continue;
      }
      if (unreachable.has(path)) {
        unreachableDropped++;
        delete dir[name];
        continue;
      }
      let content = contentOf(node, path);
      let rewritten = false;
      if (/\.[cm]?js$/.test(name)) {
        // BLA runs its full JS shield over every .js entry (protector.ts electron-asar branch).
        try {
          const r = healedJs(path, content);
          if (r.changed) {
            content = Buffer.from(r.code, "utf8");
            for (const f of r.findings.list()) findings.add(f.layer, f.technique, f.detail, f.count);
            warnings.push(...r.warnings.map((w) => `${path}: ${w}`));
            jsHealed++;
            rewritten = true;
          }
        } catch (err) {
          warnings.push(`${path}: JS heal failed (${(err as Error).message}); entry kept`);
        }
        // Fallback for entries the JS healer could not parse.
        const stripped = stripHoneyInlineMaps(content);
        if (stripped) {
          ({ content } = stripped);
          inlineMaps += stripped.count;
          rewritten = true;
        }
      } else if (name.endsWith(".map")) {
        const healed = healSourceMap(content, path, opts);
        if (healed.changed) {
          content = healed.output;
          honeyMaps++;
          rewritten = true;
        }
      }
      if (rewritten) {
        node.size = content.length;
        if (node.integrity) node.integrity = integrity(content, node.integrity.blockSize || DEFAULT_BLOCK);
      }
      node.offset = String(offset);
      chunks.push(content);
      offset += content.length;
    }
    return !hadEntries || Object.keys(dir).length > 0;
  };

  if (!root.files) return unchanged();
  try {
    unreachable = unreachableEntries(root.files);
    walk(root.files, "");
  } catch (err) {
    warnings.push(`asar parse failed (${(err as Error).message}); left unchanged`);
    return unchanged();
  }
  if (decoys + sidecarNotes + unreachableDropped + inlineMaps + honeyMaps + jsHealed === 0) return unchanged();

  const json = Buffer.from(JSON.stringify(root), "utf8");
  const aligned = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(16 + aligned);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(aligned + 8, 4);
  header.writeUInt32LE(aligned + 4, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);

  if (sidecarNotes) {
    findings.add("entangle", "asar-sidecar-note", `removed BLA sidecar entanglement note ${SIDECAR_NOTE}`, sidecarNotes);
    warnings.push(`removed ${SIDECAR_NOTE}; BLA host-side verifyAsarSidecarArchiveNote will no longer pass on this archive (intended)`);
  }
  if (decoys) {
    findings.add(
      "exhaust",
      "asar-header-flood",
      "removed decoy enclave shard entries flooding the ASAR header",
      decoys,
    );
  }
  if (unreachableDropped) findings.add("exhaust", "asar-unreachable-entry", "removed entries nothing left in the hardened archive can reach", unreachableDropped);
  if (inlineMaps) findings.add("deceive", "honey-sourcemap", "removed inline honey source maps from .js entries", inlineMaps);
  if (honeyMaps) {
    findings.add("deceive", "honey-sourcemap-file", "replaced honey .map entries with empty maps", honeyMaps);
    warnings.push("original source maps inside the asar are gone (BLA overwrote them)");
  }
  if (json.length > REA_MAX_HEADER) warnings.push(`asar header still ${json.length} bytes, above REA's 16 MiB default`);
  warnings.push(`${file}: asar header changed; Electron header-integrity checks (asar integrity fuse) will no longer match`);
  return { output: Buffer.concat([header, ...chunks]), findings, warnings, changed: true };
};
