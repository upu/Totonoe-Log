import type { LogEntry } from "./types";
import type { DisplayTimezone } from "./timezone";
import type { LineSource } from "./lineSources";
import type { DisplayMaskOptions } from "./displayMask";
import { getDistinctSeverities } from "./filterBySeverity";
import { filterEntriesByCriteria, type FilterCriteria } from "./filterEntries";
import { isFileIndexVisible, SINGLE_FILE_INDEX } from "./filterByFile";
import { applyMaskPatternToEntries } from "./maskByPattern";
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
   * 指定すると、一致箇所を `<MASKED>` に置き換える（issue #195、マスクパネルの
   * 任意パターン入力）。{@link mask} と違って整形層ではなく整形の手前で効く
   * ため別のオプションにしてある（理由は {@link maskEntriesByPattern} 参照）。
   */
  readonly maskPattern?: RegExp;
  /** 任意パターンのマスクに使うタイムアウト（ミリ秒）を上書きしたい場合に指定する（主にテスト用）。 */
  readonly maskPatternTimeoutMs?: number;

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
      /**
       * 任意パターンのマスク（issue #195）を適用できなかった場合の理由。
       * 絞り込みの失敗（`ok: false`）と違って結果全体は成立しているため、
       * 呼び出し側は表示を出したうえでこの理由を警告として添える。
       */
      readonly maskPatternFailure?: "timeout" | "error";
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

  // 任意パターンのマスクは絞り込みの後に掛ける（issue #195）。マスク前の本文で
  // 絞り込むという既存の扱い（`mask` のコメント参照）を、こちらでも揃えるため。
  const masked = await applyMaskPatternToEntries(filterResult.entries, options.maskPattern, {
    timeoutMs: options.maskPatternTimeoutMs,
  });

  const formatted = formatNormalizedLogWithLineSources(masked.entries, {
    gapThresholdMs: options.gapThresholdMs,
    displayTimezone: options.displayTimezone,
    mask: options.mask,
  });

  const items = options.collapseThreshold !== undefined
    ? buildInteractiveCollapsedLines(masked.entries, {
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
    // 行数はマスクで変わらない（置換は行単位）ので、絞り込み結果から数えてよい。
    visibleLineCount: countPhysicalLines(filterResult.entries),
    items,
    maskPatternFailure: masked.failure,
  };
}
