import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";
/** マスクしたタイムスタンプの表示に使うプレースホルダー。 */
const TIMESTAMP_PLACEHOLDER = "<TIMESTAMP>";
/** マスクしたホスト名/IPアドレスの表示に使うプレースホルダー。 */
const HOST_PLACEHOLDER = "<HOST>";

const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * メッセージ中のIPv4アドレスをプレースホルダーに置き換える。
 * ドット区切りの一般的な文字列（クラス名・バージョン番号等）まで
 * ホスト名とみなして誤マスクしないよう、数字のみのIPv4パターンに限定する。
 */
function maskIpv4Addresses(text: string): string {
  return text.replace(IPV4_REGEX, HOST_PLACEHOLDER);
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列を、日付・ホスト情報が
 * 異なる2つのログを比較する際にdiffのノイズを抑えるためのテキストへ整形する。
 *
 * - 認識できたタイムスタンプは、実際の値ではなく固定のプレースホルダーに
 *   置き換える（対応するイベントが起きた時刻が異なるだけでdiffに現れて
 *   しまわないようにする）。
 * - メッセージ中のIPv4アドレスはプレースホルダーに置き換える。
 * - syslog形式（RFC3164）はタイムスタンプの直後に必ずホスト名が来るため、
 *   そのフォーマットで認識したエントリに限り先頭トークンをホスト名として
 *   マスクする。他の形式ではスタックトレースのクラス名（`Foo.java`等）を
 *   誤ってホスト名とみなさないよう、この位置指定マスク以外は行わない。
 * - 各行には元のログファイルでの行番号を付け、{@link formatNormalizedLog}
 *   と同様にdiff結果から元の行へたどれるようにする。
 */
export function formatMaskedLogForCompare(entries: readonly LogEntry[]): string {
  const gutterWidth = String(computeMaxLineNumber(entries)).length;
  const outputLines: string[] = [];

  for (const entry of entries) {
    const messageLines = entry.message.split("\n").map(maskIpv4Addresses);

    if (entry.matched && entry.timestampFormat === "syslog") {
      messageLines[0] = messageLines[0].replace(/^\S+/, HOST_PLACEHOLDER);
    }

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${TIMESTAMP_PLACEHOLDER} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(formatGutter(entry.startLine, gutterWidth) + headerText);

    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(formatGutter(entry.startLine + i, gutterWidth) + messageLines[i]);
    }
  }

  return outputLines.join("\n");
}
