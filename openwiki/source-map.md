---
type: ソースマップ
title: ソースマップと発展経緯
description: Totonoe Log の変更目的から主要ソース、テスト、既存文書へ到達するための責務別索引と、Git履歴から読める設計の発展。
tags: [source-map, history, navigation]
---

# ソースマップと発展経緯

## 目的別の入口

| 変更目的 | 最初に読む | 次に読む・検証する |
| --- | --- | --- |
| command/menu | `package.json`, `src/extension.ts` | `docs/features/commands.ja.md`, `extension.test.ts` |
| 入力・encoding | `src/logFileReading.ts`, `src/logSourceDocument.ts` | `openVirtualDocument.ts`, `interactiveViewFiles.ts` |
| parse・timestamp | `src/normalize/parseLog.ts`, `timestampFormats.ts`, `customTimestampFormats.ts` | `types.ts`, `normalize.test.ts` |
| timezone・clock skew | `src/timezoneSettings.ts`, `clockSkewSettings.ts` | `src/normalize/timezone.ts`, `clockSkew.ts` |
| merge | `src/normalize/mergeLogFiles.ts`, `src/mergedView.ts` | `formatMergedLog.ts`, `extension.test.ts` |
| filter | `src/normalize/filterEntries.ts`, `src/filterPrompts.ts` | `setViewFilter.ts`, `interactiveViewCriteria.ts` |
| mask・compare | `maskForCompare.ts`, `displayMask.ts` | `copyMasked.ts`, `compareView.ts` |
| collapse | `collapseRepeatedEntries.ts`, `collapseMergedEntries.ts` | `buildInteractiveCollapsedLines.ts` |
| highlight | `highlightRules.ts`, `highlightDisplayLines.ts` | `highlightRuleSettings.ts`, Webview `main.ts` |
| Interactive View | `src/interactiveView.ts` | `protocol.ts`, `main.ts`, `interactiveView.test.ts` |
| 仮想文書 lifecycle | `src/virtualDocumentContentProvider.ts` | `normalizedView.ts`, `mergedView.ts`, `compareView.ts` |
| 元行ジャンプ | `lineSources.ts`, `revealSourceLine.ts` | `goToSourceLine.ts`, Webview message |
| build・release | `scripts/esbuild.js`, `package.json` | `check-package-contents.js`, `.github/workflows/` |

責務の意味は[アーキテクチャ概要](/openwiki/architecture/overview.md)、データ規則は[ログ処理ドメイン](/openwiki/domain/log-processing.md)、利用順は[ログ調査ワークフロー](/openwiki/workflows/log-investigation.md)を参照する。

## ディレクトリの役割

- `src/normalize/`: VS Code API非依存の中核。`index.ts` が公開面を集約する。
- `src/*.ts`: 拡張ホスト、command、provider、設定adapter。
- `src/webview/interactiveView/`: browser UIと共有protocol。
- `src/test/suite/`: pure logicからVS Code統合までのMocha suite。
- `scripts/`: esbuild、package allowlist、release notes抽出。
- `docs/features/`: commandの起動導線・出力リファレンス。
- `demo/`: pattern依存機能の手動確認用ログ。

`out*`、`dist`、`node_modules` は生成物または依存物であり、設計の一次ソースにしない。

## Git履歴から見た発展

1. **共通正規化基盤** — `LogEntry` を中心にfilter、mergeを再利用可能にした。
2. **実運用時刻への対応** — source timezone、file offset、clock skewを追加し、複数hostの時系列を揃えた。
3. **原文への帰還** — `fileIndex` と `LineSource` により、整形後も元ログ行へ移動可能にした。
4. **Interactive Viewの成長** — 複数ファイル、即時filter、export、mask、表示上限、設定hot reloadを段階的に集約した。
5. **非同期の正しさ** — exportは押下時criteriaを使い、worker完了順の逆転にはlatest-winsで対処した。
6. **ノイズ処理の統合** — 複数pattern、highlight編集、マージ横断collapse、認識率警告をpanelへ集約し、旧専用collapse commandを廃止した。
7. **操作の単純化** — filterをビューの状態へ移し、単一・複数ファイルの仮想表示を `Open in Virtual Document` へ統合した。
8. **表示品質** — HEADではseverity列幅とgroup suffixを調整した。比較ビューでは列paddingが不要diffを生むため例外扱いである。

v0.9.0後にもマルチルート設定、command統合、worker timeout後処理、列整列の変更があり、`package.json` のversionよりHEADが先行している。

## 最近変更された高感度領域

- `severityColumn.ts`, `groupSuffix.ts`, formatter群: 表示列とdiff安定性。
- `setViewFilter.ts`, `FilterableViewSource`: 毎回元entryへ条件を掛け直す。
- `openVirtualDocument.ts`: Explorerとactive documentの入力規則。
- `highlightRuleSettings.ts`: multi-rootのresource scope。
- worker利用filter・mask・highlight: timeout後の早期returnとlatest-wins。

変更前に[テスト指針](/openwiki/testing/guide.md)を確認する。

## 文書の優先順位

利用者向け機能は `README.ja.md`、command IDと導線は `docs/features/commands.ja.md`、開発ルールは `AGENTS.md`、現行挙動は `src/` とテストを参照する。食い違う場合は現行コードとテストを優先し、正本を修正したうえでOpenWikiを再生成する。運用上の確認は[運用ランブック](/openwiki/operations/runbook.md)へ進む。
