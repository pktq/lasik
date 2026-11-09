import { extname } from "node:path";
import type { Format } from "./types.js";

const JS_EXT = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

/** Detect an artifact's format from magic bytes first, then extension. */
export function detectFormat(file: string, head: Buffer): Format {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x0061736d) return "wasm";
  if (head.subarray(0, 16).toString("latin1") === "SQLite format 3\0") return "sqlite";
  if (head.subarray(0, 4).toString("latin1") === "GGUF") return "gguf";
  const ext = extname(file).toLowerCase();
  if (ext === ".asar") return "asar";
  if (ext === ".map") return "sourcemap";
  if (ext === ".safetensors") return "safetensors";
  if (ext === ".py") return "python";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".json") return "json";
  if (JS_EXT.has(ext)) return "javascript";
  if (head.subarray(0, 2).toString("latin1") === "#!" && /node|bun|deno/.test(head.subarray(0, 64).toString("latin1"))) {
    return "javascript";
  }
  return "unknown";
}
