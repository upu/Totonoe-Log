import * as vscode from "vscode";

/** 追加のセベリティトークンを読み込むVSCode設定のキー。 */
const SEVERITY_TOKENS_CONFIG_SECTION = "totonoeLog";
const SEVERITY_TOKENS_CONFIG_KEY = "severityTokens";

/**
 * `totonoeLog.severityTokens` 設定を読み、`parseLog` に渡す追加トークンを返す
 * （issue #302）。組み込みの語彙は `parseLog` 側で必ず残るため、ここが返すのは
 * 「上乗せ分」だけでよい。
 *
 * 設定値は手で書ける以上、宣言したスキーマ（文字列の配列）どおりとは限らない
 * ——配列でなければ空として扱い、文字列でない項目・空文字は落とす
 * （`readRawHighlightRules` と同じ縮退の仕方）。`timestampFormats` のように
 * 不正項目の警告を出さないのは、こちらは項目が単なる文字列で、型の誤りは
 * 設定スキーマが設定UI上で弾けるため——正規表現の妥当性のように、スキーマで
 * 表現できず実行時にしか分からない失敗が無い。
 */
export function readConfiguredSeverityTokens(resource?: vscode.Uri): string[] {
  const settings = vscode.workspace
    .getConfiguration(SEVERITY_TOKENS_CONFIG_SECTION, resource)
    .get<unknown>(SEVERITY_TOKENS_CONFIG_KEY, []);
  if (!Array.isArray(settings)) {
    return [];
  }
  return settings.filter((token): token is string => typeof token === "string" && token.trim() !== "");
}
