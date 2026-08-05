// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * ひらがな・カタカナ（U+3040〜U+30FF）と CJK 統合漢字（U+3400〜U+9FFF）。
 * `src/test/suite/packageLocalization.test.ts` の `JAPANESE_CHARACTER_PATTERN` と
 * 同じ範囲を使う——同じ規約を2つのゲートで見ているので、範囲がずれると
 * 「lint は通るがテストは落ちる」が起きるため。
 */
const JAPANESE_CHARACTERS = "[぀-ヿ㐀-鿿]";

const NO_HARDCODED_JAPANESE_MESSAGE =
  "ユーザー可視の文言に日本語リテラルを直接書かない（issue #281）。" +
  "英語をソース言語として書き、訳は package.nls.ja.json / l10n/bundle.l10n.ja.json に置く。" +
  "extension host なら vscode.l10n.t()、Webview なら extension host から渡すラベルを使う。";

/**
 * 日本語リテラルの禁止（issue #281）。l10n 対応（#276〜#278）の後に
 * `showWarningMessage("〜できませんでした")` のような文言を直接書くと、そこだけ
 * 訳されないまま残る。レビューの心がけではなく機械的なゲートに落とす。
 *
 * 正規表現リテラルは自然に外れる: esquery の正規表現マッチは属性値が文字列の
 * ときだけ働き、`RegExp` リテラルの `value` は `RegExp` オブジェクトになる。
 * 日本語を含む正規表現（`timestampCoverage.ts` の `\d{4}年\d{1,2}月...`）は
 * ログ側のパターンであってユーザー可視の文言ではないので、これで都合が良い。
 * コメントも `Literal` / `TemplateElement` に当たらないため対象外——このリポジトリは
 * コメントを日本語で書く方針なので、巻き込むと成立しない。
 */
const noHardcodedJapanese = [
  {
    selector: `Literal[value=/${JAPANESE_CHARACTERS}/]`,
    message: NO_HARDCODED_JAPANESE_MESSAGE,
  },
  {
    // 見るのは `raw` ではなく `cooked`（エスケープを解決した後の文字列）。
    // `raw` はソース上の見た目そのままなので、Unicode エスケープで書いた
    // 日本語をすり抜けてしまい、`value` が同じくエスケープ解決後である
    // `Literal` 側と挙動が食い違う。
    // `cooked` が undefined になるのは不正なエスケープを含むタグ付き
    // テンプレートだけで、このリポジトリはタグ付きテンプレートを使っていない。
    selector: `TemplateElement[value.cooked=/${JAPANESE_CHARACTERS}/]`,
    message: NO_HARDCODED_JAPANESE_MESSAGE,
  },
];

export default tseslint.config(
  {
    ignores: ["out/**", "out-tsc/**", "dist/**"],
  },
  {
    // src/**: TypeScript, type-checked lint (catches floating promises etc.,
    // which matter a lot for a VS Code extension's async APIs).
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // src/webview/** は DOM lib を持つ別プログラム（tsconfig.webview.json）
        // でチェックしているため、型情報を使うルールがどちらのプログラムに
        // 属するファイルでも解決できるよう両方を渡す。
        project: ["./tsconfig.json", "./tsconfig.webview.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "complexity": ["error", 15],
      "max-depth": ["error", 3],
      // 「なぜ」を説明するコメントを厚くしても関数長として罰しない。
      "max-lines-per-function": [
        "error",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
      // src/normalize/** も対象に含める。issue #281 は #279 の結論しだいで除外を
      // 検討する余地を残していたが、#279 が「整形結果の本文は英語固定・設定
      // バリデーションはメッセージコードを返す」に決まった（#286）ため、
      // ここに日本語が残る理由がなくなった。
      "no-restricted-syntax": ["error", ...noHardcodedJapanese],
    },
  },
  {
    // src/interactiveViewHtml.ts: Webview の HTML/CSS 文書をテンプレート
    // リテラルで組み立てるファイル。中の日本語は全て `<!-- -->` と CSS の
    // ブロックコメントで、どの要素に掛かる説明かを示すためその場に置いている。
    // ESLint の `TemplateElement` セレクタはテンプレートの中身を1つの文字列と
    // してしか見られず、コメントと本文を区別できないので、このファイルだけ
    // テンプレート側の禁止を外し、文字列リテラル側の禁止は残す。
    // 外した分は `packageLocalization.test.ts` の
    // 「keeps Japanese out of the Webview document text, comments aside (#281)」が
    // 塞ぐ（コメントを空白へ潰してから日本語を探す）。
    files: ["src/interactiveViewHtml.ts"],
    rules: {
      "no-restricted-syntax": ["error", noHardcodedJapanese[0]],
    },
  },
  {
    // src/test/**: test mocks intentionally overwrite `vscode.window.*`
    // methods with narrower stand-ins (`(vscode.window as any).showQuickPick
    // = ...`), so `any` and the unsafe-* family fire on nearly every mock
    // call. Keep type-checked linting (no-floating-promises etc.) active;
    // only the any-driven noise is relaxed here. Those mocks are also often
    // `async () => "value"` with no real `await` inside, just to match the
    // `Thenable<...>` return type of the vscode.* method being replaced, so
    // `require-await` is relaxed here too.
    files: ["src/test/**/*.ts"],
    rules: {
      // suite()/test() のコールバックも関数として数えられ、suite は複数の test を
      // まとめるため、テストにはプロダクションコードより緩い max 200 を適用する。
      "max-lines-per-function": [
        "error",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      // テストは日本語を文字列として持つ: 訳文そのもののアサート
      // （`packageLocalization.test.ts` が日本語バンドルを突き合わせる）、
      // 日本語を含むログのフィクスチャ、日本語リテラルを検出できることを
      // 確かめるテスト自身——いずれも l10n の抜け穴ではないので対象外にする。
      "no-restricted-syntax": "off",
    },
  },
  {
    // scripts/**: plain CommonJS Node scripts, not part of the tsconfig TS
    // program, so they get the untyped JS ruleset plus Node globals.
    files: ["scripts/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  }
);
