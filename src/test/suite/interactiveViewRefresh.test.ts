import * as assert from "node:assert";
import { RefreshRevisionGate } from "../../interactiveViewRefresh";

/** 完了タイミングを testコードから制御するための Promise。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

suite("interactiveViewRefresh / RefreshRevisionGate (#218)", () => {
  test("treats the newest requested revision as the current one", () => {
    const gate = new RefreshRevisionGate();

    const older = gate.begin();
    const newer = gate.begin();

    assert.strictEqual(gate.isCurrent(older), false);
    assert.strictEqual(gate.isCurrent(newer), true);
  });

  test("keeps a lone request current while nothing else starts", () => {
    const gate = new RefreshRevisionGate();

    const only = gate.begin();

    assert.strictEqual(gate.isCurrent(only), true);
  });

  test("publishes only the newest result when a slow older request finishes last", async () => {
    // #218 の本体。重い条件Aの計算中に軽い条件Bが届くと、Bを先に描画した後で
    // Aの結果が到着し、最新表示を上書きできていた。完了順を制御できる Promise で
    // 「新しい高速要求 → 古い低速要求」の順に終わらせて再現する。
    const gate = new RefreshRevisionGate();
    const published: string[] = [];

    const slowA = deferred<string>();
    const fastB = deferred<string>();

    const refresh = async (work: Promise<string>): Promise<void> => {
      const revision = gate.begin();
      const result = await work;
      if (!gate.isCurrent(revision)) {
        return;
      }
      published.push(result);
    };

    // A（重い条件）を先に開始し、その計算中に B（軽い条件）が届く。
    const runningA = refresh(slowA.promise);
    const runningB = refresh(fastB.promise);

    fastB.resolve("B");
    await runningB;
    slowA.resolve("A");
    await runningA;

    assert.deepStrictEqual(published, ["B"]);
  });

  test("keeps discarding stale results across several rounds", async () => {
    const gate = new RefreshRevisionGate();
    const published: string[] = [];

    const refresh = async (label: string, work: Promise<void>): Promise<void> => {
      const revision = gate.begin();
      await work;
      if (!gate.isCurrent(revision)) {
        return;
      }
      published.push(label);
    };

    const first = deferred<void>();
    const second = deferred<void>();
    const third = deferred<void>();

    const running = [
      refresh("first", first.promise),
      refresh("second", second.promise),
      refresh("third", third.promise),
    ];

    // 完了順は要求順と無関係でよい。最後に要求した third だけが公開される。
    second.resolve();
    third.resolve();
    first.resolve();
    await Promise.all(running);

    assert.deepStrictEqual(published, ["third"]);
  });
});
