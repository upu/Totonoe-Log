import { Worker } from "node:worker_threads";
import type { LogEntry } from "./types";

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

export interface FilterByMatchPatternOptions {
  /** 既定のタイムアウトを上書きしたい場合に指定する（主にテスト用）。 */
  readonly timeoutMs?: number;
}

/**
 * ワーカースレッド側で実行するマッチング処理本体。
 * `filterByIgnorePattern` と同じ理由で、素の JS の文字列として複製している
 * （ワーカーが呼び出し元のモジュールを `require` できないため）。
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { source, flags, texts } = workerData;
const matcher = new RegExp(source, flags);
const matched = texts.map((text) => {
  matcher.lastIndex = 0;
  return matcher.test(text);
});
parentPort.postMessage(matched);
`;

/**
 * 指定した正規表現にマッチするエントリ**だけ**を残す（issue #182）。
 * 「一致行のみ表示する」フィルタ型の検索の中核で、
 * {@link filterEntriesByIgnorePattern} のちょうど逆になる。
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
export function filterEntriesByMatchPattern(
  entries: readonly LogEntry[],
  pattern: RegExp,
  options: FilterByMatchPatternOptions = {}
): Promise<FilterByMatchPatternResult> {
  if (entries.length === 0) {
    return Promise.resolve({ ok: true, entries: [] });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const texts = entries.map((entry) => entry.message);

  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { source: pattern.source, flags: pattern.flags, texts },
    });

    let settled = false;
    const finish = (result: FilterByMatchPatternResult): void => {
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

    worker.once("message", (matched: boolean[]) => {
      const filtered = entries.filter((_entry, index) => matched[index]);
      finish({ ok: true, entries: filtered });
    });

    // パターンは呼び出し側で `new RegExp` によりコンパイル済みのため通常は
    // 到達しないが、ワーカー内での予期しない例外に備えたフェイルセーフ。
    worker.once("error", () => {
      finish({ ok: false, reason: "error" });
    });
  });
}
