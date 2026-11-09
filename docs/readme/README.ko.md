<p align="center"><a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <b>한국어</b> · <a href="README.es.md">Español</a></p>

<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  에이전트 방지 경화에 대한 정적 난독화 해제 도구.<br />
  LASIK은 <a href="https://github.com/qybaihe/bla">BLA</a>의 보호 계층을 제거해, 코딩 에이전트와 분석 도구가 실제 프로그램을 읽을 수 있게 합니다.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lasik-agents"><img src="https://img.shields.io/npm/v/lasik-agents?style=for-the-badge&label=npm&color=22d3ee" alt="npm version" /></a>
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pktq/lasik/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="../../docs/coverage.md"><img src="https://img.shields.io/badge/BLA_3.2.2-59%2F63_shields_healed-22d3ee?style=for-the-badge" alt="BLA coverage" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <b>0.3:</b> 구조 기반 탐지. 보호는 이름이 아니라 동작으로 식별하므로, 이름을 바꾼 빌드도 복구됩니다. <a href="#복원력">벤치마크</a>
</p>

<p align="center">
  <a href="../how-it-works.md">동작 방식</a> ·
  <a href="../benchmark.md">벤치마크</a> ·
  <a href="../../CHANGELOG.md">변경 내역</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="보호된 빌드에 있는 같은 두 함수: LASIK 적용 전과 후" width="100%" />
</p>

LASIK은 보호된 빌드를 읽고, 어느 부분이 보호 코드인지(불투명 술어, 암호화된 문자열, 미끼 코드, 변조 검사, 바이너리 패딩, 프롬프트 인젝션 텍스트) 증명한 다음 이를 제거해 정리된 사본을 만듭니다. 입력을 실행하지는 않습니다.

<p align="center"><img src="../assets/flow.svg" alt="보호된 릴리스가 lasik heal을 거친 뒤, 에이전트나 분석 도구가 실제 로직을 읽습니다" width="100%" /></p>

## 주요 특징

- **토큰 1,262배 감소.** 공개된 BLA CrackMe 코퍼스에서 약 2,100만 토큰이 1만 7천 토큰으로 줄어듭니다.
- **증명 기반.** 동작이 보존된다는 것을 LASIK이 증명할 수 있을 때만 변환을 적용합니다. 보호되지 않은 파일은 바이트 단위로 동일하게 반환됩니다.
- **구조 기반 탐지.** 식별자가 아니라 동작으로 보호를 인식하며, 이름을 바꾼 빌드에 대한 벤치마크를 CI에서 실행합니다.
- **정적 분석만 사용.** `eval`도, 샌드박스도, WebAssembly 인스턴스화도 없으므로 악의적인 입력에도 안전합니다.
- **프롬프트 인젝션 방화벽.** 모델을 유도하려고 심어 둔 텍스트를 처리합니다.
- **21개 형식**: JavaScript 및 TypeScript 번들, 인라인 HTML, WebAssembly, Electron ASAR 및 fuses, source maps, Python 및 `.pyc`, 네이티브 ELF/PE/Mach-O, Bun, SQLite, safetensors 및 GGUF, PCAP, JVM, .NET, BEAM, EVM, PTX, ZIP/APK/DEX, plist, IL2CPP, UF2 펌웨어.
- **이름 복원.** 프로그램이 원래 이름을 공개하는 경우(export, import)에는 이를 복원하고, 그 외에는 중립적인 이름을 사용합니다.
- **에이전트 연동**: CLI, Claude Code, Cursor, Codex 등 7개를 더 지원하는 MCP 서버, 그리고 라이브러리 API.

## 설치

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

Node.js 20.19 이상이 필요합니다. 소스에서 빌드하려면: `git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`.

## 사용법

빌드를 스캔한 다음, 정리된 사본을 만듭니다.

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 37.5 KB, ~21,104,859 → ~16,718 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

