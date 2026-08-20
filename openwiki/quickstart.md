---
type: クイックスタート
title: Totonoe Log コードWiki クイックスタート
description: ログを正規化・マージ・絞り込み・折りたたみ・比較する VS Code 拡張 Totonoe Log の目的、開発開始手順、主要な設計領域への入口。
resource: "https://github.com/upu/Totonoe-Log"
tags: [quickstart, vscode-extension, logs]
openwiki:
  roles: [repository, architecture, workflow]
  change_kinds: [task-routing, onboarding]
  source_paths: [package.json, src/extension.ts, src/normalize/index.ts]
  validation_commands: [npm run compile && npm run lint && npm run build]
---

# Totonoe Log コードWiki クイックスタート

## このリポジトリが提供するもの

Totonoe Log は「バラバラなログを、調査しやすい時系列に整える」VS Code 拡張である。形式の異なるログを共通モデルへ正規化し、時系列マージ、セベリティ・日時・正規表現による絞り込み、繰り返しの折りたたみ、共有前のマスク、差分比較を提供する。製品説明の正本は `README.ja.md`、コマンドの起動導線と出力の正本は `docs/features/commands.ja.md`、開発方針の正本は `AGENTS.md` である。

現在の `package.json` は v0.12.0 を示す。このリリースでは、組み込みセベリティ語彙と `totonoeLog.severityTokens`、行頭より前に既知フィールドを持つタイムスタンプ、JSON Lines（NDJSON）の構造化正規化が加わった。変更履歴の `[Unreleased]` では、Interactive Viewから選択範囲に基づくcustom timestamp patternを提案・検証・保存し、低認識率警告からその補助へ移動できる。解析規則は[ログ処理ドメイン](/openwiki/domain/log-processing.md)、新しい操作と実装境界は[タイムスタンプ形式補助ワークフロー](/openwiki/workflows/timestamp-format-helper.md)を参照する。

## 最短で開発を始める

前提は Node.js と npm、VS Code である。CIは Node 24.x を使用する。

```bash
npm ci
npm run compile
npm run lint
npm run build
npm test
npm run check:package
```

- `npm run compile`: 拡張本体とWebviewをTypeScriptコンパイルする。
- `npm run build`: `out/extension.js` と `out/webview/interactiveView/main.js` をesbuildで生成する。
- `npm test`: VS Code Electron上でMochaテストを実行する。`compile` と `build` の成果物が必要である。
- `npm run package`: `dist/totonoe-log.vsix` を生成する。
- F5開発では `.vscode/` と `npm run watch` の構成を利用する。TypeScript変更前に `docs/coding-guidelines.md` を読む。

詳しい実行順、CI、リリースは[開発運用ランブック](/openwiki/operations/runbook.md)、テストの選び方は[テスト戦略](/openwiki/testing/guide.md)を参照する。

## 最初に理解する3つの境界

1. `src/normalize/` はVS Code APIに依存しない純粋なログ処理層である。
2. `src/extension.ts` と各 `*View.ts` はVS Codeのコマンド、文書、設定、ファイルI/Oへ接続する。
3. Interactive Viewは拡張ホスト側で処理し、Webview側はJSONメッセージで状態を受けて描画する。

この分離と実行時の全体像は[アーキテクチャ概要](/openwiki/architecture/overview.md)、ファイルから変更箇所を探す場合は[ソースマップ](/openwiki/source-map.md)が入口になる。

## 機能を追う推奨順

1. [ログ処理ドメイン](/openwiki/domain/log-processing.md)で `LogEntry`、`MergedEntry`、`LineSource` と処理順を理解する。
2. [ログ調査ワークフロー](/openwiki/workflows/log-investigation.md)で入力から表示、export、元行ジャンプまでを追う。
3. [タイムスタンプ形式補助ワークフロー](/openwiki/workflows/timestamp-format-helper.md)で未認識行からのpattern提案、preview、設定保存、再parseを追う。
4. [VS Code統合](/openwiki/integrations/vscode.md)でコマンド、仮想ドキュメント、Webview、設定境界を確認する。
5. [テスト戦略](/openwiki/testing/guide.md)から変更内容に対応する回帰テストを選ぶ。

## タスク別ルーティング

