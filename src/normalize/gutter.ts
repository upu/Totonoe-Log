import type { LogEntry } from "./types";

/**
 * 元の行番号を右詰めし、区切り記号 `|` を付けたガター文字列を作る。
 * 全エントリ中の最大行番号に桁数を合わせることで、出力全体の縦位置を揃える。
 * {@link formatNormalizedLog} と {@link formatMaskedLogForCompare} が共有する。
 */
export function formatGutter(lineNumber: number, gutterWidth: number): string {
  return `${String(lineNumber).padStart(gutterWidth)} | `;
}

export function computeMaxLineNumber(entries: readonly LogEntry[]): number {
  return entries.reduce(
    (max, entry) => Math.max(max, entry.startLine + entry.lines.length - 1),
    0
  );
}
