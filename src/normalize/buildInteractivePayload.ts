import type { LogEntry } from "./types";
import type { DisplayTimezone } from "./timezone";
import type { LineSource } from "./lineSources";
import type { DisplayMaskOptions } from "./displayMask";
import { getDistinctSeverities } from "./filterBySeverity";
import { filterEntriesByCriteria, type FilterCriteria } from "./filterEntries";
import { isFileIndexVisible, SINGLE_FILE_INDEX } from "./filterByFile";
import { formatNormalizedLogWithLineSources } from "./formatNormalizedLog";
import { buildInteractiveCollapsedLines, type InteractiveDisplayItem } from "./buildInteractiveCollapsedLines";

/** {@link buildInteractivePayload} の挙動を調整するオプション。 */
export interface BuildInteractivePayloadOptions {
  readonly gapThresholdMs?: number;
  readonly displayTimezone?: DisplayTimezone;
  /** 無視パターンの評価に使うタイムアウト（ミリ秒）を上書きしたい場合に指定する（主にテスト用）。 */
  readonly ignorePatternTimeoutMs?: number;
  /**
   * 指定すると、絞り込み後のエントリから折りたたみ用の構造化データ（`items`）
   * も合わせて計算する（issue #172）。未指定なら `items` は計算しない
   * （マージ表示モードは折りたたみ非対応のため、呼び出し側がこの値を渡さない）。
   */
  readonly collapseThreshold?: number;

  /**
   * 指定すると、整形時にタイムスタンプ・ホスト名/IPアドレスをプレースホルダーへ
   * 置き換える（issue #194、Interactive View のマスクトグル）。絞り込みは
   * マスク前のエントリに対して行うため、マスクのON/OFFで絞り込み結果は変わらない。
   */
  readonly mask?: DisplayMaskOptions;

  /**
   * 表示ONにしている読み込み済みファイルのインデックス集合（issue #170、
   * Interactive View のファイル単位のトグル）。未指定なら全ファイルを表示する。
   *
   * `distinctSeverities` と `totalLineCount` はこの絞り込みより前の全エントリ
   * から求める——セベリティ絞り込みと同じく、非表示にしたファイルにしか無い
   * セベリティのチェックボックスが消えたり、「何行中何行」の分母が動いたり
   * しないようにするため。
   */
  readonly visibleFileIndices?: ReadonlySet<number>;
}

export type InteractivePayloadResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly lineSources: readonly (LineSource | undefined)[];
      readonly distinctSeverities: readonly string[];
      readonly totalLineCount: number;
      readonly visibleLineCount: number;
      readonly items?: readonly InteractiveDisplayItem[];
    }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

/** entries の物理行数（メッセージの継続行込み）を数える。 */
function countPhysicalLines(entries: readonly LogEntry[]): number {
  return entries.reduce((total, entry) => total + entry.lines.length, 0);
}

/**
 * Webviewベースのインタラクティブビュー（issue #166）が、絞り込み条件が
 * 変わるたびに呼び出す合成処理。「セベリティ一覧の算出 → 絞り込み → 整形」
 * という、正規化ビューの各コマンドが個別に組み立てていた手順を1つにまとめた。
 *
 * `distinctSeverities` は絞り込み前の `entries` から算出する。絞り込みで
 * あるセベリティのエントリが0件になっても、そのセベリティのチェックボックス
 * 自体はWebview側のフォームから消えないようにするため。
 */
export async function buildInteractivePayload(
  entries: readonly LogEntry[],
  criteria: FilterCriteria,
  options: BuildInteractivePayloadOptions = {}
): Promise<InteractivePayloadResult> {
  const distinctSeverities = getDistinctSeverities(entries);

  const fileVisibleEntries = isFileIndexVisible(options.visibleFileIndices, SINGLE_FILE_INDEX)
    ? entries
    : [];
  const filterResult = await filterEntriesByCriteria(fileVisibleEntries, criteria, {
    ignorePatternTimeoutMs: options.ignorePatternTimeoutMs,
  });
  if (!filterResult.ok) {
    return filterResult;
  }

  const formatted = formatNormalizedLogWithLineSources(filterResult.entries, {
    gapThresholdMs: options.gapThresholdMs,
    displayTimezone: options.displayTimezone,
    mask: options.mask,
  });

  const items = options.collapseThreshold !== undefined
    ? buildInteractiveCollapsedLines(filterResult.entries, {
        threshold: options.collapseThreshold,
        displayTimezone: options.displayTimezone,
        mask: options.mask,
      })
    : undefined;

  return {
    ok: true,
    text: formatted.text,
    lineSources: formatted.lineSources,
    distinctSeverities,
    totalLineCount: countPhysicalLines(entries),
    visibleLineCount: countPhysicalLines(filterResult.entries),
    items,
  };
}
