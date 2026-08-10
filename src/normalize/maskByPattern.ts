import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";
import { runPatternJob, type PatternWorkerOptions } from "./patternWorkerSession";

/** 任意パターンで伏せた箇所の表示に使うプレースホルダー（issue #195）。 */
export const CUSTOM_MASK_PLACEHOLDER = "<MASKED>";

/**
 * 置換処理を打ち切るまでの既定タイムアウト（ミリ秒）。
 * `filterByIgnorePattern` / `filterByMatchPattern` と同じ値にして、
 * ユーザーが入力する3つのパターン欄で待たされる時間の上限を揃える。
 */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * {@link maskEntriesByPattern} の結果。失敗時に「マスクせず全文を出す」
 * フォールバックをここでしないのは絞り込みと同じ理由だが、**呼び出し側の
 * 扱いは逆**——絞り込みの失敗は表示件数が変わるので警告して条件を落とすのに
 * 対し、マスクの失敗はそのマスクだけを諦めれば他のマスク・絞り込みはそのまま
 * 成立するため、呼び出し側は結果を捨てずに続行する（issue #195 の受け入れ基準）。
 */
export type MaskByPatternResult<TEntry> =
  | { readonly ok: true; readonly entries: TEntry[] }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

export type MaskByPatternOptions = PatternWorkerOptions;

/**
 * ユーザーが入力した任意の正規表現に一致した箇所を、プレースホルダーへ
 * 置き換える（issue #195）。社内固有の識別子（ユーザー名・命名規則を含む
 * ホスト名・トークン・契約IDなど）は汎用ルールで拾えないため、対象を
 * ユーザー自身に指定してもらうための機能。
 *
 * 置換の対象は `entry.message`（タイムスタンプ・セベリティを除いた本文）だけ
 * に絞る。タイムスタンプ列やセベリティ列まで巻き込むと、時系列を追うという
 * Interactive View の役目そのものが壊れてしまうため（一致パターンが
 * `message` を対象にしているのと同じ判断、issue #182）。`entry.lines` は
 * 行数の計算にしか使われないのでそのまま残す。
 *
 * 整形層（{@link maskDisplayMessageLines}）ではなく整形の手前で処理するのは、
 * 破局的バックトラッキングを起こすパターンから拡張ホストを守るため——別
 * スレッドに逃がしてタイムアウトで強制終了できる形は、この位置でしか取れない。
 *
 * パターンを配列で受けるのは、キー指定欄と任意パターン欄を同時に効かせる
 * ため（issue #212）。複数のパターンを `(?:a)|(?:b)` と1本に連結せず配列の
 * まま渡すのは、絞り込み側（#206）と同じ理由——ユーザーが書いた正規表現同士を
 * 貼り合わせると、どちらが原因で失敗したのかを追えなくなる。ワーカーの起動は
 * 配列でも1回のままなので、追加のコストはほぼ無い。
 */
export function maskEntriesByPatterns(
  entries: readonly LogEntry[],
  patterns: readonly RegExp[],
  options: MaskByPatternOptions = {}
): Promise<MaskByPatternResult<LogEntry>> {
  return maskMessages(
    entries,
    (entry) => entry.message,
    (entry, message) => ({ ...entry, message }),
    patterns,
    options
  );
}

/**
 * {@link maskEntriesByPattern} のマージ版。マージ表示（2ファイル以上）でも
 * 同じマスクが効くようにするためのもので、置換するのは `MergedEntry.entry` の
 * メッセージだけ——ファイル名・種別・`fileIndex` は行の出どころを示す情報なので
 * マスクの対象にしない。
 */
export function maskMergedEntriesByPatterns(
  mergedEntries: readonly MergedEntry[],
  patterns: readonly RegExp[],
  options: MaskByPatternOptions = {}
): Promise<MaskByPatternResult<MergedEntry>> {
  return maskMessages(
    mergedEntries,
    (merged) => merged.entry.message,
    (merged, message) => ({ ...merged, entry: { ...merged.entry, message } }),
    patterns,
    options
  );
}

/**
 * 任意パターンのマスクを「効かなくても表示は続ける」形で適用した結果
 * （issue #195）。`failure` が付いていても `entries` は必ず使える
 * （失敗時はマスク前のエントリがそのまま入る）。
 */
export interface AppliedMaskPattern<TEntry> {
  readonly entries: readonly TEntry[];
  readonly failure?: "timeout" | "error";
}

/**
 * パターン未指定なら何もせず、指定されていれば適用し、失敗したらマスク前の
 * エントリと失敗理由を返す。Interactive View の4つの合成処理（表示/書き出し ×
 * 単一/マージ）が同じ縮退の仕方をするよう、この判断をここに1本化する。
 */
export async function applyMaskPatternsToEntries(
  entries: readonly LogEntry[],
  patterns: readonly RegExp[] | undefined,
  options: MaskByPatternOptions = {}
): Promise<AppliedMaskPattern<LogEntry>> {
  if (!patterns || patterns.length === 0) {
    return { entries };
  }
  const result = await maskEntriesByPatterns(entries, patterns, options);
  return result.ok ? { entries: result.entries } : { entries, failure: result.reason };
}

/** {@link applyMaskPatternsToEntries} のマージ版。 */
export async function applyMaskPatternsToMergedEntries(
  mergedEntries: readonly MergedEntry[],
  patterns: readonly RegExp[] | undefined,
  options: MaskByPatternOptions = {}
): Promise<AppliedMaskPattern<MergedEntry>> {
  if (!patterns || patterns.length === 0) {
    return { entries: mergedEntries };
  }
  const result = await maskMergedEntriesByPatterns(mergedEntries, patterns, options);
  return result.ok
    ? { entries: result.entries }
    : { entries: mergedEntries, failure: result.reason };
}

/**
 * 単一ファイル用とマージ用で共通の置換処理。エントリからメッセージを取り出す
 * 関数と、置換後のメッセージでエントリを作り直す関数を受け取ることで、
 * ワーカーの起動とタイムアウト管理を1か所に閉じ込める。
 */
async function maskMessages<TEntry>(
  entries: readonly TEntry[],
  getMessage: (entry: TEntry) => string,
  withMessage: (entry: TEntry, message: string) => TEntry,
  patterns: readonly RegExp[],
  options: MaskByPatternOptions
): Promise<MaskByPatternResult<TEntry>> {
  if (entries.length === 0) {
    return { ok: true, entries: [] };
  }

  const texts = entries.map(getMessage);
  const masked = await runPatternJob<string[]>(
    options.session,
    {
      kind: "mask",
      patterns: patterns.map((pattern) => ({
        source: pattern.source,
        // 一致箇所を「全て」置き換えるため、呼び出し側のフラグに関わらず `g` を
        // 足す（`RegExp#replace` は `g` が無いと最初の1件しか置換しない）。
        flags: pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
      })),
      placeholder: CUSTOM_MASK_PLACEHOLDER,
      texts,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (!masked.ok) {
    return masked;
  }

  return {
    ok: true,
    entries: entries.map((entry, index) =>
      masked.value[index] === texts[index] ? entry : withMessage(entry, masked.value[index])
    ),
  };
}
