---
type: 統合ガイド
title: VS Code統合ポイント
description: Totonoe Log のコマンド、URI scheme、Webview protocol、設定、ファイルI/O、worker、diff、セキュリティ境界を整理する。
tags: [integration, vscode, webview]
---

# VS Code統合ポイント

## コマンドと公開面

`package.json` の `contributes` が公開面、`src/extension.ts` の `activate()` が配線の中心である。[ログ調査ワークフロー](/openwiki/workflows/log-investigation.md)はこれらのコマンドを利用者フローとして説明する。

| コマンドID | 主な対象 | 実装入口 |
| --- | --- | --- |
| `totonoeLog.openVirtualDocument` | Explorer選択またはアクティブエディタ | `createOpenVirtualDocumentCommand` |
| `totonoeLog.setViewFilter` | 正規化・マージ仮想文書 | `createSetViewFilterCommand` |
| `totonoeLog.compareLogs` | ダイアログで選ぶ2ファイル | `createCompareLogsCommand` |
| `totonoeLog.copyMaskedText` | 選択範囲または文書全体 | `copyMaskedLogText` |
| `totonoeLog.goToSourceLine` | 正規化・マージ表示行 | `createGoToSourceLineCommand` |
| `totonoeLog.showInteractiveView` | Explorer選択またはアクティブエディタ | `createShowInteractiveViewCommand` |
| `totonoeLog.goToSourceLineFromInteractiveView` | Webview右クリック行 | controller method |

コマンドやmenuを変える場合は `package.json`、英日 `docs/features/commands.*.md`、必要なら英日READMEを同じ変更で揃え、対象に応じて `extension.test.ts`、`openInVirtualDocument.test.ts`、`setViewFilterNormalized.test.ts`、`setViewFilterMerged.test.ts`、`goToSourceLine.test.ts` の公開面テストを更新する。

## URI schemeとprovider

- `totonoe-log-normalized`: 単一ファイル正規化とInteractive export。
- `totonoe-log-merged`: 複数ファイルマージとInteractive export。
- `totonoe-log-compare`: diff左右のmask済み文書。

前2つは元行対応を持てる。素の正規化・マージだけが `FilterableViewSource` を持ち、比較とInteractive exportは後付けfilter対象外である。[アーキテクチャ概要](/openwiki/architecture/overview.md)の仮想文書経路にライフサイクル上の制約を記載している。

## Webview protocol

`src/webview/interactiveView/protocol.ts` は拡張ホストとbrowser bundleの共有契約である。Node、DOM、`vscode`へ依存せず、primitive・配列・plain objectだけを使う。

Webviewからは `ready`、`filterChanged`、`addFiles`、`removeFile`、`exportVirtualDocument`、`revealSourceLine`、`highlightRulesChanged` を送る。拡張側からはcriteria、本文またはcollapse items、件数、ファイル、行対応、warning、highlight、表示上限情報を含む単一 `state` を返す。

`state.labels` は、Webviewが動的に生成する要素の翻訳済み文言である。`src/interactiveViewLabels.ts` が `vscode.l10n.t()` で一度構築し、Webviewは独自に表示言語を判定せず、受信したラベルだけを使う。静的コントロールは `src/interactiveViewHtml.ts` が同じAPIで翻訳し、`vscode.env.language` をHTMLの `lang` へ設定する。初回 `state` が届くまではフォームを無効化するため、controllerはHTMLを設定する前にmessage受信とpanel保持を完了しなければならない。この多言語化境界は[アーキテクチャ概要](/openwiki/architecture/overview.md)のInteractive View経路に対応する。

protocol変更時は次を同時に確認する。

1. `src/interactiveView.ts` の受信・送信と `src/interactiveViewLabels.ts` のラベル構築。
2. `src/webview/interactiveView/main.ts` のmessage handler、UI state、初回状態までの操作抑止。
3. `tsconfig.json` と `tsconfig.webview.json` の両型検査。
4. `interactiveView.test.ts`, `interactiveViewLabels.test.ts`, `interactiveViewHtml.test.ts` と必要なら`normalize.test.ts`。

