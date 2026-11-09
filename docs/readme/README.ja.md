<p align="center"><a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>日本語</b> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  エージェント対策の硬化処理に対する静的な難読化解除。<br />
  LASIK は <a href="https://github.com/qybaihe/bla">BLA</a> の保護レイヤーを取り除き、コーディングエージェントや解析ツールが本来のプログラムを読めるようにします。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lasik-agents"><img src="https://img.shields.io/npm/v/lasik-agents?style=for-the-badge&label=npm&color=22d3ee" alt="npm version" /></a>
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pktq/lasik/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="../coverage.md"><img src="https://img.shields.io/badge/BLA_3.2.2-59%2F63_shields_healed-22d3ee?style=for-the-badge" alt="BLA coverage" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <b>0.3:</b> 構造に基づく検出。保護は名前ではなく振る舞いで識別されるため、名前を変更したビルドも修復できます。<a href="#レジリエンス">ベンチマーク</a>
</p>

<p align="center">
  <a href="../how-it-works.md">仕組み</a> ·
  <a href="../benchmark.md">ベンチマーク</a> ·
  <a href="../../CHANGELOG.md">変更履歴</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="保護されたビルドにある同じ 2 つの関数。LASIK 適用前と適用後" width="100%" />
</p>

LASIK は保護されたビルドを読み取り、どの部分が保護に当たるか（不透明述語、暗号化された文字列、おとりコード、改ざん検査、バイナリのパディング、プロンプトインジェクションのテキスト）を証明したうえで、それらを取り除いてクリーンなコピーを書き出します。入力は一切実行しません。

<p align="center"><img src="../assets/flow.svg" alt="保護されたリリースを lasik heal に通すと、エージェントまたは解析ツールが本来のロジックを読める" width="100%" /></p>

## 特長

- **トークン数を 1,262 分の 1 に。** 公開されている BLA の CrackMe コーパスで、約 2,100 万から 1.7 万に減ります。
- **証明に基づく処理。** 変換は、動作が保たれると LASIK が証明できたときだけ実行されます。保護されていないファイルはバイト単位で同一のまま返されます。
- **構造に基づく検出。** 保護は識別子ではなく振る舞いで認識されます。名前を変更したビルドのベンチマークを CI で実行しています。
- **静的解析のみ。** `eval`、サンドボックス、WebAssembly のインスタンス化は使わないため、悪意ある入力に対しても安全です。
- **プロンプトインジェクション・ファイアウォール。** モデルを誘導するために仕込まれたテキストに対応します。
- **21 形式**: JavaScript/TypeScript バンドル、インライン HTML、WebAssembly、Electron ASAR と fuses、source maps、Python と `.pyc`、ネイティブ ELF/PE/Mach-O、Bun、SQLite、safetensors と GGUF、PCAP、JVM、.NET、BEAM、EVM、PTX、ZIP/APK/DEX、plist、IL2CPP、UF2 ファームウェア。
- **名前の復元。** プログラムが元の名前を公開している箇所（エクスポート、インポート）で行い、それ以外は中立的な名前にします。
- **エージェント連携**: CLI、Claude Code、Cursor、Codex ほか 7 つに対応する MCP サーバー、そしてライブラリ API。

## インストール

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

Node.js 20.19 以降が必要です。ソースからビルドするには: `git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`

## 使い方

ビルドをスキャンし、クリーンなコピーを書き出します。

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 37.5 KB, ~21,104,859 → ~16,718 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

エージェントや解析ツール（たとえば [REA](https://github.com/morluto/rea)）に、修復したコピーを渡します。

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

そのほかのコマンド: `lasik firewall`（任意のテキストから仕込まれた指示を除去）、`lasik bench`、`lasik doctor`。`--json` または `--md` を付けると機械可読なレポートが得られ、`--fail-on blinded` を付けると CI のゲートにできます。

### コーディングエージェントで使う

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| ツール | |
|---|---|
| `lasik_scan` | ファイルまたはフォルダ内の保護レイヤー、0〜100 の盲目度スコア、見つかった手法 |
| `lasik_read` | 保護を取り除いた 1 ファイル。エージェントが元のファイルの代わりに読むためのもの |
| `lasik_heal` | アプリ全体のクリーンなコピー |
| `lasik_firewall` | 任意のテキストから、仕込まれた指示を除去したもの |

このリポジトリには、保護されたビルドに遭遇するエージェント向けの[エージェントスキル](../../.agents/skills/lasik/SKILL.md)も含まれています。

## ベンチマーク

公開されている BLA の CrackMe を、[`bench/bla-crackme`](../../bench/bla-crackme) に無改変で同梱しています。

| CrackMe | ファイル数 | 処理前 | 処理後 | トークン（推定） |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 4.9 KB | 6,954,989 → 1,398 |
| v7 | 5 | 743 KB | 13.6 KB | 197,561 → 3,483 |
| v8 | 3 | 362 KB | 6.7 KB | 6,972,491 → 4,748 |
| v9 | 4 | 381 KB | 7.4 KB | 6,977,670 → 4,941 |

<p align="center"><img src="../assets/tokens.svg" alt="対数目盛の棒グラフ: CrackMe の成果物ごとの、LASIK 適用前後の推定トークン数" width="100%" /></p>

<!-- realbench:start -->
On a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](../benchmark.md#your-own-code-hardened-by-real-bla-321)):

| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |
|---|---:|---:|---:|---:|---|---|
| Defaults | 21 | 151.9 KB | 31.1 MB | 150.9 KB | 32,154,076 → 152,102 | 21/21 healed, 11 byte-identical |
| All opt-in layers | 21 | 151.9 KB | 31.2 MB | 151.0 KB | 32,178,121 → 152,197 | 21/21 healed, 10 byte-identical |
<!-- realbench:end -->

ファイルごとの数値、測定方法とその注意点は [docs/benchmark.md](../benchmark.md) にあります。LASIK は CrackMe を読める状態にしますが、解答は公開しません。

### レジリエンス

`npm run bench:renamed` は同じビルドを 2 通りで修復します。出荷されたままの状態と、生成された識別子、コメント、WASM セクション、長いエクスポート名、ASAR パスをすべて別の綴りに置き換え、可換な演算子のオペランドを並べ替えた状態です（動作は変わりません）。検出は構造に基づくため、どちらもほぼ同じ結果に修復されます。綴りを置き換えた側の除去率が 1 ポイントを超えて低い場合、CI は失敗します。

<p align="center"><img src="../assets/renamed.svg" alt="左: ベンチマークが別の綴りに置き換える対象の例。右: 形式ごとの残りトークン数。綴りを置き換えたビルドも、元のビルドとほぼ同じサイズに修復される" width="100%" /></p>

| 形式 | 出荷時のまま: 除去率 | 綴りを置き換え: 除去率 |
|---|---:|---:|
| JavaScript / TypeScript | 98.78% | 98.09% |
| HTML | 99.29% | 99.17% |
| WebAssembly | 99.98% | 99.98% |
| Electron ASAR | 99.998% | 99.96% |

## 仕組み

<p align="center"><img src="../assets/pipeline.svg" alt="LASIK のパス順序: 検出、インターロックの切断、おとりの除去、不動点までの畳み込み、改名、ファイアウォール、レポート" width="100%" /></p>

| レイヤー | LASIK の処理 |
|---|---|
| 不透明述語 | 既知ビット解析で定数の条件を証明し、到達しない分岐を取り除く |
| anti-strip インターロック | 閉じた部分集合のインタプリタで検査を評価し、何かを取り除く前に畳み込む |
| 暗号化・分割されたリテラル | 隣に同梱されたキーで文字列テーブルを復号し、分割された文字列と整数を結合し直す |
| おとり | 実際のエントリポイントから到達できないものをすべて除去する |
| 改ざん検査とドメインロック | 取り除いたうえで、ロックの条件を報告する |
| 実行時ノイズ | 誰も読まない状態の揺れとステータスブロックを除去する |
| 改名された識別子 | プログラムがエクスポートまたはインポートしている名前を復元し、それ以外は中立的な名前にする |
| パディングと埋め込みデータ | バイナリ、データベース、モデル、アーカイブからパディング、トレーラー、埋め込まれたエントリを取り除き、オフセットとチェックサムを再構築する |
| 仕込まれた指示 | 40 のファイアウォールルールで除去する |

詳細は [docs/how-it-works.md](../how-it-works.md) にあります。独立した 2 回の健全性レビューで、修復によって動作が変わる入力や、保護されていないファイルに手が加わる入力を探しました。見つかったケースはすべて修正済みで、[`tests/soundness.test.ts`](../../tests/soundness.test.ts) に固定されています。

## 形式ごとの対応状況

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

## 制限事項

- 保護によって失われた情報（ローカル名、コメント、元のソースマップ、上書きされたセクション）は復元できません。LASIK は作り上げるのではなく、その旨を報告します。
- 形式ごとの修復は、21 形式について実際の BLA 3.2.1 の出力で検証済みです（[tests/fixtures/bla-3.2.1](../../tests/fixtures/bla-3.2.1)）。Go、Flutter、Bun、BEAM、APK/DEX、IL2CPP は、今のところ BLA のソースから作成したフィクスチャでのみ検証しています。
- 新しい保護手法には更新が必要になることがあります。上流の変更は毎週追跡しており（[coverage/bla.json](../../coverage/bla.json)）、以前のバージョンで保護されたビルドも引き続き対応します。

## 責任ある利用

LASIK は難読化解除ツールです。ご自身のソフトウェア、マルウェアや脅威サンプル、CTF、そして実施を許可された監査にご利用ください。権利のないソフトウェアから保護を取り除くと、ライセンスや DMCA §1201 などの法律に違反するおそれがあります。[DISCLAIMER.md](../../DISCLAIMER.md) を参照してください。

## コントリビュート

サンプル（または `lasik scan --json` の出力）を添えたバグ報告が最も役に立ちます。[CONTRIBUTING](../../.github/CONTRIBUTING.md) を参照してください。

ほかの言語: [English](../../README.md) · [简体中文](README.zh-CN.md) · 日本語 · [한국어](README.ko.md) · [Español](README.es.md)

## ライセンス

[MIT](../../LICENSE)。ベンチマークのコーパスの著作権は BLA Contributors に帰属し、MIT ライセンスです。LASIK は BLA および REA とは無関係です。
