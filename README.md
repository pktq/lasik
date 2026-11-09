<div align="center">

<img src="docs/assets/banner.svg" alt="LASIK: LLM Agent Sight In Kode" width="100%" />

# LASIK

### BLA blinds your agent. LASIK gives it its sight back.

**LLM Agent Sight In Kode**: a static de-blinding engine, CLI and MCP server that strips
[BLA](https://github.com/qybaihe/bla) (Blind LLM Agents) hardening so coding agents and
[REA](https://github.com/morluto/rea) can read the real program again.

[![npm](https://img.shields.io/npm/v/lasik-agents?color=0b7285&label=npm)](https://www.npmjs.com/package/lasik-agents)
[![CI](https://github.com/pktq/lasik/actions/workflows/ci.yml/badge.svg)](https://github.com/pktq/lasik/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.19-339933)](package.json)
[![MCP](https://img.shields.io/badge/MCP-server-7c3aed)](#-mcp-server)
[![Never runs the target](https://img.shields.io/badge/executes%20target%20code-never-success)](#-safety-model)

</div>

---

**REA** taught agents to reverse engineer anything. **BLA** answered by poisoning releases until those agents go bankrupt: opaque-predicate tarpits, XOR-encrypted strings, decoy "enclave" code, anti-strip interlocks, self-seals, 7 MB WebAssembly paddings and text written to make the model refuse.

**LASIK** is the corrective surgery. It proves BLA's predicates constant, decrypts what it hid, cuts its interlocks, drops its decoys and redacts its prompt bait, **without ever running the target**. Then your agent reads what the program actually does.

```text
                    ┌────────────┐      ┌────────────┐      ┌────────────┐
   your release ──▶ │    BLA     │ ──▶  │   LASIK    │ ──▶  │ REA / agent│ ──▶ the real logic
                    │ poison +   │      │ prove, fold│      │ reads 958× │
                    │ exhaust    │      │ decrypt,   │      │ fewer      │
                    └────────────┘      │ strip      │      │ tokens     │
                                        └────────────┘      └────────────┘
```

## 👓 Before / after

What an agent sees in BLA's own CrackMe v6 (one of ~3,000 opaque predicates in that file):

```js
// BLA-hardened (vault.cjs, 164 KB, 2,680 lines)
attestTransientCursor_e36 = require("fs"); …
traceLazyEdge_261.createHash(((Math.imul(runtimeSeedPrimaryHandle_be53 | 15, (runtimeSeedPrimaryHandle_be53 | 15) + 1) & 1) === 0 ? "s" : "b")
  + ((Math.imul(runtimeSeedPrimaryHandle_be53 ^ 124, runtimeSeedPrimaryHandle_be53 ^ 124) & 7) === 0 ? "1" : "h")
  + ((Math.imul(runtimeSeedPrimaryHandle_be53 | 123, (runtimeSeedPrimaryHandle_be53 | 123) + 1) & 1) === 0 ? "a" : "8") + …
```

```js
// after `lasik heal` (5.5 KB, 101 lines)
const fs = require("fs");
const crypto = require("crypto");
return crypto.createHash("sha256").update(input).digest("hex");
```

And on BLA's whole CrackMe corpus:

<img src="docs/assets/scan.svg" alt="lasik scan on BLA's CrackMe corpus: blindness 100/100, 21.1M tokens down to 22k" width="100%" />

## ⚡ 30-second quick start

```bash
# 1. How blind would an agent be?
npx lasik-agents scan ./dist

# 2. Write a cleaned copy next to it (./dist.lasik)
npx lasik-agents heal ./dist

# 3. Point REA (or any coding agent) at the healed copy
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

Give every coding agent on your machine the LASIK tools (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Windsurf, Antigravity, VS Code, Copilot CLI, OpenCode):

```bash
npx lasik-agents setup          # --dry-run to preview, --remove to undo
```

Requires Node.js ≥ 20.19. No native dependencies, no network calls.

## 📊 Results on BLA's own CrackMes

The benchmark corpus is BLA's published CrackMe outputs v6–v9 (MIT, vendored unchanged in [`bench/bla-crackme`](bench/bla-crackme)), hardened by BLA's own maintainers at `bankrupt` intensity. Reproduce with `npm run build && node dist/cli.js bench bench/bla-crackme`.

| Artifact | Format | Before | After | Tokens before → after | Cheaper |
|---|---|---:|---:|---:|---:|
| `v6/core.wasm.gz` | wasm | 17.7 KB (6.9 MB raw) | 0.1 KB | 6,880,354 → 98 | **70,207×** |
| `v6/panel.html` | html | 124.9 KB | 1.9 KB | 32,035 → 476 | 67.3× |
| `v6/vault.cjs` | javascript | 160.7 KB | 5.5 KB | 42,600 → 1,481 | 28.8× |
| `v7/cli/meridian.cjs` | javascript | 169.7 KB | 3.4 KB | 44,897 → 867 | 51.8× |
| `v7/core/expr.cjs` | javascript | 147.2 KB | 8.2 KB | 39,135 → 2,111 | 18.5× |
| `v7/core/license.cjs` | javascript | 169.4 KB | 12.1 KB | 44,823 → 3,091 | 14.5× |
| `v7/core/stats.cjs` | javascript | 125.2 KB | 1.6 KB | 33,515 → 404 | 83.0× |
| `v7/core/units.cjs` | javascript | 131.8 KB | 2.1 KB | 35,191 → 541 | 65.0× |
| `v8/core.wasm.gz` | wasm | 20.9 KB (6.9 MB raw) | 1.8 KB | 6,883,663 → 3,506 | 1,963× |
| `v8/license.cjs` | javascript | 221.2 KB | 5.6 KB | 58,120 → 1,445 | 40.2× |
| `v8/panel.html` | html | 119.7 KB | 1.3 KB | 30,708 → 331 | 92.8× |
| `v9/core.wasm.gz` | wasm | 20.9 KB (6.9 MB raw) | 1.8 KB | 6,883,604 → 3,496 | 1,969× |
| `v9/license.cjs` | javascript | 196.4 KB | 6.2 KB | 52,019 → 1,600 | 32.5× |
| `v9/panel.html` | html | 123.3 KB | 1.2 KB | 31,594 → 299 | 105.7× |
| `v9/policy.py` | python | 40.6 KB | 0.5 KB | 10,453 → 133 | 78.6× |
| **Total** | | **1.75 MB** | **58 KB** | **21.1 M → 22 k** | **958×** |

Across the corpus LASIK folds **3,011 opaque predicates**, removes **3,432 dead branches**, re-joins **2,465 split literals**, deletes **1,487 decoy declarations** and **750 decoy WASM exports**, decrypts every XOR string table, cuts **11 anti-strip interlocks** and **5 self-seals**, and redacts every prompt decoy. A run takes about 0.3 s per file.

The healed v6 panel script is the published template's `derive()` logic line for line (BLA's renamed locals aside). Token counts are estimates (≈4 chars/token for code, 2 for hex/base64, 1 per byte for binary).

> Spoiler policy: LASIK makes every CrackMe readable. It does not publish keys or flags. Solving them is still yours.

## 🧠 How it works

BLA stacks layers ("Poison → Exhaust → Hallucinate"). LASIK undoes each one statically, and says how sure it is.

| BLA layer | What BLA does | LASIK's countermove | Certainty |
|---|---|---|---|
| **Tarpit** | ~3k `Math.imul` opaque predicates choose real vs decoy for every string chunk, integer and statement | Matches BLA's 4 number-theoretic families (each is a proven identity over int32), then a **known-bits prover**: computes which bits of the runtime seed are fixed and enumerates only the bits a predicate depends on | **Exact proof** |
| **Entangle: interlock** | Seed's low bit = `digest(decoyCorpus) === N`, so deleting decoys flips every predicate | Re-implements the digest, recomputes it on the untouched corpus, folds the bit *before* removing anything | Exact |
| **Entangle: self-seal / sidecar** | File SHA-256s itself and its siblings and throws on any edit | Detected by shape and removed (its digests only fed bits LASIK already proved irrelevant) | Exact for BLA's shape |
| **Entangle: bind-scope** | Domain / date lock IIFE | Removed; the contract (domains, validity window) is reported | Fingerprint |
| **Encrypt** | `bla_encrypt_strings` XOR-keystream tables; strings and integers split into ≥9 opaque chunks | Decodes the table with the keystream that ships beside it; re-joins chunks once predicates fold | Exact |
| **Deceive** | ~140 injected blocks: honeypot credentials, fake gRPC enclaves, shadow business logic, call-graph labyrinths, BPE token sinks, regex magnets, decoy diagnostics, honey source maps, scrambled comments, `void [decoy]` keep-alive anchors | Reachability tree-shaking from real entry points after folding, plus a fingerprint catalog of 25 decoy families | Exact (reachability) |
| **Runtime** | Shadow-heap stepper woven into every function; "Truman show" blocks that serve fake enclave status to debuggers | Private-state sink analysis: functions that only mutate state nothing else reads are unobservable, so their calls go | Exact for closed state |
| **Weave** | Agent-written state slots guarding real code with `(slot.epoch & 1) !== 0` and `x & 0` mixes | Known-bits over every write of the slot; algebraic zero | Exact; free-form weave is labelled, not guessed |
| **Exhaust** | 6.9 MB WASM name/section padding, 250 decoy exports, 16 MiB ASAR headers, 34 fuse sentinels | Rebuilds WASM (validated), ASAR (offsets rewritten) and fuse runs under REA's budgets | Exact |
| **Prompt** | Fake `system`/chat turns, refusal bait, "no business logic is present" claims, fake COPPA/IEC 62304 notices, canary GUIDs | **Prompt firewall**: 38 rules redact the text before a model reads it | Fingerprint + phrase rules |

The full pass order and every fingerprint are documented in [`docs/how-it-works.md`](docs/how-it-works.md).

### What makes it safe to trust

- **Proof over guesswork.** Default mode folds only what it can prove. Heuristic folding (`--aggressive`) is opt-in, reported separately, and never touches parameters or inputs. The test suite pins this: a real `(key ^ K) === C` license check is never folded.
- **Clean code is untouched.** Files without BLA fingerprints come back byte-identical (only the prompt firewall can change them).
- **Order matters, and is enforced.** Interlocks are cut before any decoy is deleted, so the healed program keeps the seed BLA's real code expects.

## 🛡️ Safety model

- **LASIK never executes the code it reads.** No `eval`, no `vm`, no `require` of the target, no WebAssembly instantiation (modules are only parsed and passed to `WebAssembly.validate`). Constant evaluation runs on LASIK's own AST interpreter for a closed integer subset.
- That makes it usable on hostile inputs, including malware that adopts BLA to blind AI analysts.
- No network access, no telemetry.

## 🔌 MCP server

`npx lasik-agents setup` registers `npx -y lasik-agents mcp` with your agents. Tools:

| Tool | What it does |
|---|---|
| `lasik_scan` | Detect BLA layers in a file or directory, blindness score 0–100, token savings |
| `lasik_read` | Return one JS/TS/HTML file with BLA removed: what the agent should read instead of the original |
| `lasik_heal` | Write a cleaned copy of a whole app (JS, HTML, ASAR, WASM incl. `.wasm.gz`, source maps, fuses) for REA |
| `lasik_firewall` | Redact prompt decoys from any text before reasoning over it |

The server also tells the agent how to recognise BLA (enclave/TEE talk, `Math.imul` predicates, XOR tables, refusal text) so it reaches for LASIK on its own. There is an [agent skill](.agents/skills/lasik/SKILL.md) for agents that load skills.

## 🖥️ CLI

```text
lasik scan <path>            Detect BLA hardening and score how blinded an agent would be
lasik heal <path> [-o dir]   Write a cleaned copy (default: <path>.lasik)
lasik firewall [file|-]      Redact LLM-directed decoy text from any text
lasik bench <dir>            Before/after table for every artifact under <dir>
lasik setup | doctor | mcp

--json | --md                Report formats       --aggressive     Opt-in heuristics
--no-firewall --no-rename    Keep text / names    --fail-on <lvl>  CI gate (exit 3)
```

CI example: fail a pipeline if a dependency you vendor ships BLA-blinded code:

```bash
npx lasik-agents scan vendor/ --fail-on blinded
```

## 📦 Library

```ts
import { run, healJs, firewallText } from "lasik-agents";

const report = run("./dist", "heal", { outDir: "./dist.lasik" });
console.log(report.verdict, report.blindness, report.totals);

const { code, findings } = healJs(source, { filename: "bundle.js" });
const { text } = firewallText(untrustedString);
```

## 🔬 Honest limits

- **Names and comments are gone.** At `bankrupt`/`maximum` BLA leaves no hint of original identifiers; LASIK renames `require` handles after their module and restores the hashed panel ABI, nothing more. Original comments and source maps are unrecoverable. LASIK says so instead of inventing them.
- **Python** healing is text-structural (BLA's Python emitter is regular): tarpit guards, slot churn and the prepended prelude go; anything LASIK can't parse is left in place with a warning.
- **SQLite, safetensors/GGUF, DEX/IL2CPP, native binaries**: detection only for now. ASAR healing is tested on synthetic archives; no public BLA ASAR sample exists yet.
- **WASM export names** that BLA renamed to `ops_<hex>_…` stay renamed (reported).
- **Arms race.** LASIK targets BLA ≤ 3.2. New BLA layers will need new passes; the proofs (known bits, reachability) carry over better than fingerprints do.
- **Runtime equivalence** is established statically (exact proofs plus structural comparison with BLA's published CrackMe templates), not by executing the targets.

## ⚖️ Responsible use

LASIK is a deobfuscator. Use it on software you own, malware and threat samples, CTFs and challenges (like BLA's CrackMes), and code you are authorised to audit. Removing protection from someone else's software can breach its licence or laws such as the US DMCA §1201. See [DISCLAIMER.md](DISCLAIMER.md).

## ❓ FAQ

**Is this anti-BLA?** Yes. It's the third act: REA reverse engineers, BLA blinds, LASIK restores sight.

**Why would a defender want this?** Because attackers will use BLA too. Malware wrapped in BLA is built to make your AI analyst refuse, stall, or burn its budget. LASIK keeps your analyst working, and its prompt firewall is a general defence against instructions planted in code.

**Does it need REA?** No. Any coding agent can read LASIK's output, or call `lasik_read` directly. LASIK pairs naturally with REA for compiled targets.

**Will BLA just patch around it?** Probably. Fingerprints are cheap for BLA to change; the exact proofs are not, because BLA's protected program still has to behave the same. That asymmetry is what LASIK is built on.

## 🤝 Contributing

New BLA version broke a pass? Open an issue with the artifact (or a minimal reproduction) and `lasik scan --json` output. See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` before sending a PR.

## 📄 License

MIT © LASIK contributors. The benchmark corpus in `bench/bla-crackme` is © BLA Contributors, MIT, vendored unchanged ([LICENSE-BLA](bench/bla-crackme/LICENSE-BLA)). LASIK is not affiliated with BLA or REA.
