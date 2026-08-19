import * as vscode from "vscode";
import {
  compileCustomTimestampFormats,
  getDefaultTimestampFormats,
  parseLog,
  type CustomTimestampFormatSetting,
  type LogEntry,
  type TimestampFormat,
} from "./normalize";
import { formatSettingsValidationErrors } from "./settingsErrorMessages";
import { readConfiguredSeverityTokens } from "./severityTokenSettings";
import type { TimestampFormatRow, TimestampFormatsScope } from "./webview/interactiveView/protocol";

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

/**
 * `totonoeLog.timestampFormats` の生の設定値を読む（コンパイルはしない）。
 * `readHighlightRuleRows` 系と同じく、宣言したスキーマ（array）どおりとは
 * 限らない設定ファイルを安全に扱う。
 */
function readRawTimestampFormats(): unknown[] {
  const settings = vscode.workspace
    .getConfiguration(TIMESTAMP_FORMATS_CONFIG_SECTION)
    .get<unknown>(TIMESTAMP_FORMATS_CONFIG_KEY, []);
  return Array.isArray(settings) ? settings : [];
}

function toTimestampFormatRow(value: unknown): TimestampFormatRow | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { name, pattern } = value as Partial<CustomTimestampFormatSetting>;
  return {
    name: typeof name === "string" ? name : "",
    pattern: typeof pattern === "string" ? pattern : "",
  };
}

/**
 * 設定値の配列を編集パネル（issue #316）の行へ変換する。`toHighlightRuleRows`
 * と同じく、**正規表現として壊れたパターンも行として残す**——タイムスタンプ
 * としては効かないが、パネルから直せなければ「設定したのに一覧に無い」状態に
 * なってしまうため。
 */
export function toTimestampFormatRows(settings: readonly unknown[]): TimestampFormatRow[] {
  if (!Array.isArray(settings)) {
    return [];
  }
  const rows: TimestampFormatRow[] = [];
  for (const setting of settings) {
    const row = toTimestampFormatRow(setting);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

/** 現在の設定値を、編集パネルに表示する行へ変換する。 */
export function readTimestampFormatRows(): TimestampFormatRow[] {
  return toTimestampFormatRows(readRawTimestampFormats());
}

/**
 * 編集パネルの行を、設定へ書き戻す形へ変換する。パターンが空の行は
 * 「+ 追加」を押した直後の入力途中なので書かない。`name` も空なら省略する
 * ——省略時の既定（`custom-<番号>`）に任せたほうが設定ファイルが読みやすい。
 * 並び順はそのまま保つ。
 */
export function toTimestampFormatSettings(
  rows: readonly unknown[]
): CustomTimestampFormatSetting[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const settings: CustomTimestampFormatSetting[] = [];
  for (const value of rows) {
    const row = toTimestampFormatRow(value);
    if (!row) {
      continue;
    }
    const pattern = row.pattern.trim();
    if (pattern === "") {
      continue;
    }
    const name = row.name.trim();
    settings.push(name === "" ? { pattern } : { name, pattern });
  }
  return settings;
}

/** {@link resolveTimestampFormatsTarget} が見る、`inspect()` の結果のうち必要な部分。 */
export interface TimestampFormatsInspection {
  readonly workspaceValue?: unknown;
  readonly globalValue?: unknown;
}

/**
 * パネルからの編集をどのスコープへ書き戻すかを決める。`highlightRuleSettings`
 * の `resolveHighlightRulesTarget` と同じ「既に定義されている場所へ書き戻す」
 * 原則だが、**フォルダ単位の層は持たない**——`readConfiguredTimestampFormats`
 * は `getConfiguration` にリソースを渡さずに読むため、`WorkspaceFolder`
 * スコープへ書いてもリソース無しの読み取りには反映されず、「保存したのに
 * 次回効かない」を起こす。マルチルートでフォルダ単位に絞り込みたい場合は
 * 読み取り側からリソース対応が必要になるため、別issueとする。
 */
export function resolveTimestampFormatsTarget(
  inspection: TimestampFormatsInspection | undefined,
  hasWorkspaceFolder: boolean
): vscode.ConfigurationTarget {
  if (!hasWorkspaceFolder) {
    return vscode.ConfigurationTarget.Global;
  }
  return inspection?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function scopeForTarget(target: vscode.ConfigurationTarget): TimestampFormatsScope {
  return target === vscode.ConfigurationTarget.Global ? "user" : "workspace";
}

function resolveCurrentTarget(): vscode.ConfigurationTarget {
  const configuration = vscode.workspace.getConfiguration(TIMESTAMP_FORMATS_CONFIG_SECTION);
  return resolveTimestampFormatsTarget(
    configuration.inspect(TIMESTAMP_FORMATS_CONFIG_KEY),
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0
  );
}

/**
 * 現在 `totonoeLog.timestampFormats` が実際に定義されている（あるいは次に
 * 書き込まれる）スコープ。パネルの表示専用で、保存の成否には関わらない。
 */
export function currentTimestampFormatsScope(): TimestampFormatsScope {
  return scopeForTarget(resolveCurrentTarget());
}

/**
 * 編集パネルの行を `totonoeLog.timestampFormats` へ書き戻す。書き込みは設定
 * 変更イベントを起こし、#183 の reparse 経路（`REPARSE_SECTIONS` の対象）で
 * パース結果と表示の両方に反映される——ここで自前に再描画を促す必要はない。
 */
export async function writeTimestampFormatRows(rows: readonly unknown[]): Promise<void> {
  // 配列でない値が届いたらメッセージ自体が壊れているので、何も書かずに戻る
  // （`writeHighlightRuleRows` と同じ理由——空配列と誤認して既存の設定を消さない）。
  if (!Array.isArray(rows)) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration(TIMESTAMP_FORMATS_CONFIG_SECTION);
  const target = resolveTimestampFormatsTarget(
    configuration.inspect(TIMESTAMP_FORMATS_CONFIG_KEY),
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0
  );
  try {
    await configuration.update(TIMESTAMP_FORMATS_CONFIG_KEY, toTimestampFormatSettings(rows), target);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(
      vscode.l10n.t("Totonoe Log: Could not save timestamp formats to Settings ({0})", reason)
    );
  }
}
