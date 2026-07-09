import type { LogEntry } from "./types";

/**
 * 指定した正規表現にマッチするエントリを除外する。
 * 判定対象は `entry.raw`（エントリを構成する全物理行の元テキスト）とし、
 * スタックトレース等の複数行にまたがるエントリでも、いずれかの行が
 * マッチすればエントリごと除外できるようにする。
 */
export function filterEntriesByIgnorePattern(
  entries: readonly LogEntry[],
  pattern: RegExp
): LogEntry[] {
  return entries.filter((entry) => !pattern.test(entry.raw));
}
