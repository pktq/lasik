# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-11-09

### Added

- `npm run bench:real`: benchmark on a project hardened with the published `bla-agents@3.2.1` (21 formats, default and all opt-in runs), in `docs/benchmark.md` and the README, checked in CI.
- README badges.

### Changed

- Package homepage and MCP registry URL point at the GitHub repo; the website deploy is manual until the site is published.

### Fixed

- The BLA coverage ledger (`coverage/bla.json`) is committed; it was caught by the `coverage/` ignore rule.
- Real-output SQLite read-back skips on Node 20, which has no `node:sqlite`.

## [0.2.0] - 2026-11-09

Full parity with BLA 3.2.1: every file in BLA's `src/` is accounted for in `coverage/bla.json`.

### Added

- Format healers: native ELF/PE/Mach-O (BLA trailer, Go/Flutter plants, compiled header strings), Bun standalone, UF2 firmware, SQLite (pure byte-level), safetensors, GGUF, PCAP, Erlang BEAM, EVM, JVM class, .NET, GPU PTX, ZIP/JAR/APK (with nested DEX/class/plist/IL2CPP), DEX, Android binary XML, Apple plist, IL2CPP metadata, Python `.pyc`.
- Python `.py` healer rebuilt on a tokenizer with exact BLA templates; interlocks cut before decoys.
- `nested-modules` pass: heals BLA modules hardened per module inside esbuild bundles.
- Prompt firewall: 40 rules (evidence lures, fake toolchain diagnostics, fixed canary URL shape).
- `coverage/bla.json` + `scripts/bla-coverage.mjs` (`check`, `pin`, `docs`), generated `docs/coverage.md`, and a weekly `BLA drift` workflow that opens an issue when upstream BLA changes.
- Verified on real `bla-agents@3.2.1` output (`tests/fixtures/bla-3.2.1`, default and all-opt-in runs over 21 formats): every file healed, no BLA marker or prompt decoy left, 10 formats restored byte for byte, SQLite schema and rows identical, `.pyc` code objects identical.
- Name recovery: BLA-renamed bindings get back the key they are exported or `require`-destructured under; other BLA names become neutral `p0`/`v0`/`f0`.
- README redesign with SVG diagrams (flow, pipeline, before/after, token chart) and a generated coverage table.

### Fixed

- A runtime-decoy block, self-seal or bind-scope lock inside an IIFE/bundler wrapper no longer deletes the whole wrapper with the real code in it.
- ZIP shadow modules matched with BLA's real 6-hex suffix; plain native `.exe`/`.dll` no longer labelled .NET.
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
