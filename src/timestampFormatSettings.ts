import * as vscode from "vscode";
import {
  compileCustomTimestampFormats,
  getDefaultTimestampFormats,
  parseLog,
  type LogEntry,
  type TimestampFormat,
} from "./normalize";
import { formatSettingsValidationErrors } from "./settingsErrorMessages";
import { readConfiguredSeverityTokens } from "./severityTokenSettings";

/** カスタムタイムスタンプ形式を読み込むVSCode設定のキー。 */
const TIMESTAMP_FORMATS_CONFIG_SECTION = "totonoeLog";
const TIMESTAMP_FORMATS_CONFIG_KEY = "timestampFormats";

/**
 * `totonoeLog.timestampFormats` 設定を読み込み、カスタム形式＋組み込み形式の
 * 完全なフォーマット一覧を返す。カスタム形式を組み込みより先に置くのは、
 * 「組み込みの認識結果が期待と違うとき、ユーザーが設定で上書きできる」
 * 逃げ道を確保するため。
 *
 * 不正な設定項目は無視して残りで継続し、警告を1回表示する（設定ミス1つで
 * パース機能全体が使えなくなるのを防ぐ）。
 */
export function readConfiguredTimestampFormats(): TimestampFormat[] {
  const settings = vscode.workspace
    .getConfiguration(TIMESTAMP_FORMATS_CONFIG_SECTION)
    .get<unknown[] | null>(TIMESTAMP_FORMATS_CONFIG_KEY);
  const { formats, errors } = compileCustomTimestampFormats(Array.isArray(settings) ? settings : []);
  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Totonoe Log: Ignored invalid entries in totonoeLog.timestampFormats — {0}",
        formatSettingsValidationErrors(errors)
      )
    );
  }
  return [...formats, ...getDefaultTimestampFormats()];
}

/**
 * パース結果そのものを決める設定（タイムスタンプ形式、セベリティ語彙）を
 * 反映して {@link parseLog} を実行する。VSCode API に触れる各コマンドは、
 * 素の `parseLog` の代わりにこれを使う（純粋ロジック層に VSCode 依存を
 * 持ち込まないための薄いラッパー）。
 *
 * `sourceUtcOffsetMinutes` はタイムゾーン表記を持たないタイムスタンプに
 * 仮定するソースオフセット（issue #13）。設定からの解決は呼び出し側が
 * `timezoneSettings.ts` を通じて行う——ファイル名ごとの規則を解決するのに
 * 読み込み元の情報が要るため、ここでは決められない。
 */
export function parseLogWithConfiguredFormats(
  text: string,
  sourceUtcOffsetMinutes?: number
): LogEntry[] {
  return parseLog(text, {
    timestampFormats: readConfiguredTimestampFormats(),
    severityTokens: readConfiguredSeverityTokens(),
    sourceUtcOffsetMinutes,
  });
}
