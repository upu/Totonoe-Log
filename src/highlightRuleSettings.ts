import * as vscode from "vscode";
import {
  compileHighlightRules,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  type HighlightRule,
  type HighlightRuleSetting,
} from "./normalize";
import type { HighlightRuleRow } from "./webview/interactiveView/protocol";

/** ハイライトルールを読み込むVSCode設定のキー。 */
const HIGHLIGHT_RULES_CONFIG_SECTION = "totonoeLog";
const HIGHLIGHT_RULES_CONFIG_KEY = "highlightRules";

/**
 * `totonoeLog.highlightRules` 設定を読み込み、コンパイル済みのルールを返す
 * （issue #18）。
 *
 * 不正な項目は無視して残りで継続し、警告を1回表示する
 * （`readConfiguredTimestampFormats` と同じ縮退の仕方——設定ミス1つで
 * ハイライト全体が効かなくなるのを防ぐ）。
 */
export function readHighlightRules(): HighlightRule[] {
  const { rules, errors } = compileHighlightRules(readRawHighlightRules());
  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      `Totonoe Log: totonoeLog.highlightRules に不正な項目があるため無視しました — ${errors.join(" / ")}`
    );
  }
  return rules;
}

/**
 * `totonoeLog.highlightRules` の生の設定値を読む（コンパイルはしない）。
 *
 * 設定値は手で書ける以上、宣言したスキーマ（`array`）どおりとは限らない
 * ——`get()` はファイルにある値をそのまま返すため、配列でなければ空として扱う。
 * ここを通さずに反復すると、設定が配列でないだけでハイライトの読み取り経路
 * 全体が例外で落ちる。
 */
function readRawHighlightRules(): unknown[] {
  const settings = vscode.workspace
    .getConfiguration(HIGHLIGHT_RULES_CONFIG_SECTION)
    .get<unknown>(HIGHLIGHT_RULES_CONFIG_KEY, []);
  return Array.isArray(settings) ? settings : [];
}

/** 現在の設定値を、編集パネル（issue #238）に表示する行へ変換する。 */
export function readHighlightRuleRows(): HighlightRuleRow[] {
  return toHighlightRuleRows(readRawHighlightRules());
}

function isHighlightColor(value: unknown): value is HighlightRuleRow["color"] {
  return typeof value === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

/**
 * 1項目を編集パネルの行へ正規化する。オブジェクトですらない値は、行として
 * 表示しようがないので `undefined` を返す。
 *
 * 設定ファイル（手書き）と Webview からのメッセージ（改ざんされうる）という、
 * どちらも型が保証されない2つの入口が同じ検証を通るよう、両方向でこれを使う。
 */
function toHighlightRuleRow(value: unknown): HighlightRuleRow | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { name, pattern, color } = value as Partial<HighlightRuleSetting>;
  return {
    name: typeof name === "string" ? name : "",
    pattern: typeof pattern === "string" ? pattern : "",
    // パレットに無い色は既定色に寄せる（ドロップダウンで選択状態を作れないため）。
    color: isHighlightColor(color) ? color : DEFAULT_HIGHLIGHT_COLOR,
  };
}

/**
 * 設定値の配列を編集パネルの行へ変換する（issue #238）。
 *
 * `compileHighlightRules` と違い、**正規表現として壊れたパターンも行として残す**
 * ——ハイライトとしては効かないが、パネルから直せなければ「設定したのに一覧に
 * 無い」状態になってしまうため。
 */
export function toHighlightRuleRows(settings: readonly unknown[]): HighlightRuleRow[] {
  if (!Array.isArray(settings)) {
    return [];
  }

  const rows: HighlightRuleRow[] = [];
  for (const setting of settings) {
    const row = toHighlightRuleRow(setting);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * 編集パネルの行を、設定へ書き戻す形へ変換する（issue #238）。
 *
 * パターンが空の行は「+ 追加」を押した直後の入力途中なので書かない。`name` も
 * 空なら省略する——設定ファイルに `"name": ""` が並ぶより、省略時の既定
 * （`highlight-<番号>`）に任せたほうが読みやすいため。
 *
 * 並び順はそのまま保つ。順序が重なったときの優先度（issue #18）だからで、
 * 並べ替えUIもこの順序を動かしている。
 *
 * 引数を `unknown[]` で受けるのは、これが Webview から届いたメッセージだから
 * ——期待した形でない値で設定の書き戻しが例外になると、表示の更新ごと壊れる。
 */
export function toHighlightRuleSettings(rows: readonly unknown[]): HighlightRuleSetting[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const settings: HighlightRuleSetting[] = [];
  for (const value of rows) {
    const row = toHighlightRuleRow(value);
    if (!row) {
      continue;
    }
    const pattern = row.pattern.trim();
    if (pattern === "") {
      continue;
    }
    const name = row.name.trim();
    settings.push(name === "" ? { pattern, color: row.color } : { name, pattern, color: row.color });
  }
  return settings;
}

/** {@link resolveHighlightRulesTarget} が見る、`inspect()` の結果のうち必要な部分。 */
export interface HighlightRulesInspection {
  readonly workspaceValue?: unknown;
  readonly globalValue?: unknown;
}

/**
 * パネルからの編集をどのスコープへ書き戻すかを決める（issue #238）。
 *
 * **既に定義されている場所へ書き戻す**のが原則。ワークスペース設定に置いて
 * チームで共有しているルールを、書き戻しでユーザー設定側へ逃がしてしまわない
 * ため。どこにも定義が無い初回はユーザー設定にする——何もしていないのに
 * `.vscode/settings.json` が生まれて、gitの作業ツリーが汚れる驚きを避ける。
 *
 * ワークスペースが開かれていないときに `Workspace` を指定すると書き込みが
 * 失敗するため、その場合もユーザー設定へ落とす。
 */
export function resolveHighlightRulesTarget(
  inspection: HighlightRulesInspection | undefined,
  hasWorkspaceFolder: boolean
): vscode.ConfigurationTarget {
  return inspection?.workspaceValue !== undefined && hasWorkspaceFolder
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

/**
 * 編集パネルの行を `totonoeLog.highlightRules` へ書き戻す（issue #238）。
 * 書き込みは設定変更イベントを起こし、#183 の redisplay 経路で表示へ反映される
 * ——ここで自前に再描画を促す必要はない。
 */
export async function writeHighlightRuleRows(rows: readonly unknown[]): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(HIGHLIGHT_RULES_CONFIG_SECTION);
  const target = resolveHighlightRulesTarget(
    configuration.inspect(HIGHLIGHT_RULES_CONFIG_KEY),
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0
  );
  try {
    await configuration.update(HIGHLIGHT_RULES_CONFIG_KEY, toHighlightRuleSettings(rows), target);
  } catch (error) {
    // 設定ファイルが読み取り専用・書き込み権限が無い等。黙って失敗すると、
    // パネルには編集が残っているのに保存されていない状態になり、パネルを
    // 開き直した時点で編集が消えたように見える。
    const reason = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(
      `Totonoe Log: ハイライトルールを設定に保存できませんでした（${reason}）`
    );
  }
}
