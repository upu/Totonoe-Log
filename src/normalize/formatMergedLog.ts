import { computeMaxLineNumber, formatGutter } from "./gutter";
import type { MergedEntry } from "./mergeLogFiles";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function computeColumnWidth(
  mergedEntries: readonly MergedEntry[],
  selectField: (merged: MergedEntry) => string
): number {
  return mergedEntries.reduce((max, merged) => Math.max(max, selectField(merged).length), 0);
}

/**
 * {@link mergeLogFiles} が返す {@link MergedEntry} の配列を、読み取り専用の
 * マージビュー（仮想ドキュメント）に表示するためのテキストへ整形する。
 *
 * 各行の先頭に、そのエントリの由来を示す「ファイル名」「種類」の2列と、
 * {@link formatNormalizedLog} と同じ元の行番号ガター・ISO統一タイムスタンプ
 * を付ける。複数行にまたがるエントリの継続行では、ファイル名・種類の列は
 * 空白で埋め、見出し情報が1エントリにつき1回だけ表示されるようにする
 * （行番号ガターは {@link formatNormalizedLog} と同様に継続行でも表示する）。
 */
export function formatMergedLog(mergedEntries: readonly MergedEntry[]): string {
  const fileNameWidth = computeColumnWidth(mergedEntries, (m) => m.fileName);
  const kindWidth = computeColumnWidth(mergedEntries, (m) => m.kind);
  const gutterWidth = String(
    computeMaxLineNumber(mergedEntries.map((m) => m.entry))
  ).length;
  const blankPrefix = `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | `;

  const outputLines: string[] = [];

  for (const { entry, fileName, kind } of mergedEntries) {
    const messageLines = entry.message.split("\n");
    const headerPrefix = `${fileName.padEnd(fileNameWidth)} | ${kind.padEnd(kindWidth)} | `;

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${formatTimestamp(entry.timestampMs)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(headerPrefix + formatGutter(entry.startLine, gutterWidth) + headerText);

    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(blankPrefix + formatGutter(entry.startLine + i, gutterWidth) + messageLines[i]);
    }
  }

  return outputLines.join("\n");
}