| 変更領域・意図 | Wiki | 正確なソース入口 | 重要なsymbol・型 | focused test | 最小検証コマンド |
| --- | --- | --- | --- | --- | --- |
| parse、timestamp、JSON Lines、severity | [ログ処理ドメイン](/openwiki/domain/log-processing.md) | `src/normalize/parseLog.ts`, `src/normalize/jsonLogLine.ts`, `src/normalize/customTimestampFormats.ts` | `LogEntry`, `parseLog`, `compileCustomTimestampFormats` | `src/test/suite/normalize.test.ts` | `npm run compile && npm test -- --grep "parseLog|timestampFormats|JSON Lines"` |
| 未認識時刻からpatternを提案・保存 | [タイムスタンプ形式補助](/openwiki/workflows/timestamp-format-helper.md) | `src/normalize/timestampPatternInference.ts`, `src/interactiveView.ts`, `src/timestampFormatSettings.ts` | `inferTimestampPattern`, `previewTimestampFormat`, `writeTimestampFormatRows` | `src/test/suite/timestampPatternInference.test.ts`, `src/test/suite/interactiveView.test.ts`, `src/test/suite/extension.test.ts` | `npm run compile && npm run build && npm test -- --grep "inferTimestampPattern|timestampFormatSettings|timestamp formats"` |
| filter、mask、collapse、highlight | [ログ調査ワークフロー](/openwiki/workflows/log-investigation.md) | `src/normalize/filterEntries.ts`, `src/normalize/displayMask.ts`, `src/normalize/collapseRepeatedEntries.ts`, `src/normalize/highlightDisplayLines.ts` | `FilterCriteria`, `PatternWorkerSession`, `RefreshRevisionGate` | `src/test/suite/normalize.test.ts`, `src/test/suite/interactiveViewRefresh.test.ts` | `npm run compile && npm test -- --grep "filter|mask|collapse|highlight"` |
| Interactive View UI・protocol | [VS Code統合](/openwiki/integrations/vscode.md) | `src/webview/interactiveView/protocol.ts`, `src/interactiveView.ts`, `src/webview/interactiveView/main.ts` | `WebviewToExtensionMessage`, `InteractiveViewStateMessage`, `InteractiveViewPanelController` | `src/test/suite/interactiveView.test.ts`, `src/test/suite/interactiveViewHtml.test.ts`, `src/test/suite/interactiveViewLabels.test.ts` | `npm run compile && npm run build && npm test -- --grep "interactiveView"` |
| command、menu、仮想文書、元行ジャンプ | [VS Code統合](/openwiki/integrations/vscode.md) | `package.json`, `src/extension.ts`, `src/virtualDocumentContentProvider.ts` | `activate`, `VirtualDocumentContentProvider`, `SourceLineMap` | `src/test/suite/extension.test.ts`, `src/test/suite/openInVirtualDocument.test.ts`, `src/test/suite/goToSourceLine.test.ts` | `npm run compile && npm run build && npm test -- --grep "command|virtual document|source line"` |
| build、VSIX、release | [運用ランブック](/openwiki/operations/runbook.md) | `package.json`, `scripts/esbuild.js`, `scripts/check-package-contents.js`, `.github/workflows/release.yml` | npm scripts, `EXPECTED` | package contents check | `npm run build && npm run check:package` |

`npm test -- --grep` はcompile済みMocha test名を絞る。変更に合う安定したsuite名が無い場合や公開面を横断する場合だけ全 `npm test` へ広げる。

## 変更時の必須確認

- ユーザー影響があれば `CHANGELOG.md` と `CHANGELOG.ja.md` の `[Unreleased]` を同期する。
- READMEの機能説明を変える場合は `README.md` と `README.ja.md` を同期する。
- コマンド・メニューを変える場合は `package.json` と `docs/features/commands.md` / `commands.ja.md` を同時更新する。
- マスク、フィルタ、折りたたみ等のログ本文パターンを変える場合は `demo/` に確認用行を加える。
- パッケージ同梱物を変える場合は `.vscodeignore` と `scripts/check-package-contents.js` の `EXPECTED` を揃える。
- 作業開始時に `git status` を確認し、生成物以外の意図しない変更を巻き込んだり上書きしたりしない。

## 最近の発展

v0.9.0前後ではInteractive Viewを中心に、複数パターン、ハイライト編集、マージ後の折りたたみ、認識率警告、マスク後の見た目に基づく折りたたみが追加された。v0.10.0ではフィルタと仮想文書コマンドを統合し、v0.11.0では整形結果を表示言語に依存しないASCII表現へ揃え、設定検証の多言語化と日時入力の厳密化を進めた。v0.12.0ではセベリティ方言、前置きフィールド付きタイムスタンプ、JSON Linesへ入力範囲を拡張した。その後は認識できない日時を利用者が選択し、既存のcustom format契約へ接続する補助を加えており、「共通モデルを広げ続けるだけでなく、未対応形式を利用者自身が安全に補える」方向へ発展している。

## Backlog

- **アクセシビリティとWebview DOM詳細** — `src/webview/interactiveView/main.ts`。初期ページでは実行境界とプロトコルを優先し、個々のDOMイベントとCSSは未整理。
- **全設定キーのリファレンス** — `package.json` の `contributes.configuration`。`docs/features/settings.ja.md` に型・既定値・効果の一覧があるため重複を避け、Wikiでは設計上重要な設定群のみ扱う。
- **タイムスタンプ形式ごとの完全仕様** — `src/normalize/timestampFormats.ts`, `customTimestampFormats.ts`。ドメイン上の優先順位と不変条件は記載したが、全形式の例は既存READMEとテストを正本とする。
