# Totonoe Log — プロジェクトガイド

VSCode 拡張機能「Totonoe Log」。コンセプトは「バラバラなログを、調査しやすい
時系列に整える」（Normalize, merge, filter, collapse, and compare messy logs）。
「Totonoe シリーズ」（何かを「整える」拡張機能群）の第一弾という位置づけ。

このファイルがプロジェクト方針の**正**（source of truth）。
`.claude/CLAUDE.md` と `.github/copilot-instructions.md` は、このファイルを参照する
薄いポインタとして維持する。方針を変更するときはこちらを更新すること。

## ビルド・実行

| コマンド | 内容 |
| --- | --- |
| `npm run compile` | `tsc -p ./` で型チェック込みのコンパイル |
| `npm run check-types` | `tsc --noEmit` で型チェックのみ |
| `npm run lint` | ESLint（`src` / `scripts` / `eslint.config.mjs` が対象） |
| `npm run build` | esbuild（`scripts/esbuild.js --production`）で `out/extension.js` にバンドル |
| `npm run watch` | esbuild のウォッチビルド |
| `npm test` | `@vscode/test-cli`（vscode-test）+ Mocha。実行前に `npm run build` が必要（拡張機能の読み込みに `out/extension.js` を使う） |
| `npm run check:package` | vsce パッケージ内容の検証。こちらも `npm run build` の成果物を使う |
| `npm run package` | `dist/totonoe-log.vsix` を生成 |

## プロジェクト構成

- `src/extension.ts` — エントリポイント。コマンド登録と各ビューへの配線
- `src/virtualDocumentContentProvider.ts` — 仮想ドキュメントの `TextDocumentContentProvider`
- `src/mergedView.ts` / `normalizedView.ts` / `compareView.ts` / `copyMasked.ts` — 各コマンドの実装（VSCode API に依存する層）
- `src/interactiveView.ts` — Interactive View の状態管理と Webview への配線
- `src/normalize/` — パース・マージ・フィルタ・折りたたみ・マスク・整形の純粋ロジック。**VSCode API に依存させない**（テスト容易性のため）
- `src/webview/interactiveView/` — Interactive View のブラウザ UI と共有プロトコル
- `src/test/suite/` — テスト
- `scripts/` — esbuild・CHANGELOG 抽出・パッケージ内容チェックの Node スクリプト（CommonJS）

## アーキテクチャ方針

- 表示方式は**仮想ドキュメント**（`TextDocumentContentProvider` による読み取り
  専用エディタ）を軸にする。VSCode 標準の検索・コピー・diff エディタがそのまま
  使えるメリットを優先する。継続的な絞り込み・マスク・折りたたみ・ハイライトを
  その場で操作する Interactive View には Webview を使い、ログ処理の中核は
  `src/normalize/` で仮想ドキュメントと共有する
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
- コマンドを追加・変更する場合は `package.json` の `contributes.commands` に登録し、
  `docs/features/commands.md`（英語）と `docs/features/commands.ja.md`（日本語）の
  一覧・該当節も同じ PR で更新する（起動導線を変える `contributes.menus` の変更も
  同様。README は機能の説明、こちらはコマンドID・起動導線・出力を引くための表）
- ログ本文のパターンに依存する機能（マスク・絞り込み・折りたたみ等）を追加・変更
  したときは、動作確認用の行を同じ PR で `demo/` のサンプルログにも足す。実装した
  本人がそのパターンを一番よく分かっている時点で1〜2行足すのが最も安く、後から
  「試す行が無い」と気づいて別 issue を起票する手間を避けられる
- TypeScript（`*.ts`）を作成・変更・レビューする場合は、作業前に
  `docs/coding-guidelines.md` の「TypeScript」セクションを読み、その規約に従う
- vsce がパッケージするファイル一覧は `scripts/check-package-contents.js` の
  `EXPECTED` で固定している。意図して同梱ファイルを変えた場合は両方（
  `.vscodeignore` とこの `EXPECTED`）を更新すること
- ファイル構成（追加・削除・移動・モジュール分割）、コマンド、ビルド・テスト
  手順、アーキテクチャ方針のいずれかを変えた PR をマージしたあとは、OpenWiki
  を更新して単独 PR で `main` に入れる。それ以外の変更は溜めてよく、リリース
  前にまとめて更新する（手順は「OpenWiki」節）

## CI

- `.github/workflows/ci.yml` で `npm ci` → `npm run compile` → `npm run lint` →
  `npm run build` → `npm test` → `npm run check:package` を実行する
  （windows-latest / Node 24.x）。
  `npm run build` は `npm test` と `npm run check:package` の両方が使う成果物を
  1回だけ生成するためのステップなので、`check:package` スクリプト自体はビルド
  しない（二重ビルドを避けるため）
