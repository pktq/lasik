# Benchmark

LASIK is measured on BLA's own CrackMe challenges, v6 to v9: the hardened files BLA's maintainers published as targets, at `bankrupt` intensity (BLA 3.x). They are vendored unchanged in [`bench/bla-crackme`](../bench/bla-crackme) under BLA's MIT licence.

Reproduce:

```bash
npm ci && npm run build
node dist/cli.js bench bench/bla-crackme
```

<img src="assets/scan.svg" alt="lasik scan on the CrackMe corpus" width="100%" />

## Results

| Artifact | Format | Before | After | Tokens before → after | Reduction |
|---|---|---:|---:|---:|---:|
| `v6/core.wasm.gz` | wasm | 17.7 KB (6.9 MB raw) | 0.1 KB | 6,880,354 → 98 | 70,207× |
| `v6/panel.html` | html | 124.9 KB | 1.9 KB | 32,035 → 476 | 67× |
| `v6/vault.cjs` | javascript | 160.7 KB | 5.5 KB | 42,600 → 1,481 | 29× |
| `v7/cli/meridian.cjs` | javascript | 169.7 KB | 3.4 KB | 44,897 → 867 | 52× |
| `v7/core/expr.cjs` | javascript | 147.2 KB | 8.2 KB | 39,135 → 2,111 | 19× |
| `v7/core/license.cjs` | javascript | 169.4 KB | 12.1 KB | 44,823 → 3,091 | 15× |
| `v7/core/stats.cjs` | javascript | 125.2 KB | 1.6 KB | 33,515 → 404 | 83× |
| `v7/core/units.cjs` | javascript | 131.8 KB | 2.1 KB | 35,191 → 541 | 65× |
| `v8/core.wasm.gz` | wasm | 20.9 KB (6.9 MB raw) | 1.8 KB | 6,883,663 → 3,506 | 1,963× |
| `v8/license.cjs` | javascript | 221.2 KB | 5.6 KB | 58,120 → 1,445 | 40× |
| `v8/panel.html` | html | 119.7 KB | 1.3 KB | 30,708 → 331 | 93× |
| `v9/core.wasm.gz` | wasm | 20.9 KB (6.9 MB raw) | 1.8 KB | 6,883,604 → 3,496 | 1,969× |
| `v9/license.cjs` | javascript | 196.4 KB | 6.2 KB | 52,019 → 1,600 | 33× |
| `v9/panel.html` | html | 123.3 KB | 1.2 KB | 31,594 → 299 | 106× |
| `v9/policy.py` | python | 40.6 KB | 0.5 KB | 10,453 → 133 | 79× |
| **Total** | | **1.75 MB** | **58 KB** | **21.1 M → 22 k** | **958×** |

Across the corpus LASIK folds 3,011 opaque predicates, removes 3,432 dead branches, re-joins 2,465 split literals, deletes 1,487 decoy declarations and 750 decoy WASM exports, decrypts every XOR string table, cuts 11 anti-strip interlocks and 5 self-seals, and finds 24 distinct AI-evasion techniques. A file takes about 0.3 s.

## Method and caveats

- **Tokens are estimates**, not measured agent or REA runs: about 4 characters per token for code, 2 for hex/base64 runs, and 1 per byte for binaries (what an agent pays to read a hex dump). WASM is counted at its decompressed size, which is what analysers parse.
- **Correctness is established statically**: exact proofs for every fold, plus structural comparison with the clean templates BLA publishes next to some CrackMes (the healed v6 panel is the template's `derive()` line for line). LASIK does not execute the targets.
- **No solves are published.** LASIK makes each CrackMe readable; recovering keys and flags is left to the player.
