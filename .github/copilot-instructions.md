# Copilot Instructions — Totonoe Log

## プロジェクト概要

VSCode 拡張機能「Totonoe Log」。コンセプトは「バラバラなログを、調査しやすい
時系列に整える」（Normalize, merge, filter, collapse, and compare messy logs）。

「Totonoe シリーズ」の第一弾という位置づけ。何かを「整える」拡張機能群。

## 進め方

- 機能は GitHub issue に登録し、1 issue = 1 PR で `main` にマージしていく
- バイブコーディング中心。GitHub Copilot をメインのアシスタントとして使う
- 一気に全部実装せず、issue 単位で小さく進める

## アーキテクチャ方針

- 表示方式は**仮想ドキュメント**（`TextDocumentContentProvider` による読み取り
  専用エディタ）を軸にする。VSCode 標準の検索・コピー・diff エディタがそのまま
  使えるメリットを優先する。Webview は将来必要になったときに検討する
- ビルドは esbuild（`scripts/esbuild.js`）でバンドルし、`tsc --noEmit` で型
  チェックする（[upu/ghost-align](https://github.com/upu/ghost-align) と同じ
  構成を踏襲）
- テストは `@vscode/test-cli`（vscode-test）+ Mocha

## 変更時のルール

- 機能追加・変更時は `CHANGELOG.md`（英語）と `CHANGELOG.ja.md`（日本語）の
  両方の `[Unreleased]` セクションに追記する（内部リファクタ・ビルド・CI・
  テスト・ドキュメントのみの変更で、ユーザー影響がない場合は不要）
- README.md（英語）/ README.ja.md（日本語）は常に内容を揃える
- PR は `.github/pull_request_template.md` に従う
- コマンドを追加する場合は `package.json` の `contributes.commands` に登録する

## CI

- `.github/workflows/ci.yml` で `npm ci` → `npm run compile` → `npm run lint` →
  `npm run build` → `npm test` → `npm run check:package` を実行する
  （windows-latest / Node 24.x）。
  `npm run build` は `npm test`（拡張機能の読み込みに `out/extension.js` が必要）と
  `npm run check:package`（パッケージ内容チェック）の両方が使う成果物を1回だけ
  生成するためのステップなので、`check:package` スクリプト自体はビルドしない
  （二重ビルドを避けるため）
- lint は ESLint（`eslint.config.mjs`）。`src/**` は型情報を使う
  `typescript-eslint` の `recommendedTypeChecked` で
  `no-floating-promises` 等の非同期バグまで検出する。`src/test/**` は
  `vscode.window.*` をモックで上書きする都合上 `any` 関連ルールと
  `require-await` を緩和している。`scripts/**` は CommonJS の素の Node
  スクリプトとして別ルールセットを当てる（詳細は `eslint.config.mjs` の
  コメント参照）
- vsce がパッケージするファイル一覧は `scripts/check-package-contents.js` の
  `EXPECTED` で固定している。意図して同梱ファイルを変えた場合は両方（
  `.vscodeignore` とこの `EXPECTED`）を更新すること
