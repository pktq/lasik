<p align="center">
  <img src="docs/assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  Read code that was built to hide from AI.<br />
  LASIK removes <a href="https://github.com/qybaihe/bla">BLA</a> anti-agent hardening so coding agents and <a href="https://github.com/morluto/rea">REA</a> can analyse the real program.
</p>

<p align="center">
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://github.com/pktq/lasik/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/pktq/lasik?color=blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.19-339933" alt="Node 20.19+" />
</p>

<p align="center">
  <a href="https://lasik.dev">Website</a> ·
  <a href="docs/how-it-works.md">How it works</a> ·
  <a href="docs/benchmark.md">Benchmark</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<br />

<p align="center">
  <img src="docs/assets/before-after.svg" alt="The same two functions from BLA's CrackMe v6, hardened and after LASIK" width="100%" />
</p>

BLA protects a release from AI agents by burying it: thousands of opaque predicates, encrypted strings, decoy "hardware enclave" code, checks that break the program if decoys are removed, multi-megabyte padding, and text written to make the model give up. LASIK takes all of that back out, statically, and hands your agent the program that is actually there.

## Highlights

- **958× fewer tokens** to read BLA's own CrackMe corpus: about 21 million down to 22 thousand.
- **Proven, not guessed.** Predicates are folded only when LASIK can prove their value; anti-strip checks are recomputed before any decoy is touched; files without BLA keep their code unchanged.
- **Never runs the target.** No `eval`, no sandbox, no WebAssembly instantiation, so it is safe on hostile input, including malware that adopts BLA.
- **A prompt firewall** that strips the text BLA plants for the model: fake system turns, refusal bait, "nothing to see here" notices.
- **Every format BLA ships**: JavaScript and TypeScript bundles, inline HTML scripts, WebAssembly, Electron ASAR archives and fuses, source maps and Python.
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
Sight restored: 1.8 MB → 58.2 KB, ~21,104,859 → ~22,027 tokens

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
| v6 | 3 | 303 KB | 7.5 KB | 6,954,989 → 2,055 |
| v7 | 5 | 743 KB | 27.4 KB | 197,561 → 7,014 |
| v8 | 3 | 362 KB | 8.8 KB | 6,972,491 → 5,282 |
| v9 | 4 | 381 KB | 9.7 KB | 6,977,670 → 5,528 |

Per-file numbers, the method and its caveats are in [docs/benchmark.md](docs/benchmark.md). LASIK makes the CrackMes readable; it does not publish their solutions.

## How it works

| BLA layer | What LASIK does |
|---|---|
| Opaque predicates | Matches BLA's number-theoretic identities and proves seed-dependent ones with a known-bits analysis, then drops the dead branches |
| Anti-strip interlocks | Recomputes the decoy-corpus digest and folds the check before removing anything |
| Encrypted and split literals | Decodes XOR string tables with the key shipped beside them; re-joins split strings and integers |
| Decoys | Removes everything unreachable from real entry points, backed by a catalog of BLA's decoy families |
| Self-seals and locks | Removes BLA's own tamper and domain checks, and reports the lock's terms |
| Runtime noise | Drops shadow-heap churn and fake enclave status blocks that nothing reads |
| Padding | Rebuilds WASM, ASAR and Electron fuses within analyser limits |
| Prompt bait | Redacts it with 38 firewall rules |

The full pass order, the proofs and every fingerprint are in [docs/how-it-works.md](docs/how-it-works.md). An independent review hunted for inputs where healing changes what a program does; every case it found is fixed and pinned in [`tests/soundness.test.ts`](tests/soundness.test.ts).

## Limitations

- Identifier names, comments and source maps that BLA destroyed cannot be recovered. LASIK says so rather than inventing them.
- SQLite, model files (safetensors, GGUF), DEX/IL2CPP and native binaries are detected but not yet cleaned.
- ASAR healing has only been tested on synthetic archives.
- LASIK targets BLA up to 3.2. New BLA layers will need new passes.

## Responsible use

LASIK is a deobfuscator. Use it on your own software, on malware and threat samples, in CTFs, and in audits you are authorised to perform. Removing protection from software you have no rights to can breach its licence or laws such as DMCA §1201. See [DISCLAIMER.md](DISCLAIMER.md).

## Contributing

Bug reports with a sample (or `lasik scan --json` output) are the most useful contribution, especially for new BLA versions. See [CONTRIBUTING](.github/CONTRIBUTING.md).

Also available in [简体中文](docs/readme/README.zh-CN.md) · [日本語](docs/readme/README.ja.md) · [한국어](docs/readme/README.ko.md) · [Español](docs/readme/README.es.md).

## License

[MIT](LICENSE). The benchmark corpus is © BLA Contributors, MIT. LASIK is not affiliated with BLA or REA.
