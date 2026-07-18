import type { LogEntry } from "./types";
import type { FormattedLogWithLineSources, LineSource } from "./lineSources";
import { computeMaxLineNumber, formatGutter } from "./gutter";
import type { CollapsedItem } from "./collapseRepeatedEntries";
import { formatTimestampForDisplay, type DisplayTimezone } from "./timezone";

/** タイムスタンプの開始〜終了を結ぶ区切り文字（issue #99）。 */
const TIMESTAMP_SPAN_SEPARATOR = " 〜 ";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

/** {@link formatCollapsedLog} の挙動を調整するオプション。 */
export interface FormatCollapsedLogOptions {
  /**
   * タイムスタンプの表示タイムゾーン。省略時は UTC（従来どおり `Z` サフィックス
   * 表示）。指定するとその壁時計時刻＋オフセットサフィックスで表示する（issue #13）。
   */
  readonly displayTimezone?: DisplayTimezone;
}

function rangeLabel(entries: readonly LogEntry[]): string {
  const first = entries[0].startLine;
  const lastEntry = entries[entries.length - 1];
  // エントリは複数物理行（スタックトレース等）にまたがりうるため、末尾の
  // 行番号は startLine ではなく、継続行を含めた最終物理行にする。
  const last = lastEntry.startLine + lastEntry.lines.length - 1;
  return `${first}-${last}`;
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
 * 見出し行に表示するタイムスタンプ文字列を組み立てる。`single` は代表
 * エントリ1件のタイムスタンプのみ、`group` は先頭エントリのタイムスタンプに
 * 加え、末尾エントリのタイムスタンプが先頭と異なる場合のみ区切り文字で
 * つないだ終了時刻を付け加える（同一タイムスタンプの繰り返し（バーストが
 * 一瞬で起きた場合等）では終了時刻を重複表示しても情報が増えないため、
 * issue #99 の設計メモに従い省略する）。認識できなかったエントリ
 * （`matched: false`）では `undefined` を返し、タイムスタンプ表示自体を
 * 省略させる。
 */
function formatHeaderTimestamp(
  item: CollapsedItem,
  displayTimezone: DisplayTimezone
): string | undefined {
  const first = item.kind === "single" ? item.entry : item.entries[0];
  if (!first.matched || first.timestampMs === undefined) {
    return undefined;
  }
  const startText = formatTimestampForDisplay(first.timestampMs, displayTimezone);
  if (item.kind === "single") {
    return startText;
  }

  const last = item.entries[item.entries.length - 1];
  if (last.timestampMs === undefined || last.timestampMs === first.timestampMs) {
    return startText;
  }
  return `${startText}${TIMESTAMP_SPAN_SEPARATOR}${formatTimestampForDisplay(last.timestampMs, displayTimezone)}`;
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
  const outputLines: string[] = [];
  const lineSources: (LineSource | undefined)[] = [];

  for (const item of items) {
    const representative = item.kind === "single" ? item.entry : item.entries[0];
    const messageLines = representative.message.split("\n");
    const suffix = item.kind === "group" ? ` (×${item.entries.length})` : "";

    const headerTimestamp = formatHeaderTimestamp(item, displayTimezone);
    const headerText = headerTimestamp !== undefined
      ? `${headerTimestamp} ${representative.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}${suffix}`
      : `${messageLines[0]}${suffix}`;
    const gutterLabel = item.kind === "single" ? representative.startLine : rangeLabel(item.entries);
    outputLines.push(formatGutter(gutterLabel, gutterWidth) + headerText);
    lineSources.push({ fileIndex: 0, line: representative.startLine });

    for (let i = 1; i < messageLines.length; i++) {
      outputLines.push(formatGutter(representative.startLine + i, gutterWidth) + messageLines[i]);
      lineSources.push({ fileIndex: 0, line: representative.startLine + i });
    }
  }

  return { text: outputLines.join("\n"), lineSources };
}
