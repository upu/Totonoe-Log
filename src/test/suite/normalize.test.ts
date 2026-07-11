import * as assert from "node:assert";
import {
  parseLog,
  createSyslogFormat,
  formatNormalizedLog,
  formatMaskedLogForCompare,
  maskLogTextForCopy,
  collapseRepeatedEntries,
  formatCollapsedLog,
  deriveLogKind,
  mergeLogFiles,
  formatMergedLog,
  getDistinctSeverities,
  filterEntriesBySeverity,
  parseDateBoundary,
  filterEntriesByDateRange,
  filterEntriesByIgnorePattern,
} from "../../normalize";

suite("normalize / parseLog", () => {
  test("parses ISO 8601 timestamps with severity and message", () => {
    const [entry] = parseLog("2024-01-02T03:04:05.678Z ERROR Something broke");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "iso8601");
    assert.strictEqual(entry.severity, "ERROR");
    assert.strictEqual(entry.message, "Something broke");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
    assert.strictEqual(entry.raw, "2024-01-02T03:04:05.678Z ERROR Something broke");
  });

  test("parses log4j-style bracketed timestamps with comma millis", () => {
    const [entry] = parseLog("[2024-01-02 03:04:05,678] INFO Starting up");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "bracketed-iso8601");
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "Starting up");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("normalizes WARNING severity to WARN", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z WARNING disk almost full");
    assert.strictEqual(entry.severity, "WARN");
    assert.strictEqual(entry.message, "disk almost full");
  });

  test("applies a UTC offset when present", () => {
    const [entry] = parseLog("2024-01-02T03:04:05+09:00 INFO hello");
    // 03:04:05+09:00 is 18:04:05 the previous day in UTC.
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
  });

  test("parses syslog-style timestamps given an assumed year", () => {
    const [entry] = parseLog("Jan  2 03:04:05 host myapp: something happened", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "syslog");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.message, "host myapp: something happened");
  });

  test("rolls a default-year syslog timestamp back one year when it would be in the future", () => {
    // 実行時点が2026年1月15日のとき「Dec 31」を2026年と解釈すると未来になるため、
    // 2025年（前年）のログと推定する。
    const [entry] = parseLog("Dec 31 23:59:59 host myapp: year rollover", {
      timestampFormats: [createSyslogFormat({ referenceTimeMs: Date.UTC(2026, 0, 15) })],
    });

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2025, 11, 31, 23, 59, 59));
  });

  test("keeps the reference year for a default-year syslog timestamp in the past", () => {
    const [entry] = parseLog("Jan  2 03:04:05 host myapp: hello", {
      timestampFormats: [createSyslogFormat({ referenceTimeMs: Date.UTC(2026, 0, 15) })],
    });

    assert.strictEqual(entry.timestampMs, Date.UTC(2026, 0, 2, 3, 4, 5));
  });

  test("keeps the reference year for a slightly-future timestamp within clock-skew tolerance", () => {
    // ログを書いたマシンの時計が少し進んでいるだけのケースを、1年前と誤認しない。
    const [entry] = parseLog("Jan 15 13:00:00 host myapp: skewed clock", {
      timestampFormats: [createSyslogFormat({ referenceTimeMs: Date.UTC(2026, 0, 15, 12, 0, 0) })],
    });

    assert.strictEqual(entry.timestampMs, Date.UTC(2026, 0, 15, 13, 0, 0));
  });

  test("an explicit assumedYear bypasses the future-rollback heuristic", () => {
    const [entry] = parseLog("Dec 31 23:59:59 host myapp: explicit year", {
      timestampFormats: [
        createSyslogFormat({ assumedYear: 2030, referenceTimeMs: Date.UTC(2026, 0, 15) }),
      ],
    });

    assert.strictEqual(entry.timestampMs, Date.UTC(2030, 11, 31, 23, 59, 59));
  });

  test("resolves Feb 29 against the previous year when the reference year is not a leap year", () => {
    const [entry] = parseLog("Feb 29 12:00:00 host myapp: leap day", {
      timestampFormats: [createSyslogFormat({ referenceTimeMs: Date.UTC(2025, 0, 15) })],
    });

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 1, 29, 12, 0, 0));
  });

  test("groups multi-line stack traces into the preceding entry", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR Unhandled exception",
      "java.lang.NullPointerException",
      "    at com.example.Foo.bar(Foo.java:42)",
      "    at com.example.Foo.main(Foo.java:10)",
      "2024-01-02T03:04:06Z INFO recovered",
    ].join("\n");

    const entries = parseLog(text);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].matched, true);
    assert.strictEqual(entries[0].lines.length, 4);
    assert.strictEqual(
      entries[0].message,
      [
        "Unhandled exception",
        "java.lang.NullPointerException",
        "    at com.example.Foo.bar(Foo.java:42)",
        "    at com.example.Foo.main(Foo.java:10)",
      ].join("\n")
    );
    assert.strictEqual(entries[1].message, "recovered");
  });

  test("keeps unparseable lines as unknown entries instead of dropping them", () => {
    const text = [
      "==== log start ====",
      "some banner line",
      "2024-01-02T03:04:05Z INFO real entry",
    ].join("\n");

    const entries = parseLog(text);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].matched, false);
    assert.strictEqual(entries[0].timestampMs, undefined);
    assert.strictEqual(entries[0].raw, "==== log start ====\nsome banner line");
    assert.strictEqual(entries[1].matched, true);
  });

  test("returns an empty array for empty input", () => {
    assert.deepStrictEqual(parseLog(""), []);
  });

  test("rejects invalid calendar dates and treats the line as unknown", () => {
    const [entry] = parseLog("2024-02-30T03:04:05Z ERROR impossible date");
    assert.strictEqual(entry.matched, false);
    assert.strictEqual(entry.raw, "2024-02-30T03:04:05Z ERROR impossible date");
  });
});

