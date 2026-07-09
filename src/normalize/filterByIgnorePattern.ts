import type { LogEntry } from "./types";

/**
 * 指定した正規表現にマッチするエントリを除外する。
 * 判定対象は `entry.raw`（エントリを構成する全物理行の元テキスト）とし、
 * スタックトレース等の複数行にまたがるエントリでも、いずれかの行が
 * マッチすればエントリごと除外できるようにする。
 *
 * `pattern` が `g` / `y` フラグ付きの場合、`RegExp#test` はマッチのたびに
 * `lastIndex` を進めてしまい、エントリをまたいだ呼び出し順で判定が
 * 不安定になる。呼び出し側から渡された `RegExp` インスタンス自体を
 * 書き換える副作用を避けつつ安定させるため、ローカルに複製した上で
 * 毎回 `lastIndex` をリセットしてから判定する。
 */
export function filterEntriesByIgnorePattern(
  entries: readonly LogEntry[],
  pattern: RegExp
): LogEntry[] {
  const matcher = new RegExp(pattern.source, pattern.flags);
  return entries.filter((entry) => {
    matcher.lastIndex = 0;
    return !matcher.test(entry.raw);
  });
}
