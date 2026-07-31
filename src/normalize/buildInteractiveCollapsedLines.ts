import type { LogEntry } from "./types";
import type { LineSource } from "./lineSources";
import type { MergedEntry } from "./mergeLogFiles";
import { SINGLE_FILE_INDEX } from "./filterByFile";
import {
  collapseRepeatedMergedEntries,
  type CollapsedMergedItem,
} from "./collapseMergedEntries";
import { computeMaxLineNumber, formatGutter } from "./gutter";
import { type DisplayTimezone } from "./timezone";
import {
  formatMaskableTimestamp,
  maskDisplayMessageLines,
  type DisplayMaskOptions,
} from "./displayMask";
import { collapseRepeatedEntries, DEFAULT_COLLAPSE_THRESHOLD, type CollapsedItem } from "./collapseRepeatedEntries";
import { computeSeverityWidth, formatSeverity } from "./severityColumn";
import { formatGroupSuffix } from "./groupSuffix";

/**
 * Interactive View の折りたたみ表示（issue #172）が1件分として扱う
 * 表示単位。`line` は折りたたまれなかった1物理行、`group` はクリックで
 * 展開/復元できる折りたたみグループを表す。`group.lines` には、グループ内の
 * 各エントリを {@link formatNormalizedLog} と同じ見た目で個別整形した行を
 * あらかじめ含めておく——Webview側は拡張機能本体との通信なしに、この
 * `lines` の表示/非表示を切り替えるだけで展開/復元を完結させる。
 *
 * `lineSource` / `lineSources` は行クリックでのジャンプとホバー表示
 * （issue #179）が使う元ログ上の位置。表示テキストと1対1で対応させるため、
 * `group` では `lines` と同じ長さ・同じ並びの配列で持つ。行対応情報を
 * 持たない呼び出し元（切り詰めのテスト等）もあるため任意とする。
 */
export type InteractiveDisplayItem =
  | { readonly kind: "line"; readonly text: string; readonly lineSource?: LineSource }
  | {
      readonly kind: "group";
      readonly headerText: string;
      readonly lines: readonly string[];
      readonly lineSources?: readonly LineSource[];
      /**
       * グループに含まれる由来ファイル（重複を除いた出現順、issue #158）。
       * 見出しの列には代表1件しか出せないため、Webview 側がこれをホバー表示の
       * フルパスへ解決して、展開せずに全ての由来を確かめられるようにする。
       *
       * ファイル名ではなくインデックスで持つのは、別フォルダの同名ファイルを
       * 見分けるため（issue #137 が `fileName` ではなく `fileIndex` を使うのと
       * 同じ理由）。パスの解決は読み込み済みファイルを知っている拡張機能本体側の
       * 責務なので、ここでは持たない。
       */
      readonly headerFileIndices?: readonly number[];
    };

