import { createHash } from "node:crypto";
import { Findings } from "../core/types.js";
import { healJs } from "../js/heal.js";
import { isHoneySourceMap } from "../js/passes/comments.js";
import { healSourceMap } from "./sourcemap.js";
import type { FormatHealer } from "./types.js";

/** REA refuses asar headers above this (DEFAULT_ASAR_MAX_HEADER_BYTES). */
const REA_MAX_HEADER = 16 * 1024 * 1024;
const DEFAULT_BLOCK = 4 * 1024 * 1024;
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

  const chunks: Buffer[] = [];
  let offset = 0;
  let decoys = 0;
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
      const start = dataBase + Number(node.offset);
      const size = node.size ?? 0;
      if (!Number.isSafeInteger(start) || start + size > input.length) throw new Error(`entry out of bounds: ${path}`);
      let content = input.subarray(start, start + size);
      let rewritten = false;
      if (/\.[cm]?js$/.test(name)) {
        // BLA runs its full JS shield over every .js entry (protector.ts electron-asar branch).
        try {
          const r = healJs(content.toString("utf8"), { filename: path, aggressive: opts.aggressive });
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
    walk(root.files, "");
  } catch (err) {
    warnings.push(`asar parse failed (${(err as Error).message}); left unchanged`);
    return unchanged();
  }
  if (decoys + inlineMaps + honeyMaps + jsHealed === 0) return unchanged();

  const json = Buffer.from(JSON.stringify(root), "utf8");
  const aligned = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(16 + aligned);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(aligned + 8, 4);
  header.writeUInt32LE(aligned + 4, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);

  if (decoys) {
    findings.add(
      "exhaust",
      "asar-header-flood",
      "removed decoy enclave shard entries flooding the ASAR header",
      decoys,
    );
  }
  if (inlineMaps) findings.add("deceive", "honey-sourcemap", "removed inline honey source maps from .js entries", inlineMaps);
  if (honeyMaps) {
    findings.add("deceive", "honey-sourcemap-file", "replaced honey .map entries with empty maps", honeyMaps);
    warnings.push("original source maps inside the asar are gone (BLA overwrote them)");
  }
  if (json.length > REA_MAX_HEADER) warnings.push(`asar header still ${json.length} bytes, above REA's 16 MiB default`);
  warnings.push(`${file}: asar header changed; Electron header-integrity checks (asar integrity fuse) will no longer match`);
  return { output: Buffer.concat([header, ...chunks]), findings, warnings, changed: true };
};
