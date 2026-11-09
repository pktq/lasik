# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Full parity with BLA 3.2.1: every file in BLA's `src/` is accounted for in `coverage/bla.json`.

### Added

- Format healers: native ELF/PE/Mach-O (BLA trailer, Go/Flutter plants, compiled header strings), Bun standalone, UF2 firmware, SQLite (pure byte-level), safetensors, GGUF, PCAP, Erlang BEAM, EVM, JVM class, .NET, GPU PTX, ZIP/JAR/APK (with nested DEX/class/plist/IL2CPP), DEX, Android binary XML, Apple plist, IL2CPP metadata, Python `.pyc`.
- Python `.py` healer rebuilt on a tokenizer with exact BLA templates; interlocks cut before decoys.
- `nested-modules` pass: heals BLA modules hardened per module inside esbuild bundles.
- Prompt firewall: 40 rules (evidence lures, fake toolchain diagnostics, fixed canary URL shape).
- `coverage/bla.json` + `scripts/bla-coverage.mjs` (`check`, `pin`, `docs`), generated `docs/coverage.md`, and a weekly `BLA drift` workflow that opens an issue when upstream BLA changes.
- README redesign with SVG diagrams (flow, pipeline, before/after, token chart) and a generated coverage table.

### Fixed

- A runtime-decoy block, self-seal or bind-scope lock inside an IIFE/bundler wrapper no longer deletes the whole wrapper with the real code in it.
- Soft-fold sidecar preambles are stripped; literal `eval` strings no longer block decoy removal; folding refuses when `Math` is a local binding.

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
