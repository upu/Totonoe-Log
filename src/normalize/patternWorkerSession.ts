import { Worker } from "node:worker_threads";

/**
 * ワーカーへ渡す正規表現。`RegExp` インスタンスは構造化クローンで運べないため、
 * ソースとフラグに分解して送る。
 */
export interface SerializedPattern {
  readonly source: string;
  readonly flags: string;
}

/** {@link SerializedPattern} へ落とす（マスクのように送る直前でフラグを足す側は各自で組む）。 */
export function serializePatterns(patterns: readonly RegExp[]): SerializedPattern[] {
  return patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
}

/**
 * ワーカーに投げる1件の仕事。
 *
 * 一致パターンと無視パターンはどちらも `test` を使う——判定そのものは同一で、
 * 結果を「残す」に使うか「除く」に使うかが違うだけだから（呼び出し側で反転する）。
 */
export type PatternWorkerJob =
  | { readonly kind: "test"; readonly patterns: readonly SerializedPattern[]; readonly texts: readonly string[] }
  | {
      readonly kind: "mask";
      readonly patterns: readonly SerializedPattern[];
      readonly placeholder: string;
      readonly texts: readonly string[];
    }
  | {
      readonly kind: "highlight";
      readonly rules: readonly (SerializedPattern & { readonly color: string })[];
      readonly lines: readonly string[];
    };

/**
 * ジョブ1件の結果。失敗の理由は従来どおり「タイムアウト」と「エラー」の2種類で、
 * どちらに縮退させるかの判断は呼び出し側（絞り込みは条件ごと落とす、マスクと
 * ハイライトはその処理だけ諦める）が持つ。
 */
export type PatternJobResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

/**
 * ワーカースレッド側で実行する処理本体。`eval: true` で渡す文字列のため、
 * TypeScript の型チェックの外で動く素の JS として書く（ワーカーは呼び出し元の
 * モジュールを `require` できない）。
 *
 * 4種類の処理を1つのソースにまとめてあるのは、1回の再描画で走る一致・無視・
 * マスク・ハイライトを同じワーカーで順に処理するため（issue #303。ワーカーの
 * 起動は1回あたり約20ミリ秒で、再描画あたり4回ぶんが固定費になっていた）。
 * `workerData` ではなく `postMessage` で受けるのはそのためで、ジョブごとに
 * `id` を返して呼び出し側が取り違えないようにしている。
 *
 * 各処理の中身は、以前それぞれのモジュールが持っていた実装をそのまま移した:
 *
 * - `test`: `g` / `y` フラグ付きの `RegExp#test` が `lastIndex` を進める問題を
 *   避けるため、テキストごとに必ずリセットしてから判定する
 * - `mask`: 行単位で置換する。`[\s\S]+` のような改行をまたぐパターンでも行数を
 *   変えないため（行数が変わると行ジャンプ（#179）と表示上限（#178）の前提が崩れる）
 * - `highlight`: 重なった範囲は先に書かれたルールを優先して落とし（#298）、
 *   返す前に開始位置で並べ直す（Webview は昇順・重なり無しを前提に描く）。
 *   幅0のマッチは `lastIndex` を1つ進めて無限ループを避け、範囲としては残さない
 */
const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");

const compile = (patterns) => patterns.map(({ source, flags }) => new RegExp(source, flags));

const runTest = (job) => {
  const matchers = compile(job.patterns);
  return job.texts.map((text) =>
    matchers.some((matcher) => {
      matcher.lastIndex = 0;
      return matcher.test(text);
    })
  );
};

const runMask = (job) => {
  const maskers = compile(job.patterns);
  return job.texts.map((text) =>
    text
      .split("\\n")
      .map((line) => maskers.reduce((current, masker) => current.replace(masker, job.placeholder), line))
      .join("\\n")
  );
};

const runHighlight = (job) => {
  const matchers = compile(job.rules);
  return job.lines.map((line) => {
    const found = [];
    matchers.forEach((matcher, ruleIndex) => {
      matcher.lastIndex = 0;
      let match;
      while ((match = matcher.exec(line)) !== null) {
        if (match[0].length === 0) {
          matcher.lastIndex += 1;
          continue;
        }
        found.push({ start: match.index, end: match.index + match[0].length, ruleIndex });
      }
    });

    found.sort((a, b) => a.ruleIndex - b.ruleIndex || a.start - b.start);

    const accepted = [];
    for (const range of found) {
      const overlaps = accepted.some((other) => range.start < other.end && other.start < range.end);
      if (overlaps) {
        continue;
      }
      accepted.push({ start: range.start, end: range.end, color: job.rules[range.ruleIndex].color });
    }

    accepted.sort((a, b) => a.start - b.start);
    return accepted;
  });
};

