import * as vscode from "vscode";
import { compileClockSkewRules, resolveClockSkewMs } from "./normalize";
import { formatSettingsValidationErrors } from "./settingsErrorMessages";

/** クロックスキュー補正設定のVSCode設定セクション名。 */
const CLOCK_SKEW_CONFIG_SECTION = "totonoeLog.clockSkew";

/**
 * `totonoeLog.clockSkew.fileOffsets`（ファイル名パターンごとの時刻補正、
 * issue #15）を読み込み、ファイル名からクロックスキュー補正量（ミリ秒）を
 * 解決する関数を返す。どの規則にもマッチしない場合は 0（補正なし）。
 *
 * 解決関数を返す形なのは `createSourceOffsetResolver` と同じ理由で、
 * マージビューのように複数ファイルへ適用するコマンドでも設定の読み込み・
 * 検証・警告を1回で済ませるため。不正な設定項目は無視して残りで継続し、
 * 警告を1回表示する（設定ミス1つで補正機能全体が使えなくなるのを防ぐ）。
 */
export function createClockSkewResolver(): (fileName: string) => number {
  const config = vscode.workspace.getConfiguration(CLOCK_SKEW_CONFIG_SECTION);

  const settings = config.get<unknown[] | null>("fileOffsets");
  const { rules, errors } = compileClockSkewRules(settings ?? []);
  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Totonoe Log: Ignored invalid entries in totonoeLog.clockSkew.fileOffsets — {0}",
        formatSettingsValidationErrors(errors)
      )
    );
  }

  return (fileName) => resolveClockSkewMs(fileName, rules) ?? 0;
}
