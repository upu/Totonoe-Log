import type { LogEntry } from "./types";

/**
 * セベリティが認識できなかったエントリを表すためのキー。
 * 実際のセベリティ文字列（大文字のみ）とは衝突しない空文字列を使う。
 */
export const UNRECOGNIZED_SEVERITY_KEY = "";

/**
 * エントリ群に登場するセベリティを初出順・重複なしで返す。
 * セベリティが認識できなかったエントリは {@link UNRECOGNIZED_SEVERITY_KEY} として扱う。
 * 呼び出し側（絞り込み UI 等）が、実際にログに登場したセベリティだけを
 * 選択肢として提示できるようにするための一覧。
 */
export function getDistinctSeverities(entries: readonly LogEntry[]): string[] {
  const seen = new Set<string>();
  const distinctSeverities: string[] = [];

  for (const entry of entries) {
    const key = entry.severity ?? UNRECOGNIZED_SEVERITY_KEY;
    if (!seen.has(key)) {
      seen.add(key);
      distinctSeverities.push(key);
    }
  }

  return distinctSeverities;
}

/**
 * 指定したセベリティ集合に含まれるエントリだけを残す。
 * セベリティ未認識のエントリも表示したい場合は、集合に
 * {@link UNRECOGNIZED_SEVERITY_KEY} を含める。
 */
export function filterEntriesBySeverity(
  entries: readonly LogEntry[],
  selectedSeverities: ReadonlySet<string>
): LogEntry[] {
  return entries.filter((entry) =>
    selectedSeverities.has(entry.severity ?? UNRECOGNIZED_SEVERITY_KEY)
  );
}
