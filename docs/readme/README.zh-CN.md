<p align="center"><a href="../../README.md">English</a> · <b>简体中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  阅读那些专为躲避 AI 而构建的代码。<br />
  LASIK 移除 <a href="https://github.com/qybaihe/bla">BLA</a> 的反智能体加固，让编码智能体和 <a href="https://github.com/morluto/rea">REA</a> 能够分析真正的程序。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lasik-agents"><img src="https://img.shields.io/npm/v/lasik-agents?style=for-the-badge&label=npm&color=22d3ee" alt="npm version" /></a>
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pktq/lasik/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="../../docs/coverage.md"><img src="https://img.shields.io/badge/BLA_3.2.1-59%2F63_shields_healed-22d3ee?style=for-the-badge" alt="BLA coverage" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="../how-it-works.md">工作原理</a> ·
  <a href="../benchmark.md">基准测试</a> ·
  <a href="../../CHANGELOG.md">更新日志</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="BLA CrackMe v6 中的同样两个函数，加固后与经 LASIK 处理后" width="100%" />
</p>

BLA 通过把发行版“埋起来”来防止 AI 智能体读取它：成千上万的不透明谓词、加密字符串、伪造的“硬件飞地”诱饵代码、移除诱饵就会破坏程序的校验、数 MB 的填充，以及专门写给模型看、让它知难而退的文本。LASIK 以纯静态方式把这一切全部移除，把真实存在的程序交给你的智能体。

<p align="center"><img src="../assets/flow.svg" alt="A BLA-hardened release goes through lasik heal, then an agent or REA reads the real logic" width="100%" /></p>

## 亮点

- **token 减少 1262 倍**：读取 BLA 自带的 CrackMe 语料，从约 2100 万降到 1.7 万。
- **有证明，不靠猜。** 只有在 LASIK 能证明谓词取值时才会折叠；在处理任何诱饵之前，先重新计算反剥离校验；不含 BLA 的文件，代码保持不变。
- **从不运行目标。** 不用 `eval`，不用沙箱，不实例化 WebAssembly，因此面对恶意输入也是安全的，包括采用 BLA 的恶意软件。
- **提示词防火墙**：清除 BLA 专门写给模型的文本，如伪造的系统轮次、拒绝诱饵、“这里没什么可看”的提示。
- **覆盖 BLA 支持的所有格式**，并用真实的 BLA 3.2.1 输出验证：JavaScript/TypeScript, HTML, WebAssembly, Electron ASAR/fuses, source maps, Python/`.pyc`, ELF/PE/Mach-O, Bun, SQLite, safetensors/GGUF, PCAP, JVM, .NET, BEAM, EVM, PTX, ZIP/APK/DEX, plist, IL2CPP, UF2。
- **恢复程序自己公开的名字**：BLA 改名为 `primeSparseStack_719` 但以 `clampPan` 导出的函数会重新叫 `clampPan`；其余 BLA 名字改为中性的 `p0`、`v0`，而不是误导性的名字。
- **紧跟 BLA 更新**：BLA 的每个源文件都在 [coverage/bla.json](../../coverage/bla.json) 中记录了哈希，BLA 一有变化，每周任务就会开一个 issue。
- **为智能体而生**：提供 CLI、适用于 Claude Code、Cursor、Codex 等另外七种工具的 MCP 服务器，以及库 API。

## 安装

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

需要 Node.js 20.19 或更高版本。从源码构建：`git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`。

## 使用

先扫描一个构建产物，看看 BLA 对它做了什么，再写出清理后的副本：

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 37.5 KB, ~21,104,859 → ~16,718 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

让你的智能体或 REA 去分析清理后的副本：

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

其他命令：`lasik firewall`（清除任意文本中的提示词诱饵）、`lasik bench`、`lasik doctor`。加上 `--json` 或 `--md` 可得到机器可读的报告，加上 `--fail-on blinded` 可在 CI 中作为门禁。

### 在你的编码智能体中

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| 工具 | |
|---|---|
| `lasik_scan` | 文件或文件夹带有哪些 BLA 层、0–100 的致盲分数，以及发现的 AI 规避技术 |
| `lasik_read` | 移除 BLA 之后的单个文件，供智能体代替原文件阅读 |
| `lasik_heal` | 整个应用的清理副本，可直接交给 REA |
| `lasik_firewall` | 清除任意文本中被植入的指令 |

仓库还附带一个[智能体技能](../../.agents/skills/lasik/SKILL.md)，教智能体识别 BLA 并使用这些工具。

## 基准测试

在 BLA 维护者公开发布的 CrackMe 挑战上测得，原样收录于 [`bench/bla-crackme`](../../bench/bla-crackme)：

