import * as vscode from "vscode";
import type { TimestampPatternInferenceFailureReason } from "./normalize";

/**
 * `inferTimestampPattern`（issue #320）が返した理由コードを、パネルに出す
 * 文言へ翻訳する。`settingsErrorMessages.ts` と同じ理由で、`src/normalize/`
 * には日本語も英語散文も置かず、コードだけを返す方針を保つ。
 */
export function formatTimestampPatternInferenceFailureReason(
  reason: TimestampPatternInferenceFailureReason
): string {
  switch (reason) {
    case "emptySelection":
      return vscode.l10n.t("Select part of a line first.");
    case "monthName":
      return vscode.l10n.t(
        "This selection contains a month name, which totonoeLog.timestampFormats cannot express (it only understands numeric month values). Select the numeric parts instead."
      );
    case "unsupportedToken":
      return vscode.l10n.t(
        "This selection contains text that cannot be turned into a pattern. Try selecting only the date and time digits."
      );
    case "twoDigitYear":
      return vscode.l10n.t(
        "A 4-digit year could not be found in this selection. A 2-digit year would be misread (e.g. 24 as the year 24 AD) — include the full year if possible."
      );
    case "missingFields":
      return vscode.l10n.t(
        "Could not recognize this selection as a timestamp. Select either an epoch number or a full date and time (year, month, day, hour, minute, second)."
      );
  }
}
