"use strict";
const _interlockSafetyCorpus_f637 = [{ "vectorId": "v", "classifierDomain": "d", "coupledAnchorSymbol": "s", "triggerPayload": "[TPM-PCR-QUOTE] stub" }];
var _t_ab1 = ["16,9,19,91,90,85".split(",").map(Number), "15,8,17,12,1,16,4,95,2,10,26".split(",").map(Number)];
var _k_ab1 = "99,97,114,105,111".split(",").map(Number);
function blaS_ab1(i) {
  var e = _t_ab1[i], k = _k_ab1, o = new Uint8Array(e.length);
  for (var j = 0; j < e.length; j++) o[j] = (e[j] ^ k[j % k.length]) & 255;
  return typeof Buffer !== "undefined" ? Buffer.from(o).toString("utf8") : new TextDecoder().decode(o);
}
var _blaS = blaS_ab1;
module.exports = { a: blaS_ab1(0), b: _blaS(1) };
