import type { LogEntry } from "./types";

/**
 * 元の行番号（または折りたたみビューの行範囲 `"1-5"` のようなラベル）を
 * 右詰めし、区切り記号 `|` を付けたガター文字列を作る。全エントリ中で
 * 最も幅の広いラベルに桁数を合わせることで、出力全体の縦位置を揃える。
 * {@link formatNormalizedLog}・{@link formatMaskedLogForCompare}・
 * {@link formatCollapsedLog} が共有する。
 */
export function formatGutter(label: string | number, gutterWidth: number): string {
  return `${String(label).padStart(gutterWidth)} | `;
}

export function computeMaxLineNumber(entries: readonly LogEntry[]): number {
  return entries.reduce(
    (max, entry) => Math.max(max, entry.startLine + entry.lines.length - 1),
    0
  );
}
