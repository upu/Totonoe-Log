import type { LogEntry } from "./types";
import { filterEntriesBySeverity } from "./filterBySeverity";
import type { DateRange } from "./filterByDateRange";
import { filterEntriesByDateRange } from "./filterByDateRange";
import {
  filterEntriesByIgnorePattern,
  type FilterByIgnorePatternResult,
} from "./filterByIgnorePattern";

/**
 * `filterEntriesByCriteria` に渡す絞り込み条件。各フィールドは省略可能で、
 * 指定したフィールドの条件だけが AND で適用される。すべて省略した場合は
 * 元の `entries` をそのまま返す。
 */
export interface FilterCriteria {
  /** 指定した場合、このセベリティ集合に含まれるエントリだけを残す。 */
  readonly severities?: ReadonlySet<string>;
  /** 指定した場合、この日付範囲に含まれるエントリだけを残す。 */
  readonly dateRange?: DateRange;
  /** 指定した場合、このパターンにマッチするエントリを除外する。 */
  readonly ignorePattern?: RegExp;
}

/** `filterEntriesByCriteria` の結果。無視パターンの評価がタイムアウトした場合は `ok: false`。 */
export type FilterEntriesResult = FilterByIgnorePatternResult;

export interface FilterEntriesByCriteriaOptions {
  /** 無視パターンの評価に使うタイムアウト（ミリ秒）を上書きしたい場合に指定する（主にテスト用）。 */
  readonly ignorePatternTimeoutMs?: number;
}

/**
 * セベリティ・日付範囲・無視パターンの各条件を、指定されたものだけ順に
 * 適用して絞り込む。個々の絞り込み関数（{@link filterEntriesBySeverity} 等）
 * を単に直列に呼ぶだけで AND 条件が得られる。
 *
 * `LogEntry[]` を受け取り `LogEntry[]` を返す形に揃えているのは、正規化
 * ビュー以外（マージビュー等）でも同じ組み合わせロジックを再利用できる
 * ようにするため（#61 でマージビューへの絞り込みを追加する際に再利用する
 * 想定）。
 *
 * 無視パターンはワーカースレッドでの非同期マッチングを伴うため、比較的
 * 軽量なセベリティ・日付範囲の絞り込みを先に適用してからパターンマッチを
 * 行うことで、マッチング対象を必要最小限に絞ってから評価する。
 */
export async function filterEntriesByCriteria(
  entries: readonly LogEntry[],
  criteria: FilterCriteria,
  options: FilterEntriesByCriteriaOptions = {}
): Promise<FilterEntriesResult> {
  let filtered: readonly LogEntry[] = entries;

  if (criteria.severities !== undefined) {
    filtered = filterEntriesBySeverity(filtered, criteria.severities);
  }

  if (criteria.dateRange !== undefined) {
    filtered = filterEntriesByDateRange(filtered, criteria.dateRange);
  }

  if (criteria.ignorePattern !== undefined) {
    const ignoreResult = await filterEntriesByIgnorePattern(filtered, criteria.ignorePattern, {
      timeoutMs: options.ignorePatternTimeoutMs,
    });
    if (!ignoreResult.ok) {
      return ignoreResult;
    }
    filtered = ignoreResult.entries;
  }

  return { ok: true, entries: [...filtered] };
}
