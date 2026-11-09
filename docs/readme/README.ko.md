<p align="center"><a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a></p>

<div align="center">

<img src="../assets/banner.svg" alt="LASIK: LLM Agent Sight In Kode" width="100%" />

# LASIK

### BLA는 당신의 에이전트를 눈멀게 합니다. LASIK은 시력을 되찾아 줍니다.

**LLM Agent Sight In Kode**: [BLA](https://github.com/qybaihe/bla)(Blind LLM Agents)의 하드닝을 벗겨내어
코딩 에이전트와 [REA](https://github.com/morluto/rea)가 실제 프로그램을 다시 읽을 수 있게 해 주는
정적 난독화 해제 엔진, CLI, MCP 서버.

[![npm](https://img.shields.io/npm/v/lasik-agents?color=0b7285&label=npm)](https://www.npmjs.com/package/lasik-agents)
[![CI](https://github.com/pktq/lasik/actions/workflows/ci.yml/badge.svg)](https://github.com/pktq/lasik/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.19-339933)](../../package.json)
[![MCP](https://img.shields.io/badge/MCP-server-7c3aed)](#-mcp-서버)
[![Never runs the target](https://img.shields.io/badge/executes%20target%20code-never-success)](#-안전-모델)

</div>

---

**REA**는 에이전트에게 무엇이든 리버스 엔지니어링하는 법을 가르쳤습니다. **BLA**는 그 에이전트들이 파산할 때까지 릴리스에 독을 푸는 것으로 응수했습니다. 불투명 술어(opaque predicate) 타르핏, XOR로 암호화된 문자열, 미끼 "enclave" 코드, 안티 스트립 인터록, 셀프 실, 7 MB짜리 WebAssembly 패딩, 그리고 모델이 거부하도록 쓰인 텍스트까지.

**LASIK**은 교정 수술입니다. BLA의 술어가 상수임을 증명하고, 숨겨진 것을 복호화하고, 인터록을 끊고, 미끼를 제거하고, 프롬프트 미끼를 가리며, 이 모든 것을 **대상을 한 번도 실행하지 않고** 해냅니다. 그러면 당신의 에이전트는 프로그램이 실제로 하는 일을 읽게 됩니다.

```text
                    ┌────────────┐      ┌────────────┐      ┌────────────┐
   your release ──▶ │    BLA     │ ──▶  │   LASIK    │ ──▶  │ REA / agent│ ──▶ the real logic
                    │ poison +   │      │ prove, fold│      │ reads 958× │
                    │ exhaust    │      │ decrypt,   │      │ fewer      │
                    └────────────┘      │ strip      │      │ tokens     │
                                        └────────────┘      └────────────┘
```

## 👓 적용 전 / 후

BLA 자체 CrackMe v6에서 에이전트가 보는 모습입니다(해당 파일에 있는 약 3,000개의 불투명 술어 중 하나):

```js
// BLA-hardened (vault.cjs, 164 KB, 2,680 lines)
attestTransientCursor_e36 = require("fs"); …
traceLazyEdge_261.createHash(((Math.imul(runtimeSeedPrimaryHandle_be53 | 15, (runtimeSeedPrimaryHandle_be53 | 15) + 1) & 1) === 0 ? "s" : "b")
  + ((Math.imul(runtimeSeedPrimaryHandle_be53 ^ 124, runtimeSeedPrimaryHandle_be53 ^ 124) & 7) === 0 ? "1" : "h")
  + ((Math.imul(runtimeSeedPrimaryHandle_be53 | 123, (runtimeSeedPrimaryHandle_be53 | 123) + 1) & 1) === 0 ? "a" : "8") + …
```

```js
// after `lasik heal` (5.5 KB, 99 lines)
const fs = require("fs");
const crypto = require("crypto");
return crypto.createHash("sha256").update(input).digest("hex");
```

그리고 BLA의 CrackMe 전체 코퍼스에 적용한 결과입니다:

<img src="../assets/scan.svg" alt="lasik scan on BLA's CrackMe corpus: blindness 100/100, 21.1M tokens down to 22k" width="100%" />

## ⚡ 30초 퀵 스타트

```bash
# 1. How blind would an agent be?
npx lasik-agents scan ./dist

# 2. Write a cleaned copy next to it (./dist.lasik)
npx lasik-agents heal ./dist

# 3. Point REA (or any coding agent) at the healed copy
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

컴퓨터에 있는 모든 코딩 에이전트에 LASIK 도구를 제공하세요(Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Windsurf, Antigravity, VS Code, Copilot CLI, OpenCode):

```bash
npx lasik-agents setup          # --dry-run to preview, --remove to undo
```

Node.js ≥ 20.19가 필요합니다. 네이티브 의존성도, 네트워크 호출도 없습니다.

## 📊 BLA 자체 CrackMe에 대한 결과

벤치마크 코퍼스는 BLA가 공개한 CrackMe 결과물 v6–v9(MIT, [`bench/bla-crackme`](../../bench/bla-crackme)에 변경 없이 포함)이며, BLA 메인테이너들이 직접 `bankrupt` 강도로 하드닝한 것입니다. `npm run build && node dist/cli.js bench bench/bla-crackme`로 재현할 수 있습니다.

| 아티팩트 | 형식 | 이전 | 이후 | 토큰 이전 → 이후 | 절감 배율 |
|---|---|---:|---:|---:|---:|
| `v6/core.wasm.gz` | wasm | 17.7 KB (원본 6.9 MB) | 0.1 KB | 6,880,354 → 98 | **70,207×** |
| `v6/panel.html` | html | 124.9 KB | 1.9 KB | 32,035 → 476 | 67.3× |
| `v6/vault.cjs` | javascript | 160.7 KB | 5.5 KB | 42,600 → 1,481 | 28.8× |
| `v7/cli/meridian.cjs` | javascript | 169.7 KB | 3.4 KB | 44,897 → 867 | 51.8× |
| `v7/core/expr.cjs` | javascript | 147.2 KB | 8.2 KB | 39,135 → 2,111 | 18.5× |
| `v7/core/license.cjs` | javascript | 169.4 KB | 12.1 KB | 44,823 → 3,091 | 14.5× |
| `v7/core/stats.cjs` | javascript | 125.2 KB | 1.6 KB | 33,515 → 404 | 83.0× |
| `v7/core/units.cjs` | javascript | 131.8 KB | 2.1 KB | 35,191 → 541 | 65.0× |
| `v8/core.wasm.gz` | wasm | 20.9 KB (원본 6.9 MB) | 1.8 KB | 6,883,663 → 3,506 | 1,963× |
| `v8/license.cjs` | javascript | 221.2 KB | 5.6 KB | 58,120 → 1,445 | 40.2× |
| `v8/panel.html` | html | 119.7 KB | 1.3 KB | 30,708 → 331 | 92.8× |
| `v9/core.wasm.gz` | wasm | 20.9 KB (원본 6.9 MB) | 1.8 KB | 6,883,604 → 3,496 | 1,969× |
| `v9/license.cjs` | javascript | 196.4 KB | 6.2 KB | 52,019 → 1,600 | 32.5× |
| `v9/panel.html` | html | 123.3 KB | 1.2 KB | 31,594 → 299 | 105.7× |
| `v9/policy.py` | python | 40.6 KB | 0.5 KB | 10,453 → 133 | 78.6× |
| **합계** | | **1.75 MB** | **58 KB** | **21.1 M → 22 k** | **958×** |

코퍼스 전체에서 LASIK은 **3,011개의 불투명 술어**를 접고, **3,432개의 죽은 분기**를 제거하고, **2,465개의 분할된 리터럴**을 다시 합치고, **1,487개의 미끼 선언**과 **750개의 미끼 WASM export**를 삭제하고, 모든 XOR 문자열 테이블을 복호화하고, **11개의 안티 스트립 인터록**과 **5개의 셀프 실**을 끊고, 모든 프롬프트 미끼를 가립니다. 실행은 파일당 약 0.3초가 걸립니다.

복원된 v6 패널 스크립트는 공개된 템플릿의 `derive()` 로직과 한 줄 한 줄 일치합니다(BLA가 바꾼 지역 변수 이름은 제외). 토큰 수는 추정치입니다(코드는 토큰당 약 4자, hex/base64는 2자, 바이너리는 바이트당 1).

> 스포일러 정책: LASIK은 모든 CrackMe를 읽을 수 있게 만듭니다. 키나 플래그는 공개하지 않습니다. 푸는 것은 여전히 당신의 몫입니다.

## 🧠 작동 방식

BLA는 레이어를 쌓습니다("Poison → Exhaust → Hallucinate"). LASIK은 각 레이어를 정적으로 되돌리며, 얼마나 확신하는지도 함께 알려 줍니다.

| BLA 레이어 | BLA가 하는 일 | LASIK의 대응 | 확실성 |
|---|---|---|---|
| **Tarpit** | 약 3천 개의 `Math.imul` 불투명 술어가 모든 문자열 조각, 정수, 문장마다 진짜와 미끼 중 하나를 고름 | BLA의 4가지 정수론 패밀리(각각 int32 위에서 증명된 항등식)를 매칭한 뒤, **known-bits 증명기**를 적용: 런타임 시드의 어떤 비트가 고정인지 계산하고 술어가 의존하는 비트만 열거 | **정확한 증명** |
| **Entangle: interlock** | 시드의 최하위 비트 = `digest(decoyCorpus) === N`이므로, 미끼를 삭제하면 모든 술어가 뒤집힘 | 다이제스트를 재구현하고, 손대지 않은 코퍼스에서 다시 계산하여, 무언가를 제거하기 *전에* 그 비트를 접음 | 정확함 |
| **Entangle: self-seal / sidecar** | 파일이 자기 자신과 형제 파일의 SHA-256을 계산하고 어떤 수정이든 있으면 throw | 형태(shape)로 탐지하여 제거(그 다이제스트는 LASIK이 이미 무관함을 증명한 비트에만 쓰였음) | BLA의 형태에 대해 정확함 |
| **Entangle: bind-scope** | 도메인 / 날짜 잠금 IIFE | 제거하고, 그 계약(도메인, 유효 기간)은 보고 | 핑거프린트 |
| **Encrypt** | `bla_encrypt_strings` XOR 키스트림 테이블; 문자열과 정수가 9개 이상의 불투명 조각으로 분할됨 | 함께 배포된 키스트림으로 테이블을 디코딩; 술어가 접히면 조각을 다시 합침 | 정확함 |
| **Deceive** | 약 140개의 주입 블록: 허니팟 자격 증명, 가짜 gRPC enclave, 그림자 비즈니스 로직, 호출 그래프 미궁, BPE 토큰 싱크, 정규식 자석, 미끼 진단, 허니 소스 맵, 뒤섞인 주석, `void [decoy]` 킵얼라이브 앵커 | 접은 뒤 실제 진입점에서 도달 가능성 트리 셰이킹, 그리고 25개 미끼 패밀리의 핑거프린트 카탈로그 | 정확함 (도달 가능성) |
| **Runtime** | 모든 함수에 짜 넣은 섀도 힙 스테퍼; 디버거에 가짜 enclave 상태를 내놓는 "Truman show" 블록 | 비공개 상태 싱크 분석: 다른 곳에서 읽지 않는 상태만 변경하는 함수는 관측 불가능하므로 그 호출을 제거 | 닫힌 상태에 대해 정확함 |
| **Weave** | 실제 코드를 `(slot.epoch & 1) !== 0`과 `x & 0` 혼합으로 보호하는, 에이전트가 작성한 상태 슬롯 | 슬롯의 모든 쓰기에 대한 known-bits; 대수적 영 | 정확함; 자유 형식 weave는 추측하지 않고 표시만 함 |
| **Exhaust** | 6.9 MB WASM 이름/섹션 패딩, 250개의 미끼 export, 16 MiB ASAR 헤더, 34개의 퓨즈 센티넬 | REA의 예산 안에서 WASM(검증됨), ASAR(오프셋 재작성), 퓨즈 런을 재구성 | 정확함 |
| **Prompt** | 가짜 `system`/채팅 턴, 거부 미끼, "비즈니스 로직이 없다"는 주장, 가짜 COPPA/IEC 62304 고지, 카나리 GUID | **프롬프트 방화벽**: 38개 규칙이 모델이 읽기 전에 텍스트를 가림(`heal`에서는 동작 유지, `lasik_read`에서는 완전히 가림) | 핑거프린트 + 구문 규칙 |

전체 패스 순서와 모든 핑거프린트는 [`docs/how-it-works.md`](../how-it-works.md)에 문서화되어 있습니다.

### 신뢰할 수 있는 이유

- **추측이 아닌 증명.** 기본 모드는 증명할 수 있는 것만 접습니다. 휴리스틱 접기(`--aggressive`)는 옵트인이고, 별도로 보고되며, 매개변수나 입력은 절대 건드리지 않습니다. 테스트 스위트가 이를 고정합니다. 실제 `(key ^ K) === C` 라이선스 검사는 절대 접히지 않습니다.
- **깨끗한 코드는 그대로 둡니다.** BLA 증거가 없는 파일은 바이트 단위로 동일하게 돌아오며, 프롬프트 방화벽은 그 주석만 가릴 수 있습니다.
- **복원해도 동작은 유지됩니다.** `heal` 출력에서 방화벽은 주석과 BLA 전용 문자열만 가립니다. 프롬프트 형태의 *런타임* 문자열(예: 실제 채팅 앱의 ChatML 마커)은 다시 쓰지 않고 보고만 합니다. `lasik_read`와 `--strict-firewall`은 에이전트에게 완전히 가린 읽기용 뷰를 제공합니다.
- **독립적으로 검토되었습니다.** 별도의 적대적 검토가 어떤 패스가 동작을 바꾸는 입력을 찾아 15건을 발견했고, 모두 수정되어 [`tests/soundness.test.ts`](../../tests/soundness.test.ts)에 고정되었습니다(전체 테스트 85개).
- **순서가 중요하며, 강제됩니다.** 인터록은 어떤 미끼보다 먼저 끊으므로, 복원된 프로그램은 BLA의 실제 코드가 기대하는 시드를 유지합니다.

## 🛡️ 안전 모델

- **LASIK은 읽는 코드를 절대 실행하지 않습니다.** `eval`도, `vm`도, 대상의 `require`도, WebAssembly 인스턴스화도 없습니다(모듈은 파싱만 하고 `WebAssembly.validate`에 전달할 뿐입니다). 상수 평가는 닫힌 정수 부분집합에 대한 LASIK 자체 AST 인터프리터에서 실행됩니다.
- 그 덕분에 적대적인 입력, 즉 AI 분석가를 눈멀게 하려고 BLA를 채택한 악성코드에도 사용할 수 있습니다.
- 네트워크 접근도, 텔레메트리도 없습니다.

## 🔌 MCP 서버

`npx lasik-agents setup`은 `npx -y lasik-agents mcp`를 당신의 에이전트에 등록합니다. 도구:

| 도구 | 하는 일 |
|---|---|
| `lasik_scan` | 파일 또는 디렉터리에서 BLA 레이어를 탐지하고, 블라인드 점수 0–100과 토큰 절감량을 제공 |
| `lasik_read` | BLA를 제거한 JS/TS/HTML 파일 하나를 반환: 에이전트가 원본 대신 읽어야 할 것 |
| `lasik_heal` | REA를 위해 앱 전체(JS, HTML, ASAR, `.wasm.gz`를 포함한 WASM, 소스 맵, 퓨즈)의 정리된 복사본을 작성 |
| `lasik_firewall` | 추론하기 전에 모든 텍스트에서 프롬프트 미끼를 가림 |

서버는 에이전트에게 BLA를 알아보는 방법(enclave/TEE 관련 언급, `Math.imul` 술어, XOR 테이블, 거부 문구)도 알려 주므로, 에이전트가 스스로 LASIK을 찾게 됩니다. 스킬을 로드하는 에이전트를 위한 [에이전트 스킬](../../.agents/skills/lasik/SKILL.md)도 있습니다.

## 🖥️ CLI

```text
lasik scan <path>            Detect BLA hardening and score how blinded an agent would be
lasik heal <path> [-o dir]   Write a cleaned copy (default: <path>.lasik)
lasik firewall [file|-]      Redact LLM-directed decoy text from any text
lasik bench <dir>            Before/after table for every artifact under <dir>
lasik setup | doctor | mcp

--json | --md                Report formats       --aggressive     Opt-in heuristics
--no-firewall --no-rename    Keep text / names    --fail-on <lvl>  CI gate (exit 3)
--strict-firewall            Redact prompt decoys in runtime strings too (read view)
```

CI 예시: 벤더링한 의존성이 BLA로 눈먼 코드를 배포하면 파이프라인을 실패시키기:

```bash
npx lasik-agents scan vendor/ --fail-on blinded
```

## 📦 라이브러리

```ts
import { run, healJs, firewallText } from "lasik-agents";

const report = run("./dist", "heal", { outDir: "./dist.lasik" });
console.log(report.verdict, report.blindness, report.totals);

const { code, findings } = healJs(source, { filename: "bundle.js" });
const { text } = firewallText(untrustedString);
```

## 🔬 솔직한 한계

- **이름과 주석은 사라집니다.** `bankrupt`/`maximum`에서 BLA는 원래 식별자의 단서를 남기지 않습니다. LASIK은 `require` 핸들을 해당 모듈 이름으로 바꾸고 해시된 패널 ABI를 복원할 뿐, 그 이상은 하지 않습니다. 원래 주석과 소스 맵은 복구할 수 없습니다. LASIK은 이를 지어내는 대신 그렇다고 말합니다.
- **Python** 복원은 텍스트 구조 기반입니다(BLA의 Python 에미터는 규칙적입니다). 타르핏 가드, 슬롯 교란, 앞에 붙은 프렐류드는 제거되며, LASIK이 파싱하지 못하는 부분은 경고와 함께 그대로 남겨 둡니다.
- **SQLite, safetensors/GGUF, DEX/IL2CPP, 네이티브 바이너리**: 현재는 탐지만 지원합니다. ASAR 복원은 합성 아카이브로 테스트되었으며, 공개된 BLA ASAR 샘플은 아직 없습니다.
- BLA가 `ops_<hex>_…`로 이름을 바꾼 **WASM export 이름**은 바뀐 채로 남습니다(보고됨).
- **군비 경쟁.** LASIK은 BLA ≤ 3.2를 대상으로 합니다. 새로운 BLA 레이어에는 새로운 패스가 필요합니다. 증명(known bits, 도달 가능성)은 핑거프린트보다 더 잘 이어집니다.
- **런타임 동등성**은 대상을 실행하는 것이 아니라 정적으로(정확한 증명과 BLA가 공개한 CrackMe 템플릿과의 구조적 비교로) 확립됩니다.

## ⚖️ 책임 있는 사용

LASIK은 난독화 해제 도구입니다. 직접 소유한 소프트웨어, 악성코드와 위협 샘플, CTF와 챌린지(BLA의 CrackMe 같은), 감사할 권한이 있는 코드에 사용하세요. 다른 사람의 소프트웨어에서 보호를 제거하는 것은 해당 라이선스나 US DMCA §1201 같은 법률을 위반할 수 있습니다. [DISCLAIMER.md](../../DISCLAIMER.md)를 참고하세요.

## ❓ FAQ

**이건 안티 BLA인가요?** 네. 3막입니다. REA는 리버스 엔지니어링하고, BLA는 눈멀게 하고, LASIK은 시력을 되찾아 줍니다.

**방어하는 쪽이 왜 이게 필요한가요?** 공격자들도 BLA를 쓸 것이기 때문입니다. BLA로 감싼 악성코드는 당신의 AI 분석가가 거부하거나, 멈추거나, 예산을 소진하도록 만들어집니다. LASIK은 분석가가 계속 일하게 해 주며, 프롬프트 방화벽은 코드에 심어 둔 지시에 대한 범용 방어책입니다. 또한 모든 스캔은 **"AI-evasion techniques found: N"** 을 보고합니다. AI 분석을 피하려고 애쓰는 코드는 그 자체로 위험 신호입니다.

**REA가 필요한가요?** 아니요. 어떤 코딩 에이전트든 LASIK의 출력을 읽거나 `lasik_read`를 직접 호출할 수 있습니다. LASIK은 컴파일된 대상에 대해서는 REA와 자연스럽게 짝을 이룹니다.

**BLA가 그냥 우회하도록 패치하지 않을까요?** 아마도요. 핑거프린트는 BLA가 바꾸기 쉽지만, 정확한 증명은 그렇지 않습니다. BLA가 보호하는 프로그램은 여전히 같게 동작해야 하기 때문입니다. 그 비대칭이 LASIK의 토대입니다.

## 🤝 기여하기

새 BLA 버전이 패스를 망가뜨렸나요? 아티팩트(또는 최소 재현 예제)와 `lasik scan --json` 출력을 첨부해 이슈를 열어 주세요. [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요. PR을 보내기 전에 `npm test`를 실행하세요.

## 📄 라이선스

MIT © LASIK contributors. `bench/bla-crackme`의 벤치마크 코퍼스는 © BLA Contributors, MIT이며 변경 없이 포함되었습니다([LICENSE-BLA](../../bench/bla-crackme/LICENSE-BLA)). LASIK은 BLA 또는 REA와 제휴 관계가 없습니다.
