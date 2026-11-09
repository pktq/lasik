# Benchmark

LASIK is measured on BLA's own CrackMe challenges, v6 to v9: the hardened files BLA's maintainers published as targets, at `bankrupt` intensity (BLA 3.x). They are vendored unchanged in [`bench/bla-crackme`](../bench/bla-crackme) under BLA's MIT licence.

Reproduce:

```bash
npm ci && npm run build
node dist/cli.js bench bench/bla-crackme
```

<img src="assets/tokens.svg" alt="Estimated tokens per CrackMe artifact before and after LASIK, log scale" width="100%" />

<img src="assets/scan.svg" alt="lasik scan on the CrackMe corpus" width="100%" />

## Results

| Artifact | Format | Before | After | Tokens before → after | Reduction |
|---|---|---:|---:|---:|---:|
| `v6/core.wasm.gz` | wasm | 17.7 KB | 0.1 KB | 6,880,354 → 98 | 70207.7× |
| `v6/panel.html` | html | 124.9 KB | 1.4 KB | 32,035 → 354 | 90.5× |
| `v6/vault.cjs` | javascript | 160.7 KB | 3.4 KB | 42,600 → 946 | 45.0× |
| `v7/cli/meridian.cjs` | javascript | 169.7 KB | 2.2 KB | 44,897 → 569 | 78.9× |
| `v7/core/expr.cjs` | javascript | 147.2 KB | 3.9 KB | 39,135 → 994 | 39.4× |
| `v7/core/license.cjs` | javascript | 169.4 KB | 5.9 KB | 44,823 → 1,524 | 29.4× |
| `v7/core/stats.cjs` | javascript | 125.2 KB | 0.6 KB | 33,515 → 154 | 217.6× |
| `v7/core/units.cjs` | javascript | 131.8 KB | 0.9 KB | 35,191 → 242 | 145.4× |
| `v8/core.wasm.gz` | wasm | 20.9 KB | 1.8 KB | 6,883,663 → 3,506 | 1963.4× |
| `v8/license.cjs` | javascript | 221.2 KB | 3.6 KB | 58,120 → 911 | 63.8× |
| `v8/panel.html` | html | 119.7 KB | 1.3 KB | 30,708 → 331 | 92.8× |
| `v9/core.wasm.gz` | wasm | 20.9 KB | 1.8 KB | 6,883,604 → 3,496 | 1969.0× |
| `v9/license.cjs` | javascript | 196.4 KB | 3.9 KB | 52,019 → 1,013 | 51.4× |
| `v9/panel.html` | html | 123.3 KB | 1.2 KB | 31,594 → 299 | 105.7× |
| `v9/policy.py` | python | 40.6 KB | 0.5 KB | 10,453 → 133 | 78.6× |
| **Total** | | **1.75 MB** | **37 KB** | **21.1 M → 17 k** | **1,262×** |

Across the corpus LASIK folds 3,011 opaque predicates, removes 3,432 dead branches, re-joins 2,465 split literals, deletes 1,487 decoy declarations and 750 decoy WASM exports, decrypts every XOR string table, cuts 11 anti-strip interlocks and 5 self-seals, and finds 24 distinct AI-evasion techniques. A file takes about 0.3 s.

## Method and caveats

