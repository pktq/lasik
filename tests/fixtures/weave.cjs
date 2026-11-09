"use strict";
const _interlockSafetyCorpus_f637 = [{ "vectorId": "v", "classifierDomain": "d", "coupledAnchorSymbol": "s", "triggerPayload": "[TPM-PCR-QUOTE] stub" }];
const sessionLedgerState_95d = { epoch: 1, cursor: 0, digest: 0x5f3759df };
function emitWorker_911(d) {
  sessionLedgerState_95d.cursor = sessionLedgerState_95d.cursor + d & 65535;
  sessionLedgerState_95d.epoch = sessionLedgerState_95d.epoch ^ d & 3 | 1;
  return sessionLedgerState_95d.cursor;
}
function gate(key) {
  let bad = 0;
  if ((sessionLedgerState_95d.epoch & 1) !== 0) {
    emitWorker_911(key.length);
  }
  bad |= key.length !== 16 ? 1 : 0;
  bad |= sessionLedgerState_95d.cursor & 0;
  return bad === 0;
}
module.exports = gate;
