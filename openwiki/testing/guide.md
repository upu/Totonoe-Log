---
type: テストガイド
title: テスト指針
description: Totonoe Log の純粋ロジック、VS Code統合、Interactive View、非同期更新を検証するテスト配置と、変更種別ごとの実行手順。
tags: [testing, ci, quality]
---

# テスト指針

## 基本コマンド

```bash
npm run compile
npm run lint
npm run build
npm test
npm run check:package
```

CI相当の順序とOS差は[運用ランブック](/openwiki/operations/runbook.md)を参照する。`npm test` は `out-tsc/test/suite/**/*.test.js` と `out/extension.js` を使う。

## テスト層

| ファイル | 主な対象 |
| --- | --- |
| `src/test/suite/normalize.test.ts` | parse、timestamp、severity、filter、merge、mask、collapse、highlight、timezone、clock skew、line source |
| `src/test/suite/extension.test.ts` | command登録、比較、設定などの拡張統合 |
| `src/test/suite/openInVirtualDocument.test.ts`, `mergedView.test.ts` | 単一・複数入力から仮想文書を開く経路、encoding、大容量fallback |
| `src/test/suite/setViewFilterNormalized.test.ts`, `setViewFilterMerged.test.ts` | 開いた仮想文書へのfilter適用と行対応 |
| `src/test/suite/goToSourceLine.test.ts`, `virtualDocumentGuard.test.ts` | 元行ジャンプと、整形済み文書を入力へ再利用しないガード |
| `src/test/suite/interactiveView.test.ts`, `interactiveViewHtml.test.ts`, `interactiveViewLabels.test.ts` | panel、criteria、file visibility、export、HTML/CSP、Webview要素ID、表示言語、静的・動的ラベル契約 |
| `src/test/suite/packageLocalization.test.ts` | manifest・実行時翻訳キー、英日bundle、位置プレースホルダー、Webview scriptの日本語リテラル排除 |
| `src/test/suite/filterPrompts.test.ts` | QuickPick/InputBoxによるfilter入力 |
| `src/test/suite/interactiveViewRefresh.test.ts` | latest-winsの世代管理 |

純粋処理を `src/normalize/` に置く[アーキテクチャ境界](/openwiki/architecture/overview.md)により、広いドメインケースをUIから切り離して検証できる。[ソースマップ](/openwiki/source-map.md)から変更目的に対応するsuiteを選ぶ。

`eslint.config.mjs` は `src/**/*.ts` の関数を空行・コメントを除いて最大60行に制限する。`src/test/**/*.ts` も対象だが、複数testを束ねる `suite()` callbackを考慮して最大200行である。大きな統合suiteは上表のように機能境界で分け、共有待機処理は `src/test/suite/support/waitForDocumentText.ts` のような非 `*.test.ts` helperへ置く。テスト名やassertionを変えずに配置だけを直す場合も、Mochaの `*.test.js` 検出対象とtest件数が変わらないことを確認する。

## 変更種別ごとの確認

### parse・時刻・merge

[ログ処理ドメイン](/openwiki/domain/log-processing.md)の不変条件を `normalize.test.ts` で確認する。認識済み・未認識、継続行、無効日付、offset有無、clock skew、同時刻tie-break、同名ファイルの `fileIndex` を含める。patternを増やしたら `demo/` に手動確認用の行も追加する。

### filter・正規表現

severity/date/match/ignoreのAND・OR、空条件、複数行message、構文エラー、timeoutを確認する。timeout時に全件表示へ誤fallbackしないこと、Interactive Viewで古い結果を公開しないことも検証する。

### 表示整形・元行ジャンプ

本文と `lineSources` の行数・順序、gap markerの `undefined`、collapse group、severity列幅、マージ `fileIndex` を確認する。pure formatterだけでなく `goToSourceLine.test.ts` または `interactiveView.test.ts` で元行ジャンプまで通す。[ログ調査ワークフロー](/openwiki/workflows/log-investigation.md)にあるexportと大容量fallbackの差は `openInVirtualDocument.test.ts` と `mergedView.test.ts` で守る。

### command・menu・configuration

- `package.json` contributionと `src/extension.ts` 登録の一致。
- 対象外文書と警告。
- resource scope・multi-rootの設定読み書き。
- 英日command docsとCHANGELOGの同期。

### Webview protocol

`protocol.ts` 変更時はhostとbrowserの両型検査に加え、production buildでNode・`vscode` 依存の誤importがないことを確認する。export変更では押下直前のcriteria、特にmaskが欠けない回帰ケースを追加する。[VS Code統合](/openwiki/integrations/vscode.md)の共有契約を参照する。

### 多言語化

`packageLocalization.test.ts` は、`package.json` の `%key%` と `package.nls.json` / `package.nls.ja.json` のキー集合、拡張ホストの直接的な `vscode.l10n.t()` 呼び出しと `l10n/bundle.l10n.ja.json`、位置プレースホルダーを突き合わせる。runtimeのソース文言はキー抽出のため文字列リテラルを直接渡す。Interactive Viewでは `interactiveViewHtml.test.ts` で翻訳済み静的文言と `lang` のescape、`interactiveViewLabels.test.ts` でprotocolが要求する全ラベル、`packageLocalization.test.ts` でbrowser scriptに日本語UIリテラルが残らないことを確認する。設計上の3経路は[VS Code統合](/openwiki/integrations/vscode.md)を参照する。

### package・release

`npm run check:package` は `vsce ls` と固定allowlistを比較し、release workflowの `.vsix` pathも検査する。同梱物を変える場合は `.vscodeignore` と `EXPECTED` を揃える。`package.nls.json`, `package.nls.ja.json`, `l10n/bundle.l10n.ja.json` も配布対象であり、翻訳追加時はallowlistから欠落させない。

## 失敗の読み分け

- compileのみ: Node・Webviewの型境界、`tsconfig*.json`。
- buildのみ: esbuild platform分離と誤import。
- Linux testのみ: Xvfb、path、encoding、改行依存。
- package checkのみ: allowlist、`.vscodeignore`、VSIX path。
- 非同期testが不安定: timeoutを伸ばす前に `RefreshRevisionGate` とworker終了経路。
