import * as vscode from "vscode";
import type { SettingsValidationError } from "./normalize";

/**
 * `src/normalize/` が返した設定バリデーションのエラー（issue #279）を、
 * VSCode の表示言語に合わせた文言へ組み立てる。
 *
 * 文言をこちら側に置くのは、`src/normalize/` を VSCode API に依存させない方針
 * （AGENTS.md）を保つため。純粋ロジック層はメッセージコードとパラメータだけを
 * 返し、`vscode.l10n.t()` を通すのはこの層の責務にする。
 *
 * `index` は設定配列の0始まりの添字なので、ユーザーに見せるときだけ +1 する
 * ——設定ファイルは1番目から数えて読むため。
 */
export function formatSettingsValidationError(error: SettingsValidationError): string {
  switch (error.code) {
    case "notAnObject":
      return vscode.l10n.t("Entry {0}: not an object", error.index + 1);
    case "missingStringProperty":
      return vscode.l10n.t(
        "Entry {0}: {1} (string) is missing",
        error.index + 1,
        error.property
      );
    case "invalidRegexProperty":
      return vscode.l10n.t(
        "Entry {0}: {1} is not a valid regular expression ({2})",
        error.index + 1,
        error.property,
        error.reason
      );
    case "invalidUtcOffset":
      return vscode.l10n.t(
        'Entry {0}: offset is invalid (specify a UTC offset such as "+09:00")',
        error.index + 1
      );
    case "invalidOffsetSeconds":
      return vscode.l10n.t(
        "Entry {0}: offsetSeconds is invalid (specify a number of seconds such as -40 or 1.5)",
        error.index + 1
      );
    case "missingNamedPattern":
      return vscode.l10n.t("{0}: pattern (string) is missing", error.name);
    case "invalidNamedRegex":
      return vscode.l10n.t(
        "{0}: not a valid regular expression ({1})",
        error.name,
        error.reason
      );
    case "missingTimestampGroups":
      return vscode.l10n.t(
        "{0}: named capture groups are missing (include all of {1}, or epochMs / epochSec)",
        error.name,
        error.requiredGroups.join(" ")
      );
    case "invalidHighlightColor":
      return vscode.l10n.t(
        "{0}: color must be one of {1} (given: {2})",
        error.name,
        error.allowedColors.join(" / "),
        error.actual
      );
  }
}

/**
 * 複数の項目エラーを、警告メッセージ1本に収まる1行へまとめる。設定ミス1件ごとに
 * 通知を出すと同じ設定の保存で何本も並ぶため、まとめて1回だけ出す方針
 * （`readConfiguredTimestampFormats` 等の従来の縮退の仕方に合わせる）。
 */
export function formatSettingsValidationErrors(
  errors: readonly SettingsValidationError[]
): string {
  return errors.map(formatSettingsValidationError).join(" / ");
}
