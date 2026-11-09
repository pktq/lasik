<p align="center"><a href="../../README.md">English</a> · <b>简体中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  针对反智能体加固的静态反混淆工具。<br />
  LASIK 移除 <a href="https://github.com/qybaihe/bla">BLA</a> 的保护层，让编码智能体和分析工具能够读取真正的程序。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lasik-agents"><img src="https://img.shields.io/npm/v/lasik-agents?style=for-the-badge&label=npm&color=22d3ee" alt="npm version" /></a>
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pktq/lasik/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="../../docs/coverage.md"><img src="https://img.shields.io/badge/BLA_3.2.2-59%2F63_shields_healed-22d3ee?style=for-the-badge" alt="BLA coverage" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <b>0.3：</b>结构化检测。保护按其行为而非名称来识别，因此被改名的构建同样可以清理。<a href="#韧性">基准测试</a>
</p>

<p align="center">
  <a href="../how-it-works.md">工作原理</a> ·
  <a href="../benchmark.md">基准测试</a> ·
  <a href="../../CHANGELOG.md">更新日志</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="同一个受保护构建中的两个函数，处理前与经 LASIK 处理后" width="100%" />
</p>

LASIK 读取受保护的构建，证明其中哪些部分属于保护（不透明谓词、加密字符串、诱饵代码、防篡改校验、二进制填充、提示词注入文本），将其移除，并写出一份干净的副本。它从不运行输入。

<p align="center"><img src="../assets/flow.svg" alt="受保护的发行版经过 lasik heal，之后智能体或分析工具读取真实逻辑" width="100%" /></p>

## 亮点

- **token 减少 1262 倍**：在公开的 BLA CrackMe 语料上，从约 2100 万降到 1.7 万。
- **基于证明。** 只有当 LASIK 能证明某项转换保持行为不变时才会执行。未受保护的文件原样返回，字节完全一致。
- **结构化检测。** 按行为而非标识符识别保护；CI 中运行改名构建的基准测试。
- **纯静态。** 不用 `eval`，不用沙箱，不实例化 WebAssembly，因此面对恶意输入也是安全的。
- **提示词注入防火墙**：处理为引导模型而植入的文本。
- **21 种格式**：JavaScript 与 TypeScript 包、内联 HTML、WebAssembly、Electron ASAR 与 fuses、source maps、Python 与 `.pyc`、原生 ELF/PE/Mach-O、Bun、SQLite、safetensors 与 GGUF、PCAP、JVM、.NET、BEAM、EVM、PTX、ZIP/APK/DEX、plist、IL2CPP 以及 UF2 固件。
- **名称恢复**：程序仍公开原始名称的地方（导出、导入）会恢复；其余使用中性名称。
- **智能体集成**：提供 CLI、适用于 Claude Code、Cursor、Codex 等另外七种工具的 MCP 服务器，以及库 API。

## 安装

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

需要 Node.js 20.19 或更高版本。从源码构建：`git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`。

## 使用

先扫描一个构建产物，再写出清理后的副本：

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 37.5 KB, ~21,104,859 → ~16,718 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

