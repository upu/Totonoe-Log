import type { LogEntry } from "./types";
import {
  runPatternJob,
  serializePatterns,
  type PatternWorkerOptions,
} from "./patternWorkerSession";

/**
 * マッチング処理を打ち切るまでの既定タイムアウト（ミリ秒）。
 * 通常の（破局的でない）正規表現はログ数千行に対しても数十ミリ秒程度で
 * 終わるため、体感できる遅延にならない範囲で十分に余裕を持たせている。
 */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * `filterEntriesByIgnorePattern` の結果。
 *
 * マッチング処理がタイムアウトした場合は `ok: false` を返す。この場合、
 * 「フィルタなしで全件表示する」フォールバックはしない。破局的
 * バックトラッキングを起こすパターンは往々にして無関係な誤入力であり、
 * 意図しない全件表示よりも、呼び出し側が明示的に失敗を扱える形の方が
 * 安全だと判断したため。
 */
export type FilterByIgnorePatternResult =
  | { readonly ok: true; readonly entries: LogEntry[] }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

export type FilterByIgnorePatternOptions = PatternWorkerOptions;

/**
 * 指定した正規表現の**どれか**にマッチするエントリを除外する（issue #206）。
 * 判定対象は `entry.raw`（エントリを構成する全物理行の元テキスト）とし、
 * スタックトレース等の複数行にまたがるエントリでも、いずれかの行が
 * マッチすればエントリごと除外できるようにする。
 *
 * `patterns` が空の場合は「無視パターンの条件なし」として全件そのまま返す。
 *
 * パターンが `g` / `y` フラグ付きの場合、`RegExp#test` はマッチのたびに
 * `lastIndex` を進めてしまい、エントリをまたいだ呼び出し順で判定が
 * 不安定になる。呼び出し側から渡された `RegExp` インスタンス自体を
 * 書き換える副作用を避けつつ安定させるため、ワーカー側で毎回
 * `lastIndex` をリセットしてから判定する。
 *
 * ユーザーが入力した正規表現は、破局的バックトラッキング
 * （catastrophic backtracking）を起こしうる（例: `(a+)+` に長い非マッチ
 * 入力）。Node の同期正規表現エンジンには実行時タイムアウトの仕組みが
 * 無く、`vm` モジュールの `timeout` オプションもネイティブな正規表現の
 * バックトラック処理そのものは中断できないため、拡張ホストをフリーズ
 * させない唯一の方法は「別スレッドに実行を追い出し、時間切れで
 * `Worker#terminate()` により強制終了する」ことだと判断した
 * （V8 は `TerminateExecution` をバックトラック中の正規表現マッチにも
 * 割り込ませられる）。既知の危険パターンを静的検出して事前警告する案も
 * 検討したが、誤検知・見逃しの余地があり単体では受け入れ基準（フリーズ
 * させない）を満たし切れないため、実行時タイムアウトのみを唯一の対策
 * として採用する。
 */
export async function filterEntriesByIgnorePattern(
  entries: readonly LogEntry[],
  patterns: readonly RegExp[],
  options: FilterByIgnorePatternOptions = {}
): Promise<FilterByIgnorePatternResult> {
  if (entries.length === 0) {
    return { ok: true, entries: [] };
  }
  if (patterns.length === 0) {
    return { ok: true, entries: [...entries] };
  }

  const excluded = await runPatternJob<boolean[]>(
    options.session,
    { kind: "test", patterns: serializePatterns(patterns), texts: entries.map((entry) => entry.raw) },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (!excluded.ok) {
    return excluded;
  }
  return { ok: true, entries: entries.filter((_entry, index) => !excluded.value[index]) };
}