parentPort.on("message", (job) => {
  const value =
    job.kind === "test" ? runTest(job) : job.kind === "mask" ? runMask(job) : runHighlight(job);
  parentPort.postMessage({ id: job.id, value });
});
`;

/**
 * 1回の再描画のあいだ、パターン処理のワーカーを使い回すための入れ物
 * （issue #303）。
 *
 * ワーカーの起動は1回あたり約20ミリ秒かかり、Interactive View は再描画のたびに
 * 一致・無視・マスク・ハイライトで4回起動していた（大きめのログでの実測では、
 * 絞り込みが効いている場合で再描画1回 288ms のうち約80ms）。同じセッションを
 * 渡せば、この4つが1つのワーカーで順に走る。
 *
 * 有効範囲を「1回の再描画」に留めてプロセス常駐にしないのは、再描画が重なり
 * うるため——入力は300msでデバウンスされる一方、大きなログの再描画はそれより
 * 長くかかることがあり、古い再描画は latest-wins（#218）で結果が捨てられるだけで
 * 処理自体は走り続ける。プロセス常駐の1本にまとめると、捨てられると分かって
 * いる古い仕事が最新の再描画を待たせることになり、いま速くしたい場面がむしろ
 * 遅くなる。再描画ごとに区切れば、重なった再描画は今までどおり別スレッドで
 * 並行する。
 *
 * 破局的バックトラッキングからの隔離という元の設計意図は変えていない。ジョブ
 * ごとにタイムアウトを持ち、時間切れになったワーカーは強制終了して捨てる
 * ——バックトラック中のワーカーは他のジョブに使い回せないため。次のジョブは
 * 新しいワーカーで走る。
 */
export class PatternWorkerSession {
  private worker: Worker | undefined;
  private nextJobId = 0;
  private spawned = 0;

  /** このセッションが起動したワーカーの数（テストと実測用）。 */
  get spawnCount(): number {
    return this.spawned;
  }

  /**
   * ジョブを1件実行する。ワーカーはこのタイミングで初めて起動する
   * ——パターンもハイライトルールも無い再描画では、呼び出し側が早期に
   * 戻るためワーカーを1つも作らずに済む。
   */
  run<TValue>(job: PatternWorkerJob, timeoutMs: number): Promise<PatternJobResult<TValue>> {
    const worker = this.ensureWorker();
    const id = (this.nextJobId += 1);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PatternJobResult<TValue>): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        resolve(result);
      };

      const onMessage = (reply: { id: number; value: TValue }): void => {
        // 打ち切ったジョブの結果が遅れて届くことがあるので、必ず id で照合する。
        if (reply.id !== id) {
          return;
        }
        finish({ ok: true, value: reply.value });
      };

      const onError = (): void => {
        // 例外で死んだワーカーは以降のジョブに使えないため、セッションから外す。
        this.discard(worker);
        finish({ ok: false, reason: "error" });
      };

      const timer = setTimeout(() => {
        this.discard(worker);
        finish({ ok: false, reason: "timeout" });
      }, timeoutMs);

      worker.on("message", onMessage);
      worker.on("error", onError);
      try {
        worker.postMessage({ ...job, id });
      } catch {
        // 送れないワーカー（既に終了している等）は捨てて、次のジョブで作り直す。
        // 呼び出し側から見えるのは他の失敗と同じ `error` で、絞り込みなら条件を
        // 落とし、マスク・ハイライトならその処理だけ諦める。
        onError();
      }
    });
  }

  /**
   * 抱えているワーカーを終了する。以降にジョブが来た場合は新しいワーカーを
   * 起動する——使い終わったセッションへの呼び出しを例外にすると、配線を1か所
   * 間違えただけで表示が出なくなるため、多少のコストを払ってでも動く側に倒す。
   */
  dispose(): void {
    const worker = this.worker;
    this.worker = undefined;
    void worker?.terminate();
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(WORKER_SOURCE, { eval: true });
      // ジョブごとの `error` ハンドラとは別に、生存中ずっと付けたままにする。
      // `EventEmitter` は listener の無い `error` を送出時に投げ直すため、
      // ジョブとジョブの間に死んだワーカーが拡張ホストを巻き込まないようにする。
      worker.on("error", () => {
        this.discard(worker);
      });
      // `error` を伴わずに終了することもある（外部からの終了・異常終了など）。
      // 死んだワーカーを抱えたままだと次のジョブが届かずタイムアウトを待つ
      // ことになるため、終了を見たら参照だけ外して作り直せるようにする。
      worker.on("exit", () => {
        this.forget(worker);
      });
      this.worker = worker;
      this.spawned += 1;
    }
    return this.worker;
  }

  private discard(worker: Worker): void {
    this.forget(worker);
    void worker.terminate();
  }

  /** 参照だけ外す（終了処理は呼び出し側の状況次第）。 */
  private forget(worker: Worker): void {
    if (this.worker === worker) {
      this.worker = undefined;
    }
  }
}

/**
 * セッションが渡されていればそれで、渡されていなければ使い捨てのワーカーで
 * ジョブを1件実行する。Interactive View 以外の呼び出し元（書き出し・各コマンド）は
 * 再描画のように連続してパターン処理をしないため、セッションを引き回さずに
 * 済ませられる。
 */
export async function runPatternJob<TValue>(
  session: PatternWorkerSession | undefined,
  job: PatternWorkerJob,
  timeoutMs: number
): Promise<PatternJobResult<TValue>> {
  if (session) {
    return session.run<TValue>(job, timeoutMs);
  }
  const transient = new PatternWorkerSession();
  try {
    return await transient.run<TValue>(job, timeoutMs);
  } finally {
    transient.dispose();
  }
}

/** パターン処理のオプションのうち、4つの処理で共通する部分。 */
export interface PatternWorkerOptions {
  /** 既定のタイムアウトを上書きしたい場合に指定する（主にテスト用）。 */
  readonly timeoutMs?: number;
  /**
   * 同じ再描画の他のパターン処理と共有するワーカー（issue #303）。未指定なら
   * この呼び出しだけで使い捨てるワーカーを起動する。
   */
  readonly session?: PatternWorkerSession;
}
