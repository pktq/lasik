import type { Findings } from "../core/types.js";

export interface FormatHealOptions {
  /** Fold/strip heuristically detected (not fingerprint-proven) BLA artifacts too. */
  aggressive?: boolean;
}

export interface FormatHealResult {
  /** Healed bytes (identical to input when nothing changed). */
  output: Buffer;
  findings: Findings;
  warnings: string[];
  changed: boolean;
}

/** Heal one artifact of a given format. Must never execute the input. */
export type FormatHealer = (input: Buffer, file: string, opts: FormatHealOptions) => FormatHealResult;