- lint は ESLint（`eslint.config.mjs`）。本体の `src/**/*.ts`（`src/test/**` を
  除く）は型情報を使う `typescript-eslint` の `strictTypeChecked` を適用し、
  `no-floating-promises` に加えて不要な条件分岐や暗黙の文字列化等も検出する。
  `src/test/**` は `recommendedTypeChecked` を維持し、`vscode.window.*` をモックで
  上書きする都合上 `any` 関連ルールと `require-await` を緩和している。
  `scripts/**` は CommonJS の素の Node スクリプトとして別ルールセットを当てる
  （詳細は `eslint.config.mjs` のコメント参照）
- `no-restricted-syntax` で、`src/**` に日本語の文字列リテラル・テンプレートを
  直接書くことを禁止している（l10n が腐るのを防ぐ機械的なゲート）。文言は英語を
  ソース言語として書き、訳は `package.nls.ja.json` / `l10n/bundle.l10n.ja.json`
  に置く。コメント・正規表現リテラル・`src/test/**` は対象外。
  `src/interactiveViewHtml.ts` だけはテンプレート側の禁止を外している（HTML/CSS の
  文書を組み立てるファイルで、中の日本語が全てコメントのため）。外した分は
  `packageLocalization.test.ts` が補う

## ワークフロー

- GitHub Flow で進める。機能は GitHub issue に登録し、**1 issue = 1 PR** で
  `main` にマージしていく。一気に全部実装せず、issue 単位で小さく進める
- `main` への直接 push は禁止。必ずブランチを切って PR を経由する
- 複数行のコミットメッセージは heredoc で渡す
  （`git commit -m "$(cat <<'EOF' ... EOF)"` 形式。引用符のエスケープ事故を
  避けるため）

## 行動原則

- 自明でない作業は Plan モードで方針を合意してから実装に入る
- **読まずに書かない**：変更対象のファイル・周辺コードを読んでから編集する
- 繰り返し発生する手順や判断は、その場で消化して終わりにせず、スキル化・
  フック化をユーザーに提案する

## 優先度判断（このリポジトリ固有）

issue の優先度を判断するときは、ユーザーへの影響度・実装コストに加えて、
**「整える」コンセプトのコア（正規化 / マージ / フィルタ / 折りたたみ / 比較）に
どれだけ近いか**を判断材料にする。コアに近い改善ほど優先度を高くする。

## OpenWiki

このリポジトリでは、コードベースの補助ドキュメントとして OpenWiki を使用する。コンテキストを調べるときは `openwiki/quickstart.md` から読み、必要に応じてリンク先のアーキテクチャ、ワークフロー、運用情報、ソースマップを参照する。

OpenWiki文書は、次のコマンドでローカルから手動更新する（CI での自動更新はしない）。

`openwiki code --update --language ja-JP`

更新するタイミングは「変更時のルール」節のとおり、リリース前のまとめ更新をベースに、リポジトリの構造が変わったときだけ追加で回す。毎 PR では更新しない — 生成物なので再生成のたびに無関係なページまで差分が出て、機能 PR のレビューを妨げるため。`openwiki/**` は `.vscodeignore` で除外済みで vsix には含まれないので、リリース直前に実行してもパッケージ検証には影響しない。

生成された差分は機能変更と混ぜず、`docs: OpenWiki を更新` のような単独 PR にする。

OpenWiki を更新したら、生成された内容はその PR の中で手直ししてよい。生成そのものへの指示は `openwiki/INSTRUCTIONS.md` に書く。

### 更新後に取り消すもの

`openwiki code --update` は `openwiki/**` の外にも書き込む。次の 2 つはこのリポジトリの方針と合わないので、コミットする前に取り消す。

- **`AGENTS.md` に追加される英語の `## OpenWiki` 節**（`<!-- OPENWIKI:START -->` 〜 `<!-- OPENWIKI:END -->`）。既存の日本語の節と重複するうえ、「scheduled OpenWiki GitHub Actions workflow がwikiを更新する」という、上に書いたローカル手動運用と矛盾する内容が含まれる。`git checkout -- AGENTS.md` で戻す
- **リポジトリルートに新規生成される `CLAUDE.md`**。同じ定型文が入る。指示ファイルは `AGENTS.md` を正本、`.claude/CLAUDE.md` をその薄いポインタとする構成なので、ルート直下に別系統を増やさない。ファイルごと削除する

あわせて、`openwiki/**` の各 `index.md` が改行コードだけの差分（`git diff` が空なのに `git status` では変更扱い）になることがある。レビューできる実質差分だけを残すため、内容の変わっていないファイルは `git checkout --` で戻してからコミットする。
