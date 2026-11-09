# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-09

First release. Targets BLA up to 3.2.

### Added

- Static de-blinding engine that never executes the target.
- JavaScript passes: corpus-interlock cutting, opaque-predicate folding (BLA's four families plus a known-bits prover), dead-branch elimination, split-literal re-joining, weave-invariant folding, private-state sink removal, XOR string-table decryption, self-seal and sidecar removal, bind-scope reporting, runtime-deception removal, reachability tree-shaking, scrambled-comment stripping, `require` handle renaming.
- Opt-in `--aggressive` sampling, restricted to top-level constants.
- Format healers: WebAssembly (incl. `.wasm.gz`), ASAR, Electron fuses, honey source maps, HTML inline scripts.
- Prompt firewall with 38 rules in six categories; behaviour-preserving in `heal`, strict in `lasik_read` / `--strict-firewall`.
- "AI-evasion techniques found: N" risk signal in every report.
- Soundness hardening after an independent review: 15 behaviour-changing counterexamples fixed and pinned as regression tests.
- Blindness score (0-100) and `clean` / `suspected` / `blinded` verdicts.
- CLI: `scan`, `heal`, `firewall`, `bench`, `setup`, `doctor`, `mcp`; `--json`, `--md`, `--fail-on` (exit 3).
- MCP server with `lasik_scan`, `lasik_read`, `lasik_heal`, `lasik_firewall`, and an agent skill.
- `lasik setup` registration for common coding agents.
- Library API (`run`, `healJs`, `firewallText`).
- Benchmark against BLA's published CrackMes (v6-v9).
- Python healing (text-structural): tarpit guards, private-slot writes and the prepended prelude; detection only for SQLite, safetensors/GGUF, DEX/IL2CPP and native binaries.
