# Contributing to LASIK

Thanks for helping. LASIK undoes BLA hardening statically; the bar is that every change is provably safe.

## Dev setup

Requires Node.js 20.19 or newer.

```bash
npm ci
npm run build
npm test
node dist/cli.js bench bench/bla-crackme   # before/after table on BLA's CrackMes
```

Also run `npm run typecheck`. `npm run dev -- <args>` runs the CLI from source.

## Layout

- `src/js/passes/` JS passes, run in the order set by `src/js/heal.ts`
- `src/formats/` WASM, ASAR, Electron fuses, source maps
- `src/firewall/` prompt-firewall rules
- `src/engine/` file walking, reports, blindness score
- `src/cli.ts`, `src/mcp/server.ts` interfaces
- `tests/` Vitest suites and fixtures; `bench/` vendored BLA CrackMes

See [docs/how-it-works.md](docs/how-it-works.md) for the design.

## Adding a pass

1. **Proof first.** Write down why the transform preserves behaviour (an identity over int32, a known-bits argument, reachability). If it cannot be proven, it must be opt-in, labelled and reported separately.
2. **Fixture.** Add a minimal BLA-shaped sample under `tests/fixtures/` (or inline in the test) that the pass must handle.
3. **Test.** Assert the healed output, and add a test that equivalent *clean* code stays byte-identical.
4. **Order.** Place the pass in `heal.ts` deliberately; anything that deletes code must run after the interlocks are cut.
5. **Never execute the target.** No `eval`, `vm`, `require` of inputs or WASM instantiation.
6. Report findings with a layer and technique so the score and `scan` output stay accurate.

## Reporting a new BLA version

Open a "New BLA version or layer" issue with the BLA version, intensity, `lasik scan --json` output and the artifact or a minimal reproduction. A hardened file plus the BLA version is the most useful thing you can send.

## Pull requests

Keep changes focused, run the full suite, and fill in the PR template. Do not include personal information or local paths in code, fixtures or commits.
