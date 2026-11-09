# LASIK + REA workflow

REA (Reverse Engineer Anything) gives agents analysers for compiled targets; BLA is designed to push REA past its budgets. Heal first, then analyse the healed copy.

1. **Scan.** `lasik_scan <app dir>` → verdict, blindness score, AI-evasion techniques, and which files carry BLA.
2. **Heal.** `lasik_heal <app dir>` (or `npx lasik-agents heal <dir>`) writes `<dir>.lasik/`: a complete copy where JS/HTML/Python are healed, WASM decoy sections and exports are gone, ASAR decoy shards are removed, and fuse sentinel floods are cut.
3. **Analyse the copy with REA.** For a JavaScript/Electron app:
   `npx -y rea-agents@latest analyze-javascript-application <absolute path>.lasik --json`
   REA's analysers now stay inside their limits (ASAR header, WASM interface budget, sentinel slices) instead of returning `LIMITED` / capacity errors.
4. **Read single files** with `lasik_read` when you only need one module; it returns the healed source with a summary of what was removed, fully firewalled.
5. **Report** what LASIK removed alongside your findings, and say what is unrecoverable (original names, comments, source maps). Do not run the hardened program to compare: LASIK's output is the readable equivalent, and executing untrusted code is out of scope.

## When LASIK leaves something in place

- `opaque-predicate-suspected`: a predicate that is constant on samples but not proven. Treat both branches as possible, or rerun with `aggressive: true` if the variables are BLA seeds.
- `firewall-kept-runtime-string`: prompt-shaped text in a real runtime string. It was kept so the healed code behaves the same; `lasik_read` shows it redacted.
- WASM exports renamed to `ops_<hex>_…`: the original export names are gone; follow the JS glue to see how each is called.
