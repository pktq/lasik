<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  阅读那些专为躲避 AI 而构建的代码。<br />
  LASIK 移除 <a href="https://github.com/qybaihe/bla">BLA</a> 的反智能体加固，让编码智能体和 <a href="https://github.com/morluto/rea">REA</a> 能够分析真正的程序。
</p>

<p align="center">
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://github.com/pktq/lasik/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/pktq/lasik?color=blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.19-339933" alt="Node 20.19+" />
</p>

<p align="center">
  <a href="https://lasik.dev">网站</a> ·
  <a href="../how-it-works.md">工作原理</a> ·
  <a href="../benchmark.md">基准测试</a> ·
  <a href="../../CHANGELOG.md">更新日志</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="BLA CrackMe v6 中的同样两个函数，加固后与经 LASIK 处理后" width="100%" />
</p>

BLA 通过把发行版“埋起来”来防止 AI 智能体读取它：成千上万的不透明谓词、加密字符串、伪造的“硬件飞地”诱饵代码、移除诱饵就会破坏程序的校验、数 MB 的填充，以及专门写给模型看、让它知难而退的文本。LASIK 以纯静态方式把这一切全部移除，把真实存在的程序交给你的智能体。

## 亮点

- **token 减少 958 倍**：读取 BLA 自带的 CrackMe 语料，从约 2100 万降到 2.2 万。
- **有证明，不靠猜。** 只有在 LASIK 能证明谓词取值时才会折叠；在处理任何诱饵之前，先重新计算反剥离校验；不含 BLA 的文件，代码保持不变。
- **从不运行目标。** 不用 `eval`，不用沙箱，不实例化 WebAssembly，因此面对恶意输入也是安全的，包括采用 BLA 的恶意软件。
- **提示词防火墙**：清除 BLA 专门写给模型的文本，如伪造的系统轮次、拒绝诱饵、“这里没什么可看”的提示。
- **覆盖 BLA 支持的所有格式**：JavaScript 和 TypeScript 包、HTML 内联脚本、WebAssembly、Electron ASAR 归档与 fuse、source map 以及 Python。
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
Sight restored: 1.8 MB → 58.2 KB, ~21,104,859 → ~22,027 tokens

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
| v6 | 3 | 303 KB | 7.5 KB | 6,954,989 → 2,055 |
| v7 | 5 | 743 KB | 27.4 KB | 197,561 → 7,014 |
| v8 | 3 | 362 KB | 8.8 KB | 6,972,491 → 5,282 |
| v9 | 4 | 381 KB | 9.7 KB | 6,977,670 → 5,528 |

逐文件数据、方法及其局限见 [docs/benchmark.md](../benchmark.md)。LASIK 让 CrackMe 变得可读，但不会公布它们的解法。

## 工作原理

| BLA 层 | LASIK 的做法 |
|---|---|
| 不透明谓词 | 匹配 BLA 的数论恒等式，并用已知位分析证明依赖种子的谓词，然后删除死分支 |
| 反剥离互锁 | 先重新计算诱饵语料的摘要并折叠该校验，再移除任何内容 |
| 加密与拆分的字面量 | 用随附的密钥解码 XOR 字符串表；重新拼合被拆开的字符串和整数 |
| 诱饵 | 移除从真实入口点不可达的一切，并有一份 BLA 诱饵家族目录作为依据 |
| 自封与锁 | 移除 BLA 自身的防篡改与域名检查，并报告该锁的条件 |
| 运行时噪声 | 删除没人读取的影子堆抖动和伪造的飞地状态块 |
| 填充 | 在分析器限制内重建 WASM、ASAR 和 Electron fuse |
| 提示词诱饵 | 用 38 条防火墙规则清除 |

完整的处理顺序、证明和所有指纹见 [docs/how-it-works.md](../how-it-works.md)。一次独立评审专门寻找会让清理改变程序行为的输入；发现的每个案例都已修复，并固定在 [`tests/soundness.test.ts`](../../tests/soundness.test.ts) 中。

## 局限

- BLA 破坏掉的标识符名称、注释和 source map 无法恢复。LASIK 会如实说明，而不是凭空编造。
- SQLite、模型文件（safetensors、GGUF）、DEX/IL2CPP 和原生二进制文件目前只能检测，尚不能清理。
- ASAR 清理目前只在合成归档上测试过。
- LASIK 针对的是不超过 3.2 的 BLA。新的 BLA 层需要新的处理环节。

## 负责任地使用

LASIK 是一个反混淆工具。请将其用于你自己的软件、恶意软件与威胁样本、CTF，以及你被授权进行的审计。对你无权处理的软件移除保护，可能违反其许可协议，或违反 DMCA §1201 等法律。参见 [DISCLAIMER.md](../../DISCLAIMER.md)。

## 参与贡献

附带样本（或 `lasik scan --json` 输出）的错误报告是最有价值的贡献，尤其是针对新版 BLA 的报告。参见 [CONTRIBUTING](../../.github/CONTRIBUTING.md)。

[English](../../README.md) · 简体中文 · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

## 许可证

[MIT](../../LICENSE)。基准语料版权归 BLA Contributors 所有，采用 MIT 许可。LASIK 与 BLA 和 REA 没有隶属关系。
