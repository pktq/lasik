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
