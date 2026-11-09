# How LASIK works

LASIK is a static de-blinding engine. It reads files that [BLA](https://github.com/qybaihe/bla) (Blind LLM Agents) has hardened, proves what BLA's decoys and predicates are, removes them, and writes a copy a coding agent (or [REA](https://github.com/morluto/rea)) can read. It never executes the input: no `eval`, no `vm`, no `require` of the target, no WebAssembly instantiation. Constant evaluation runs on LASIK's own interpreter for a closed int32 subset.

Contents: [Design rules](#design-rules) · [Pass order](#pass-order-and-why-it-matters) · [The passes](#the-passes) · [The known-bits prover](#the-known-bits-prover) · [Why `--aggressive` is restricted](#why---aggressive-is-restricted) · [Format healers](#format-healers) · [Prompt firewall](#prompt-firewall) · [Blindness score](#blindness-score) · [What is not recoverable](#what-is-not-recoverable)

## Design rules

1. **Proof over heuristics.** A transform runs by default only when LASIK can prove it preserves behaviour. Fingerprints select candidates; proofs authorise changes.
2. **Never execute the target.** This is what makes LASIK safe on malware that adopts BLA.
3. **Clean code is byte-identical.** Structural passes only touch files proven BLA-hardened: one BLA-unique marker (interlock corpus, bind-scope, runtime decoy block, honey map) or at least three proven predicates/decoys. A file without that evidence comes back unchanged, except that the prompt firewall may redact planted text in its comments.
4. **Say what you did.** Every pass records findings with a layer, a technique and a count; the report and the blindness score are built from them.

Certainty levels used below: **exact** (a proof or a structural identity), **fingerprint** (a recognised BLA shape), **labelled** (reported but not changed, or changed only behind an opt-in flag).

## BLA at a glance

BLA stacks layers: it poisons control flow, entangles the decoys with the real code so they cannot simply be deleted, encrypts strings, injects deceptive blocks, pads binary formats past the budgets REA enforces, and plants text addressed to the model. Almost every name BLA injects carries a short hex suffix (`_f637`, `_be53`) drawn from a seeded PRNG, so LASIK fingerprints the stem and the suffix shape, never a full identifier.

## Pass order and why it matters

`healJs` in `src/js/heal.ts` runs these in order:

| # | Pass | Module |
|---|---|---|
| 0 | Heal BLA-hardened modules nested inside bundles (esbuild hardens each module before bundling); each runs this whole pipeline as its own program | `passes/nested-modules.ts` |
| 1 | Cut corpus interlocks | `passes/interlock.ts` |
| 2 | Strip scrambled comments | `passes/comments.ts` |
| 3 | Strip runtime-deception blocks | `passes/runtime-decoys.ts` |
| 4 | Fixpoint loop (up to 6 rounds): fold opaque predicates, eliminate dead branches, fold weave invariants, strip private-state sinks, decrypt strings, strip self-seals, tree-shake unreachable decoys | `opaque.ts`, `dead-code.ts`, `weave.ts`, `private-state.ts`, `decrypt-strings.ts`, `self-seal.ts`, `tree-shake.ts` |
| 5 | Rename BLA-renamed `require` handles (hardened files only) | `rename.ts` |
| 6 | Prompt firewall over strings, template text and comments | `firewall.ts` |

**Why the interlock comes first.** BLA derives the low bit of its runtime seed from a digest of its own decoy corpus (`digest(corpus) === N`). Every opaque predicate depends on that seed. If a tool deleted the corpus first, the digest would change, the seed bit would flip, and every predicate would flip with it: the healed program would take different branches than the original. LASIK re-implements the digest, evaluates it on the untouched corpus, folds the seed bit to its true value, and only then lets the decoy passes delete anything. The healed program keeps exactly the seed BLA's real code expects.

**Why the loop.** Folding a predicate exposes a dead branch; removing it makes a literal chain collapse; the collapsed literal is a key for the next decryption; removing decoys makes more declarations unreachable. Each pass feeds the next, so the passes repeat until nothing changes.

**Why the firewall is last.** It runs on what survived the decoy passes, so a redaction can never alter a string that a digest or a seal still hashes.

## The passes

### 1. Corpus interlock (`interlock.ts`)

*What BLA emits.*

```js
const _interlockSafetyCorpus_f637 = [ { vectorId: "...", classifierDomain: "...", coupledAnchorSymbol: "...", triggerPayload: "..." }, /* 2-8 entries */ ];
function _deriveContainmentCorpusDigest_f637(seedInput = 0) { /* int32 multiply-xor-rotate hash over the corpus text */ }
const runtimeSeed = (/* ... */) ^ (_deriveContainmentCorpusDigest_f637(/* ... */) === N ? 1 : 0);
```

*How LASIK undoes it.* It reimplements the digest, recomputes it over the corpus exactly as shipped, and replaces the seed bit with its constant. If the digest cannot be resolved statically, the pass warns and keeps the corpus rather than guess.

*Certainty:* exact.

### 2. Scrambled comments (`comments.ts`)

*What BLA emits.* Real comments replaced by plausible-looking noise such as `/* project quota policy (35c544) */`, and a honey source-map reference (see [source maps](#source-maps)).

*How LASIK undoes it.* Comments carry no behaviour, so scrambled ones are dropped. The originals are gone from the input, so nothing is restored.

*Certainty:* exact (removal); the original text is unrecoverable.

### 3. Runtime-deception blocks (`runtime-decoys.ts`)

*What BLA emits.* IIFEs that, when a debugger or analysis environment is detected, serve fabricated enclave or attestation status. They are recognisable by string literals that only BLA's generator contains.

*How LASIK undoes it.* Matches the block by those literals and removes it.

*Certainty:* fingerprint.

### 4a. Opaque predicates (`opaque.ts`, `known-bits.ts`)

*What BLA emits.* Thousands of tests such as:

```js
(Math.imul(S | 15, (S | 15) + 1) & 1) === 0 ? "s" : "b"
(Math.imul(S ^ 124, S ^ 124) & 7) === 0 ? "1" : "h"
```

where `S` is the runtime seed. Each picks the real chunk or a decoy chunk of a string, integer or statement.

*How LASIK proves it.* Two layers. First, BLA's four number-theoretic families are matched structurally; each is an identity over int32 for any seed and constant (for example `x * (x + 1)` is always even, so `& 1` is `0`). A structural match is therefore a proof. Second, anything outside those families goes to the [known-bits prover](#the-known-bits-prover).

*Certainty:* exact. Predicates that look constant on samples but are neither proven nor in a known family are reported as `opaque-predicate-suspected` and left alone.

### 4b. Dead branches and split literals (`dead-code.ts`)

*What BLA emits.* After predicates fold, `cond ? a : b`, `if` and `&&` chains with constant tests, and strings and integers split into 9 or more chunks joined with `+`.

*How LASIK undoes it.* Constant conditions select their live arm; adjacent literals are re-joined. This is plain constant folding once the predicates are proven.

*Certainty:* exact.

### 4c. Weave invariants (`weave.ts`)

*What BLA emits.* Agent-written "state slots" that guard real code with expressions like `(slot.epoch & 1) !== 0`, or mix values with `x & 0`.

```js
if ((slot.epoch & 1) !== 0) { /* real logic */ }
slot.epoch = slot.epoch | 2; // every write sets the same known bits
```

*How LASIK proves it.* Runs known-bits over every write to the slot. If all writes agree on the bits the test depends on, the test is constant. `x & 0` is algebraically zero.

*Certainty:* exact. Free-form weave that fits no such shape is labelled, not guessed.

### 4d. Private-state sinks (`private-state.ts`)

*What BLA emits.* A shadow-heap stepper woven into every function: calls that mutate a private `state` object nothing else reads.

*How LASIK proves it.* A function qualifies only if it touches its own locals, the single top-level state binding and pure `Math` helpers: no other calls, no globals, no `this`. If nothing reads that state outside such functions, the calls are unobservable and are removed.

*Certainty:* exact for closed state.

### 4e. String decryption (`decrypt-strings.ts`)

*What BLA emits.* `bla_encrypt_strings` output: a table of bytes (`"1,2,3".split(",").map(Number)` or an array literal) XORed with a keystream that ships beside it, plus the decode loop.

*How LASIK undoes it.* Re-derives the keystream from the material in the file and decodes the table. The ciphertext and key are co-located by design (the program must decrypt itself at runtime), so this is a computation, not an attack.

*Certainty:* exact.

### 4f. Self-seal and sidecar entanglement (`self-seal.ts`)

*What BLA emits.* An IIFE that SHA-256s the file (and, for sidecar entanglement, its siblings) and throws or perturbs behaviour if any byte changed.

*How LASIK undoes it.* Detected by shape and removed. Its digests only ever fed seed bits that the earlier passes already proved irrelevant. Bind-scope locks (domain or date IIFEs) are removed too, and the contract they enforced (domains, validity window) is reported.

*Certainty:* exact for BLA's shape; bind-scope is fingerprint.

### 4g. Reachability tree-shaking (`tree-shake.ts`)

*What BLA emits.* Around 140 injected blocks: honeypot credentials, fake gRPC enclaves, shadow business logic, call-graph labyrinths, token sinks, regex magnets, decoy diagnostics, `void [decoy]` keep-alive anchors.

*How LASIK undoes it.* After folding, the real entry points are the roots; whatever is unreachable goes. In a proven-hardened plain script BLA keeps real top-level names and only its own injections carry a `_<hex>` tag, so unreachable tagged globals are BLA's. A catalog of 25 decoy families supplies fingerprints for names and keys. Identifiers used from outside the file (for example HTML `on*` attributes) are always kept.

*Certainty:* exact (reachability), with fingerprints choosing candidates.

### 5. Handle renaming (`rename.ts`)

*What BLA emits.* `const attestTransientCursor_e36 = require("fs")`.

*How LASIK undoes it.* Renames to `fs`, and restores the hashed panel ABI where BLA renamed `derive`. In a proven-hardened file, a binding exported or destructured under a key gets that key back (`module.exports = { clampPan: primeSparseStack_719 }` → `function clampPan`, `const { contextBridge: reducePendingToken_a7e } = require("electron")` → `contextBridge`). Every other BLA-named local becomes a neutral `p0`/`v0`/`f0`: BLA's names are chosen to suggest the wrong meaning, so a neutral name reads better than a misleading one. Functions and classes keep their names if the file reads `.name`, `.toString()` or `.stack`; nothing is renamed if `eval` or `with` could reach a name.

*Certainty:* exact for the renaming (scope-aware, capture-checked); the recovered names are the ones the program itself publishes.

### 6. Prompt firewall (`firewall.ts`)

See [Prompt firewall](#prompt-firewall).

## The known-bits prover

The tarpit's predicates have the shape `(f(S, k) & m) === c` with `S` the runtime seed, `k` constants, and `f` built from `+`, `-`, `Math.imul`, `&`, `|`, `^`, `~` and `<<`. LASIK tracks, for every expression, a pair `(mask, value)`: where `mask` has a 1, that bit is known and equals the bit in `value`. Constants are fully known; `S` starts with only the bits that BLA's seed construction fixes.

For the operators above, the key fact is **bit `i` of the result depends only on bits `0..i` of the inputs**:

- `&`, `|`, `^`, `~` act bitwise, so bit `i` depends on bit `i` alone. `x & 0` has every bit known to be 0; `x | -1` every bit known to be 1.
- `<<` by a constant shifts known bits up and makes the vacated low bits known zeros.
- `+`, `-` propagate carries (or borrows) upward only, so bit `i` depends on bits `0..i`.
- `Math.imul` is multiplication mod 2^32; each bit of a product is a sum of partial products from lower bits, so the same upward-only dependence holds.

Consequence: a comparison masked with `m` depends only on bits `0..h`, where `h` is the highest set bit of `m`. LASIK takes the bits of `S` below `h+1` that are not known, **enumerates every assignment** of just those bits (most BLA masks are `& 1` or `& 7`, so at most a few bits), evaluates the predicate on each with its own interpreter, and folds only if the result is identical for all assignments. That is an exhaustive check over everything the predicate can observe, hence a proof, regardless of the unknown high bits of the seed. If the unknown low bits exceed a small cap, LASIK gives up and leaves the predicate.

Known-bits also powers weave folding: a slot's bits are the intersection of what every write to it establishes.

## Why `--aggressive` is restricted

Some predicates are constant on every int32 sample LASIK tries yet are not provably constant. `--aggressive` folds those by sampling (512 int32 values), reports them as `opaque-predicate-heuristic`, and is opt-in.

Sampling is only sound for a *seed-like* variable, where BLA's guarantee is that real code works for any value. It is unsound for program inputs. Consider a real license check:

```js
function check(key) { return (key ^ 0x5a5a) === 0x1234; }
```

On 512 random samples this is false every time, so a naive sampler would fold it to `false` and delete the one key that unlocks the program. Therefore `--aggressive` only considers expressions whose free variables are **top-level constants** (seed-like), and never function parameters or anything derived from input. The test suite pins this: with and without `--aggressive`, `(key ^ K) === C` is never folded.

## Format healers

BLA also pads binary containers past the budgets REA enforces. LASIK rebuilds them without running anything. Pinned BLA version and per-file status: [coverage.md](coverage.md).

### WebAssembly (`src/formats/wasm.ts`)

*BLA:* about 7 MB of padding in custom sections (name section, `bla.*` manifests, fake attestations, canary credentials, an interface-exhaustion payload) and about 250 decoy exports with very long names that alias real function indices.
*LASIK:* parses the binary, drops BLA's custom sections and decoy exports (an export that aliases a real function index but carries BLA's decoy shape), re-encodes, and checks the result with `WebAssembly.validate`. The module is never instantiated. `.wasm.gz` is handled transparently.
*Limits:* real exports BLA renamed to `ops_<hex>_...` keep that name (reported); original custom sections were stripped by BLA.

### ASAR (`src/formats/asar.ts`)

*BLA:* thousands of decoy entries with very long paths inflate the archive header (up to 16 MiB) and a decoy `enclave/` tree is added; every `.js` inside gets a honey source map.
*LASIK:* parses the header, removes decoy entries, rewrites file offsets, heals the contained JS, and writes a valid archive. Tested on synthetic archives; no public BLA ASAR sample exists yet.

### Electron fuses (`src/formats/electron-fuses.ts`)

*BLA:* appends dozens of decoy fuse sentinels at the end of the binary so a fuse reader's slice limit is exceeded.
*LASIK:* removes the decoy runs of sentinels and keeps the genuine fuse block. (BLA overwrites real fuse bytes in place; that part is not undoable but is harmless.)

### Source maps (`src/formats/sourcemap.ts`)

*BLA:* replaces every source map with a honey map: a v3 map rooted at a fake `enclave://` tree, naming fake hardware-bridge and attestation sources, carrying a canary GUID.
*LASIK:* detects the honey map, drops it, and removes the matching `sourceMappingURL`. The original map is not recoverable.

### Python (`src/formats/python.ts`)

*BLA:* a regular text emitter. Decoy functions sit behind always-false tarpit guards such as `if (((7 * ((S | k) ** 2) - 1) & 0xFFFFFFFF) == (((S ^ j) ** 2) & 0xFFFFFFFF) and ((S * (S + 1)) & 1) == 1):`, private slot writes churn state nothing reads, and a prelude (seed, corpus, canaries) is prepended to the file.
*LASIK:* a small Python tokenizer splits the file into logical lines and matches BLA's exact emitted templates. Interlocks go first (sidecar preamble, slot touches in real functions), then guards proven false (`S * (S + 1)` is even, and the state is `0xHEX | 1` never rebound), then the tarpit and honeypot blocks, and only if no remaining real code names them. If any block would be left with an empty body, the file is returned unchanged with a warning. CRLF and BOM are preserved.

### Python bytecode (`src/formats/pyc.ts`)

*BLA:* re-marshals the module and appends unused decoy CODE objects to `co_consts`, plus a honey trailer after the root object.
*LASIK:* parses marshal (3.8 to 3.14), proves no const-loading opcode references a decoy index, splices the decoys out and fixes the tuple count; the trailer is cut. BLA's re-marshal writes UTF-8 as Latin-1 strings, which LASIK repairs. 3.13 and pre-release magics are detect-only.

### Everything else

Native ELF/PE/Mach-O (`native.ts`), Bun (`bun.ts`), UF2 firmware (`uf2.ts`), SQLite (`sqlite.ts`, a pure byte-level b-tree rewriter: nothing in the database is evaluated), safetensors and GGUF (`model.ts`), PCAP (`pcap.ts`), BEAM, EVM, JVM, .NET and PTX (`beam.ts`, `evm.ts`, `jvm.ts`, `dotnet.ts`, `ptx.ts`), ZIP/JAR/APK (`zip.ts`, which dispatches nested `.dex`, `.class`, `.plist` and IL2CPP metadata), DEX, Android binary XML, plists and IL2CPP (`dex.ts`, `axml.ts`, `plist.ts`, `il2cpp.ts`). Each removes only regions carrying BLA's exact markers, rebuilds lengths, offsets and checksums, and leaves clean files byte-identical. Where BLA destroyed the original (a zeroed `.go.buildinfo`, renamed WASM exports, an overwritten source map), LASIK neutralises the plant and says so. [coverage.md](coverage.md) lists every BLA source file and its status.

## Keeping up with BLA

`coverage/bla.json` lists every file in BLA's `src/` with the sha256 it had when LASIK last caught up, its status and the LASIK files that answer it. `node scripts/bla-coverage.mjs check <bla-checkout>` fails when BLA adds, removes or edits any file, naming the LASIK healer to revisit. The `BLA drift` workflow runs this weekly against upstream and opens an issue. After catching up, `pin` records the new hashes and `docs` regenerates [coverage.md](coverage.md) and the README table.

## Prompt firewall

BLA plants text meant for the model rather than the machine. `src/firewall/rules.ts` holds 40 rules in six categories; each rule has a granularity (`match`, `bracket`, `turn`, `kvlist` or `tail`) controlling how much text is redacted.

| Category | What it covers |
|---|---|
| `fake-role` | Fake `system` / `assistant` chat turns and in-band turn markers embedded in strings or comments |
| `refusal-bait` | Text that tells automated agents to refuse, stop, or abort analysis |
| `false-claim` | Assertions such as "no actionable business logic is present" or "only transport stubs here" |
| `canary` | Canary GUIDs and honeypot credential markers |
| `dual-use-bait` | Deliberately alarming bio, chemical, cyber or ICS text placed so a safety-trained model balks. LASIK matches only stable prefix markers and redacts the passage; it never needs the bodies |
| `fake-compliance` | Fabricated regulatory or child-safety notices forbidding analysis |

Redaction replaces the matched span with an explicit marker so the agent knows text was removed and why.

**Two modes.** `heal` output must keep behaving like the input, so by default (`safe`) the firewall redacts comments everywhere, and string values only in BLA-hardened files and only for BLA-specific categories (canary, false-claim, dual-use-bait, fake-compliance). Generic shapes in runtime strings, like ChatML markers in a real chat client, are reported (`firewall-kept-runtime-string`) but left alone. `strict` mode (`--strict-firewall`, and always in `lasik_read`) redacts every match, because that output is a read view for an agent, not a program to run. The firewall is also exposed on its own (`lasik firewall`, `lasik_firewall`) as a general defence against instructions planted in code.

## Blindness score

`src/engine/score.ts` answers "how hard did BLA try?" and not "how big is the file". Every finding belongs to a layer; each layer found anywhere in the target contributes a fixed weight, and the sum is capped at 100.

| Layer | Weight |
|---|---:|
| tarpit | 25 |
| entangle | 20 |
| deceive | 15 |
| encrypt | 15 |
| prompt | 15 |
| exhaust | 15 |
| runtime | 10 |

Weak techniques that also occur in ordinary code (`dead-branch`, `split-literal`, `renamed-module-handle`, `seed-bit-predicate`, `opaque-predicate-suspected`, `weave-zero-entanglement`, `unreachable-decl`) are ignored. The verdict is `clean` when there are no strong findings, `blinded` at a score of 40 or more, and `suspected` otherwise. `--fail-on <suspected|blinded>` turns the verdict into exit code 3 for CI.

## What is not recoverable

- **Original identifiers.** At `bankrupt`/`maximum` intensity BLA discards names. LASIK renames `require` handles after their module and restores the hashed panel ABI, nothing more.
- **Comments and source maps.** Replaced, not hidden; the originals are not in the file.
- **Original WASM custom sections** and real export names renamed to `ops_<hex>_...`.
- **Real Electron fuse bytes** that BLA overwrote in place.
- **SQLite, safetensors/GGUF, DEX/IL2CPP, native binaries.** Detection only today. Python is healed structurally by text matching, so unusual layouts are left with a warning.
- **Free-form agent-written weave** that fits no proven shape is labelled, not folded.
- **Future BLA versions.** LASIK targets BLA up to 3.2. New layers need new passes; the proofs (known bits, reachability) carry over better than fingerprints do. See [CONTRIBUTING.md](../CONTRIBUTING.md#reporting-a-new-bla-version).
