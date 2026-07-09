import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";
/** マスクしたタイムスタンプの表示に使うプレースホルダー。 */
const TIMESTAMP_PLACEHOLDER = "<TIMESTAMP>";
/** マスクしたホスト名/IPアドレスの表示に使うプレースホルダー。 */
const HOST_PLACEHOLDER = "<HOST>";

// 各オクテットを 0-255 に限定することで、`999.999.999.999` のような
// IPv4として不正な4分割の数値トークン（バージョン表記等）を誤マスクしない。
const IPV4_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const IPV4_REGEX = new RegExp(`\\b${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}\\b`, "g");

/**
 * メッセージ中のIPv4アドレスをプレースホルダーに置き換える。
 * ドット区切りの一般的な文字列（クラス名・バージョン番号等）まで
 * ホスト名とみなして誤マスクしないよう、数字のみのIPv4パターンに限定する。
 * 比較ビュー・コピー機能に加え、繰り返し検出（{@link collapseRepeatedEntries}）
 * が可変部分を除いた一致判定を行う際にも使う。
 */
export function maskIpv4Addresses(text: string): string {
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

/** {@link maskLogTextForCopy} でマスクする対象を個別に切り替えるオプション。 */
export interface MaskForCopyOptions {
  /** タイムスタンプをマスクするかどうか。省略時は true。 */
  readonly maskTimestamp?: boolean;
  /** IPv4アドレス・syslogホスト名をマスクするかどうか。省略時は true。 */
  readonly maskHost?: boolean;
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列を、外部のdiffツールに貼り
 * 付けやすいマスク済みテキストへ整形する。{@link formatMaskedLogForCompare}
 * とは異なり、タイムスタンプ・severityをISO形式などに書き換えたり行番号
 * ガターを付けたりせず、元の生テキストのフォーマットをそのまま保ちながら
 * 該当箇所だけをプレースホルダーに置き換える（コピー後にそのまま元のログ
 * と見比べられるようにするため）。
 *
 * マスク対象（タイムスタンプ / ホスト名・IPアドレス）はそれぞれ独立に
 * 無効化できる。
 */
export function maskLogTextForCopy(
  entries: readonly LogEntry[],
  options: MaskForCopyOptions = {}
): string {
  const maskTimestamp = options.maskTimestamp ?? true;
  const maskHost = options.maskHost ?? true;
  const outputLines: string[] = [];

  for (const entry of entries) {
    const lines = [...entry.lines];

    if (entry.matched && entry.rawTimestamp !== undefined) {
      const afterTimestamp = lines[0].slice(entry.rawTimestamp.length);
      const maskedAfterTimestamp =
        maskHost && entry.timestampFormat === "syslog"
          ? afterTimestamp.replace(/^(\s*)(\S+)/, `$1${HOST_PLACEHOLDER}`)
          : afterTimestamp;
      lines[0] = (maskTimestamp ? TIMESTAMP_PLACEHOLDER : entry.rawTimestamp) + maskedAfterTimestamp;
    }

    for (const line of lines) {
      outputLines.push(maskHost ? maskIpv4Addresses(line) : line);
    }
  }

  return outputLines.join("\n");
}
