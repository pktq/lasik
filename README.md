<p align="center"><b>English</b> · <a href="docs/readme/README.zh-CN.md">简体中文</a> · <a href="docs/readme/README.ja.md">日本語</a> · <a href="docs/readme/README.ko.md">한국어</a> · <a href="docs/readme/README.es.md">Español</a></p>

<p align="center">
  <img src="docs/assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  Read code that was built to hide from AI.<br />
  LASIK removes <a href="https://github.com/qybaihe/bla">BLA</a> anti-agent hardening so coding agents and <a href="https://github.com/morluto/rea">REA</a> can analyse the real program.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lasik-agents"><img src="https://img.shields.io/npm/v/lasik-agents?style=for-the-badge&label=npm&color=22d3ee" alt="npm version" /></a>
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pktq/lasik/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="docs/coverage.md"><img src="https://img.shields.io/badge/BLA_3.2.1-59%2F63_shields_healed-22d3ee?style=for-the-badge" alt="BLA coverage" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="docs/how-it-works.md">How it works</a> ·
  <a href="docs/benchmark.md">Benchmark</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<br />

<p align="center">
  <img src="docs/assets/before-after.svg" alt="The same two functions from BLA's CrackMe v6, hardened and after LASIK" width="100%" />
</p>

BLA protects a release from AI agents by burying it: thousands of opaque predicates, encrypted strings, decoy "hardware enclave" code, checks that break the program if decoys are removed, multi-megabyte padding, and text written to make the model give up. LASIK takes all of that back out, statically, and hands your agent the program that is actually there.

<p align="center"><img src="docs/assets/flow.svg" alt="A BLA-hardened release goes through lasik heal, then an agent or REA reads the real logic" width="100%" /></p>

## Highlights

- **1,262× fewer tokens** to read BLA's own CrackMe corpus: about 21 million down to 17 thousand.
- **Proven, not guessed.** Predicates are folded only when LASIK can prove their value; anti-strip checks are recomputed before any decoy is touched; files without BLA keep their code unchanged.
- **Never runs the target.** No `eval`, no sandbox, no WebAssembly instantiation, so it is safe on hostile input, including malware that adopts BLA.
- **A prompt firewall** that strips the text BLA plants for the model: fake system turns, refusal bait, "nothing to see here" notices.
- **Every format BLA ships**, checked against real BLA 3.2.1 output: JavaScript and TypeScript bundles, inline HTML, WebAssembly, Electron ASAR and fuses, source maps, Python and `.pyc`, native ELF/PE/Mach-O, Bun, SQLite, safetensors and GGUF, PCAP, JVM, .NET, BEAM, EVM, PTX, ZIP/APK/DEX, plists, IL2CPP and UF2 firmware.
- **Names back where the program publishes them**: a function BLA renamed to `primeSparseStack_719` but exports as `clampPan` is `clampPan` again; other BLA names become neutral `p0`, `v0` instead of misleading ones.
- **Keeps up with BLA**: every BLA source file is hashed in [coverage/bla.json](coverage/bla.json), and a weekly job opens an issue the moment BLA changes.
- **Built for agents**: a CLI, an MCP server for Claude Code, Cursor, Codex and seven more, and a library API.

## Installation

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

Requires Node.js 20.19 or later. To build from source: `git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`.

## Usage

Scan a build to see what BLA did to it, then write a cleaned copy:

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 37.5 KB, ~21,104,859 → ~16,718 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

Point your agent, or REA, at the healed copy:

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

Other commands: `lasik firewall` (redact prompt decoys from any text), `lasik bench`, `lasik doctor`. Add `--json` or `--md` for machine-readable reports and `--fail-on blinded` to gate CI.

### In your coding agent

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| Tool | |
|---|---|
| `lasik_scan` | Which BLA layers a file or folder carries, a 0–100 blindness score and the AI-evasion techniques found |
| `lasik_read` | One file with BLA removed, for the agent to read instead of the original |
| `lasik_heal` | A cleaned copy of a whole app, ready for REA |
| `lasik_firewall` | Planted instructions redacted from any text |

The repository also ships an [agent skill](.agents/skills/lasik/SKILL.md) that teaches an agent to recognise BLA and reach for these tools.

## Benchmark

Measured on the CrackMes BLA's maintainers published as challenges, vendored unchanged in [`bench/bla-crackme`](bench/bla-crackme):

| CrackMe | Files | Before | After | Tokens (estimated) |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 4.9 KB | 6,954,989 → 1,398 |
| v7 | 5 | 743 KB | 13.6 KB | 197,561 → 3,483 |
| v8 | 3 | 362 KB | 6.7 KB | 6,972,491 → 4,748 |
| v9 | 4 | 381 KB | 7.4 KB | 6,977,670 → 4,941 |

<p align="center"><img src="docs/assets/tokens.svg" alt="Log-scale bar chart: estimated tokens per BLA CrackMe artifact before and after LASIK" width="100%" /></p>