suite("normalize / formatNormalizedLog", () => {
  test("renders matched entries with a unified ISO timestamp and original line number", () => {
    const entries = parseLog("[2024-01-02 03:04:05,678] INFO Starting up");
    const output = formatNormalizedLog(entries);

    assert.strictEqual(output, "1 | 2024-01-02T03:04:05.678Z INFO Starting up");
  });

  test("keeps original line numbers aligned across multi-line entries", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR Unhandled exception",
      "java.lang.NullPointerException",
      "    at com.example.Foo.bar(Foo.java:42)",
      "2024-01-02T03:04:06Z INFO recovered",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text));

    assert.strictEqual(
      output,
      [
        "1 | 2024-01-02T03:04:05.000Z ERROR Unhandled exception",
        "2 | java.lang.NullPointerException",
        "3 |     at com.example.Foo.bar(Foo.java:42)",
        "4 | 2024-01-02T03:04:06.000Z INFO recovered",
      ].join("\n")
    );
  });

  test("passes unrecognized lines through without a timestamp/severity header", () => {
    const text = ["==== log start ====", "2024-01-02T03:04:05Z INFO real entry"].join("\n");

    const output = formatNormalizedLog(parseLog(text));

    assert.strictEqual(
      output,
      ["1 | ==== log start ====", "2 | 2024-01-02T03:04:05.000Z INFO real entry"].join("\n")
    );
  });

  test("uses '-' as the severity placeholder when none was recognized", () => {
    const output = formatNormalizedLog(parseLog("2024-01-02T03:04:05Z no severity here"));
    assert.strictEqual(output, "1 | 2024-01-02T03:04:05.000Z - no severity here");
  });

  test("returns an empty string for no entries", () => {
    assert.strictEqual(formatNormalizedLog([]), "");
  });

  test("does not insert a gap marker when gapThresholdMs is not specified", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO before",
      "2024-01-02T03:05:05Z INFO after (60s later)",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text));

    assert.ok(!output.includes("空白"));
  });

  test("inserts a gap marker between entries whose timestamp gap meets the threshold", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO before",
      "2024-01-02T03:04:35Z INFO after",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.strictEqual(
      output,
      [
        "1 | 2024-01-02T03:04:05.000Z INFO before",
        "... | 30秒の空白",
        "2 | 2024-01-02T03:04:35.000Z INFO after",
      ].join("\n")
    );
  });

  test("does not insert a gap marker when the gap is below the threshold", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO before",
      "2024-01-02T03:04:34Z INFO after (29s later)",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.ok(!output.includes("空白"));
  });

  test("formats a sub-second-precision gap duration with one decimal place", () => {
    const text = [
      "2024-01-02T03:04:05.000Z INFO before",
      "2024-01-02T03:04:35.500Z INFO after",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.ok(output.includes("30.5秒の空白"));
  });

  test("skips the gap check for a pair where the earlier entry lacks a recognized timestamp, without affecting later pairs", () => {
    // 先頭の未認識行は matched: false の独立エントリになる（parseLog は、認識済み
    // タイムスタンプ行より前に現れた行のみを未マッチエントリとして扱うため）。
    const text = [
      "unrecognized banner line",
      "2024-01-02T03:04:05Z INFO first matched entry",
      "2024-01-02T03:05:05Z INFO second matched entry (60s later)",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.strictEqual((output.match(/秒の空白/g) ?? []).length, 1);
    assert.ok(output.includes("60秒の空白"));
  });

  test("treats a gapThresholdMs of 0 as disabled", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO before",
      "2024-01-02T03:04:06Z INFO after",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 0 });

    assert.ok(!output.includes("空白"));
  });

  test("inserts multiple gap markers for multiple qualifying gaps", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO a",
      "2024-01-02T03:04:35Z INFO b",
      "2024-01-02T03:05:05Z INFO c",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.strictEqual((output.match(/秒の空白/g) ?? []).length, 2);
  });
});

