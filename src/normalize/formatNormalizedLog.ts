import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列を、読み取り専用の正規化
 * ビュー（仮想ドキュメント）に表示するためのテキストへ整形する。
 *
 * - 認識できたタイムスタンプは ISO 8601 に統一して表示し、元の表記ゆれを
 *   吸収する。
 * - 各行の先頭には元のログファイルでの行番号を付け、正規化後の表示と
 *   元のログとの対応関係が常に分かるようにする（セベリティ絞り込み等で
 *   一部のエントリだけを渡した場合も、各エントリの `startLine` を使うため
 *   元の行番号がずれない）。
 * - 複数行にまたがるエントリ（スタックトレース等）の継続行は、元のインデント
 *   をそのまま保持して見出し行の下に並べる。
 */
export function formatNormalizedLog(entries: readonly LogEntry[]): string {
  const gutterWidth = String(computeMaxLineNumber(entries)).length;
  const outputLines: string[] = [];

  for (const entry of entries) {
    const messageLines = entry.message.split("\n");

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${formatTimestamp(entry.timestampMs)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(formatGutter(entry.startLine, gutterWidth) + headerText);

    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(formatGutter(entry.startLine + i, gutterWidth) + messageLines[i]);
    }
  }

  return outputLines.join("\n");
}