에이전트나 분석 도구(예: [REA](https://github.com/morluto/rea))가 복구된 사본을 읽도록 지정하세요.

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

다른 명령: `lasik firewall`(임의의 텍스트에서 심어진 지시문을 제거), `lasik bench`, `lasik doctor`. `--json` 또는 `--md`를 붙이면 기계가 읽을 수 있는 보고서를 얻고, `--fail-on blinded`를 붙이면 CI 게이트로 쓸 수 있습니다.

### 코딩 에이전트에서

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| 도구 | |
|---|---|
| `lasik_scan` | 파일이나 폴더의 보호 계층, 0–100 실명 점수, 발견된 기법 |
| `lasik_read` | 보호를 제거한 파일 하나. 에이전트가 원본 대신 읽도록 하는 용도 |
| `lasik_heal` | 앱 전체의 정리된 사본 |
| `lasik_firewall` | 임의의 텍스트에서 심어진 지시문을 제거한 결과 |

이 저장소에는 보호된 빌드를 마주한 에이전트를 위한 [에이전트 스킬](../../.agents/skills/lasik/SKILL.md)도 들어 있습니다.

## 벤치마크

공개된 BLA CrackMe이며, [`bench/bla-crackme`](../../bench/bla-crackme)에 수정 없이 포함되어 있습니다.

| CrackMe | 파일 수 | 이전 | 이후 | 토큰(추정) |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 4.9 KB | 6,954,989 → 1,398 |
| v7 | 5 | 743 KB | 13.6 KB | 197,561 → 3,483 |
| v8 | 3 | 362 KB | 6.7 KB | 6,972,491 → 4,748 |
| v9 | 4 | 381 KB | 7.4 KB | 6,977,670 → 4,941 |

<p align="center"><img src="../assets/tokens.svg" alt="로그 스케일 막대 차트: LASIK 적용 전후의 CrackMe 산출물별 추정 토큰 수" width="100%" /></p>

<!-- realbench:start -->
On a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](../benchmark.md#your-own-code-hardened-by-real-bla-321)):

| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |
|---|---:|---:|---:|---:|---|---|
| Defaults | 21 | 151.9 KB | 31.1 MB | 150.9 KB | 32,154,076 → 152,102 | 21/21 healed, 11 byte-identical |
| All opt-in layers | 21 | 151.9 KB | 31.2 MB | 151.0 KB | 32,178,121 → 152,197 | 21/21 healed, 10 byte-identical |
<!-- realbench:end -->

파일별 수치, 측정 방법과 그 한계는 [docs/benchmark.md](../benchmark.md)에 있습니다. LASIK은 CrackMe를 읽을 수 있게 만들 뿐, 풀이를 공개하지는 않습니다.

### 복원력

`npm run bench:renamed`는 같은 빌드를 두 번 복구합니다. 한 번은 배포된 그대로, 다른 한 번은 생성된 모든 식별자, 주석, WASM 섹션, 긴 export 이름, ASAR 경로의 철자를 바꾸고 교환 법칙이 성립하는 피연산자의 순서를 바꾼 상태(동작은 동일)로 복구합니다. 탐지가 구조 기반이므로 두 결과는 거의 같습니다. 철자를 바꾼 쪽이 제거하는 양이 1퍼센트포인트 넘게 적으면 CI가 실패합니다.

<p align="center"><img src="../assets/renamed.svg" alt="왼쪽: 벤치마크가 철자를 바꾸는 항목의 예. 오른쪽: 형식별 남은 토큰 수. 철자를 바꾼 빌드도 원본과 거의 같은 크기로 복구됩니다" width="100%" /></p>

| 형식 | 배포 그대로: 제거율 | 철자 변경: 제거율 |
|---|---:|---:|
| JavaScript / TypeScript | 98.78% | 98.09% |
| HTML | 99.29% | 99.17% |
| WebAssembly | 99.98% | 99.98% |
| Electron ASAR | 99.998% | 99.96% |

## 동작 방식

<p align="center"><img src="../assets/pipeline.svg" alt="LASIK 처리 순서: 탐지, 인터락 차단, 미끼 제거, 고정점까지 접기, 이름 변경, 방화벽, 보고" width="100%" /></p>

| 계층 | LASIK의 처리 |
|---|---|
| 불투명 술어 | 알려진 비트 분석으로 상수 조건을 증명하고 죽은 분기를 제거 |
| anti-strip 인터락 | 닫힌 부분집합 인터프리터에서 검사를 계산해, 무엇이든 제거하기 전에 접음 |
| 암호화·분할된 리터럴 | 함께 배포된 키로 문자열 테이블을 복호화하고, 분할된 문자열과 정수를 다시 결합 |
| 미끼 | 실제 진입점에서 도달할 수 없는 모든 것을 제거 |
| 변조 및 도메인 락 | 이를 제거하고 락의 조건을 보고 |
| 런타임 노이즈 | 아무도 읽지 않는 상태 변동과 상태 블록을 제거 |
| 이름이 바뀐 식별자 | 프로그램이 export하거나 import하는 이름을 복원하고, 나머지는 중립적인 이름으로 바꿈 |
| 패딩과 심어 둔 데이터 | 바이너리, 데이터베이스, 모델, 아카이브에서 패딩, 트레일러, 심어 둔 항목을 제거하고 오프셋과 체크섬을 다시 구성 |
| 심어 둔 지시문 | 40개의 방화벽 규칙으로 제거 |

자세한 내용은 [docs/how-it-works.md](../how-it-works.md)에 있습니다. 두 번의 독립적인 건전성 검토에서 복구가 동작을 바꾸거나 보호되지 않은 파일을 건드리는 입력을 찾아 보았고, 발견된 모든 사례는 수정되어 [`tests/soundness.test.ts`](../../tests/soundness.test.ts)에 고정되어 있습니다.

## 형식별 지원 현황

<!-- coverage:start -->
Pinned to BLA **3.2.2**. 59/63 BLA shield files fully healed; 44 more emit nothing into artifacts. Full per-file table: [docs/coverage.md](../coverage.md).

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

## 한계

- 보호 과정에서 파괴된 정보(지역 이름, 주석, 원본 source maps, 덮어쓴 섹션)는 복구할 수 없습니다. LASIK은 이를 지어내는 대신 보고합니다.
- 형식별 복구기는 21개 형식에 대해 실제 BLA 3.2.1 출력으로 검증했고([tests/fixtures/bla-3.2.1](../../tests/fixtures/bla-3.2.1)), Go, Flutter, Bun, BEAM, APK/DEX, IL2CPP는 아직 BLA 소스로 만든 픽스처로만 검증했습니다.
- 새로운 보호 기법에는 업데이트가 필요할 수 있습니다. 업스트림 변경은 매주 추적하며([coverage/bla.json](../../coverage/bla.json)), 이전 버전으로 보호된 빌드도 계속 지원합니다.

## 책임 있는 사용

LASIK은 난독화 해제 도구입니다. 본인의 소프트웨어, 악성코드와 위협 샘플, CTF, 그리고 수행할 권한이 있는 감사에 사용하세요. 권리가 없는 소프트웨어에서 보호를 제거하면 라이선스나 DMCA §1201 같은 법률을 위반할 수 있습니다. [DISCLAIMER.md](../../DISCLAIMER.md)를 참고하세요.

## 기여하기

샘플(또는 `lasik scan --json` 출력)을 첨부한 버그 리포트가 가장 도움이 되는 기여입니다. [CONTRIBUTING](../../.github/CONTRIBUTING.md)을 참고하세요.

다른 언어: [English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md).

## 라이선스

[MIT](../../LICENSE). 벤치마크 코퍼스의 저작권은 BLA Contributors에게 있으며 MIT 라이선스입니다. LASIK은 BLA 및 REA와 제휴 관계가 없습니다.
