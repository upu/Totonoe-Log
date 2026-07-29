import { Worker } from "node:worker_threads";
import type { LogEntry } from "./types";

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

export interface FilterByIgnorePatternOptions {
  /** 既定のタイムアウトを上書きしたい場合に指定する（主にテスト用）。 */
  readonly timeoutMs?: number;
}

/**
 * ワーカースレッド側で実行するマッチング処理本体。
 *
 * `Worker` に `eval: true` で渡す文字列のため、TypeScript の型チェックの
 * 外で実行される素の JS として書く。ロジックはこのファイルの以前の実装
 * （`RegExp#test` を複製したインスタンスで呼ぶだけ）と同一で、
 * ワーカーが呼び出し元のモジュールを `require` できない都合上、
 * 内容を文字列として複製している（数行のため保守コストは小さい）。
 *
 * 複数パターンは `{ source, flags }` の配列として受け取り、ここで `some()`
 * 判定する（issue #206）。交替正規表現へ連結しないのは、どのパターンが不正
 * なのかの帰属が失われ、破局的バックトラッキングのリスクも合成で増えるため。
 * ワーカーの起動は1回のままなので、パターンが増えても追加コストはほぼ無い。
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { patterns, texts } = workerData;
const matchers = patterns.map(({ source, flags }) => new RegExp(source, flags));
const excluded = texts.map((text) =>
  matchers.some((matcher) => {
    matcher.lastIndex = 0;
    return matcher.test(text);
  })
);
parentPort.postMessage(excluded);
`;

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
export function filterEntriesByIgnorePattern(
  entries: readonly LogEntry[],
  patterns: readonly RegExp[],
  options: FilterByIgnorePatternOptions = {}
): Promise<FilterByIgnorePatternResult> {
  if (entries.length === 0) {
    return Promise.resolve({ ok: true, entries: [] });
  }
  if (patterns.length === 0) {
    return Promise.resolve({ ok: true, entries: [...entries] });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const texts = entries.map((entry) => entry.raw);

  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        patterns: patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags })),
        texts,
      },
    });

    let settled = false;
    const finish = (result: FilterByIgnorePatternResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, reason: "timeout" });
    }, timeoutMs);

    worker.once("message", (excluded: boolean[]) => {
      const filtered = entries.filter((_entry, index) => !excluded[index]);
      finish({ ok: true, entries: filtered });
    });

    // パターンは呼び出し側で `new RegExp` によりコンパイル済みのため通常は
    // 到達しないが、ワーカー内での予期しない例外に備えたフェイルセーフ。
    worker.once("error", () => {
      finish({ ok: false, reason: "error" });
    });
  });
}
