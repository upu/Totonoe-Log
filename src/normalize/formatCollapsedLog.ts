import type { LogEntry } from "./types";
import type { FormattedLogWithLineSources, LineSource } from "./lineSources";
import { computeMaxLineNumber, formatGutter } from "./gutter";
import type { CollapsedItem } from "./collapseRepeatedEntries";
import { type DisplayTimezone } from "./timezone";
import {
  formatMaskableTimestamp,
  maskDisplayMessageLines,
  type DisplayMaskOptions,
} from "./displayMask";

import { computeSeverityWidth, formatSeverity, messageColumnIndent } from "./severityColumn";
import { formatGroupSuffix } from "./groupSuffix";

/** {@link formatCollapsedLog} の挙動を調整するオプション。 */
export interface FormatCollapsedLogOptions {
  /**
   * タイムスタンプの表示タイムゾーン。省略時は UTC（従来どおり `Z` サフィックス
   * 表示）。指定するとその壁時計時刻＋オフセットサフィックスで表示する（issue #13）。
   */
  readonly displayTimezone?: DisplayTimezone;

  /**
   * 指定すると、タイムスタンプ・ホスト名/IPアドレスをプレースホルダーに
   * 置き換えて整形する（issue #194）。Interactive View がマスク中に
   * 「仮想ドキュメントとして書き出す」ときに、表示と同じ状態で書き出すために使う。
   */
  readonly mask?: DisplayMaskOptions;
}

function rangeLabel(entries: readonly LogEntry[]): string {
  const first = entries[0].startLine;
  const lastEntry = entries[entries.length - 1];
  // エントリは複数物理行（スタックトレース等）にまたがりうるため、末尾の
  // 行番号は startLine ではなく、継続行を含めた最終物理行にする。
  const last = lastEntry.startLine + lastEntry.lines.length - 1;
  return `${String(first)}-${String(last)}`;
}

/**
 * 折りたたみビューの行番号ガター幅を決める。通常の最大行番号に加え、
 * 折りたたみグループの行範囲ラベル（例: `"95-100"`）が単純な行番号より
 * 幅広くなる場合があるため、その幅も考慮する。
 */
function computeGutterWidth(entries: readonly LogEntry[], items: readonly CollapsedItem[]): number {
  let width = String(computeMaxLineNumber(entries)).length;
  for (const item of items) {
    if (item.kind === "group") {
      width = Math.max(width, rangeLabel(item.entries).length);
    }
  }
  return width;
}

/**
 * 見出し行に表示する開始・終了のタイムスタンプ文字列を組み立てる。通常行と
 * 同じ位置に置くのは開始側だけで、終了側は {@link formatGroupSuffix} が末尾へ
 * 回す（issue #174）。認識できなかったエントリ（`matched: false`）では
 * `undefined` を返し、タイムスタンプ表示自体を省略させる。
 */
function formatHeaderTimestamps(
  item: CollapsedItem,
  displayTimezone: DisplayTimezone,
  mask: DisplayMaskOptions | undefined
): { readonly startText: string; readonly endText?: string } | undefined {
  const first = item.kind === "single" ? item.entry : item.entries[0];
  if (!first.matched || first.timestampMs === undefined) {
    return undefined;
  }
  const startText = formatMaskableTimestamp(first.timestampMs, displayTimezone, mask);
  if (item.kind === "single") {
    return { startText };
  }

  const last = item.entries[item.entries.length - 1];
  if (last.timestampMs === undefined) {
    return { startText };
  }
  return {
    startText,
    endText: formatMaskableTimestamp(last.timestampMs, displayTimezone, mask),
  };
}

/**
 * {@link collapseRepeatedEntries} が返す {@link CollapsedItem} の配列を、
 * 読み取り専用の折りたたみビュー（仮想ドキュメント）に表示するための
 * テキストへ整形する。折りたたまれなかったエントリは {@link formatNormalizedLog}
 * と同じ見た目で表示し、折りたたまれたグループは代表エントリ（先頭の
 * エントリ）の内容を、行番号の代わりに範囲ラベルと繰り返し回数
 * （例: `"×5"`）付きで1行にまとめて表示する。グループの開始・終了時刻が
 * 異なる場合は、そのタイムスタンプの間の時間スパンも見出しに表示する
 * （issue #99）。
 */
export function formatCollapsedLog(
  entries: readonly LogEntry[],
  items: readonly CollapsedItem[],
  options: FormatCollapsedLogOptions = {}
): string {
  return formatCollapsedLogWithLineSources(entries, items, options).text;
}

/**
 * {@link formatCollapsedLog} と同じテキストに加えて、表示行ごとの元ログ
 * 物理行の対応表を返す（issue #137）。折りたたみグループの見出し行は
 * 「範囲開始行」（グループ先頭エントリの見出し行）へ対応づける——グループは
 * 元ファイル上の連続した行範囲をまとめたものであり、その先頭が範囲全体の
 * 入口として最も自然なため。対応表を別ロジックで再計算すると行構成と
 * 食い違うリスクがあるため、同じループで本文と一緒に組み立てる。
 */
export function formatCollapsedLogWithLineSources(
  entries: readonly LogEntry[],
  items: readonly CollapsedItem[],
  options: FormatCollapsedLogOptions = {}
): FormattedLogWithLineSources {
  const displayTimezone = options.displayTimezone ?? 0;
  const gutterWidth = computeGutterWidth(entries, items);
  // グループ化のキーにセベリティが含まれる（`collapseRepeatedEntries`）ため、
  // 同じグループのエントリは必ず同じセベリティ。全件から求めても、代表だけから
  // 求めても結果は同じになる。
  const severityWidth = computeSeverityWidth(entries);
  const outputLines: string[] = [];
  const lineSources: (LineSource | undefined)[] = [];

  for (const item of items) {
    const representative = item.kind === "single" ? item.entry : item.entries[0];
    const messageLines = maskDisplayMessageLines(
      representative.message.split("\n"),
      representative.timestampFormat,
      options.mask
    );
    const timestamps = formatHeaderTimestamps(item, displayTimezone, options.mask);
    const suffix =
      item.kind === "group"
        ? formatGroupSuffix(item.entries.length, timestamps?.startText, timestamps?.endText)
        : "";
    const headerText = timestamps !== undefined
      ? `${timestamps.startText} ${formatSeverity(representative.severity, severityWidth)} ${messageLines[0]}${suffix}`
      : `${messageLines[0]}${suffix}`;
    const gutterLabel = item.kind === "single" ? representative.startLine : rangeLabel(item.entries);
    outputLines.push(formatGutter(gutterLabel, gutterWidth) + headerText);
    lineSources.push({ fileIndex: 0, line: representative.startLine });

    const continuationIndent =
      timestamps !== undefined ? messageColumnIndent(timestamps.startText, severityWidth) : "";
    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(
        formatGutter(representative.startLine + i, gutterWidth) +
          continuationIndent +
          messageLines[i]
      );
      lineSources.push({ fileIndex: 0, line: representative.startLine + i });
    }
  }

  return { text: outputLines.join("\n"), lineSources };
}