让你的智能体或分析工具去读取清理后的副本，例如 [REA](https://github.com/morluto/rea)：

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

其他命令：`lasik firewall`（清除任意文本中被植入的指令）、`lasik bench`、`lasik doctor`。加上 `--json` 或 `--md` 可得到机器可读的报告，加上 `--fail-on blinded` 可在 CI 中作为门禁。

### 在你的编码智能体中

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| 工具 | |
|---|---|
| `lasik_scan` | 文件或文件夹中的保护层、0–100 的致盲分数，以及发现的技术 |
| `lasik_read` | 移除保护后的单个文件，供智能体代替原文件阅读 |
| `lasik_heal` | 整个应用的清理副本 |
| `lasik_firewall` | 清除任意文本中被植入的指令 |

仓库还附带一个[智能体技能](../../.agents/skills/lasik/SKILL.md)，供遇到受保护构建的智能体使用。

## 基准测试

公开的 BLA CrackMe，原样收录于 [`bench/bla-crackme`](../../bench/bla-crackme)：

| CrackMe | 文件数 | 处理前 | 处理后 | token（估算） |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 4.9 KB | 6,954,989 → 1,398 |
| v7 | 5 | 743 KB | 13.6 KB | 197,561 → 3,483 |
| v8 | 3 | 362 KB | 6.7 KB | 6,972,491 → 4,748 |
| v9 | 4 | 381 KB | 7.4 KB | 6,977,670 → 4,941 |

<p align="center"><img src="../assets/tokens.svg" alt="对数刻度柱状图：每个 CrackMe 产物在 LASIK 处理前后的估算 token 数" width="100%" /></p>

<!-- realbench:start -->
On a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](../benchmark.md#your-own-code-hardened-by-real-bla-321)):

| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |
|---|---:|---:|---:|---:|---|---|
| Defaults | 21 | 151.9 KB | 31.1 MB | 150.9 KB | 32,154,076 → 152,102 | 21/21 healed, 11 byte-identical |
| All opt-in layers | 21 | 151.9 KB | 31.2 MB | 151.0 KB | 32,178,121 → 152,197 | 21/21 healed, 10 byte-identical |
<!-- realbench:end -->

逐文件数据、方法及其局限见 [docs/benchmark.md](../benchmark.md)。LASIK 让 CrackMe 变得可读，但不会公布它们的解法。

### 韧性

`npm run bench:renamed` 会对同一批构建清理两次：一次按原样，一次把所有生成的标识符、注释、WASM 段、长导出名和 ASAR 路径重新拼写，并调换可交换运算数的顺序，同时保持行为不变。由于检测基于结构，两次的清理结果几乎相同。如果重新拼写的那一次比原样少移除超过一个百分点，CI 就会失败。

<p align="center"><img src="../assets/renamed.svg" alt="左：基准测试所做重新拼写的示例。右：各格式剩余的 token 数；重新拼写后的构建清理后的大小与原构建几乎相同" width="100%" /></p>

| 格式 | 原样：移除比例 | 重新拼写：移除比例 |
|---|---:|---:|
| JavaScript / TypeScript | 98.78% | 98.09% |
| HTML | 99.29% | 99.17% |
| WebAssembly | 99.98% | 99.98% |
| Electron ASAR | 99.998% | 99.96% |

## 工作原理

<p align="center"><img src="../assets/pipeline.svg" alt="LASIK 的处理顺序：检测、切断互锁、清除诱饵、折叠至不动点、重命名、防火墙、报告" width="100%" /></p>

| 层 | LASIK 的做法 |
|---|---|
| 不透明谓词 | 用已知位分析证明恒定条件，并删除死分支 |
| 反剥离互锁 | 在解释器的封闭子集上计算该校验并将其折叠，然后再移除任何内容 |
| 加密与拆分的字面量 | 用随附的密钥解码字符串表；重新拼合被拆开的字符串和整数 |
| 诱饵 | 移除从真实入口点不可达的一切 |
| 防篡改与域名锁 | 移除它们，并报告该锁的条件 |
| 运行时噪声 | 删除没人读取的状态抖动和状态块 |
| 被改名的标识符 | 恢复程序导出或导入时使用的名字；其余使用中性名字 |
| 填充与植入数据 | 从二进制文件、数据库、模型和归档中清除填充、尾部数据和被植入的条目，并重建偏移和校验和 |
| 被植入的指令 | 用 40 条防火墙规则清除 |

详情见 [docs/how-it-works.md](../how-it-works.md)。两次独立的可靠性评审专门寻找会让清理改变程序行为或触及未受保护文件的输入；发现的每个案例都已修复，并固定在 [`tests/soundness.test.ts`](../../tests/soundness.test.ts) 中。

## 格式覆盖

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

## 局限

- 保护所破坏的信息（局部变量名、注释、原始 source map、被覆盖的段）无法恢复；LASIK 会如实报告，而不是凭空编造。
- 各格式的修复器已用真实的 BLA 3.2.1 输出验证 21 种格式（[tests/fixtures/bla-3.2.1](../../tests/fixtures/bla-3.2.1)）；Go、Flutter、Bun、BEAM、APK/DEX 和 IL2CPP 目前只用根据 BLA 源码构建的测试样例验证过。
- 新的保护技术可能需要更新。上游变化每周跟踪一次（[coverage/bla.json](../../coverage/bla.json)），用早期版本保护的构建仍受支持。

## 负责任地使用

LASIK 是一个反混淆工具。请将其用于你自己的软件、恶意软件与威胁样本、CTF，以及你被授权进行的审计。对你无权处理的软件移除保护，可能违反其许可协议，或违反 DMCA §1201 等法律。参见 [DISCLAIMER.md](../../DISCLAIMER.md)。

## 参与贡献

附带样本（或 `lasik scan --json` 输出）的错误报告是最有价值的贡献。参见 [CONTRIBUTING](../../.github/CONTRIBUTING.md)。

另有以下语言版本：[简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)。

## 许可证

[MIT](../../LICENSE)。基准语料版权归 BLA Contributors 所有，采用 MIT 许可。LASIK 与 BLA 和 REA 没有隶属关系。