/** {@link buildInteractiveCollapsedLines} の挙動を調整するオプション。 */
export interface BuildInteractiveCollapsedLinesOptions {
  /** 何回以上連続で繰り返されたら折りたたむかのしきい値。省略時は {@link DEFAULT_COLLAPSE_THRESHOLD}。 */
  readonly threshold?: number;
  /** タイムスタンプの表示タイムゾーン。省略時は UTC。 */
  readonly displayTimezone?: DisplayTimezone;
  /**
   * 指定すると、タイムスタンプ・ホスト名/IPアドレスをプレースホルダーに
   * 置き換えて整形する（issue #194）。行内の置き換えなので `lines` の本数と
   * `lineSources` の対応は変わらない。
   */
  readonly mask?: DisplayMaskOptions;
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

/**
 * 複数ファイルにまたがるグループの見出しガター（issue #158）。
 *
 * 行番号の範囲（`rangeLabel`）は使えない——由来ファイルが違えば行番号は同じ
 * スケールではないため、`8-5` のように逆転した無意味なラベルになりうる。
 * 代わりに代表1件（先頭エントリ）の行番号を出す。見出しが指す位置
 * （`headerLineSource`）も先頭エントリなので、そちらとも一致する。
 */
function multiFileGroupGutterLabel(entries: readonly LogEntry[]): string {
  return String(entries[0].startLine);
}

/** 整形済みの1行と、その行が由来する元ログ上の位置（issue #179）のペア。 */
interface FormattedEntryLine {
  readonly text: string;
  readonly lineSource: LineSource;
}

/**
 * 1エントリを {@link formatNormalizedLog} と同じ見た目（ガター＋タイムスタンプ
 * ＋severity＋継続行）に整形する。
 *
 * `fileIndex` と `columnPrefix` は、マージ表示（issue #158）でそれぞれ由来
 * ファイルと「ファイル名 | 種別 |」の列を与えるためのもの。単一ファイル表示では
 * `fileIndex` は常に 0、列は無い。
 */
function formatEntryLines(
  entry: LogEntry,
  gutterWidth: number,
  severityWidth: number,
  displayTimezone: DisplayTimezone,
  mask: DisplayMaskOptions | undefined,
  fileIndex = SINGLE_FILE_INDEX,
  columnPrefix = ""
): FormattedEntryLine[] {
  const messageLines = maskDisplayMessageLines(
    entry.message.split("\n"),
    entry.timestampFormat,
    mask
  );
  const headerText = entry.matched && entry.timestampMs !== undefined
    ? `${formatMaskableTimestamp(entry.timestampMs, displayTimezone, mask)} ${formatSeverity(entry.severity, severityWidth)} ${messageLines[0]}`
    : messageLines[0];

  const lines: FormattedEntryLine[] = [
    {
      text: columnPrefix + formatGutter(entry.startLine, gutterWidth) + headerText,
      lineSource: { fileIndex, line: entry.startLine },
    },
  ];
  for (let i = 1; i < messageLines.length; i++) {
    lines.push({
      text: columnPrefix + formatGutter(entry.startLine + i, gutterWidth) + messageLines[i],
      lineSource: { fileIndex, line: entry.startLine + i },
    });
  }
  return lines;
}

/** グループ見出しの開始・終了タイムスタンプ（{@link formatCollapsedLogWithLineSources} と同じ判定）。 */
function formatHeaderTimestamps(
  entries: readonly LogEntry[],
  displayTimezone: DisplayTimezone,
  mask: DisplayMaskOptions | undefined
): { readonly startText: string; readonly endText?: string } | undefined {
  const first = entries[0];
  if (!first.matched || first.timestampMs === undefined) {
    return undefined;
  }
  const startText = formatMaskableTimestamp(first.timestampMs, displayTimezone, mask);
  const last = entries[entries.length - 1];
  if (last.timestampMs === undefined) {
    return { startText };
  }
  return {
    startText,
    endText: formatMaskableTimestamp(last.timestampMs, displayTimezone, mask),
  };
}

function formatGroupHeaderText(
  entries: readonly LogEntry[],
  gutterWidth: number,
  severityWidth: number,
  displayTimezone: DisplayTimezone,
  mask: DisplayMaskOptions | undefined,
  columnPrefix = "",
  gutterLabel = rangeLabel(entries)
): string {
  const first = entries[0];
  const messageLines = maskDisplayMessageLines(
    first.message.split("\n"),
    first.timestampFormat,
    mask
  );

  const timestamps = formatHeaderTimestamps(entries, displayTimezone, mask);
  const suffix = formatGroupSuffix(entries.length, timestamps?.startText, timestamps?.endText);
  const headerText = timestamps !== undefined
    ? `${timestamps.startText} ${formatSeverity(first.severity, severityWidth)} ${messageLines[0]}${suffix}`
    : `${messageLines[0]}${suffix}`;

  return columnPrefix + formatGutter(gutterLabel, gutterWidth) + headerText;
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列から、Interactive View の
 * 折りたたみ表示（issue #172）用の表示単位を組み立てる。
 * `collapseRepeatedEntries` によるグルーピングと、{@link formatNormalizedLog}
 * 相当の整形を1パスで行うことで、単一行・グループ内展開行の間でガター幅を
 * 一貫させる。
 *
 * ギャップ検出（`gapThresholdMs`）は扱わない——折りたたみは連続した繰り返しを
 * 1行にまとめる表示なので、まとめた範囲の内側にギャップ行を差し込む位置が
 * 決まらないため（{@link formatCollapsedLogWithLineSources} も同じ扱い）。
 */
export function buildInteractiveCollapsedLines(
  entries: readonly LogEntry[],
  options: BuildInteractiveCollapsedLinesOptions = {}
): readonly InteractiveDisplayItem[] {
  const displayTimezone = options.displayTimezone ?? 0;
  const items = collapseRepeatedEntries(entries, {
    threshold: options.threshold ?? DEFAULT_COLLAPSE_THRESHOLD,
    mask: options.mask,
  });
  const gutterWidth = computeGutterWidth(entries, items);
  // 展開したグループ内の行も同じ幅で描くので、代表だけでなく全件から求める。
  const severityWidth = computeSeverityWidth(entries);

  const result: InteractiveDisplayItem[] = [];
  for (const item of items) {
    if (item.kind === "single") {
      for (const { text, lineSource } of formatEntryLines(item.entry, gutterWidth, severityWidth, displayTimezone, options.mask)) {
        result.push({ kind: "line", text, lineSource });
      }
      continue;
    }

    const groupLines = item.entries.flatMap((entry) =>
      formatEntryLines(entry, gutterWidth, severityWidth, displayTimezone, options.mask)
    );
    result.push({
      kind: "group",
      headerText: formatGroupHeaderText(item.entries, gutterWidth, severityWidth, displayTimezone, options.mask),
      lines: groupLines.map((line) => line.text),
      lineSources: groupLines.map((line) => line.lineSource),
    });
  }
  return result;
}

/** 複数ファイル由来のグループで、代表のファイル名/種別に添える印（issue #158）。 */
const MULTIPLE_SOURCES_SUFFIX = " 他";

/**
 * グループの列に出す代表値を決める。代表1件しか出せない以上どれかに寄せる
 * しかないが、単に先頭をそのまま出すと1ファイルのグループに見えてしまうため、
 * 複数あるときは「先頭 + 他」にする（全ての由来は `headerFileIndices` から
 * Webview 側がホバーで見せる）。
 *
 * ファイル名列の判定に値の一致ではなく `spansMultipleFiles` を使うのは、
 * 別フォルダの同名ファイル（`app.log` が2つ等）でも「複数ある」と示すため。
 * 種別列は値が実際に違うときだけ印を付ける——同じ種別なら「app 他」と書いても
 * 情報が増えないため。
 */
function formatGroupColumnValue(values: readonly string[], spansMultipleFiles: boolean): string {
  const first = values[0] ?? "";
  return spansMultipleFiles ? `${first}${MULTIPLE_SOURCES_SUFFIX}` : first;
}

/** 重複を除いた出現順の一覧。 */
function distinctInOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * {@link buildInteractiveCollapsedLines} のマージ版（issue #158）。
 * 単一ファイル表示と同じ折りたたみを、ファイル名/種別列付きのマージ表示でも
 * 使えるようにする。
 *
 * 列幅はエントリ行だけでなくグループ見出しの代表値（「先頭 + 他」）も含めて
 * 求める。見出しだけ列がはみ出すと、折りたたみを開いた瞬間に桁がずれるため。
 *
 * グルーピングが由来ファイルを区別しない理由は
 * {@link collapseRepeatedMergedEntries} 参照。
 */
export function buildInteractiveMergedCollapsedLines(
  mergedEntries: readonly MergedEntry[],
  options: BuildInteractiveCollapsedLinesOptions = {}
): readonly InteractiveDisplayItem[] {
  const displayTimezone = options.displayTimezone ?? 0;
  const items = collapseRepeatedMergedEntries(mergedEntries, {
    threshold: options.threshold ?? DEFAULT_COLLAPSE_THRESHOLD,
    mask: options.mask,
  });

  // 列に載りうる値（各行の値と、グループ見出しの代表値）を全て集めてから幅を決める。
  const fileNameCandidates: string[] = mergedEntries.map((merged) => merged.fileName);
  const kindCandidates: string[] = mergedEntries.map((merged) => merged.kind);
  for (const item of items) {
    if (item.kind === "group") {
      const spansMultipleFiles =
        distinctInOrder(item.entries.map((merged) => merged.fileIndex)).length > 1;
      const kinds = item.entries.map((merged) => merged.kind);
      fileNameCandidates.push(
        formatGroupColumnValue(item.entries.map((merged) => merged.fileName), spansMultipleFiles)
      );
      kindCandidates.push(
        formatGroupColumnValue(kinds, kinds.some((kind) => kind !== kinds[0]))
      );
    }
  }
  const fileNameWidth = fileNameCandidates.reduce((max, value) => Math.max(max, value.length), 0);
  const kindWidth = kindCandidates.reduce((max, value) => Math.max(max, value.length), 0);
  const columnPrefixOf = (fileName: string, kind: string): string =>
    `${fileName.padEnd(fileNameWidth)} | ${kind.padEnd(kindWidth)} | `;

  // 見出しガターは、グループが1ファイルに収まっているときだけ行番号の範囲に
  // できる（複数ファイルにまたがる場合の理由は multiFileGroupGutterLabel 参照）。
  const gutterLabelOf = (item: Extract<CollapsedMergedItem, { kind: "group" }>): string => {
    const entries = item.entries.map((merged) => merged.entry);
    return distinctInOrder(item.entries.map((merged) => merged.fileIndex)).length > 1
      ? multiFileGroupGutterLabel(entries)
      : rangeLabel(entries);
  };

  let gutterWidth = String(
    computeMaxLineNumber(mergedEntries.map((merged) => merged.entry))
  ).length;
  const severityWidth = computeSeverityWidth(mergedEntries.map((merged) => merged.entry));
  for (const item of items) {
    if (item.kind === "group") {
      gutterWidth = Math.max(gutterWidth, gutterLabelOf(item).length);
    }
  }

  const result: InteractiveDisplayItem[] = [];
  for (const item of items) {
    if (item.kind === "single") {
      const { entry, fileName, kind, fileIndex } = item.merged;
      for (const { text, lineSource } of formatEntryLines(
        entry,
        gutterWidth,
        severityWidth,
        displayTimezone,
        options.mask,
        fileIndex,
        columnPrefixOf(fileName, kind)
      )) {
        result.push({ kind: "line", text, lineSource });
      }
      continue;
    }

    const entries = item.entries.map((merged) => merged.entry);
    const groupLines = item.entries.flatMap((merged) =>
      formatEntryLines(
        merged.entry,
        gutterWidth,
        severityWidth,
        displayTimezone,
        options.mask,
        merged.fileIndex,
        columnPrefixOf(merged.fileName, merged.kind)
      )
    );
    const fileIndices = distinctInOrder(item.entries.map((merged) => merged.fileIndex));
    const kinds = item.entries.map((merged) => merged.kind);
    result.push({
      kind: "group",
      headerText: formatGroupHeaderText(
        entries,
        gutterWidth,
        severityWidth,
        displayTimezone,
        options.mask,
        columnPrefixOf(
          formatGroupColumnValue(
            item.entries.map((merged) => merged.fileName),
            fileIndices.length > 1
          ),
          formatGroupColumnValue(kinds, kinds.some((kind) => kind !== kinds[0]))
        ),
        gutterLabelOf(item)
      ),
      headerFileIndices: fileIndices,
      lines: groupLines.map((line) => line.text),
      lineSources: groupLines.map((line) => line.lineSource),
    });
  }
  return result;
}

/**
 * 折りたたみ表示の表示単位を、書き出し用のテキストと行対応へ畳む（issue #158）。
 * グループは見出し1行だけにする——展開状態は Webview 内のローカルな状態
 * （issue #172）で、書き出しは「折りたたまれた状態」を写すため。
 *
 * 表示と同じ組み立てを通すことで、「書き出しは表示の状態を引き継ぐ」
 * （issue #175）が別実装の食い違いではなく構造として保証される。
 */
export function toCollapsedFormattedLog(
  items: readonly InteractiveDisplayItem[]
): { readonly text: string; readonly lineSources: readonly (LineSource | undefined)[] } {
  const lines: string[] = [];
  const lineSources: (LineSource | undefined)[] = [];
  for (const item of items) {
    if (item.kind === "line") {
      lines.push(item.text);
      lineSources.push(item.lineSource);
      continue;
    }
    lines.push(item.headerText);
    // 見出しはグループの範囲の入口、つまり先頭エントリの1行目に対応づける
    // （`formatCollapsedLogWithLineSources` と同じ扱い）。`lines` と同じ並びの
    // `lineSources` の先頭がちょうどそれなので、別のフィールドとして重複して
    // 持たない。
    lineSources.push(item.lineSources?.[0]);
  }
  return { text: lines.join("\n"), lineSources };
}
