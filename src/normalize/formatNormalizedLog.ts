import type { LogEntry } from "./types";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/**
 * 元の行番号を右詰めし、区切り記号 `|` を付けたガター文字列を作る。
 * 全エントリ中の最大行番号に桁数を合わせることで、出力全体の縦位置を揃える。
 */
function formatGutter(lineNumber: number, gutterWidth: number): string {
  return `${String(lineNumber).padStart(gutterWidth)} | `;
}

function countTotalLines(entries: readonly LogEntry[]): number {
  return entries.reduce((total, entry) => total + entry.lines.length, 0);
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列を、読み取り専用の正規化
 * ビュー（仮想ドキュメント）に表示するためのテキストへ整形する。
 *
 * - 認識できたタイムスタンプは ISO 8601 に統一して表示し、元の表記ゆれを
 *   吸収する。
 * - 各行の先頭には元のログファイルでの行番号を付け、正規化後の表示と
 *   元のログとの対応関係が常に分かるようにする。
 * - 複数行にまたがるエントリ（スタックトレース等）の継続行は、元のインデント
 *   をそのまま保持して見出し行の下に並べる。
 */
export function formatNormalizedLog(entries: readonly LogEntry[]): string {
  const gutterWidth = String(countTotalLines(entries)).length;
  const outputLines: string[] = [];
  let originalLineNumber = 1;

  for (const entry of entries) {
    const messageLines = entry.message.split("\n");

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${formatTimestamp(entry.timestampMs)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(formatGutter(originalLineNumber, gutterWidth) + headerText);

    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(formatGutter(originalLineNumber + i, gutterWidth) + messageLines[i]);
    }

    originalLineNumber += entry.lines.length;
  }

  return outputLines.join("\n");
}
