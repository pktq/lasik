import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

export const isJvm = (file: string, head: Buffer): boolean => {
  if (head.length < 8 || head.readUInt32BE(0) !== 0xcafebabe) return false;
  const major = head.readUInt16BE(6);
  return /\.class$/i.test(file) || (head.readUInt32BE(4) > 30 && major >= 45 && major <= 90);
};

const SCHEMA = '{"schema":"bla-jvm-enclave-v1"';
const TRAILER = Buffer.from("\0BLA_JVM_SHIELD_V1\0", "utf8");
/** Fixed first two Utf8 strings of the block BLA appends to the constant pool. */
const POOL_MARK = ["BlaEnclaveDelegation", "com/enclave/sgx/TeeAttestationBridge"];

interface Entry {
  at: number;
  tag: number;
  index: number;
}

/** Walk the constant pool; returns each entry's offset, tag and index, plus the offset after the pool. */
function walkPool(b: Buffer): { entries: Entry[]; end: number } | null {
  const count = b.readUInt16BE(8);
  const entries: Entry[] = [];
  let at = 10;
  for (let index = 1; index < count; ) {
    const tag = b[at];
    let size: number;
    let slots = 1;
    if (tag === 1) size = at + 3 <= b.length ? 3 + b.readUInt16BE(at + 1) : Infinity;
    else if (tag === 3 || tag === 4 || (tag !== undefined && tag >= 9 && tag <= 12) || tag === 17 || tag === 18) size = 5;
    else if (tag === 5 || tag === 6) {
      size = 9;
      slots = 2;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) size = 3;
    else if (tag === 15) size = 4;
    else return null;
    if (at + size > b.length) return null;
    entries.push({ at, tag: tag!, index });
    at += size;
    index += slots;
  }
  return { entries, end: at };
}

/**
 * BLA (jvm-bytecode.ts) appends decoy Utf8 entries to the end of the constant
 * pool (never referenced by the class) and then either a JSON blob after the
 * class bytes ("structural") or a `\0BLA_JVM_SHIELD_V1\0` string block
 * ("trailer"). Cut the pool block, fix constant_pool_count, drop the tail.
 */
export const healJvm: FormatHealer = (input) => {
  const findings = new Findings();
  const unchanged = { output: input, findings, warnings: [] as string[], changed: false };
  if (input.length < 24 || input.readUInt32BE(0) !== 0xcafebabe) return unchanged;

  let out = input;
  const t = input.lastIndexOf(TRAILER);
  const j = input.lastIndexOf(SCHEMA);
  let tail = 0;
  if (t >= 0 && input[input.length - 1] === 0) tail = input.length - t;
  else if (j >= 0) {
    try {
      const doc = JSON.parse(input.toString("utf8", j)) as { schema?: string };
      if (doc.schema === "bla-jvm-enclave-v1") tail = input.length - j;
    } catch {
      /* not BLA's blob: leave it */
    }
  }
  if (tail) out = input.subarray(0, input.length - tail);

  let pool = 0;
  const walked = walkPool(out);
  if (walked) {
    const str = (e: Entry) => out.toString("utf8", e.at + 3, e.at + 3 + out.readUInt16BE(e.at + 1));
    const i = walked.entries.findIndex(
      (e, k) => e.tag === 1 && str(e) === POOL_MARK[0] && walked.entries[k + 1]?.tag === 1 && str(walked.entries[k + 1]!) === POOL_MARK[1],
    );
    if (i >= 0 && walked.entries.slice(i).every((e) => e.tag === 1)) {
      const cut = walked.entries[i]!;
      out = Buffer.concat([out.subarray(0, cut.at), out.subarray(walked.end)]);
      out.writeUInt16BE(cut.index, 8);
      pool = walked.entries.length - i;
    }
  }
  if (!tail && !pool) return unchanged;
  findings.add("deceive", "jvm-decoy-constants", "removed decoy Utf8 constant-pool entries (enclave bridge, tarpit classes, canaries) and fixed constant_pool_count", pool);
  findings.add("deceive", "jvm-trailing-blob", "removed BLA data appended after the class bytes (invalid trailing bytes)", tail ? 1 : 0);
  return { output: Buffer.from(out), findings, warnings: [], changed: true };
};
