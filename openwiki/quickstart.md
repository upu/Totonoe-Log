---
type: クイックスタート
title: Totonoe Log コードWiki クイックスタート
description: ログを正規化・マージ・絞り込み・折りたたみ・比較する VS Code 拡張 Totonoe Log の目的、開発開始手順、主要な設計領域への入口。
resource: "https://github.com/upu/Totonoe-Log"
tags: [quickstart, vscode-extension, logs]
---

# Totonoe Log コードWiki クイックスタート

## このリポジトリが提供するもの

Totonoe Log は「バラバラなログを、調査しやすい時系列に整える」VS Code 拡張である。形式の異なるログを共通モデルへ正規化し、時系列マージ、セベリティ・日時・正規表現による絞り込み、繰り返しの折りたたみ、共有前のマスク、差分比較を提供する。製品説明の正本は `README.ja.md`、コマンドの起動導線と出力の正本は `docs/features/commands.ja.md`、開発方針の正本は `AGENTS.md` である。

現在の `package.json` は `0.9.0` だが、HEADにはそのタグ以降の未リリース変更がある。最近の方向性は、機能ごとのコマンドを増やすのではなく、対象数を自動判定する `totonoeLog.openVirtualDocument` と、開いているビューの状態を変える `totonoeLog.setViewFilter` へ操作を統合することにある。

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
3. [VS Code統合](/openwiki/integrations/vscode.md)でコマンド、仮想ドキュメント、Webview、設定境界を確認する。
4. [テスト戦略](/openwiki/testing/guide.md)から変更内容に対応する回帰テストを選ぶ。

## 変更時の必須確認

- ユーザー影響があれば `CHANGELOG.md` と `CHANGELOG.ja.md` の `[Unreleased]` を同期する。
- READMEの機能説明を変える場合は `README.md` と `README.ja.md` を同期する。
- コマンド・メニューを変える場合は `package.json` と `docs/features/commands.md` / `commands.ja.md` を同時更新する。
- マスク、フィルタ、折りたたみ等のログ本文パターンを変える場合は `demo/` に確認用行を加える。
- パッケージ同梱物を変える場合は `.vscodeignore` と `scripts/check-package-contents.js` の `EXPECTED` を揃える。
- 作業開始時に `git status` を確認する。初期Wiki作成時点では `AGENTS.md` とOpenWiki関連ファイルに既存の未コミット変更があり、生成Wiki以外を上書きしてはならない。

## 最近の発展

v0.9.0前後ではInteractive Viewを中心に、複数パターン、ハイライト編集、マージ後の折りたたみ、認識率警告、マスク後の見た目に基づく折りたたみが追加された。その後、マルチルート設定の修正、フィルタと仮想文書コマンドの統合、正規表現ワーカーのタイムアウト後処理、セベリティ列の整列が続いた。これは「調査操作を1か所へ集約しつつ、非同期処理と表示の正確性を強化する」流れと読める。

## Backlog

- **アクセシビリティとWebview DOM詳細** — `src/webview/interactiveView/main.ts`。初期ページでは実行境界とプロトコルを優先し、個々のDOMイベントとCSSは未整理。
- **全設定キーのリファレンス** — `package.json` の `contributes.configuration`。既存の `README.ja.md` に一覧があるため重複を避け、Wikiでは設計上重要な設定群のみ扱う。
- **タイムスタンプ形式ごとの完全仕様** — `src/normalize/timestampFormats.ts`, `customTimestampFormats.ts`。ドメイン上の優先順位と不変条件は記載したが、全形式の例は既存READMEとテストを正本とする。
�
