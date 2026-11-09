<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  AI から隠れるように作られたコードを読む。<br />
  LASIK は <a href="https://github.com/qybaihe/bla">BLA</a> のエージェント対策の硬化処理を取り除き、コーディングエージェントと <a href="https://github.com/morluto/rea">REA</a> が本物のプログラムを解析できるようにします。
</p>

<p align="center">
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://github.com/pktq/lasik/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/pktq/lasik?color=blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.19-339933" alt="Node 20.19+" />
</p>

<p align="center">
  <a href="https://lasik.dev">Web サイト</a> ·
  <a href="../how-it-works.md">仕組み</a> ·
  <a href="../benchmark.md">ベンチマーク</a> ·
  <a href="../../CHANGELOG.md">変更履歴</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="BLA の CrackMe v6 にある同じ 2 つの関数。硬化後と LASIK 適用後" width="100%" />
</p>

BLA は、リリースを埋め尽くすことで AI エージェントから守ります。数千の不透明述語、暗号化された文字列、偽の「ハードウェアエンクレーブ」コード、おとりを取り除くとプログラムが壊れる検査、数 MB のパディング、そしてモデルに諦めさせるために書かれたテキストです。LASIK はそのすべてを静的に取り除き、実際にあるプログラムをエージェントに渡します。

## 特長

- **トークン数を 958 分の 1 に。** BLA 自身の CrackMe コーパスを読むとき、約 2,100 万から 2.2 万に減ります。
- **推測ではなく証明。** 述語は LASIK が値を証明できたときだけ畳み込みます。anti-strip 検査は、おとりに触れる前に再計算します。BLA を含まないファイルのコードは変わりません。
- **対象を実行しません。** `eval` も、サンドボックスも、WebAssembly のインスタンス化も使わないため、BLA を採用したマルウェアを含む悪意ある入力に対しても安全です。
- **プロンプトファイアウォール。** BLA がモデル向けに仕込むテキスト、つまり偽のシステムターン、拒否を誘う餌、「ここには何もありません」という通知を取り除きます。
- **BLA が扱うすべての形式に対応。** JavaScript と TypeScript のバンドル、HTML のインラインスクリプト、WebAssembly、Electron の ASAR アーカイブと fuse、ソースマップ、Python。
- **エージェント向けに作られています。** CLI、Claude Code、Cursor、Codex ほか 7 つに対応する MCP サーバー、そしてライブラリ API を備えます。

## インストール

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

Node.js 20.19 以降が必要です。ソースからビルドするには: `git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`

## 使い方

ビルドをスキャンして BLA が何をしたかを確認し、クリーンなコピーを書き出します。

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 58.2 KB, ~21,104,859 → ~22,027 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

エージェントまたは REA に、修復したコピーを渡します。

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

そのほかのコマンド: `lasik firewall`（任意のテキストからプロンプトのおとりを除去）、`lasik bench`、`lasik doctor`。`--json` または `--md` を付けると機械可読なレポートが得られ、`--fail-on blinded` を付けると CI のゲートにできます。

### コーディングエージェントで使う

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| ツール | |
|---|---|
| `lasik_scan` | ファイルまたはフォルダにどの BLA レイヤーがあるか、0〜100 の盲目度スコア、見つかった AI 回避手法 |
| `lasik_read` | BLA を取り除いた 1 ファイル。エージェントが元のファイルの代わりに読むためのもの |
| `lasik_heal` | アプリ全体のクリーンなコピー。そのまま REA に渡せます |
| `lasik_firewall` | 任意のテキストから、仕込まれた指示を除去したもの |

このリポジトリには [エージェントスキル](../../.agents/skills/lasik/SKILL.md) も含まれており、エージェントに BLA を見分けてこれらのツールを使うことを教えます。

## ベンチマーク

BLA のメンテナーが課題として公開した CrackMe で計測しました。[`bench/bla-crackme`](../../bench/bla-crackme) に無改変で同梱しています。

| CrackMe | ファイル数 | 処理前 | 処理後 | トークン（推定） |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 7.5 KB | 6,954,989 → 2,055 |
| v7 | 5 | 743 KB | 27.4 KB | 197,561 → 7,014 |
| v8 | 3 | 362 KB | 8.8 KB | 6,972,491 → 5,282 |
| v9 | 4 | 381 KB | 9.7 KB | 6,977,670 → 5,528 |

ファイルごとの数値、測定方法とその注意点は [docs/benchmark.md](../benchmark.md) にあります。LASIK は CrackMe を読める状態にしますが、解答は公開しません。

## 仕組み

| BLA のレイヤー | LASIK の処理 |
|---|---|
| 不透明述語 | BLA の整数論的恒等式に一致させ、シードに依存するものは既知ビット解析で証明したうえで、到達しない分岐を取り除く |
| anti-strip インターロック | おとりコーパスのダイジェストを再計算して検査を畳み込んでから、何かを取り除く |
| 暗号化・分割されたリテラル | 隣に同梱されたキーで XOR 文字列テーブルを復号し、分割された文字列と整数を結合し直す |
| おとり | 実際のエントリポイントから到達できないものをすべて除去する。根拠は BLA のおとりファミリーのカタログ |
| セルフシールとロック | BLA 自身の改ざん検査とドメイン検査を取り除き、ロックの条件を報告する |
| 実行時ノイズ | 誰も読まないシャドウヒープの揺れと偽のエンクレーブ状態ブロックを除去する |
| パディング | WASM、ASAR、Electron fuse を、解析ツールの上限内に再構築する |
| プロンプトの餌 | 38 のファイアウォールルールで除去する |

処理の完全な順序、証明、すべてのフィンガープリントは [docs/how-it-works.md](../how-it-works.md) にあります。独立したレビューで、修復によってプログラムの動作が変わる入力を探しました。見つかったケースはすべて修正済みで、[`tests/soundness.test.ts`](../../tests/soundness.test.ts) に固定されています。

## 制限事項

- BLA が破壊した識別子名、コメント、ソースマップは復元できません。LASIK は作り上げるのではなく、その旨を伝えます。
- SQLite、モデルファイル（safetensors、GGUF）、DEX/IL2CPP、ネイティブバイナリは検出するだけで、まだクリーンアップはできません。
- ASAR の修復は、合成したアーカイブでしかテストしていません。
- LASIK が対象とするのは BLA 3.2 までです。新しい BLA のレイヤーには新しいパスが必要です。

## 責任ある利用

LASIK は難読化解除ツールです。ご自身のソフトウェア、マルウェアや脅威サンプル、CTF、そして実施を許可された監査にご利用ください。権利のないソフトウェアから保護を取り除くと、ライセンスや DMCA §1201 などの法律に違反するおそれがあります。[DISCLAIMER.md](../../DISCLAIMER.md) を参照してください。

## コントリビュート

サンプル（または `lasik scan --json` の出力）を添えたバグ報告が最も役に立ちます。特に新しいバージョンの BLA についての報告を歓迎します。[CONTRIBUTING](../../.github/CONTRIBUTING.md) を参照してください。

[English](../../README.md) · [简体中文](README.zh-CN.md) · 日本語 · [한국어](README.ko.md) · [Español](README.es.md)

## ライセンス

[MIT](../../LICENSE)。ベンチマークのコーパスの著作権は BLA Contributors に帰属し、MIT ライセンスです。LASIK は BLA および REA とは無関係です。
