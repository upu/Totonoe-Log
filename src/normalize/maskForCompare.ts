import { isIPv6 } from "node:net";
import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";
// 比較ビューは桁を揃えない（左右でセベリティの顔ぶれが違うと列幅も変わり、
// 本文が同じ行まで差分になるため、issue #174）。ただしプレースホルダーの
// 表記だけは他のビューと同じものを使う。
import { SEVERITY_PLACEHOLDER } from "./severityColumn";
/** マスクしたタイムスタンプの表示に使うプレースホルダー。 */
export const TIMESTAMP_PLACEHOLDER = "<TIMESTAMP>";
/** マスクしたホスト名/IPアドレスの表示に使うプレースホルダー。 */
export const HOST_PLACEHOLDER = "<HOST>";
/** マスクしたプロセスIDの表示に使うプレースホルダー（issue #195）。 */
export const PROCESS_ID_PLACEHOLDER = "<PID>";

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

// プロセスIDは「数値そのもの」に手がかりが無いため、IPv6と同じく「それらしい
// 候補を拾って文脈で検証する」形にする（issue #195）。文脈は2つ——
//
// 1. syslog のタグ表記 `sshd[1234]:` — 角括弧の**直後にコロンが続く**ことを
//    必須にして、log4j のスレッド名列（`[main]`）や配列の添字（`retries[3] =`）
//    を巻き込まない。さらに2桁以上・先頭0なしに限り、`items[0]:` のような
//    1桁の添字も外す（1桁PIDは {@link maskSyslogTagProcessId} が位置で拾う）
// 2. `pid` というキーワードを伴う表記 — こちらはキーワード自体が文脈なので
//    桁数の制限を課さない（`pid=1` は init の正当なPID）
const TAGGED_PROCESS_ID_REGEX = /([A-Za-z][\w.\-/]*)\[([1-9][0-9]{1,6})\](?=:)/g;
const KEYWORD_PROCESS_ID_REGEX = /\b(pid\s*[=:]\s*|pid\s+)([0-9]{1,7})\b/gi;

// syslog（RFC3164）はタイムスタンプの直後がホスト名、その次がタグ `name[pid]:`
// と位置が確定している。その位置に限れば `systemd[1]:` のような1桁のPIDも
// 添字と取り違える恐れが無いため、汎用ルールより緩い条件で拾える
// （ホスト名の位置指定マスクと同じ発想）。
const SYSLOG_TAG_PROCESS_ID_REGEX = /^(\s*\S+\s+[A-Za-z][\w.\-/]*)\[([0-9]{1,7})\](?=:)/;

/**
 * メッセージ中のプロセスIDをプレースホルダーに置き換える（issue #195）。
 * ログをissueやチャットに貼るときに落としたい情報のうち、タイムスタンプ・
 * ホスト名に次いで頻度が高いものとして追加した。
 *
 * 取りこぼしより誤マスクを避ける側に倒してある——PIDらしく見えるだけの数値を
 * 伏せると、読み手が「元は何だったのか」を復元できず調査の妨げになるため。
 */
export function maskProcessIds(text: string): string {
  return text
    .replace(TAGGED_PROCESS_ID_REGEX, `$1[${PROCESS_ID_PLACEHOLDER}]`)
    .replace(KEYWORD_PROCESS_ID_REGEX, `$1${PROCESS_ID_PLACEHOLDER}`);
}

/**
 * syslog形式と分かっている行の、タグ位置（ホスト名の次のトークン）にある
 * プロセスIDをマスクする。{@link maskProcessIds} と併用する前提で、あちらが
 * 誤マスクを避けるために外している1桁のPIDだけをここで拾う。
 *
 * 引数はホスト名トークンから始まる行（ホスト名を `<HOST>` に置き換えた後でも
 * よい）。
 */
export function maskSyslogTagProcessId(text: string): string {
  return text.replace(SYSLOG_TAG_PROCESS_ID_REGEX, `$1[${PROCESS_ID_PLACEHOLDER}]`);
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
  /**
   * プロセスIDをマスクするかどうか（issue #195）。他の2つと違い**省略時は
   * false**——後から足した対象なので、既定でONにすると既存の
   * `Copy Masked Text` の出力が黙って変わってしまうため。
   */
  readonly maskProcessId?: boolean;
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列を、外部のdiffツールに貼り
 * 付けやすいマスク済みテキストへ整形する。{@link formatMaskedLogForCompare}
 * とは異なり、タイムスタンプ・severityをISO形式などに書き換えたり行番号
 * ガターを付けたりせず、元の生テキストのフォーマットをそのまま保ちながら
 * 該当箇所だけをプレースホルダーに置き換える（コピー後にそのまま元のログ
 * と見比べられるようにするため）。
 *
 * マスク対象（タイムスタンプ / ホスト名・IPアドレス / プロセスID）はそれぞれ
 * 独立に切り替えられる。
 */
export function maskLogTextForCopy(
  entries: readonly LogEntry[],
  options: MaskForCopyOptions = {}
): string {
  const maskTimestamp = options.maskTimestamp ?? true;
  const maskHost = options.maskHost ?? true;
  const maskProcessId = options.maskProcessId ?? false;
  const outputLines: string[] = [];

  for (const entry of entries) {
    const lines = [...entry.lines];

    if (entry.matched && entry.rawTimestamp !== undefined) {
      let afterTimestamp = lines[0].slice(entry.rawTimestamp.length);
      if (entry.timestampFormat === "syslog") {
        afterTimestamp = maskHost
          ? afterTimestamp.replace(/^(\s*)(\S+)/, `$1${HOST_PLACEHOLDER}`)
          : afterTimestamp;
        afterTimestamp = maskProcessId
          ? maskSyslogTagProcessId(afterTimestamp)
          : afterTimestamp;
      }
      lines[0] = (maskTimestamp ? TIMESTAMP_PLACEHOLDER : entry.rawTimestamp) + afterTimestamp;
    }

    for (const line of lines) {
      const withHostMasked = maskHost ? maskHostAddresses(line) : line;
      outputLines.push(maskProcessId ? maskProcessIds(withHostMasked) : withHostMasked);
    }
  }

  return outputLines.join("\n");
}
