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
| `src/test/suite/extension.test.ts` | command登録、仮想文書、比較、マージ、設定、元行ジャンプ |
| `src/test/suite/interactiveView.test.ts` | panel、criteria、file visibility、export、highlight設定 |
| `src/test/suite/filterPrompts.test.ts` | QuickPick/InputBoxによるfilter入力 |
| `src/test/suite/interactiveViewRefresh.test.ts` | latest-winsの世代管理 |

純粋処理を `src/normalize/` に置く[アーキテクチャ境界](/openwiki/architecture/overview.md)により、広いドメインケースをUIから切り離して検証できる。[ソースマップ](/openwiki/source-map.md)から変更目的に対応するsuiteを選ぶ。

## 変更種別ごとの確認

### parse・時刻・merge

[ログ処理ドメイン](/openwiki/domain/log-processing.md)の不変条件を `normalize.test.ts` で確認する。認識済み・未認識、継続行、無効日付、offset有無、clock skew、同時刻tie-break、同名ファイルの `fileIndex` を含める。patternを増やしたら `demo/` に手動確認用の行も追加する。

### filter・正規表現

severity/date/match/ignoreのAND・OR、空条件、複数行message、構文エラー、timeoutを確認する。timeout時に全件表示へ誤fallbackしないこと、Interactive Viewで古い結果を公開しないことも検証する。

### 表示整形・元行ジャンプ

本文と `lineSources` の行数・順序、gap markerの `undefined`、collapse group、severity列幅、マージ `fileIndex` を確認する。pure formatterだけでなく `extension.test.ts` または `interactiveView.test.ts` で元行ジャンプまで通す。[ログ調査ワークフロー](/openwiki/workflows/log-investigation.md)にあるexportと大容量fallbackの差も守る。

### command・menu・configuration

- `package.json` contributionと `src/extension.ts` 登録の一致。
- 対象外文書と警告。
- resource scope・multi-rootの設定読み書き。
- 英日command docsとCHANGELOGの同期。

### Webview protocol

`protocol.ts` 変更時はhostとbrowserの両型検査に加え、production buildでNode・`vscode` 依存の誤importがないことを確認する。export変更では押下直前のcriteria、特にmaskが欠けない回帰ケースを追加する。[VS Code統合](/openwiki/integrations/vscode.md)の共有契約を参照する。

### package・release

`npm run check:package` は `vsce ls` と固定allowlistを比較し、release workflowの `.vsix` pathも検査する。同梱物を変える場合は `.vscodeignore` と `EXPECTED` を揃える。

## 失敗の読み分け

- compileのみ: Node・Webviewの型境界、`tsconfig*.json`。
- buildのみ: esbuild platform分離と誤import。
- Linux testのみ: Xvfb、path、encoding、改行依存。
- package checkのみ: allowlist、`.vscodeignore`、VSIX path。
- 非同期testが不安定: timeoutを伸ばす前に `RefreshRevisionGate` とworker終了経路。
