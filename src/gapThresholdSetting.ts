import * as vscode from "vscode";
import { DEFAULT_GAP_THRESHOLD_SECONDS } from "./normalize";

/** 時間ギャップ検出のしきい値（秒）を読み込むVSCode設定のセクション名。 */
const GAP_CONFIG_SECTION = "totonoeLog.gap";

/**
 * `totonoeLog.gap.thresholdSeconds` 設定を読み込み、{@link formatNormalizedLog}・
 * {@link formatMergedLog} が受け取るミリ秒単位のしきい値に変換する。0以下を
 * 指定した場合は無効化を意味するため、そのまま各フォーマット関数側の
 * 「0以下なら挿入しない」判定に委ねる。正規化ビュー・マージビューの両方が
 * この設定を共有する（issue #102。以前は `normalizedView.ts` 内に閉じていた）。
 */
export function readGapThresholdMs(): number {
  const thresholdSeconds = vscode.workspace
    .getConfiguration(GAP_CONFIG_SECTION)
    .get<number>("thresholdSeconds", DEFAULT_GAP_THRESHOLD_SECONDS);
  return thresholdSeconds * 1000;
}
