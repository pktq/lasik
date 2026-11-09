# Real BLA 3.2.1 output

Ground truth for `tests/bla-real.test.ts`: one small clean file per format, and what `bla-agents@3.2.1` (MIT, see `LICENSE-BLA`) made of it.

- `clean/`: the inputs. `sound-pan.js`, `electron-bridge.js`, `license-validator.ts` and `pricing_engine.py` are BLA's own examples; the rest come from `make-clean.mjs` plus `javac` (`Pricing.class`), `py_compile` (`pricing_engine.pyc`, `dfile="pricing_engine.py"`), `rustc` (`hello.exe`, no PDB) and `dotnet build` (`Pricing.dll`, `DebugType=none`).
- `default/`: `npx bla-agents@3.2.1 harden .` (bankrupt intensity), each file gzipped.
- `max/`: the same with `--weave-decoys --self-seal --llm-directives`.

To refresh after a BLA release: rebuild `clean/` in a scratch folder under `dist/`, run both commands there, gzip `.bla-hardened/dist/*` into `default/` and `max/`. Check nothing embeds a local path before committing.