suite("normalize / filterEntriesBySeverity", () => {
  test("getDistinctSeverities lists severities in order of first appearance, using '' for unrecognized", () => {
    const text = [
      "no timestamp here",
      "2024-01-02T03:04:05Z INFO starting",
      "2024-01-02T03:04:06Z ERROR boom",
      "2024-01-02T03:04:07Z WARNING low disk",
      "2024-01-02T03:04:08Z INFO another info",
    ].join("\n");

    const severities = getDistinctSeverities(parseLog(text));

    assert.deepStrictEqual(severities, ["", "INFO", "ERROR", "WARN"]);
  });

  test("filterEntriesBySeverity keeps only entries whose severity is selected", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO starting",
      "2024-01-02T03:04:06Z ERROR boom",
      "2024-01-02T03:04:07Z WARN low disk",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = filterEntriesBySeverity(entries, new Set(["ERROR"]));

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].severity, "ERROR");
  });

  test("filterEntriesBySeverity treats '' as the key for entries without a recognized severity", () => {
    const text = ["==== banner ====", "2024-01-02T03:04:05Z INFO hello"].join("\n");
    const entries = parseLog(text);

    const filtered = filterEntriesBySeverity(entries, new Set([""]));

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].matched, false);
  });
});

suite("normalize / filterEntriesByDateRange", () => {
  test("parseDateBoundary parses a date-only string as UTC midnight", () => {
    assert.strictEqual(parseDateBoundary("2024-01-02"), Date.UTC(2024, 0, 2, 0, 0, 0));
  });

  test("parseDateBoundary parses a date and time string as UTC", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02T03:04:05"),
      Date.UTC(2024, 0, 2, 3, 4, 5)
    );
    assert.strictEqual(
      parseDateBoundary("2024-01-02 03:04"),
      Date.UTC(2024, 0, 2, 3, 4, 0)
    );
  });

  test("parseDateBoundary returns undefined for an unrecognized or invalid string", () => {
    assert.strictEqual(parseDateBoundary("not a date"), undefined);
    assert.strictEqual(parseDateBoundary("2024-02-30"), undefined);
    assert.strictEqual(parseDateBoundary("2024-01-02T24:00:00"), undefined);
    assert.strictEqual(parseDateBoundary("2024-01-02T03:60:00"), undefined);
  });

  test("filterEntriesByDateRange keeps only entries within [startMs, endMs]", () => {
    const text = [
      "2024-01-01T00:00:00Z INFO before range",
      "2024-01-02T03:04:05Z INFO in range",
      "2024-01-03T00:00:00Z INFO after range",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = filterEntriesByDateRange(entries, {
      startMs: Date.UTC(2024, 0, 2, 0, 0, 0),
      endMs: Date.UTC(2024, 0, 2, 23, 59, 59),
    });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "in range");
  });

  test("filterEntriesByDateRange treats an omitted bound as unbounded", () => {
    const text = [
      "2024-01-01T00:00:00Z INFO first",
      "2024-01-05T00:00:00Z INFO second",
    ].join("\n");
    const entries = parseLog(text);

    const onlyStart = filterEntriesByDateRange(entries, {
      startMs: Date.UTC(2024, 0, 3),
    });
    assert.strictEqual(onlyStart.length, 1);
    assert.strictEqual(onlyStart[0].message, "second");

    const onlyEnd = filterEntriesByDateRange(entries, { endMs: Date.UTC(2024, 0, 3) });
    assert.strictEqual(onlyEnd.length, 1);
    assert.strictEqual(onlyEnd[0].message, "first");
  });

  test("filterEntriesByDateRange judges year-crossing syslog entries by their inferred years", () => {
    // 2026年1月に開いた、年境界をまたぐ syslog ログ。「Dec 31」は2025年、
    // 「Jan  1」は2026年と推定されるため、2026年以降の範囲指定で後者だけが残る。
    const text = [
      "Dec 31 23:00:00 host app: last year",
      "Jan  1 01:00:00 host app: this year",
    ].join("\n");
    const entries = parseLog(text, {
      timestampFormats: [createSyslogFormat({ referenceTimeMs: Date.UTC(2026, 0, 15) })],
    });

    const filtered = filterEntriesByDateRange(entries, { startMs: Date.UTC(2026, 0, 1) });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "host app: this year");
  });

  test("filterEntriesByDateRange excludes entries without a recognized timestamp", () => {
    const text = ["==== banner ====", "2024-01-02T03:04:05Z INFO hello"].join("\n");
    const entries = parseLog(text);

    const filtered = filterEntriesByDateRange(entries, {});

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "hello");
  });
});