- **Tokens are estimates**, not measured agent or REA runs: about 4 characters per token for code, 2 for hex/base64 runs, and 1 per byte for binaries (what an agent pays to read a hex dump). WASM is counted at its decompressed size, which is what analysers parse.
- **Correctness is established statically**: exact proofs for every fold, plus structural comparison with the clean templates BLA publishes next to some CrackMes (the healed v6 panel is the template's `derive()` line for line). LASIK does not execute the targets.
- **No solves are published.** LASIK makes each CrackMe readable; recovering keys and flags is left to the player.

<!-- realbench:start -->
## Your own code, hardened by real BLA 3.2.1

Twenty-one small clean files, one per format (BLA's own JS/TS/Python examples plus generated SQLite, models, PCAP, binaries and more), hardened with the published `bla-agents@3.2.1` and then healed. Originals, BLA's output and how they were made: [tests/fixtures/bla-3.2.1](../tests/fixtures/bla-3.2.1). Reproduce: `npm run build && npm run bench:real`.

*byte-identical*: LASIK restored the original file exactly. *healed*: every BLA artifact is gone and the program is the same, but bytes differ (BLA renamed identifiers, re-serialised a header, or dropped a trailing newline).

### Default run

`bla harden .` (defaults, bankrupt intensity)

| File | Format | Original | BLA-hardened | After LASIK | Tokens before → after | Result |
|---|---|---:|---:|---:|---:|---|
| `Info.plist` | plist | 0.3 KB | 2.8 KB | 0.3 KB | 2,885 → 303 | healed |
| `Pricing.class` | jvm | 0.5 KB | 12.1 KB | 0.5 KB | 12,432 → 530 | byte-identical |
| `Pricing.dll` | dotnet | 3.5 KB | 10.9 KB | 3.5 KB | 11,174 → 3,584 | byte-identical |
| `add.wasm` | wasm | 0.0 KB | 6.6 MB | 0.1 KB | 6,880,181 → 75 | healed |
| `app.asar` | asar | 0.1 KB | 17.2 MB | 0.3 KB | 18,007,508 → 331 | healed |
| `app.js.map` | sourcemap | 0.1 KB | 2.3 KB | 0.1 KB | 589 → 17 | healed |
| `bundle.zip` | zip | 0.1 KB | 8.9 KB | 0.1 KB | 9,117 → 132 | byte-identical |
| `capture.pcap` | pcap | 0.1 KB | 1.3 MB | 0.1 KB | 1,346,460 → 150 | byte-identical |
| `contract.evm` | evm | 0.0 KB | 4.0 MB | 0.0 KB | 4,190,208 → 23 | byte-identical |
| `electron-bridge.js` | javascript | 1.3 KB | 211.1 KB | 0.9 KB | 55,497 → 224 | healed |
| `firmware.uf2` | uf2 | 1.0 KB | 137.0 KB | 1.0 KB | 140,288 → 1,024 | byte-identical |
| `hello.exe` | native | 133.0 KB | 1.2 MB | 133.0 KB | 1,301,047 → 136,192 | byte-identical |
| `index.html` | html | 0.2 KB | 121.7 KB | 0.3 KB | 31,190 → 70 | healed |
| `kernel.ptx` | ptx | 0.3 KB | 25.9 KB | 0.3 KB | 6,640 → 69 | byte-identical |
| `license-validator.ts` | javascript | 1.2 KB | 131.9 KB | 0.8 KB | 35,210 → 205 | healed |
| `local.sqlite` | sqlite | 8.0 KB | 52.0 KB | 8.0 KB | 53,248 → 8,192 | healed |
| `model.safetensors` | safetensors | 0.1 KB | 9.9 KB | 0.1 KB | 10,120 → 72 | byte-identical |
| `pricing_engine.py` | python | 0.6 KB | 39.4 KB | 0.6 KB | 10,162 → 152 | healed |
| `pricing_engine.pyc` | pyc | 0.6 KB | 8.0 KB | 0.6 KB | 8,240 → 573 | byte-identical |
| `sound-pan.js` | javascript | 0.7 KB | 127.7 KB | 0.3 KB | 34,136 → 79 | healed |
| `tiny.gguf` | gguf | 0.1 KB | 7.6 KB | 0.1 KB | 7,744 → 105 | byte-identical |
| **Total** | | **151.9 KB** | **31.1 MB** | **150.9 KB** | **32,154,076 → 152,102** | **21/21 healed, 11 byte-identical** |

### All opt-in layers

`bla harden . --weave-decoys --self-seal --llm-directives`

| File | Format | Original | BLA-hardened | After LASIK | Tokens before → after | Result |
|---|---|---:|---:|---:|---:|---|
| `Info.plist` | plist | 0.3 KB | 2.8 KB | 0.3 KB | 2,885 → 303 | healed |
| `Pricing.class` | jvm | 0.5 KB | 13.1 KB | 0.5 KB | 13,410 → 530 | byte-identical |
| `Pricing.dll` | dotnet | 3.5 KB | 11.9 KB | 3.5 KB | 12,218 → 3,584 | byte-identical |
| `add.wasm` | wasm | 0.0 KB | 6.6 MB | 0.1 KB | 6,881,232 → 74 | healed |
| `app.asar` | asar | 0.1 KB | 17.2 MB | 0.3 KB | 18,015,771 → 331 | healed |
| `app.js.map` | sourcemap | 0.1 KB | 2.3 KB | 0.1 KB | 586 → 17 | healed |
| `bundle.zip` | zip | 0.1 KB | 9.5 KB | 0.1 KB | 9,714 → 132 | byte-identical |
| `capture.pcap` | pcap | 0.1 KB | 1.3 MB | 0.1 KB | 1,347,504 → 150 | byte-identical |
| `contract.evm` | evm | 0.0 KB | 4.0 MB | 0.0 KB | 4,190,208 → 23 | byte-identical |
| `electron-bridge.js` | javascript | 1.3 KB | 221.7 KB | 0.9 KB | 58,369 → 223 | healed |
| `firmware.uf2` | uf2 | 1.0 KB | 137.0 KB | 1.0 KB | 140,288 → 1,024 | byte-identical |
| `hello.exe` | native | 133.0 KB | 1.2 MB | 133.0 KB | 1,302,020 → 136,192 | byte-identical |
| `index.html` | html | 0.2 KB | 125.7 KB | 0.3 KB | 32,217 → 70 | healed |
| `kernel.ptx` | ptx | 0.3 KB | 25.9 KB | 0.3 KB | 6,640 → 69 | byte-identical |
| `license-validator.ts` | javascript | 1.2 KB | 135.7 KB | 0.8 KB | 36,192 → 205 | healed |
| `local.sqlite` | sqlite | 8.0 KB | 52.0 KB | 8.0 KB | 53,248 → 8,192 | healed |
| `model.safetensors` | safetensors | 0.1 KB | 9.9 KB | 0.1 KB | 10,088 → 72 | byte-identical |
| `pricing_engine.py` | python | 0.6 KB | 40.8 KB | 0.6 KB | 10,518 → 152 | healed |
| `pricing_engine.pyc` | pyc | 0.6 KB | 11.9 KB | 0.7 KB | 12,203 → 670 | healed |
| `sound-pan.js` | javascript | 0.7 KB | 131.5 KB | 0.3 KB | 35,098 → 79 | healed |
| `tiny.gguf` | gguf | 0.1 KB | 7.5 KB | 0.1 KB | 7,712 → 105 | byte-identical |
| **Total** | | **151.9 KB** | **31.2 MB** | **151.0 KB** | **32,178,121 → 152,197** | **21/21 healed, 10 byte-identical** |
<!-- realbench:end -->
