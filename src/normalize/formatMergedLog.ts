import { computeMaxLineNumber, formatGutter } from "./gutter";
import type { MergedEntry } from "./mergeLogFiles";
import { formatTimestampForDisplay, type DisplayTimezone } from "./timezone";
import { computeGapMs, formatGapMarkerText, GAP_MARKER_LABEL } from "./gapDetection";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

/** {@link formatMergedLog} の挙動を調整するオプション。 */
export interface FormatMergedLogOptions {
  /**
   * タイムスタンプの表示タイムゾーン。省略時は UTC（従来どおり `Z` サフィックス
   * 表示）。指定するとその壁時計時刻＋オフセットサフィックスで表示する（issue #13）。
   */
  readonly displayTimezone?: DisplayTimezone;

  /**
   * 連続するエントリのタイムスタンプ差がこの値（ミリ秒）以上の場合に、
   * 「XX秒の空白」の区切り行を両エントリの間に挿入する。`undefined` または
   * 0以下の場合は挿入しない。{@link formatNormalizedLog} と同じ判定ロジック
   * （{@link computeGapMs}）を共有する（issue #102）。
   */
  readonly gapThresholdMs?: number;
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
 *
 * `options.gapThresholdMs` を指定すると、配列上で隣り合うエントリ（元が
 * どのファイル由来でも、{@link mergeLogFiles} により時系列にソート済み）の
 * タイムスタンプ差がその値以上のとき、間に「XX秒の空白」の区切り行を挿入
 * する（{@link formatNormalizedLog} と同じ判定ロジックを使う、issue #102）。
 * 区切り行はどのファイルにも属さないため、ファイル名・種類列は継続行と同様
 * 空白で埋める。絞り込み後のエントリ列に対してもそのまま機能する。
 */
export function formatMergedLog(
  mergedEntries: readonly MergedEntry[],
  options: FormatMergedLogOptions = {}
): string {
  const displayTimezone = options.displayTimezone ?? 0;
  const gapThresholdMs = options.gapThresholdMs;
  const fileNameWidth = computeColumnWidth(mergedEntries, (m) => m.fileName);
  const kindWidth = computeColumnWidth(mergedEntries, (m) => m.kind);
  const gutterWidth = String(
    computeMaxLineNumber(mergedEntries.map((m) => m.entry))
  ).length;
  const blankPrefix = `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | `;

  const outputLines: string[] = [];

  for (let i = 0; i < mergedEntries.length; i++) {
    const { entry, fileName, kind } = mergedEntries[i];

    if (i > 0) {
      const gapMs = computeGapMs(
        mergedEntries[i - 1].entry.timestampMs,
        entry.timestampMs,
        gapThresholdMs
      );
      if (gapMs !== undefined) {
        outputLines.push(
          blankPrefix + formatGutter(GAP_MARKER_LABEL, gutterWidth) + formatGapMarkerText(gapMs)
        );
      }
    }

    const messageLines = entry.message.split("\n");
    const headerPrefix = `${fileName.padEnd(fileNameWidth)} | ${kind.padEnd(kindWidth)} | `;

    const headerText = entry.matched && entry.timestampMs !== undefined
      ? `${formatTimestampForDisplay(entry.timestampMs, displayTimezone)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(headerPrefix + formatGutter(entry.startLine, gutterWidth) + headerText);

    for (let j = 1; j < messageLines.length; j++) {
      outputLines.push(blankPrefix + formatGutter(entry.startLine + j, gutterWidth) + messageLines[j]);
    }
  }

  return outputLines.join("\n");
}
