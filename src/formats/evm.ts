import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

export const isEvm = (file: string, _head: Buffer): boolean => /\.(evm|bin-evm|solidity-bin|evm\.bin)$/i.test(file);

const JUMPDEST = 0x5b;
const MAX_PAD = 64 * 1024;
/** REA's 4 MiB input budget minus the 4096 slack BLA's "bankrupt" mode pads up to. */
const BANKRUPT_LEN = 4 * 1024 * 1024 - 4096;

/**
 * BLA appends a Solidity-style CBOR metadata trailer carrying `[BLA-EVM-SHIELD]`
 * and `bla_evm_canary`, optionally preceded by inert JUMPDEST padding
 * (evm-bytecode.ts). Both sit after the real code and any original metadata.
 */
export const healEvm: FormatHealer = (input) => {
  const findings = new Findings();
  const unchanged = { output: input, findings, warnings: [] as string[], changed: false };
  if (input.length < 3) return unchanged;
  const len = input.readUInt16BE(input.length - 2);
  const start = input.length - 2 - len;
  if (len === 0 || start <= 0 || input[start]! >> 5 !== 5) return unchanged;
  const tail = input.toString("utf8", start, input.length - 2);
  if (!tail.includes("[BLA-EVM-SHIELD]") || !tail.includes("bla_evm_canary")) return unchanged;

  let run = 0;
  while (start - run > 0 && input[start - run - 1] === JUMPDEST) run++;
  // Padding is 64 KiB (maximum) or fills the file to a fixed length (bankrupt); balanced has none.
  const pad = input.length === BANKRUPT_LEN ? run : run >= MAX_PAD ? MAX_PAD : 0;

  findings.add("deceive", "evm-metadata-trailer", "removed BLA canary CBOR metadata trailer appended after the contract code", 1);
  findings.add("exhaust", "evm-jumpdest-padding", "removed inert JUMPDEST padding between the code and the BLA trailer", pad);
  const warnings = pad ? ["trailing JUMPDEST run removed as padding; a final JUMPDEST that belonged to the original code cannot be told apart (it is inert at the end)"] : [];
  return { output: Buffer.from(input.subarray(0, start - pad)), findings, warnings, changed: true };
};
