import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";
import type { FilterCriteria, FilterEntriesByCriteriaOptions } from "./filterEntries";
import { filterEntriesByCriteria } from "./filterEntries";

/**
 * `filterMergedEntriesByCriteria` の結果。`entries` が `LogEntry[]` ではなく
 * `MergedEntry[]` になっている以外は {@link FilterEntriesResult}（実体は
 * {@link FilterByIgnorePatternResult}）と同じ形。
 */
export type FilterMergedEntriesResult =
  | { readonly ok: true; readonly entries: MergedEntry[] }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

/**
 * マージビュー（{@link MergedEntry} の配列）に対して、正規化ビューと同じ
 * {@link filterEntriesByCriteria} の絞り込みロジックをそのまま再利用するための
 * 薄いラッパー（issue #61）。`MergedEntry.entry`（`LogEntry`）だけを取り出して
 * 絞り込みを行い、結果に残った `LogEntry` を、元の `MergedEntry`（`fileName` /
 * `kind` を保持）へ引き当てて戻す。
 *
 * 引き当ては `LogEntry` インスタンスの参照の同一性で行う。
 * `filterEntriesByCriteria` 内の各絞り込み関数はいずれも `Array#filter`
 * ベースの実装で、常に元の `LogEntry` インスタンスを複製せずそのまま
 * 部分列として返すため、参照比較で安全に引き当てられる。この方式により、
 * `formatMergedLog` が出力するテキスト（ファイル名/種類列や行番号ガター付き）
 * を再パースする必要がなく、フォーマットの変更に影響されずに済む。
 */
export async function filterMergedEntriesByCriteria(
  mergedEntries: readonly MergedEntry[],
  criteria: FilterCriteria,
  options: FilterEntriesByCriteriaOptions = {}
): Promise<FilterMergedEntriesResult> {
  const mergedByEntry = new Map<LogEntry, MergedEntry>();
  for (const merged of mergedEntries) {
    mergedByEntry.set(merged.entry, merged);
  }

  const result = await filterEntriesByCriteria(
    mergedEntries.map((merged) => merged.entry),
    criteria,
    options
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    entries: result.entries.map((entry) => {
      const merged = mergedByEntry.get(entry);
      if (!merged) {
        // filterEntriesByCriteria は元の LogEntry インスタンスをそのまま
        // 返す実装のため通常は到達しないが、行がサイレントに消えるより
        // 検出しやすくするためのフェイルセーフとして例外にする。
        throw new Error(
          "filterMergedEntriesByCriteria: no MergedEntry matched an entry in the filtered result."
        );
      }
      return merged;
    }),
  };
}
