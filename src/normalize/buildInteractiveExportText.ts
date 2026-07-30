import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";
import type { DisplayTimezone } from "./timezone";
import type { FormattedLogWithLineSources } from "./lineSources";
import type { DisplayMaskOptions } from "./displayMask";
import { filterEntriesByCriteria, type FilterCriteria } from "./filterEntries";
import { filterMergedEntriesByCriteria } from "./filterMergedEntries";
import { filterMergedEntriesByFileIndex, isFileIndexVisible, SINGLE_FILE_INDEX } from "./filterByFile";
import {
  applyMaskPatternsToEntries,
  applyMaskPatternsToMergedEntries,
} from "./maskByPattern";
import { formatNormalizedLogWithLineSources } from "./formatNormalizedLog";
import {
  buildInteractiveMergedCollapsedLines,
  toCollapsedFormattedLog,
} from "./buildInteractiveCollapsedLines";
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

  /**
   * 指定すると、整形時にタイムスタンプ・ホスト名/IPアドレスをプレースホルダーへ
   * 置き換える（issue #194、Interactive View のマスクトグル）。絞り込みは
   * マスク前のエントリに対して行うため、マスクのON/OFFで絞り込み結果は変わらない。
   */
  readonly mask?: DisplayMaskOptions;

  /**
   * 指定すると、一致箇所を `<MASKED>` に置き換える（issue #195・#212）。
   * 表示側と同じく、書き出しもマスクパネルの状態をそのまま引き継ぐ。
   */
  readonly maskPatterns?: readonly RegExp[];
  /** 任意パターンのマスクに使うタイムアウト（ミリ秒）を上書きしたい場合に指定する（主にテスト用）。 */
  readonly maskPatternTimeoutMs?: number;

  /**
   * 表示ONにしている読み込み済みファイルのインデックス集合（issue #170）。
   * 未指定なら全ファイルを書き出す。表示中の状態をそのまま書き出すため、
   * 絞り込み・折りたたみ・マスクと同じく画面のファイル選択にも従う。
   */
  readonly visibleFileIndices?: ReadonlySet<number>;
}

export type InteractiveExportTextResult =
  | {
      readonly ok: true;
      readonly formatted: FormattedLogWithLineSources;
      /** 任意パターンのマスク（issue #195）を適用できなかった場合の理由（表示側と同じ扱い）。 */
      readonly maskPatternFailure?: "timeout" | "error";
    }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

/**
 * Interactive View が単一ファイル表示中に「仮想ドキュメントとして
 * 書き出す」操作（issue #175）で呼ぶ、絞り込み＋整形の合成処理。折りたたみが
 * 有効なら `Show Collapsed View` と同じ関数で折りたたみ済みテキストを、
 * 無効なら通常の正規化テキストを組み立てる。
 */
export async function buildInteractiveExportText(
  entries: readonly LogEntry[],
  criteria: FilterCriteria,
  options: BuildInteractiveExportTextOptions = {}
): Promise<InteractiveExportTextResult> {
  const fileVisibleEntries = isFileIndexVisible(options.visibleFileIndices, SINGLE_FILE_INDEX)
    ? entries
    : [];
  const filterResult = await filterEntriesByCriteria(fileVisibleEntries, criteria, {
    ignorePatternTimeoutMs: options.ignorePatternTimeoutMs,
  });
  if (!filterResult.ok) {
    return filterResult;
  }

  const masked = await applyMaskPatternsToEntries(filterResult.entries, options.maskPatterns, {
    timeoutMs: options.maskPatternTimeoutMs,
  });

  if (options.collapseThreshold !== undefined) {
    const items = collapseRepeatedEntries(masked.entries, {
      threshold: options.collapseThreshold,
    });
    return {
      ok: true,
      formatted: formatCollapsedLogWithLineSources(masked.entries, items, {
        displayTimezone: options.displayTimezone,
        mask: options.mask,
      }),
      maskPatternFailure: masked.failure,
    };
  }

  return {
    ok: true,
    formatted: formatNormalizedLogWithLineSources(masked.entries, {
      gapThresholdMs: options.gapThresholdMs,
      displayTimezone: options.displayTimezone,
      mask: options.mask,
    }),
    maskPatternFailure: masked.failure,
  };
}

/**
 * {@link buildInteractiveExportText} のマージ版（issue #175）。折りたたみが
 * 有効なら、表示と同じ組み立て（{@link buildInteractiveMergedCollapsedLines}）を
 * 通してから見出し1行に畳む（issue #158）——単一ファイル側が
 * `formatCollapsedLogWithLineSources` を表示と共有しているのと同じ趣旨で、
 * 「書き出しは表示の状態を引き継ぐ」を別実装の食い違いにしないため。
 */
export async function buildInteractiveMergedExportText(
  mergedEntries: readonly MergedEntry[],
  criteria: FilterCriteria,
  options: BuildInteractiveExportTextOptions = {}
): Promise<InteractiveExportTextResult> {
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

  if (options.collapseThreshold !== undefined) {
    return {
      ok: true,
      formatted: toCollapsedFormattedLog(
        buildInteractiveMergedCollapsedLines(masked.entries, {
          threshold: options.collapseThreshold,
          displayTimezone: options.displayTimezone,
          mask: options.mask,
        })
      ),
      maskPatternFailure: masked.failure,
    };
  }

  return {
    ok: true,
    formatted: formatMergedLogWithLineSources(masked.entries, {
      gapThresholdMs: options.gapThresholdMs,
      displayTimezone: options.displayTimezone,
      mask: options.mask,
    }),
    maskPatternFailure: masked.failure,
  };
}
