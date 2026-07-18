import type { LogEntry } from "./types";
import type { FormattedLogWithLineSources, LineSource } from "./lineSources";
import { computeMaxLineNumber, formatGutter } from "./gutter";
import { formatTimestampForDisplay, type DisplayTimezone } from "./timezone";
import { computeGapMs, formatGapMarkerText, GAP_MARKER_LABEL } from "./gapDetection";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

/** {@link formatNormalizedLog} の挙動を調整するオプション。 */
export interface FormatNormalizedLogOptions {
  /**
   * 連続するエントリのタイムスタンプ差がこの値（ミリ秒）以上の場合に、
   * 「XX秒の空白」の区切り行を両エントリの間に挿入する。`undefined` または
   * 0以下の場合は挿入しない（両エントリともタイムスタンプを認識できている
   * 場合のみ判定対象になる）。
   */
  readonly gapThresholdMs?: number;

  /**
   * タイムスタンプの表示タイムゾーン。省略時は UTC（従来どおり `Z` サフィックス
   * 表示）。指定するとその壁時計時刻＋オフセットサフィックスで表示する（issue #13）。
   */
  readonly displayTimezone?: DisplayTimezone;
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
  return formatNormalizedLogWithLineSources(entries, options).text;
}

/**
 * {@link formatNormalizedLog} と同じテキストに加えて、表示行ごとの元ログ
 * 物理行の対応表を返す（issue #137）。対応表を別ロジックで再計算すると
 * ギャップマーカー挿入等の行構成と食い違うリスクがあるため、同じループで
 * 本文と一緒に組み立てる。
 */
export function formatNormalizedLogWithLineSources(
  entries: readonly LogEntry[],
  options: FormatNormalizedLogOptions = {}
): FormattedLogWithLineSources {
  const gutterWidth = String(computeMaxLineNumber(entries)).length;
  const outputLines: string[] = [];
  const lineSources: (LineSource | undefined)[] = [];
  const gapThresholdMs = options.gapThresholdMs;
  const displayTimezone = options.displayTimezone ?? 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (i > 0) {
      const gapMs = computeGapMs(entries[i - 1].timestampMs, entry.timestampMs, gapThresholdMs);
      if (gapMs !== undefined) {
        outputLines.push(formatGutter(GAP_MARKER_LABEL, gutterWidth) + formatGapMarkerText(gapMs));
        lineSources.push(undefined);
      }
    }

    const messageLines = entry.message.split("\n");

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${formatTimestampForDisplay(entry.timestampMs, displayTimezone)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(formatGutter(entry.startLine, gutterWidth) + headerText);
    lineSources.push({ fileIndex: 0, line: entry.startLine });

    for (let j = 1; j < messageLines.length; j++) {
      outputLines.push(formatGutter(entry.startLine + j, gutterWidth) + messageLines[j]);
      lineSources.push({ fileIndex: 0, line: entry.startLine + j });
    }
  }

  return { text: outputLines.join("\n"), lineSources };
}
