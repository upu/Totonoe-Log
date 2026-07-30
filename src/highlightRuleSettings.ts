import * as vscode from "vscode";
import { compileHighlightRules, type HighlightRule } from "./normalize";

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
  const settings = vscode.workspace
    .getConfiguration(HIGHLIGHT_RULES_CONFIG_SECTION)
    .get<unknown[]>(HIGHLIGHT_RULES_CONFIG_KEY, []);
  const { rules, errors } = compileHighlightRules(settings ?? []);
  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      `Totonoe Log: totonoeLog.highlightRules に不正な項目があるため無視しました — ${errors.join(" / ")}`
    );
  }
  return rules;
}
