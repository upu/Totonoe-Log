import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";
import type { BuildInteractivePayloadOptions, InteractivePayloadResult } from "./buildInteractivePayload";
import { getDistinctSeverities } from "./filterBySeverity";
import { filterMergedEntriesByCriteria } from "./filterMergedEntries";
import { filterMergedEntriesByFileIndex } from "./filterByFile";
import type { FilterCriteria } from "./filterEntries";
import { applyMaskPatternsToMergedEntries } from "./maskByPattern";
import { formatMergedLogWithLineSources } from "./formatMergedLog";

/** entries の物理行数（メッセージの継続行込み）を数える。 */
function countPhysicalLines(entries: readonly LogEntry[]): number {
  return entries.reduce((total, entry) => total + entry.lines.length, 0);
}

/**
 * {@link buildInteractivePayload} のマージ版（issue #168）。Interactive View
 * が2ファイル以上を読み込んだ状態のときに使う。`LogEntry[]` ではなく
 * `MergedEntry[]` を受け取り、ファイル名/種別列付きの `formatMergedLog` 系
 * 整形を使う以外は、絞り込み・セベリティ一覧算出・行数カウントの構成は
 * `buildInteractivePayload` と同じ（`filterMergedEntriesByCriteria` /
 * `formatMergedLogWithLineSources` を使う点だけが異なる）。
 *
 * `distinctSeverities` は絞り込み前の `mergedEntries` から算出する
 * （`buildInteractivePayload` と同じ理由）。`getDistinctSeverities` は
 * `LogEntry[]` しか受け付けないため、`MergedEntry.entry` を取り出してから渡す
 * （`mergedView.ts` の既存パターンと同じ unwrap）。
 */
export async function buildInteractiveMergedPayload(
  mergedEntries: readonly MergedEntry[],
  criteria: FilterCriteria,
  options: BuildInteractivePayloadOptions = {}
): Promise<InteractivePayloadResult> {
  const distinctSeverities = getDistinctSeverities(mergedEntries.map((merged) => merged.entry));

  const filterResult = await filterMergedEntriesByCriteria(
    filterMergedEntriesByFileIndex(mergedEntries, options.visibleFileIndices),
    criteria,
    { ignorePatternTimeoutMs: options.ignorePatternTimeoutMs }
  );
  if (!filterResult.ok) {
    return filterResult;
  }

  const masked = await applyMaskPatternsToMergedEntries(filterResult.entries, options.maskPatterns, {
    timeoutMs: options.maskPatternTimeoutMs,
  });

  const formatted = formatMergedLogWithLineSources(masked.entries, {
    gapThresholdMs: options.gapThresholdMs,
    displayTimezone: options.displayTimezone,
    mask: options.mask,
  });

  return {
    ok: true,
    text: formatted.text,
    lineSources: formatted.lineSources,
    distinctSeverities,
    totalLineCount: countPhysicalLines(mergedEntries.map((merged) => merged.entry)),
    visibleLineCount: countPhysicalLines(filterResult.entries.map((merged) => merged.entry)),
    maskPatternFailure: masked.failure,
  };
}
