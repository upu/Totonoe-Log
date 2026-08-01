// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

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
      // 「なぜ」を説明するコメントを厚くしても関数長として罰しない。
      "max-lines-per-function": [
        "error",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
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
