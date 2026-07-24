import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";
import type { DisplayTimezone } from "./timezone";
import type { FormattedLogWithLineSources } from "./lineSources";
import { filterEntriesByCriteria, type FilterCriteria } from "./filterEntries";
import { filterMergedEntriesByCriteria } from "./filterMergedEntries";
import { formatNormalizedLogWithLineSources } from "./formatNormalizedLog";
import { formatMergedLogWithLineSources } from "./formatMergedLog";
import { formatCollapsedLogWithLineSources } from "./formatCollapsedLog";
import { collapseRepeatedEntries } from "./collapseRepeatedEntries";

/** {@link buildInteractiveExportText} / {@link buildInteractiveMergedExportText} の挙動を調整するオプション。 */
export interface BuildInteractiveExportTextOptions {
  readonly gapThresholdMs?: number;
  readonly displayTimezone?: DisplayTimezone;
  /** 無視パターンの評価に使うタイムアウト（ミリ秒）を上書きしたい場合に指定する（主にテスト用）。 */
  readonly ignorePatternTimeoutMs?: number;
  /**
   * 指定すると、折りたたみグループを `formatCollapsedLogWithLineSources`
   * （`Show Collapsed View` と同じ整形）でまとめた状態を書き出す（issue #175）。
   * Webview内での個々のグループの展開/復元はブラウザ側だけのローカル状態で
   * 拡張機能本体に届いていないため、書き出し時点では常に全グループ折りたたみ
   * 済みとして書き出す。
   */
  readonly collapseThreshold?: number;
}

export type InteractiveExportTextResult =
  | { readonly ok: true; readonly formatted: FormattedLogWithLineSources }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

/**
 * Interactive View (Alpha) が単一ファイル表示中に「仮想ドキュメントとして
 * 書き出す」操作（issue #175）で呼ぶ、絞り込み＋整形の合成処理。折りたたみが
 * 有効なら `Show Collapsed View` と同じ関数で折りたたみ済みテキストを、
 * 無効なら通常の正規化テキストを組み立てる。
 */
export async function buildInteractiveExportText(
  entries: readonly LogEntry[],
  criteria: FilterCriteria,
  options: BuildInteractiveExportTextOptions = {}
): Promise<InteractiveExportTextResult> {
  const filterResult = await filterEntriesByCriteria(entries, criteria, {
    ignorePatternTimeoutMs: options.ignorePatternTimeoutMs,
  });
  if (!filterResult.ok) {
    return filterResult;
  }

  if (options.collapseThreshold !== undefined) {
    const items = collapseRepeatedEntries(filterResult.entries, {
      threshold: options.collapseThreshold,
    });
    return {
      ok: true,
      formatted: formatCollapsedLogWithLineSources(filterResult.entries, items, {
        displayTimezone: options.displayTimezone,
      }),
    };
  }

  return {
    ok: true,
    formatted: formatNormalizedLogWithLineSources(filterResult.entries, {
      gapThresholdMs: options.gapThresholdMs,
      displayTimezone: options.displayTimezone,
    }),
  };
}

/**
 * {@link buildInteractiveExportText} のマージ版（issue #175）。マージ表示
 * （2ファイル以上）は折りたたみ非対応（#158の未解決課題）のため、常に
 * `formatMergedLogWithLineSources` で展開表示のテキストを組み立てる。
 */
export async function buildInteractiveMergedExportText(
  mergedEntries: readonly MergedEntry[],
  criteria: FilterCriteria,
  options: BuildInteractiveExportTextOptions = {}
): Promise<InteractiveExportTextResult> {
  const filterResult = await filterMergedEntriesByCriteria(mergedEntries, criteria, {
    ignorePatternTimeoutMs: options.ignorePatternTimeoutMs,
  });
  if (!filterResult.ok) {
    return filterResult;
  }

  return {
    ok: true,
    formatted: formatMergedLogWithLineSources(filterResult.entries, {
      gapThresholdMs: options.gapThresholdMs,
      displayTimezone: options.displayTimezone,
    }),
  };
}