| CrackMe | 文件数 | 处理前 | 处理后 | token（估算） |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 4.9 KB | 6,954,989 → 1,398 |
| v7 | 5 | 743 KB | 13.6 KB | 197,561 → 3,483 |
| v8 | 3 | 362 KB | 6.7 KB | 6,972,491 → 4,748 |
| v9 | 4 | 381 KB | 7.4 KB | 6,977,670 → 4,941 |

<p align="center"><img src="../assets/tokens.svg" alt="Log-scale bar chart: estimated tokens per BLA CrackMe artifact before and after LASIK" width="100%" /></p>

<!-- realbench:start -->
On a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](../benchmark.md#your-own-code-hardened-by-real-bla-321)):

| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |
|---|---:|---:|---:|---:|---|---|
| Defaults | 21 | 151.9 KB | 31.1 MB | 150.9 KB | 32,154,076 → 152,102 | 21/21 healed, 11 byte-identical |
| All opt-in layers | 21 | 151.9 KB | 31.2 MB | 151.0 KB | 32,178,121 → 152,197 | 21/21 healed, 10 byte-identical |
<!-- realbench:end -->

逐文件数据、方法及其局限见 [docs/benchmark.md](../benchmark.md)。LASIK 让 CrackMe 变得可读，但不会公布它们的解法。

## 工作原理

<p align="center"><img src="../assets/pipeline.svg" alt="LASIK pass order: detect, cut interlocks, strip decoys, fold to a fixpoint, rename, firewall, report" width="100%" /></p>

| BLA 层 | LASIK 的做法 |
|---|---|
| 不透明谓词 | 匹配 BLA 的数论恒等式，并用已知位分析证明依赖种子的谓词，然后删除死分支 |
| 反剥离互锁 | 先重新计算诱饵语料的摘要并折叠该校验，再移除任何内容 |
| 加密与拆分的字面量 | 用随附的密钥解码 XOR 字符串表；重新拼合被拆开的字符串和整数 |
| 诱饵 | 移除从真实入口点不可达的一切，并有一份 BLA 诱饵家族目录作为依据 |
| 自封与锁 | 移除 BLA 自身的防篡改与域名检查，并报告该锁的条件 |
| 运行时噪声 | 删除没人读取的影子堆抖动和伪造的飞地状态块 |
| 被改名的标识符 | 恢复程序导出或导入某个绑定时使用的名字；其余改为中性名字 |
| 填充与植入数据 | 从二进制文件、数据库、模型和归档中清除 BLA 的段、尾部数据、蜜罐表、诱饵条目和洪泛数据，并重建偏移和校验和，使文件保持有效 |
| 提示词诱饵 | 用 40 条防火墙规则清除 |

完整的处理顺序、证明和所有指纹见 [docs/how-it-works.md](../how-it-works.md)。一次独立评审专门寻找会让清理改变程序行为的输入；发现的每个案例都已修复，并固定在 [`tests/soundness.test.ts`](../../tests/soundness.test.ts) 中。

## 格式覆盖

<!-- coverage:start -->
Pinned to BLA **3.2.1**. 59/63 BLA shield files fully healed; 44 more emit nothing into artifacts. Full per-file table: [docs/coverage.md](../coverage.md).

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

- 局部变量名、注释、source map，以及 BLA 覆盖掉的少数段（Go 的 `.go.buildinfo`、被改名的 WASM 导出）无法恢复。LASIK 会如实说明，而不是凭空编造。
- 各格式的修复器能精确识别 BLA 3.2.1 的输出。已用真实 BLA 输出验证 21 种格式（[tests/fixtures/bla-3.2.1](../../tests/fixtures/bla-3.2.1)）；Go、Flutter、Bun、BEAM、APK/DEX 和 IL2CPP 目前只用根据 BLA 源码构建的测试样例验证过。
- BLA 变化后，某个修复器可能在更新前无法匹配。每周的变更检查会指出需要复查的文件；JavaScript 核心靠证明工作，不依赖 BLA 的名字。

## 负责任地使用

LASIK 是一个反混淆工具。请将其用于你自己的软件、恶意软件与威胁样本、CTF，以及你被授权进行的审计。对你无权处理的软件移除保护，可能违反其许可协议，或违反 DMCA §1201 等法律。参见 [DISCLAIMER.md](../../DISCLAIMER.md)。

## 参与贡献

附带样本（或 `lasik scan --json` 输出）的错误报告是最有价值的贡献，尤其是针对新版 BLA 的报告。参见 [CONTRIBUTING](../../.github/CONTRIBUTING.md)。

[English](../../README.md) · 简体中文 · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

## 许可证

[MIT](../../LICENSE)。基准语料版权归 BLA Contributors 所有，采用 MIT 许可。LASIK 与 BLA 和 REA 没有隶属关系。
