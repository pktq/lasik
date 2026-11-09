# Security policy

## Threat model

LASIK is built to analyse hostile input, including malware. It **never executes** the files it reads: no `eval`, no `vm`, no `require` of the target, no WebAssembly instantiation (modules are only parsed and passed to `WebAssembly.validate`). Constant evaluation uses LASIK's own interpreter over a closed integer subset. It makes no network calls and sends no telemetry.

Anything that breaks those guarantees is a vulnerability: code execution or resource exhaustion triggered by crafted input, path traversal when writing a healed copy (for example from ASAR entries), or a healing step that changes the behaviour of clean code.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/pktq/lasik/security/advisories/new). Do not open a public issue for security problems. Include the LASIK version, a minimal input and the observed behaviour. We aim to acknowledge reports within a few days.

## Supported versions

Only the latest release receives fixes.
