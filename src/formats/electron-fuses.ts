import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/** Electron fuse wire sentinel (also what BLA floods). */
export const FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "latin1");
/** BLA's decoy fuse state; real Electron fuses only use '0', '1' and 'r'. */
const DECOY_STATE = 0x39;

/**
 * BLA appends a run of fake Electron fuse records (sentinel + 0x01 version +
 * length + fuse bytes) at EOF to push the sentinel count past REA's per-slice
 * limit. Remove only a contiguous run of well-formed records ending exactly at
 * EOF, keeping the first sentinel of the file if every sentinel is in that run.
 */
export const healFuseSentinels: FormatHealer = (input) => {
  const findings = new Findings();
  const unchanged = { output: input, findings, warnings: [] as string[], changed: false };

  // Walk back from EOF over records whose end lands exactly on the current cut.
  const run: number[] = [];
  let end = input.length;
  while (end >= FUSE_SENTINEL.length + 2) {
    const at = input.lastIndexOf(FUSE_SENTINEL, end - FUSE_SENTINEL.length);
    if (at < 0) break;
    const ver = input[at + FUSE_SENTINEL.length];
    const len = input[at + FUSE_SENTINEL.length + 1];
    if (ver !== 0x01 || len === undefined || at + FUSE_SENTINEL.length + 2 + len !== end) break;
    run.push(at);
    end = at;
  }
  if (run.length === 0) return unchanged;
  run.reverse(); // ascending offsets

  const realElsewhere = input.subarray(0, run[0]).includes(FUSE_SENTINEL);
  const removed = realElsewhere ? run : run.slice(1);
  if (removed.length === 0) return unchanged;
  const decoyMarked = removed.some((at) => {
    const len = input[at + FUSE_SENTINEL.length + 1]!;
    return input.subarray(at + FUSE_SENTINEL.length + 2, at + FUSE_SENTINEL.length + 2 + len).includes(DECOY_STATE);
  });
  // A single trailing record with no decoy marker could be a legitimately odd binary: leave it.
  if (removed.length < 2 && !decoyMarked) return unchanged;

  findings.add(
    "exhaust",
    "decoy-fuse-sentinels",
    "removed decoy Electron fuse sentinel records appended at EOF (sentinel-limit flood)",
    removed.length,
  );
  return { output: Buffer.from(input.subarray(0, removed[0])), findings, warnings: [], changed: true };
};