suite("normalize / filterEntriesByIgnorePattern", () => {
  /** テストの意図（マッチ結果の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function filterOk(entries: Parameters<typeof filterEntriesByIgnorePattern>[0], pattern: RegExp) {
    const result = await filterEntriesByIgnorePattern(entries, pattern);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    return result.entries;
  }

  test("excludes entries whose raw text matches a metacharacter-free pattern (substring match)", async () => {
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat ok",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, /heartbeat/i);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });

  test("excludes entries matching a regular expression pattern", async () => {
    const text = [
      "2024-01-02T03:04:05Z DEBUG verbose trace",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, /^.*DEBUG.*$/im);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });

  test("excludes a multi-line entry (e.g. stack trace) if any of its lines match", async () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "    at com.example.Foo.bar(Foo.java:42)",
      "2024-01-02T03:04:06Z INFO keep",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, /com\.example/);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "keep");
  });

  test("keeps every entry when nothing matches", async () => {
    const text = "2024-01-02T03:04:05Z INFO hello";
    const entries = parseLog(text);

    const filtered = await filterOk(entries, /nope/);

    assert.strictEqual(filtered.length, 1);
  });

  test("matches every entry independently even when the pattern has a global flag", async () => {
    // g フラグ付きの RegExp#test は呼び出しのたびに lastIndex を進めるため、
    // リセットしないと1件目のマッチが2件目以降の判定を狂わせてしまう。
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat one",
      "2024-01-02T03:04:06Z ERROR boom",
      "2024-01-02T03:04:07Z INFO heartbeat two",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, /heartbeat/g);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });

  test("returns quickly for a normal pattern against a moderately sized log (no perceptible slowdown)", async () => {
    const lines = [];
    for (let i = 0; i < 500; i += 1) {
      lines.push(`2024-01-02T03:04:05Z INFO message number ${i}`);
    }
    const entries = parseLog(lines.join("\n"));

    const startedAt = Date.now();
    const filtered = await filterOk(entries, /number 42$/);
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(filtered.length, entries.length - 1);
    // ワーカースレッドの起動コストを含めても、通常のパターンは十分速く
    // 終わるべき（既定タイムアウトの 2000ms よりずっと短い）。
    assert.ok(elapsedMs < 1500, `expected a fast result, took ${elapsedMs}ms`);
  });

  test("terminates and reports a timeout instead of hanging forever when matching doesn't finish in time", async function () {
    this.timeout(5000);

    // 実際に破局的バックトラッキングを起こす正規表現（例: `(a+)+b` に長い
    // 非マッチ入力を与える）はリポジトリに literal で置かない。実測すると
    // 数十秒〜数分ブロックし続ける危険な正規表現がテストコードとして
    // コミットされ続けることになり、CodeQL の js/redos が（意図どおり）
    // 正しく検出する。破局的バックトラッキング自体への保護（ワーカー
    // スレッド + タイムアウトで拡張ホストをブロックしない）が実際に効く
    // ことは、下記の手動確認手順で検証する:
    //   1. `Totonoe Log: Show Normalized View Filtered by Ignore Pattern`
    //      を実行する
    //   2. パターン入力欄に `(a+)+b` と入力して確定する
    //   3. 対象ログに "a" が30文字以上連続する行（末尾に "b" が無い）が
    //      含まれていることを確認した上で実行する
    //   4. 数秒待っても VS Code 全体が無応答にならず、「入力されたパターン
    //      の処理に時間がかかりすぎたため中断しました」という警告が表示
    //      され、ビューが開かれないことを確認する
    //
    // ここでは、安全な（破局的でない）パターンに極端に短い timeoutMs を
    // 与えることで、「マッチングが時間内に終わらなかった場合に
    // Worker#terminate() で打ち切り、ok: false を返す」という同じコード
    // パス（filterByIgnorePattern.ts の setTimeout ハンドラ）を、危険な
    // 正規表現なしに決定的に検証する。ワーカースレッドの起動（新しい
    // V8 isolate の生成を伴う）は 1ms よりも確実に時間がかかるため、
    // timeoutMs: 1 は通常のマッチング処理より先に必ず発火する。
    const text = "2024-01-02T03:04:05Z INFO hello";
    const entries = parseLog(text);

    const startedAt = Date.now();
    const result = await filterEntriesByIgnorePattern(entries, /hello/, {
      timeoutMs: 1,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.reason, "timeout");
    }
    // タイムアウトによって早期に打ち切られていること（＝拡張ホストを
    // ブロックし続けない）ことの確認。ワーカーの起動・終了コストを見込んで
    // 余裕を持たせる。
    assert.ok(elapsedMs < 4000, `expected an early termination, took ${elapsedMs}ms`);
  });
});

suite("normalize / formatMaskedLogForCompare", () => {
  test("replaces a recognized timestamp with a fixed placeholder", () => {
    const output = formatMaskedLogForCompare(parseLog("2024-01-02T03:04:05Z ERROR boom"));
    assert.strictEqual(output, "1 | <TIMESTAMP> ERROR boom");
  });

  test("masks IPv4 addresses anywhere in the message", () => {
    const output = formatMaskedLogForCompare(
      parseLog("2024-01-02T03:04:05Z INFO connect to 192.168.1.10 failed")
    );
    assert.strictEqual(output, "1 | <TIMESTAMP> INFO connect to <HOST> failed");
  });

  test("masks the RFC3164 hostname token for syslog-format entries", () => {
    const entries = parseLog("Jan  2 03:04:05 web01 myapp: something happened", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });
    const output = formatMaskedLogForCompare(entries);
    assert.strictEqual(output, "1 | <TIMESTAMP> - <HOST> myapp: something happened");
  });

  test("masks a fully expanded IPv6 address anywhere in the message", () => {
    const output = formatMaskedLogForCompare(
      parseLog("2024-01-02T03:04:05Z INFO connect to 2001:0db8:0000:0000:0000:0000:0000:0001 failed")
    );
    assert.strictEqual(output, "1 | <TIMESTAMP> INFO connect to <HOST> failed");
  });

  test("masks a :: -compressed IPv6 address anywhere in the message", () => {
    const output = formatMaskedLogForCompare(
      parseLog("2024-01-02T03:04:05Z INFO connect to 2001:db8::1 failed")
    );
    assert.strictEqual(output, "1 | <TIMESTAMP> INFO connect to <HOST> failed");
  });

  test("masks a zone-id-qualified link-local IPv6 address", () => {
    const output = formatMaskedLogForCompare(
      parseLog("2024-01-02T03:04:05Z INFO connect to fe80::1%eth0 failed")
    );
    assert.strictEqual(output, "1 | <TIMESTAMP> INFO connect to <HOST> failed");
  });

  test("does not mask a time-like token embedded in the message", () => {
    const output = formatMaskedLogForCompare(
      parseLog("2024-01-02T03:04:05Z INFO retry backoff 03:04:05 elapsed")
    );
    assert.strictEqual(output, "1 | <TIMESTAMP> INFO retry backoff 03:04:05 elapsed");
  });

  test("does not mask dotted tokens that are not IPv4 addresses or syslog hostnames", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR Unhandled exception",
      "    at com.example.Foo.bar(Foo.java:42)",
    ].join("\n");

    const output = formatMaskedLogForCompare(parseLog(text));

    assert.strictEqual(
      output,
      ["1 | <TIMESTAMP> ERROR Unhandled exception", "2 |     at com.example.Foo.bar(Foo.java:42)"].join(
        "\n"
      )
    );
  });

  test("passes unrecognized lines through unmasked aside from IPv4 addresses", () => {
    const output = formatMaskedLogForCompare(parseLog("==== log start on 10.0.0.1 ===="));
    assert.strictEqual(output, "1 | ==== log start on <HOST> ====");
  });

  test("does not mask a dotted 4-number token whose octets are out of IPv4 range", () => {
    const output = formatMaskedLogForCompare(
      parseLog("2024-01-02T03:04:05Z INFO build 999.999.999.999 deployed")
    );
    assert.strictEqual(output, "1 | <TIMESTAMP> INFO build 999.999.999.999 deployed");
  });

  test("keeps original line numbers aligned across multi-line entries", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR Unhandled exception",
      "java.lang.NullPointerException",
      "2024-01-02T03:04:06Z INFO recovered",
    ].join("\n");

    const output = formatMaskedLogForCompare(parseLog(text));

    assert.strictEqual(
      output,
      [
        "1 | <TIMESTAMP> ERROR Unhandled exception",
        "2 | java.lang.NullPointerException",
        "3 | <TIMESTAMP> INFO recovered",
      ].join("\n")
    );
  });

  test("returns an empty string for no entries", () => {
    assert.strictEqual(formatMaskedLogForCompare([]), "");
  });
});

suite("normalize / maskLogTextForCopy", () => {
  test("replaces a recognized timestamp in place, keeping the surrounding raw text", () => {
    const entries = parseLog("[2024-01-02 03:04:05,678] INFO Starting up");
    assert.strictEqual(maskLogTextForCopy(entries), "<TIMESTAMP> INFO Starting up");
  });

  test("masks IPv4 addresses anywhere in the text, including unmatched banner lines", () => {
    const text = [
      "==== log start on 10.0.0.1 ====",
      "2024-01-02T03:04:05Z INFO connect to 192.168.1.10 failed",
    ].join("\n");

    const output = maskLogTextForCopy(parseLog(text));

    assert.strictEqual(
      output,
      ["==== log start on <HOST> ====", "<TIMESTAMP> INFO connect to <HOST> failed"].join("\n")
    );
  });

  test("masks the RFC3164 hostname token in place, preserving surrounding whitespace", () => {
    const entries = parseLog("Jan  2 03:04:05  web01 myapp: hello", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });

    assert.strictEqual(maskLogTextForCopy(entries), "<TIMESTAMP>  <HOST> myapp: hello");
  });

  test("masks IPv6 addresses (full, :: -compressed, and zone-id forms) in the text", () => {
    const text = [
      "==== log start on 2001:0db8:0000:0000:0000:0000:0000:0001 ====",
      "2024-01-02T03:04:05Z INFO connect to 2001:db8::1 failed",
      "2024-01-02T03:04:06Z INFO connect to fe80::1%eth0 failed",
    ].join("\n");

    const output = maskLogTextForCopy(parseLog(text));

    assert.strictEqual(
      output,
      [
        "==== log start on <HOST> ====",
        "<TIMESTAMP> INFO connect to <HOST> failed",
        "<TIMESTAMP> INFO connect to <HOST> failed",
      ].join("\n")
    );
  });

  test("does not mask a time-like token embedded in the text", () => {
    const text = "2024-01-02T03:04:05Z INFO retry backoff 03:04:05 elapsed";
    assert.strictEqual(maskLogTextForCopy(parseLog(text)), "<TIMESTAMP> INFO retry backoff 03:04:05 elapsed");
  });

  test("keeps the original timestamp text when maskTimestamp is false", () => {
    const entries = parseLog("2024-01-02T03:04:05Z ERROR boom");
    assert.strictEqual(
      maskLogTextForCopy(entries, { maskTimestamp: false }),
      "2024-01-02T03:04:05Z ERROR boom"
    );
  });

  test("keeps IPv4 addresses and syslog hostnames unmasked when maskHost is false", () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO connect to 192.168.1.10 failed");
    assert.strictEqual(
      maskLogTextForCopy(entries, { maskHost: false }),
      "<TIMESTAMP> INFO connect to 192.168.1.10 failed"
    );
  });

  test("preserves multi-line raw structure, masking IPv4 addresses in continuation lines", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR Unhandled exception",
      "    at com.example.Foo.bar(10.0.0.5:42)",
    ].join("\n");

    const output = maskLogTextForCopy(parseLog(text));

    assert.strictEqual(
      output,
      ["<TIMESTAMP> ERROR Unhandled exception", "    at com.example.Foo.bar(<HOST>:42)"].join("\n")
    );
  });

  test("passes unrecognized lines through unless they contain an IPv4 address", () => {
    assert.strictEqual(maskLogTextForCopy(parseLog("==== banner ====")), "==== banner ====");
  });

  test("returns an empty string for no entries", () => {
    assert.strictEqual(maskLogTextForCopy([]), "");
  });
});

suite("normalize / collapseRepeatedEntries", () => {
  function repeatedEntriesText(count: number, startSecond = 5): string {
    return Array.from({ length: count }, (_, i) =>
      `2024-01-02T03:04:${String(startSecond + i).padStart(2, "0")}Z INFO connect ok`
    ).join("\n");
  }

  test("groups consecutive entries with identical messages once the threshold is met", () => {
    const entries = parseLog(repeatedEntriesText(3));
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    assert.strictEqual(items[0].kind === "group" ? items[0].entries.length : 0, 3);
  });

  test("keeps entries below the threshold ungrouped", () => {
    const entries = parseLog(repeatedEntriesText(3));
    const items = collapseRepeatedEntries(entries, { threshold: 4 });

    assert.strictEqual(items.length, 3);
    assert.ok(items.every((item) => item.kind === "single"));
  });

  test("does not merge non-consecutive repeats separated by a different entry", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO A",
      "2024-01-02T03:04:06Z INFO A",
      "2024-01-02T03:04:07Z INFO B",
      "2024-01-02T03:04:08Z INFO A",
    ].join("\n");
    const entries = parseLog(text);

    const items = collapseRepeatedEntries(entries, { threshold: 2 });

    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0].kind, "group");
    assert.strictEqual(items[0].kind === "group" ? items[0].entries.length : 0, 2);
    assert.strictEqual(items[1].kind, "single");
    assert.strictEqual(items[1].kind === "single" ? items[1].entry.message : "", "B");
    assert.strictEqual(items[2].kind, "single");
    assert.strictEqual(items[2].kind === "single" ? items[2].entry.message : "", "A");
  });

  test("treats entries differing only by a masked IPv4 address as repeats", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR connect to 192.168.1.10 failed",
      "2024-01-02T03:04:06Z ERROR connect to 192.168.1.11 failed",
    ].join("\n");
    const entries = parseLog(text);

    const items = collapseRepeatedEntries(entries, { threshold: 2 });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    assert.strictEqual(items[0].kind === "group" ? items[0].entries.length : 0, 2);
  });

  test("does not merge entries with different severities even when the message matches", () => {
    const text = ["2024-01-02T03:04:05Z INFO boom", "2024-01-02T03:04:06Z ERROR boom"].join("\n");
    const entries = parseLog(text);

    const items = collapseRepeatedEntries(entries, { threshold: 2 });

    assert.strictEqual(items.length, 2);
    assert.ok(items.every((item) => item.kind === "single"));
  });

  test("returns an empty array for no entries", () => {
    assert.deepStrictEqual(collapseRepeatedEntries([]), []);
  });
});

suite("normalize / formatCollapsedLog", () => {
  test("renders a collapsed group with a line-range gutter and repeat count suffix", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:06Z INFO connect ok",
      "2024-01-02T03:04:07Z INFO connect ok",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      "1-3 | 2024-01-02T03:04:05.000Z INFO connect ok (×3)"
    );
  });

  test("renders ungrouped entries exactly like formatNormalizedLog", () => {
    const entries = parseLog("2024-01-02T03:04:05Z ERROR boom");
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(formatCollapsedLog(entries, items), formatNormalizedLog(entries));
  });

  test("widens the gutter to fit a line-range label wider than the max plain line number", () => {
    const text = [
      "==== banner ====",
      "2024-01-02T03:04:05Z INFO ok",
      "2024-01-02T03:04:06Z INFO ok",
      "2024-01-02T03:04:07Z INFO ok",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      ["  1 | ==== banner ====", "2-4 | 2024-01-02T03:04:05.000Z INFO ok (×3)"].join("\n")
    );
  });

  test("extends the range label through the last entry's continuation lines", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:06Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:07Z ERROR boom",
      "  detail",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      ["1-6 | 2024-01-02T03:04:05.000Z ERROR boom (×3)", "  2 |   detail"].join("\n")
    );
  });

  test("returns an empty string for no entries", () => {
    assert.strictEqual(formatCollapsedLog([], []), "");
  });
});

suite("normalize / deriveLogKind", () => {
  test("strips the extension and a trailing YYYYMMDD date suffix", () => {
    assert.strictEqual(deriveLogKind("message_20240101.log"), "message");
  });

  test("strips a trailing hyphen-separated date suffix", () => {
    assert.strictEqual(deriveLogKind("app-2024-01-02.txt"), "app");
  });

  test("strips a trailing date+time suffix", () => {
    assert.strictEqual(deriveLogKind("server_20240101_1200.log"), "server");
  });

  test("falls back to the extension-stripped name when there is no date suffix", () => {
    assert.strictEqual(deriveLogKind("readme.log"), "readme");
  });

  test("falls back to the original name when stripping the date would leave nothing", () => {
    assert.strictEqual(deriveLogKind("20240101.log"), "20240101");
  });

  test("keeps a leading dot intact for dotfiles with no other extension", () => {
    assert.strictEqual(deriveLogKind(".env"), ".env");
  });
});

suite("normalize / mergeLogFiles", () => {
  test("interleaves entries from multiple files in chronological order, regardless of input order", () => {
    const merged = mergeLogFiles([
      {
        fileName: "b.log",
        text: [
          "2024-01-02T03:04:05Z INFO first",
          "2024-01-02T03:04:06Z INFO second",
        ].join("\n"),
      },
      { fileName: "a.log", text: "2024-01-02T03:04:07Z INFO third" },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["first", "second", "third"]
    );
    assert.deepStrictEqual(
      merged.map((m) => m.fileName),
      ["b.log", "b.log", "a.log"]
    );
  });

  test("tags each entry with the kind derived from its source file name", () => {
    const merged = mergeLogFiles([
      { fileName: "message_20240101.log", text: "2024-01-02T03:04:05Z INFO hello" },
    ]);

    assert.strictEqual(merged[0].fileName, "message_20240101.log");
    assert.strictEqual(merged[0].kind, "message");
  });

  test("merges files that use different timestamp formats into true chronological order", () => {
    const merged = mergeLogFiles([
      { fileName: "bracketed.log", text: "[2024-01-02 03:04:07,000] INFO bracketed-later" },
      { fileName: "iso.log", text: "2024-01-02T03:04:05Z INFO iso-earlier" },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["iso-earlier", "bracketed-later"]
    );
  });

  test("stable-sorts entries without a recognized timestamp to the end, preserving encounter order", () => {
    const merged = mergeLogFiles([
      { fileName: "a.log", text: ["banner A", "2024-01-02T03:04:05Z INFO a-real"].join("\n") },
      { fileName: "b.log", text: ["banner B", "2024-01-02T03:04:06Z INFO b-real"].join("\n") },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["a-real", "b-real", "banner A", "banner B"]
    );
  });

  test("merges year-crossing syslog files into true chronological order", () => {
    // 2026年1月に、12月分と1月分の syslog ファイルをマージするケース。
    // 年推定により「Dec 31」（2025年）が「Jan  1」（2026年）より前に並ぶ。
    const merged = mergeLogFiles(
      [
        { fileName: "jan.log", text: "Jan  1 00:30:00 host app: january" },
        { fileName: "dec.log", text: "Dec 31 23:30:00 host app: december" },
      ],
      {
        timestampFormats: [createSyslogFormat({ referenceTimeMs: Date.UTC(2026, 0, 15) })],
      }
    );

    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["host app: december", "host app: january"]
    );
  });

  test("returns an empty array for no files", () => {
    assert.deepStrictEqual(mergeLogFiles([]), []);
  });
});

suite("normalize / formatMergedLog", () => {
  test("renders fileName/kind columns padded and aligned, alongside the unified timestamp/gutter", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO hello" },
      { fileName: "database_20240101.log", text: "2024-01-02T03:04:04Z ERROR boom" },
    ]);

    const output = formatMergedLog(merged);

    const fileNameWidth = "database_20240101.log".length;
    const kindWidth = "database".length;
    const expected = [
      `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:04.000Z ERROR boom`,
      `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO hello`,
    ].join("\n");

    assert.strictEqual(output, expected);
  });

  test("blanks the fileName/kind columns on continuation lines, keeping per-line numbering", () => {
    const merged = mergeLogFiles([
      {
        fileName: "app.log",
        text: ["2024-01-02T03:04:05Z ERROR boom", "  at Foo.bar"].join("\n"),
      },
    ]);

    const output = formatMergedLog(merged);

    const fileNameWidth = "app.log".length;
    const kindWidth = "app".length;
    const expected = [
      `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z ERROR boom`,
      `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | 2 |   at Foo.bar`,
    ].join("\n");

    assert.strictEqual(output, expected);
  });

  test("returns an empty string for no entries", () => {
    assert.strictEqual(formatMergedLog([]), "");
  });
});
