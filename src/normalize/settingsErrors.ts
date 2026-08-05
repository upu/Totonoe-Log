/**
 * 設定バリデーションが返すエラーの表現（issue #279）。
 *
 * 文言そのものではなくメッセージコードとパラメータを返す。この層を VSCode API
 * に依存させない方針（AGENTS.md）を保ったまま、警告文だけは VSCode の表示言語へ
 * 追従させるため——ここで文言を組み立ててしまうと `vscode.l10n.t()` を通す
 * 手立てが無くなる。組み立ては extension host 側の
 * `src/settingsErrorMessages.ts` が行う。
 *
 * `index` は設定配列の 0 始まりの添字をそのまま入れる。「N番目」という数え方は
 * 表示側の都合なので、+1 は文言を組み立てる側で行う。
 */

/**
 * 全メッセージコードの一覧。訳が用意されていることをテストで突き合わせるため、
 * 型だけでなく値としても持つ。
 */
export const SETTINGS_VALIDATION_ERROR_CODES = [
  "notAnObject",
  "missingStringProperty",
  "invalidRegexProperty",
  "invalidUtcOffset",
  "invalidOffsetSeconds",
  "missingNamedPattern",
  "invalidNamedRegex",
  "missingTimestampGroups",
  "invalidHighlightColor",
] as const;

export type SettingsValidationErrorCode = (typeof SETTINGS_VALIDATION_ERROR_CODES)[number];

/**
 * 設定の1項目が無効だった理由。項目を `index` で指すものと、項目名（`name`）で
 * 指すものがある——`timestampFormats` / `highlightRules` は項目に名前を付けられ、
 * 名前があるほうが設定ファイル上で見つけやすいため。
 */
export type SettingsValidationError =
  | { readonly code: "notAnObject"; readonly index: number }
  | { readonly code: "missingStringProperty"; readonly index: number; readonly property: string }
  | {
      readonly code: "invalidRegexProperty";
      readonly index: number;
      readonly property: string;
      readonly reason: string;
    }
  | { readonly code: "invalidUtcOffset"; readonly index: number }
  | { readonly code: "invalidOffsetSeconds"; readonly index: number }
  | { readonly code: "missingNamedPattern"; readonly name: string }
  | { readonly code: "invalidNamedRegex"; readonly name: string; readonly reason: string }
  | {
      readonly code: "missingTimestampGroups";
      readonly name: string;
      readonly requiredGroups: readonly string[];
    }
  | {
      readonly code: "invalidHighlightColor";
      readonly name: string;
      readonly allowedColors: readonly string[];
      /** ユーザーが書いた値を JSON 表記にしたもの（`"chartreuse"` / `42` など）。 */
      readonly actual: string;
    };

/**
 * `new RegExp` などが投げた例外から、文言に添える理由を取り出す。エンジンの
 * 説明（`Invalid regular expression: ...`）はパターンのどこが悪いかを示す
 * 一次情報なので、訳さずそのまま運ぶ。
 */
export function describeThrownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
