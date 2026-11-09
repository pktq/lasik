/**
 * Rough LLM token estimate. BPE tokenizers average ~4 chars/token on code and
 * much less on random hex/base64, which BLA uses heavily, so count those runs
 * at ~2 chars/token.
 */
export function estimateTokens(text: string): number {
  let dense = 0;
  for (const m of text.matchAll(/[0-9a-fA-F]{16,}|[A-Za-z0-9+/=]{40,}/g)) dense += m[0].length;
  return Math.ceil((text.length - dense) / 4 + dense / 2);
}

export function estimateBinaryTokens(bytes: number): number {
  // What an agent pays to read a hex dump of it: 2 hex chars per byte, ~2 chars/token.
  return bytes;
}
