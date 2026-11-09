/** Body of BLA 3.2.1's corpus digest function (as emitted in tests/fixtures/bla-3.2.1), after its length guard. */
export const DIGEST_BODY = (corpus: string): string => `
  let acc = ((seedInput | 0) ^ 0x26b5c67b) >>> 0;
  for (let i = 0; i < ${corpus}.length; i++) {
    const entry = ${corpus}[i];
    if (!entry || typeof entry.coupledAnchorSymbol !== "string" || typeof entry.triggerPayload !== "string") return 0;
    const text = entry.coupledAnchorSymbol + "::" + entry.triggerPayload;
    for (let j = 0; j < text.length; j++) {
      acc = Math.imul(acc ^ text.charCodeAt(j), 0x85ebca6b) >>> 0;
      acc = (acc << 13 | acc >>> 19) >>> 0;
    }
  }
  return acc >>> 0;`;
