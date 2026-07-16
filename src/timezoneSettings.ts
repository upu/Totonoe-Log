import * as vscode from "vscode";
import {
  compileFileOffsetRules,
  parseUtcOffsetMinutes,
  resolveFileOffsetMinutes,
  type DisplayTimezone,
} from "./normalize";

/** タイムゾーン関連設定のVSCode設定セクション名。 */
const TIMEZONE_CONFIG_SECTION = "totonoeLog.timezone";

/**
 * `totonoeLog.timezone.display` 設定を読み込み、各整形関数に渡す表示
 * タイムゾーンへ変換する。`"local"` はそのまま（DST 対応のため整形時に
 * タイムスタンプごとへ解決させる）、それ以外は UTC オフセット表記として
 * 解析する。不正な値は UTC へフォールバックし、警告を1回表示する
 * （`totonoeLog.timestampFormats` の不正項目と同じ方針）。
 */
export function readDisplayTimezone(): DisplayTimezone {
  const value = vscode.workspace
    .getConfiguration(TIMEZONE_CONFIG_SECTION)
    .get<string>("display", "UTC");
  if (value.trim().toLowerCase() === "local") {
    return "local";
  }
  const offsetMinutes = parseUtcOffsetMinutes(value);
  if (offsetMinutes === undefined) {
    vscode.window.showWarningMessage(
      `Totonoe Log: totonoeLog.timezone.display の値「${value}」が不正なため UTC で表示します（"UTC" / "local" / "+09:00" のように指定してください）。`
    );
    return 0;
  }
  return offsetMinutes;
}

/**
 * `totonoeLog.timezone.sourceOffset`（全体既定）と
 * `totonoeLog.timezone.fileOffsets`（ファイル名パターンごとの上書き）を
 * 読み込み、ファイル名からソースオフセット（分）を解決する関数を返す。
 * 優先順位は「ファイル別規則 → 全体既定 → UTC」。
 *
 * 解決関数を返す形なのは、マージビューのように複数ファイルへ適用する
 * コマンドでも設定の読み込み・検証・警告を1回で済ませるため。不正な設定
 * 項目は無視して残りで継続し、警告を1回表示する（設定ミス1つでパース機能
 * 全体が使えなくなるのを防ぐ）。
 */
export function createSourceOffsetResolver(): (fileName: string) => number | undefined {
  const config = vscode.workspace.getConfiguration(TIMEZONE_CONFIG_SECTION);

  const fileOffsetSettings = config.get<unknown[]>("fileOffsets", []);
  const { rules, errors } = compileFileOffsetRules(fileOffsetSettings ?? []);
  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      `Totonoe Log: totonoeLog.timezone.fileOffsets に不正な項目があるため無視しました — ${errors.join(" / ")}`
    );
  }

  const defaultValue = config.get<string>("sourceOffset", "UTC");
  const defaultOffsetMinutes = parseUtcOffsetMinutes(defaultValue);
  if (defaultOffsetMinutes === undefined) {
    vscode.window.showWarningMessage(
      `Totonoe Log: totonoeLog.timezone.sourceOffset の値「${defaultValue}」が不正なため UTC として扱います（"+09:00" のように指定してください）。`
    );
  }

  return (fileName) =>
    resolveFileOffsetMinutes(fileName, rules) ?? defaultOffsetMinutes;
}