<!-- realbench:start -->
On a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](docs/benchmark.md#your-own-code-hardened-by-real-bla-321)):

| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |
|---|---:|---:|---:|---:|---|---|
| Defaults | 21 | 151.9 KB | 31.1 MB | 150.9 KB | 32,154,076 → 152,102 | 21/21 healed, 11 byte-identical |
| All opt-in layers | 21 | 151.9 KB | 31.2 MB | 151.0 KB | 32,178,121 → 152,197 | 21/21 healed, 10 byte-identical |
<!-- realbench:end -->

Per-file numbers, the method and its caveats are in [docs/benchmark.md](docs/benchmark.md). LASIK makes the CrackMes readable; it does not publish their solutions.

## How it works

<p align="center"><img src="docs/assets/pipeline.svg" alt="LASIK pass order: detect, cut interlocks, strip decoys, fold to a fixpoint, rename, firewall, report" width="100%" /></p>

| BLA layer | What LASIK does |
|---|---|
| Opaque predicates | Matches BLA's number-theoretic identities and proves seed-dependent ones with a known-bits analysis, then drops the dead branches |
| Anti-strip interlocks | Recomputes the decoy-corpus digest and folds the check before removing anything |
| Encrypted and split literals | Decodes XOR string tables with the key shipped beside them; re-joins split strings and integers |
| Decoys | Removes everything unreachable from real entry points, backed by a catalog of BLA's decoy families |
| Self-seals and locks | Removes BLA's own tamper and domain checks, and reports the lock's terms |
| Runtime noise | Drops shadow-heap churn and fake enclave status blocks that nothing reads |
| Renamed identifiers | Restores names the program exports or imports a binding under; neutral names for the rest |
| Padding and planted data | Strips BLA's sections, trailers, honey tables, decoy entries and floods from binaries, databases, models and archives, and rebuilds offsets and checksums so the file stays valid |
| Prompt bait | Redacts it with 40 firewall rules |

The full pass order, the proofs and every fingerprint are in [docs/how-it-works.md](docs/how-it-works.md). An independent review hunted for inputs where healing changes what a program does; every case it found is fixed and pinned in [`tests/soundness.test.ts`](tests/soundness.test.ts).

## Format coverage

<!-- coverage:start -->
Pinned to BLA **3.2.1**. 59/63 BLA shield files fully healed; 44 more emit nothing into artifacts. Full per-file table: [docs/coverage.md](docs/coverage.md).

| Surface | Status |
|---|---|
| .NET assembly | ✅ healed |
| Android APK | ✅ healed |
| Android DEX | ✅ healed |
| Apple plist | ✅ healed |
| Bun standalone | ✅ healed |
| Electron ASAR | ✅ healed |
| Erlang BEAM | ✅ healed |
| EVM bytecode | ✅ healed |
| Firmware UF2 | ✅ healed |
| GPU PTX | ✅ healed |
| JavaScript / HTML | 🟡 partial |
| JVM class | ✅ healed |
| Mobile game (DEX / IL2CPP) | ✅ healed |
| Native ELF / PE / Mach-O | 🟡 partial |
| PCAP | ✅ healed |
| Prompt text | ✅ healed |
| Python | ✅ healed |
| Safetensors / GGUF | ✅ healed |
| Sidecar entanglement | ✅ healed |
| Source maps | ✅ healed |
| SQLite | ✅ healed |
| WebAssembly | ✅ healed |
| ZIP / JAR / APK | ✅ healed |
<!-- coverage:end -->

## Limitations

- Local names, comments, source maps and the few sections BLA overwrote (a Go `.go.buildinfo`, renamed WASM exports) cannot be recovered. LASIK says so rather than inventing them.
- Format healers recognise BLA 3.2.1's output precisely. They are checked on real BLA output for 21 formats ([tests/fixtures/bla-3.2.1](tests/fixtures/bla-3.2.1)); Go, Flutter, Bun, BEAM, APK/DEX and IL2CPP so far only on fixtures built from BLA's source.
- When BLA changes, a healer can stop matching until it is updated. The weekly drift check names the file to revisit; the JavaScript core works by proof and does not depend on BLA's names.

## Responsible use

LASIK is a deobfuscator. Use it on your own software, on malware and threat samples, in CTFs, and in audits you are authorised to perform. Removing protection from software you have no rights to can breach its licence or laws such as DMCA §1201. See [DISCLAIMER.md](DISCLAIMER.md).

## Contributing

Bug reports with a sample (or `lasik scan --json` output) are the most useful contribution, especially for new BLA versions. See [CONTRIBUTING](.github/CONTRIBUTING.md).

Also available in [简体中文](docs/readme/README.zh-CN.md) · [日本語](docs/readme/README.ja.md) · [한국어](docs/readme/README.ko.md) · [Español](docs/readme/README.es.md).

## License

[MIT](LICENSE). The benchmark corpus is © BLA Contributors, MIT. LASIK is not affiliated with BLA or REA.
