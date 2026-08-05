import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";
import { collapseRepeatedEntries, type CollapseOptions } from "./collapseRepeatedEntries";

/**
 * {@link collapseRepeatedMergedEntries} が返す1件分の出力単位。
 * {@link CollapsedItem} の `LogEntry` を `MergedEntry` へ置き換えただけの形。
 */
export type CollapsedMergedItem =
  | { readonly kind: "single"; readonly merged: MergedEntry }
  | { readonly kind: "group"; readonly entries: readonly MergedEntry[] };

/**
 * マージ表示（{@link MergedEntry} の配列）に対して、単一ファイル表示と同じ
 * {@link collapseRepeatedEntries} のグルーピングを再利用するための薄い
 * ラッパー（issue #158）。`filterMergedEntries` が
 * `filterEntriesByCriteria` に対して行っているのと同じパターンで、
 * `MergedEntry.entry` だけを取り出して畳み、結果を元の `MergedEntry`
 * （`fileName` / `kind` / `fileIndex` を保持）へ引き当て直す。
 *
 * 引き当ては `LogEntry` インスタンスの参照の同一性で行う
 * （`collapseRepeatedEntries` は受け取ったインスタンスを複製せずそのまま
 * 出力へ入れる）。由来ファイルを保った状態で戻すことが、折りたたみからの
 * `Go to Source Line`（issue #137）が正しい元ファイルへ飛ぶための前提になる。
 *
 * グルーピングのキーは単一ファイル表示と同じで、**由来ファイルを区別しない**
 * （issue #158 で決定）。マージ結果はタイムスタンプ順に並ぶため、複数サーバが
 * 同じメッセージを出す場合その行は交互に並ぶ——ファイルごとにグループを分けると
 * 連続した繰り返しが発生せず、1件も畳めなくなる。
 */
export function collapseRepeatedMergedEntries(
  mergedEntries: readonly MergedEntry[],
  options: CollapseOptions = {}
): CollapsedMergedItem[] {
  const mergedByEntry = new Map<LogEntry, MergedEntry>();
  for (const merged of mergedEntries) {
    mergedByEntry.set(merged.entry, merged);
  }

  const toMerged = (entry: LogEntry): MergedEntry => {
    const merged = mergedByEntry.get(entry);
    if (!merged) {
      // `collapseRepeatedEntries` は元の LogEntry インスタンスをそのまま返す
      // 実装のため通常は到達しないが、由来ファイルがサイレントに失われるより
      // 検出しやすくするためのフェイルセーフとして例外にする
      // （`filterMergedEntriesByCriteria` と同じ扱い）。
      throw new Error(
        "collapseRepeatedMergedEntries: no MergedEntry matched an entry in the collapsed result."
      );
    }
    return merged;
  };

  return collapseRepeatedEntries(
    mergedEntries.map((merged) => merged.entry),
    options
  ).map((item) =>
    item.kind === "single"
      ? { kind: "single", merged: toMerged(item.entry) }
      : { kind: "group", entries: item.entries.map(toMerged) }
  );
}
