import type { MergedEntry } from "./mergeLogFiles";

/**
 * 単一ファイル表示中のエントリが由来するファイルのインデックス（issue #170）。
 * 単一ファイル表示では `LogEntry` にファイル情報が付かないが、読み込み済み
 * ファイル一覧上は先頭の1件なので、ファイル軸の絞り込みでは常にこの値で扱う。
 */
export const SINGLE_FILE_INDEX = 0;

/**
 * 読み込み済みファイルのうち、表示ONのファイル由来のエントリだけを残す
 * （issue #170、Interactive View のファイル単位のトグル）。
 *
 * `visibleFileIndices` が未指定のときは全件そのまま返す——ファイル軸の
 * 絞り込みを使わない呼び出し元（既存のマージビュー等）に、常に全ファイル
 * 表示という既定を与えるため。
 */
export function filterMergedEntriesByFileIndex(
  entries: readonly MergedEntry[],
  visibleFileIndices: ReadonlySet<number> | undefined
): readonly MergedEntry[] {
  if (!visibleFileIndices) {
    return entries;
  }
  return entries.filter((merged) => visibleFileIndices.has(merged.fileIndex));
}

/**
 * 指定インデックスのファイルが表示ONかを返す。単一ファイル表示のように
 * エントリ側にファイル情報が無く、全体を出すか出さないかだけを決めればよい
 * 場面で使う（{@link filterMergedEntriesByFileIndex} と未指定時の扱いを揃える）。
 */
export function isFileIndexVisible(
  visibleFileIndices: ReadonlySet<number> | undefined,
  fileIndex: number
): boolean {
  return !visibleFileIndices || visibleFileIndices.has(fileIndex);
}
