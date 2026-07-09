import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";
import type { CollapsedItem } from "./collapseRepeatedEntries";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function rangeLabel(entries: readonly LogEntry[]): string {
  const first = entries[0].startLine;
  const last = entries[entries.length - 1].startLine;
  return `${first}-${last}`;
}

/**
 * 折りたたみビューの行番号ガター幅を決める。通常の最大行番号に加え、
 * 折りたたみグループの行範囲ラベル（例: `"95-100"`）が単純な行番号より
 * 幅広くなる場合があるため、その幅も考慮する。
 */
function computeGutterWidth(entries: readonly LogEntry[], items: readonly CollapsedItem[]): number {
  let width = String(computeMaxLineNumber(entries)).length;
  for (const item of items) {
    if (item.kind === "group") {
      width = Math.max(width, rangeLabel(item.entries).length);
    }
  }
  return width;
}

/**
 * {@link collapseRepeatedEntries} が返す {@link CollapsedItem} の配列を、
 * 読み取り専用の折りたたみビュー（仮想ドキュメント）に表示するための
 * テキストへ整形する。折りたたまれなかったエントリは {@link formatNormalizedLog}
 * と同じ見た目で表示し、折りたたまれたグループは代表エントリ（先頭の
 * エントリ）の内容を、行番号の代わりに範囲ラベルと繰り返し回数
 * （例: `"×5"`）付きで1行にまとめて表示する。
 */
export function formatCollapsedLog(
  entries: readonly LogEntry[],
  items: readonly CollapsedItem[]
): string {
  const gutterWidth = computeGutterWidth(entries, items);
  const outputLines: string[] = [];

  for (const item of items) {
    const representative = item.kind === "single" ? item.entry : item.entries[0];
    const messageLines = representative.message.split("\n");
    const suffix = item.kind === "group" ? ` (×${item.entries.length})` : "";

    const headerText = representative.matched && representative.timestampMs !== undefined
      ? `${formatTimestamp(representative.timestampMs)} ${representative.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}${suffix}`
      : `${messageLines[0]}${suffix}`;
    const gutterLabel = item.kind === "single" ? representative.startLine : rangeLabel(item.entries);
    outputLines.push(formatGutter(gutterLabel, gutterWidth) + headerText);

    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(formatGutter(representative.startLine + i, gutterWidth) + messageLines[i]);
    }
  }

  return outputLines.join("\n");
}