`src/interactiveView.ts` は単一ファイルとマージ表示のどちらでも `collapsibleSupported` を有効にし、両方の折りたたみに対応する。仕様を変更する場合は、共有protocol、controller、payload builder、Webview UIを同時に確認する。

## 多言語化の境界

VS Codeの表示言語へ追従する文言は、用途ごとに3つの経路を使う。

- manifestの表示名、説明、command title、設定説明: `package.json` は `%key%` だけを持ち、英語の正本を `package.nls.json`、日本語訳を `package.nls.ja.json` に置く。
- 拡張ホストの通知、warning、prompt、QuickPick、ダイアログ: 英語リテラルを `vscode.l10n.t()` へ渡し、日本語訳を `l10n/bundle.l10n.ja.json` に置く。位置プレースホルダー `{0}`, `{1}` は翻訳前後で一致させる。
- Interactive View: 静的HTML文言は `src/interactiveViewHtml.ts`、動的要素は `src/interactiveViewLabels.ts` で翻訳する。後者は共有protocolの `state.labels` を介してbrowser側へ渡す。

翻訳対象を変更したら[テスト指針](/openwiki/testing/guide.md)の `packageLocalization.test.ts` を確認する。また3つの翻訳ファイルはVSIX同梱物なので、`scripts/check-package-contents.js` のallowlistも同期する。

## 設定統合

設定は `totonoeLog` namespaceにあり、schemaの正本は `package.json`、表示文言の正本は `package.nls.json` と `package.nls.ja.json` である。主な群は次のとおり。

- parse: `timestampFormats`, `timezone.sourceOffset`, `timezone.fileOffsets`, `clockSkew.fileOffsets`
- display: `timezone.display`, `gap.thresholdSeconds`, `interactiveView.maxDisplayLines`
- collapse: `collapse.threshold`
- mask: `copyMasked.maskTimestamp`, `maskHost`, `maskProcessId`
- highlight: `highlightRules`

Interactive Viewを開いたまま設定変更を反映するのは `interactiveViewConfigWatch.ts`。parse結果に影響する設定は全ファイルを再parseし、それ以外は再描画する。folder固有設定を扱うときはresource scopeを失わない。特にhighlight編集は既存定義のscopeへ書き戻す。

## ファイルI/Oと大容量結果

`src/logFileReading.ts` は `workspace.fs.readFile` とresource scopeの `files.encoding` を使い、VS Code文書同期上限を避けてログを読む。アクティブエディタ経路だけは `TextDocument.getText()` なので未保存変更を含む。

50 MiB以上の整形済みマージ結果は `MergedViewContentProvider` がextension global storageへ一時保存し、通常テキスト文書として開く。これは検索・コピーを維持するためのfallbackだが、provider上の行対応やfilter材料は持たない。タブを閉じた後に一時コピーを削除する。

## 外部・プロセス統合

- VS Code標準diff: `vscode.diff` へcompare用仮想文書を渡す。
- `worker_threads`: match、ignore、custom mask、highlightのユーザー正規表現を隔離する。
- clipboard: `Copy Masked Text` がmask済み本文を書き込む。
- configuration API: 設定読取、監視、highlight ruleのscope-aware更新。
- HoverProvider: マージ列の省略表示から元ファイルフルパスを示す。

## セキュリティと正確性

Webviewのログ本文は `innerHTML` ではなくtext node / `textContent` で描画し、CSPはnonce付きscript/styleへ制限する。ユーザー入力の正規表現はtimeoutさせ、失敗した条件だけを外してwarningを返す。async更新ではlatest-winsを守る。これらは機能ではなく、ログに任意文字列が含まれることを前提にした安全境界である。

変更時の具体的な検証は[テスト戦略](/openwiki/testing/guide.md)、配布時の確認は[開発運用ランブック](/openwiki/operations/runbook.md)へ進む。
