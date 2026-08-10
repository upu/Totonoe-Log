import type { LogEntry } from "./types";
import {
  runPatternJob,
  serializePatterns,
  type PatternWorkerOptions,
} from "./patternWorkerSession";

/**
 * マッチング処理を打ち切るまでの既定タイムアウト（ミリ秒）。
 * `filterByIgnorePattern` と同じ値にして、対になる2つの入力欄で
 * 待たされる時間の上限が食い違わないようにする。
 */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * `filterEntriesByMatchPattern` の結果。
 *
 * タイムアウト時に「フィルタなしで全件表示する」フォールバックをしない理由は
 * `filterByIgnorePattern` と同じ（破局的バックトラッキングを起こすパターンは
 * 往々にして誤入力であり、呼び出し側が明示的に失敗を扱える方が安全）。
 */
export type FilterByMatchPatternResult =
  | { readonly ok: true; readonly entries: LogEntry[] }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

export type FilterByMatchPatternOptions = PatternWorkerOptions;

/**
 * 指定した正規表現の**どれか**にマッチするエントリだけを残す（issue #182、#206）。
 * 「一致行のみ表示する」フィルタ型の検索の中核で、
 * {@link filterEntriesByIgnorePattern} のちょうど逆になる。
 *
 * `patterns` が空の場合は「一致パターンの条件なし」として全件そのまま返す
 * （「どれにも一致しない」と解釈して0件にすると、パターンを1件も入力していない
 * 初期状態で全行が消えてしまう）。
 *
 * 判定対象は `entry.raw` ではなく `entry.message`（タイムスタンプ・セベリティを
 * 除いた本文）とし、無視パターンとはあえて非対称にしている。タイムスタンプと
 * セベリティは日付範囲欄・セベリティのチェックボックスで既に絞れるため、
 * 一致パターンでそれらに当たると意図しない行が残ってノイズになるため。
 * `message` は継続行を含むので、スタックトレース等の複数行エントリでも
 * いずれかの行が一致すればエントリごと残る（＝文脈が切れない）。
 *
 * `g` / `y` フラグ付きの `RegExp#test` が `lastIndex` を進めてしまう問題への
 * 対処（ワーカー側で毎回リセットする）と、破局的バックトラッキング対策として
 * 別スレッド＋タイムアウトで強制終了する設計は、いずれも
 * {@link filterEntriesByIgnorePattern} と同じ。詳しい背景はそちらのコメント参照。
 */
export async function filterEntriesByMatchPattern(
  entries: readonly LogEntry[],
  patterns: readonly RegExp[],
  options: FilterByMatchPatternOptions = {}
): Promise<FilterByMatchPatternResult> {
  if (entries.length === 0) {
    return { ok: true, entries: [] };
  }
  if (patterns.length === 0) {
    return { ok: true, entries: [...entries] };
  }

  const matched = await runPatternJob<boolean[]>(
    options.session,
    { kind: "test", patterns: serializePatterns(patterns), texts: entries.map((entry) => entry.message) },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (!matched.ok) {
    return matched;
  }
  return { ok: true, entries: entries.filter((_entry, index) => matched.value[index]) };
}
