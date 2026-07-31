import { computeMaxLineNumber, formatGutter } from "./gutter";
import type { FormattedLogWithLineSources, LineSource } from "./lineSources";
import type { MergedEntry } from "./mergeLogFiles";
import { type DisplayTimezone } from "./timezone";
import { computeGapMs, formatGapMarkerText, GAP_MARKER_LABEL } from "./gapDetection";
import {
  formatMaskableTimestamp,
  maskDisplayMessageLines,
  type DisplayMaskOptions,
} from "./displayMask";
import { computeSeverityWidth, formatSeverity, messageColumnIndent } from "./severityColumn";

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

  /**
   * 指定すると、タイムスタンプ・ホスト名/IPアドレスをプレースホルダーに
   * 置き換えて整形する（issue #194）。ファイル名/種別列は元ファイルを
   * 見分けるための構造的な列なのでマスクしない（#195 で改めて扱う）。
   */
  readonly mask?: DisplayMaskOptions;
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
  return formatMergedLogWithLineSources(mergedEntries, options).text;
}

/**
 * {@link formatMergedLog} と同じテキストに加えて、表示行ごとの元ログ物理行の
 * 対応表を返す（issue #137）。元ファイルは {@link MergedEntry.fileIndex} で
 * 表し、同名ファイルが異なるフォルダにあっても呼び出し側が入力ファイル配列
 * から正しい URI を引けるようにする。対応表を別ロジックで再計算すると
 * ギャップマーカー挿入等の行構成と食い違うリスクがあるため、同じループで
 * 本文と一緒に組み立てる。
 */
export function formatMergedLogWithLineSources(
  mergedEntries: readonly MergedEntry[],
  options: FormatMergedLogOptions = {}
): FormattedLogWithLineSources {
  const displayTimezone = options.displayTimezone ?? 0;
  const gapThresholdMs = options.gapThresholdMs;
  const fileNameWidth = computeColumnWidth(mergedEntries, (m) => m.fileName);
  const kindWidth = computeColumnWidth(mergedEntries, (m) => m.kind);
  const gutterWidth = String(
    computeMaxLineNumber(mergedEntries.map((m) => m.entry))
  ).length;
  const blankPrefix = `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | `;
  const severityWidth = computeSeverityWidth(mergedEntries.map((merged) => merged.entry));

  const outputLines: string[] = [];
  const lineSources: (LineSource | undefined)[] = [];

  for (let i = 0; i < mergedEntries.length; i++) {
    const { entry, fileName, kind, fileIndex } = mergedEntries[i];

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
        lineSources.push(undefined);
      }
    }

    const messageLines = maskDisplayMessageLines(
      entry.message.split("\n"),
      entry.timestampFormat,
      options.mask
    );
    const headerPrefix = `${fileName.padEnd(fileNameWidth)} | ${kind.padEnd(kindWidth)} | `;

    const timestampText = entry.matched && entry.timestampMs !== undefined
      ? formatMaskableTimestamp(entry.timestampMs, displayTimezone, options.mask)
      : undefined;
    const headerText = timestampText !== undefined
      ? `${timestampText} ${formatSeverity(entry.severity, severityWidth)} ${messageLines[0]}`
      : messageLines[0];
    outputLines.push(headerPrefix + formatGutter(entry.startLine, gutterWidth) + headerText);
    lineSources.push({ fileIndex, line: entry.startLine });

    const continuationIndent =
      timestampText !== undefined ? messageColumnIndent(timestampText, severityWidth) : "";
    for (let j = 1; j < messageLines.length; j++) {
      outputLines.push(
        blankPrefix +
          formatGutter(entry.startLine + j, gutterWidth) +
          continuationIndent +
          messageLines[j]
      );
      lineSources.push({ fileIndex, line: entry.startLine + j });
    }
  }

  return { text: outputLines.join("\n"), lineSources };
}
