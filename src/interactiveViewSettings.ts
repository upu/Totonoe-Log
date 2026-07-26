import * as vscode from "vscode";
import { DEFAULT_MAX_DISPLAY_LINES } from "./normalize";

/** Interactive View 固有の設定を読み込むVSCode設定のセクション名。 */
const INTERACTIVE_VIEW_CONFIG_SECTION = "totonoeLog.interactiveView";

/**
 * `totonoeLog.interactiveView.maxDisplayLines` 設定を読み込む（issue #178）。
 * 0以下は「上限なし」を意味するため、そのまま {@link limitInteractiveDisplay}
 * 側の判定に委ねる（`totonoeLog.gap.thresholdSeconds` と同じ扱い）。
 */
export function readMaxDisplayLines(): number {
  return vscode.workspace
    .getConfiguration(INTERACTIVE_VIEW_CONFIG_SECTION)
    .get<number>("maxDisplayLines", DEFAULT_MAX_DISPLAY_LINES);
}
