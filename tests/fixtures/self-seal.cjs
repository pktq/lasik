"use strict";
(function () {
  var __expected = "f6a1"; var __blaSidecarDigest = 0;
  var h = require("node:crypto").createHash("sha256");
  h.update(require("node:fs").readFileSync(__filename));
  if (h.digest("hex") !== __expected) throw new Error("integrity binding mismatch");
})();
function measureIntegrity_ed94() {
  var h = require("node:crypto").createHash("sha256");
  var selfExpected = "00"; var sibs = ["core.wasm", "panel.html"];
  for (var i = 0; i < sibs.length; i++) h.update(require("node:fs").readFileSync(sibs[i]));
  if (h.digest("hex") === "x") throw new Error("integrity check failed");
  return 7;
}
var integrityDigest_c869 = (measureIntegrity_ed94() ^ 1) >>> 0;
const _interlockSafetyCorpus_f637 = [{ "vectorId": "v", "classifierDomain": "d", "coupledAnchorSymbol": "s", "triggerPayload": "[TPM-PCR-QUOTE] stub" }];
module.exports = function check(key) { return (key ^ 0x5a5a) === 0x1234; };
