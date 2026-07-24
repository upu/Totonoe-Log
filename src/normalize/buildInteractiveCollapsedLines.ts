import type { LogEntry } from "./types";
import { computeMaxLineNumber, formatGutter } from "./gutter";
import { formatTimestampForDisplay, type DisplayTimezone } from "./timezone";
import { collapseRepeatedEntries, DEFAULT_COLLAPSE_THRESHOLD, type CollapsedItem } from "./collapseRepeatedEntries";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
const SEVERITY_PLACEHOLDER = "-";

/** タイムスタンプの開始〜終了を結ぶ区切り文字（{@link formatCollapsedLog} と同じ表記）。 */
const TIMESTAMP_SPAN_SEPARATOR = " 〜 ";

/**
 * Interactive View (Alpha) の折りたたみ表示（issue #172）が1件分として扱う
 * 表示単位。`line` は折りたたまれなかった1物理行、`group` はクリックで
 * 展開/復元できる折りたたみグループを表す。`group.lines` には、グループ内の
 * 各エントリを {@link formatNormalizedLog} と同じ見た目で個別整形した行を
 * あらかじめ含めておく——Webview側は拡張機能本体との通信なしに、この
 * `lines` の表示/非表示を切り替えるだけで展開/復元を完結させる。
 */
export type InteractiveDisplayItem =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "group"; readonly headerText: string; readonly lines: readonly string[] };

/** {@link buildInteractiveCollapsedLines} の挙動を調整するオプション。 */
export interface BuildInteractiveCollapsedLinesOptions {
  /** 何回以上連続で繰り返されたら折りたたむかのしきい値。省略時は {@link DEFAULT_COLLAPSE_THRESHOLD}。 */
  readonly threshold?: number;
  /** タイムスタンプの表示タイムゾーン。省略時は UTC。 */
  readonly displayTimezone?: DisplayTimezone;
}

function rangeLabel(entries: readonly LogEntry[]): string {
  const first = entries[0].startLine;
  const lastEntry = entries[entries.length - 1];
  const last = lastEntry.startLine + lastEntry.lines.length - 1;
  return `${first}-${last}`;
}

/**
 * ガター幅は、通常の行番号に加え折りたたみグループの範囲ラベル
 * （例: `"95-100"`）も考慮する（{@link formatCollapsedLogWithLineSources}
 * と同じ理由）。単一行・グループ展開後の行の両方でこの幅を共有することで、
 * 展開してもガターの縦位置がずれない。
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

/** 1エントリを {@link formatNormalizedLog} と同じ見た目（ガター＋タイムスタンプ＋severity＋継続行）に整形する。 */
function formatEntryLines(
  entry: LogEntry,
  gutterWidth: number,
  displayTimezone: DisplayTimezone
): string[] {
  const messageLines = entry.message.split("\n");
  const headerText = entry.matched && entry.timestampMs !== undefined
    ? `${formatTimestampForDisplay(entry.timestampMs, displayTimezone)} ${entry.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}`
    : messageLines[0];

  const lines = [formatGutter(entry.startLine, gutterWidth) + headerText];
  for (let i = 1; i < messageLines.length; i++) {
    lines.push(formatGutter(entry.startLine + i, gutterWidth) + messageLines[i]);
  }
  return lines;
}

/** グループ見出しのタイムスタンプ表示。開始・終了が異なる場合のみスパン表示する（{@link formatCollapsedLogWithLineSources} と同じ判定）。 */
function formatHeaderTimestamp(
  entries: readonly LogEntry[],
  displayTimezone: DisplayTimezone
): string | undefined {
  const first = entries[0];
  if (!first.matched || first.timestampMs === undefined) {
    return undefined;
  }
  const startText = formatTimestampForDisplay(first.timestampMs, displayTimezone);
  const last = entries[entries.length - 1];
  if (last.timestampMs === undefined || last.timestampMs === first.timestampMs) {
    return startText;
  }
  return `${startText}${TIMESTAMP_SPAN_SEPARATOR}${formatTimestampForDisplay(last.timestampMs, displayTimezone)}`;
}

function formatGroupHeaderText(
  entries: readonly LogEntry[],
  gutterWidth: number,
  displayTimezone: DisplayTimezone
): string {
  const first = entries[0];
  const messageLines = first.message.split("\n");
  const suffix = ` (×${entries.length})`;

  const headerTimestamp = formatHeaderTimestamp(entries, displayTimezone);
  const headerText = headerTimestamp !== undefined
    ? `${headerTimestamp} ${first.severity ?? SEVERITY_PLACEHOLDER} ${messageLines[0]}${suffix}`
    : `${messageLines[0]}${suffix}`;

  return formatGutter(rangeLabel(entries), gutterWidth) + headerText;
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列から、Interactive View
 * (Alpha) の折りたたみ表示（issue #172）用の表示単位を組み立てる。
 * `collapseRepeatedEntries` によるグルーピングと、{@link formatNormalizedLog}
 * 相当の整形を1パスで行うことで、単一行・グループ内展開行の間でガター幅を
 * 一貫させる。
 *
 * ギャップ検出（`gapThresholdMs`）は扱わない——{@link formatCollapsedLogWithLineSources}
 * （既存の `Show Collapsed View`）も同様にギャップマーカーを省略しており、
 * それに揃える。
 */
export function buildInteractiveCollapsedLines(
  entries: readonly LogEntry[],
  options: BuildInteractiveCollapsedLinesOptions = {}
): readonly InteractiveDisplayItem[] {
  const displayTimezone = options.displayTimezone ?? 0;
  const items = collapseRepeatedEntries(entries, { threshold: options.threshold ?? DEFAULT_COLLAPSE_THRESHOLD });
  const gutterWidth = computeGutterWidth(entries, items);

  const result: InteractiveDisplayItem[] = [];
  for (const item of items) {
    if (item.kind === "single") {
      for (const text of formatEntryLines(item.entry, gutterWidth, displayTimezone)) {
        result.push({ kind: "line", text });
      }
      continue;
    }

    result.push({
      kind: "group",
      headerText: formatGroupHeaderText(item.entries, gutterWidth, displayTimezone),
      lines: item.entries.flatMap((entry) => formatEntryLines(entry, gutterWidth, displayTimezone)),
    });
  }
  return result;
}
