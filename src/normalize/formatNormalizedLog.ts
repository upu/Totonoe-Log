import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

/** ギャップ区切り行のガター欄に表示するラベル。特定の行番号に対応しないことを表す。 */
const GAP_MARKER_LABEL = "...";

/** 時間ギャップ検出しきい値の既定値（秒）。この秒数以上間が空いたら区切り行を挿入する。 */
export const DEFAULT_GAP_THRESHOLD_SECONDS = 30;

/** {@link formatNormalizedLog} の挙動を調整するオプション。 */
export interface FormatNormalizedLogOptions {
  /**
   * 連続するエントリのタイムスタンプ差がこの値（ミリ秒）以上の場合に、
   * 「XX秒の空白」の区切り行を両エントリの間に挿入する。`undefined` または
   * 0以下の場合は挿入しない（両エントリともタイムスタンプを認識できている
   * 場合のみ判定対象になる）。
   */
  readonly gapThresholdMs?: number;
}

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/**
 * ギャップの長さ（ミリ秒）を「XX秒の空白」表示用の秒数文字列に変換する。
 * 小数第1位までに丸め、整数秒であれば小数点以下を表示しない。
 */
function formatGapSeconds(gapMs: number): string {
  const rounded = Math.round(gapMs / 100) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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
 * - `options.gapThresholdMs` を指定すると、隣り合うエントリ（配列上で連続する
 *   もの）のタイムスタンプ差がその値以上のとき、間に「XX秒の空白」の区切り
 *   行を挿入する。絞り込み後のエントリ列に対してもそのまま機能するため、
 *   例えばセベリティで絞り込んだ後の「沈黙時間」も検出できる。片方でも
 *   タイムスタンプを認識できないエントリが隣接する場合は、その組については
 *   判定をスキップする（前後の他の組の判定には影響しない）。
 */
export function formatNormalizedLog(
  entries: readonly LogEntry[],
  options: FormatNormalizedLogOptions = {}
): string {
  const gutterWidth = String(computeMaxLineNumber(entries)).length;
  const outputLines: string[] = [];
  const gapThresholdMs = options.gapThresholdMs;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (i > 0 && gapThresholdMs !== undefined && gapThresholdMs > 0) {
      const previous = entries[i - 1];
      if (previous.timestampMs !== undefined && entry.timestampMs !== undefined) {
        const gapMs = entry.timestampMs - previous.timestampMs;
        if (gapMs >= gapThresholdMs) {
          outputLines.push(
            formatGutter(GAP_MARKER_LABEL, gutterWidth) + `${formatGapSeconds(gapMs)}秒の空白`
          );
        }
      }
    }

    const messageLines = entry.message.split("\n");

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${formatTimestamp(entry.timestampMs)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(formatGutter(entry.startLine, gutterWidth) + headerText);

    for (let j = 1; j < messageLines.length; j++) {
      outputLines.push(formatGutter(entry.startLine + j, gutterWidth) + messageLines[j]);
    }
  }

  return outputLines.join("\n");
}
