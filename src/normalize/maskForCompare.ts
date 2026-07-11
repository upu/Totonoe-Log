import { isIPv6 } from "node:net";
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

// IPv6は `::` による省略やゾーンID（`%eth0`）などで表記の幅が広く、正規表現
// だけで正確に構文検証するのは複雑になりやすい。ここでは16進数とコロンから
// なる「それらしい」候補トークンを緩く抽出し、候補ごとにNode.jsの
// `net.isIPv6` で正当性を検証する二段構えにする。`03:04:05` のような時刻
// 表記や `00:1a:2b:3c:4d:5e` のようなMACアドレスも候補としては拾うが、
// どちらも `net.isIPv6` が false を返すため誤マスクしない。前後がホスト名の
// 一部を切り出したものにならないよう、英数字・コロンに隣接する位置では
// 候補を開始/終了させない。
const IPV6_CANDIDATE_REGEX =
  /(?<![0-9a-zA-Z:])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:%[0-9A-Za-z]+)?(?![0-9a-zA-Z:])/g;

/**
 * メッセージ中のIPv4/IPv6アドレスをプレースホルダーに置き換える。
 * IPv4はドット区切りの一般的な文字列（クラス名・バージョン番号等）まで
 * ホスト名とみなして誤マスクしないよう、数字のみのIPv4パターンに限定する。
 * IPv6は {@link IPV6_CANDIDATE_REGEX} で候補を抽出したうえで `net.isIPv6`
 * により正当性を検証し、時刻表記等を誤マスクしないようにする。
 * 比較ビュー・コピー機能に加え、繰り返し検出（{@link collapseRepeatedEntries}）
 * が可変部分を除いた一致判定を行う際にも使う。
 */
export function maskHostAddresses(text: string): string {
  const withIpv4Masked = text.replace(IPV4_REGEX, HOST_PLACEHOLDER);
  return withIpv4Masked.replace(IPV6_CANDIDATE_REGEX, (candidate) =>
    isIPv6(candidate) ? HOST_PLACEHOLDER : candidate
  );
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列を、日付・ホスト情報が
 * 異なる2つのログを比較する際にdiffのノイズを抑えるためのテキストへ整形する。
 *
 * - 認識できたタイムスタンプは、実際の値ではなく固定のプレースホルダーに
 *   置き換える（対応するイベントが起きた時刻が異なるだけでdiffに現れて
 *   しまわないようにする）。
 * - メッセージ中のIPv4/IPv6アドレスはプレースホルダーに置き換える。
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
    const messageLines = entry.message.split("\n").map(maskHostAddresses);

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
  /** IPv4/IPv6アドレス・syslogホスト名をマスクするかどうか。省略時は true。 */
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
      outputLines.push(maskHost ? maskHostAddresses(line) : line);
    }
  }

  return outputLines.join("\n");
}
