import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseLog,
  createSyslogFormat,
  compileCustomTimestampFormats,
  formatNormalizedLog,
  formatMaskedLogForCompare,
  maskLogTextForCopy,
  maskProcessIds,
  maskEntriesByPatterns,
  maskMergedEntriesByPatterns,
  buildKeyMaskPattern,
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
  filterEntriesByMatchPattern,
  filterEntriesByCriteria,
  filterMergedEntriesByCriteria,
  filterMergedEntriesByFileIndex,
  isFileIndexVisible,
  SINGLE_FILE_INDEX,
  assessTimestampRecognition,
  assessTimestampRecognitionByFile,
  LOW_RECOGNITION_MIN_LINE_COUNT,
  LOW_RECOGNITION_RATIO_THRESHOLD,
  parseUtcOffsetMinutes,
  formatTimestampForDisplay,
  compileFileOffsetRules,
  resolveFileOffsetMinutes,
  compileClockSkewRules,
  resolveClockSkewMs,
  applyClockSkew,
  formatNormalizedLogWithLineSources,
  formatMergedLogWithLineSources,
  formatCollapsedLogWithLineSources,
  buildInteractivePayload,
  buildInteractiveMergedPayload,
  buildInteractiveCollapsedLines,
  buildInteractiveMergedCollapsedLines,
  collapseRepeatedMergedEntries,
  buildInteractiveExportText,
  buildInteractiveMergedExportText,
  limitInteractiveDisplay,
  compileHighlightRules,
  highlightDisplayLines,
  DEFAULT_HIGHLIGHT_COLOR,
} from "../../normalize";
import * as maskForCompare from "../../normalize/maskForCompare";

/**
 * ギャップ区切り行（`... | 30.5s gap`）の出現回数。単に "gap" を数えると、
 * ログ本文にその語が含まれるだけで数が合わなくなるため、秒数付きの形で数える。
 */
function countGapMarkers(output: string): number {
  return (output.match(/\d+(?:\.\d)?s gap/g) ?? []).length;
}

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

  test("recognizes severity after a bracketed thread-name token (log4j %d [%t] %-5p layout)", () => {
    const [entry] = parseLog("2024-01-02 03:04:05 [main] INFO com.example.App - started");
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "com.example.App - started");
  });

  test("still recognizes severity immediately after the timestamp when no thread token is present", () => {
    const [entry] = parseLog("2024-01-02 03:04:05 ERROR no thread token");
    assert.strictEqual(entry.severity, "ERROR");
    assert.strictEqual(entry.message, "no thread token");
  });

  test("does not treat a severity-like word beyond the skip limit as the severity", () => {
    const [entry] = parseLog(
      "2024-01-02 03:04:05 [main] [com.example.App] started, INFO was logged"
    );
    assert.strictEqual(entry.severity, undefined);
    assert.strictEqual(entry.message, "[main] [com.example.App] started, INFO was logged");
  });

  test("applies a UTC offset when present", () => {
    const [entry] = parseLog("2024-01-02T03:04:05+09:00 INFO hello");
    // 03:04:05+09:00 is 18:04:05 the previous day in UTC.
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
  });

  test("right-pads a one-digit fractional second to milliseconds", () => {
    const [entry] = parseLog("2024-01-02T03:04:05.5Z INFO hello");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 500));
  });

  test("applies a UTC offset with .NET-style 7-digit fractional seconds (#94)", () => {
    const [entry] = parseLog("2024-01-02T03:04:05.1234567+09:00 INFO hello");
    // タイムゾーンオフセットが正しく読まれていれば前日18時台になる。
    // 落ちていると UTC のまま扱われ 03:04:05 台に留まってしまう。
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5, 123));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "hello");
  });

  test("applies a UTC offset with Go RFC3339Nano-style 9-digit fractional seconds (#94)", () => {
    const [entry] = parseLog("2024-01-02T03:04:05.123456789+09:00 INFO hello");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5, 123));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "hello");
  });

  test("recognizes a Z-suffixed timestamp with 9-digit fractional seconds without leaking leftover digits into the message (#94)", () => {
    const [entry] = parseLog("2024-01-02T03:04:05.123456789Z INFO hello");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 123));
    assert.strictEqual(entry.message, "hello");
  });

  test("applies a UTC offset with 7-digit fractional seconds for bracketed ISO timestamps (#94)", () => {
    const [entry] = parseLog("[2024-01-02 03:04:05.1234567+09:00] INFO hello");
    assert.strictEqual(entry.timestampFormat, "bracketed-iso8601");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5, 123));
    assert.strictEqual(entry.message, "hello");
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

  test("rejects out-of-range time components and UTC offsets across built-in formats", () => {
    const invalidLines = [
      "2024-01-02T24:04:05Z invalid ISO hour",
      "[2024-01-02 03:60:05] invalid bracketed minute",
      "2024/01/02 03:04:60 invalid slash-date second",
      "[02/Jan/2024:03:60:05 +0900] invalid Apache minute",
      "[02/Jan/2024:03:04:05 +9999] invalid Apache offset",
    ];

    for (const line of invalidLines) {
      const [entry] = parseLog(line);
      assert.strictEqual(entry.matched, false, line);
      assert.strictEqual(entry.timestampMs, undefined, line);
    }

    const [syslogEntry] = parseLog("Jan  2 03:04:60 invalid syslog second", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });
    assert.strictEqual(syslogEntry.matched, false);
    assert.strictEqual(syslogEntry.timestampMs, undefined);
  });

  test("recognizes valid time and UTC-offset boundary values across built-in formats", () => {
    const validLines = [
      "2024-01-02T23:59:59.999999999Z valid ISO boundary",
      "[2024-01-02 23:59:59,5+14:00] valid bracketed boundary",
      "2024/01/02 23:59:59.5 valid slash-date boundary",
      "[02/Jan/2024:23:59:59 +1400] valid Apache boundary",
    ];

    for (const line of validLines) {
      const [entry] = parseLog(line);
      assert.strictEqual(entry.matched, true, line);
      assert.notStrictEqual(entry.timestampMs, undefined, line);
    }

    const [syslogEntry] = parseLog("Jan  2 23:59:59 valid syslog boundary", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });
    assert.strictEqual(syslogEntry.matched, true);
    assert.strictEqual(syslogEntry.timestampMs, Date.UTC(2024, 0, 2, 23, 59, 59));
  });
});

suite("normalize / parseLog JSON Lines (#300)", () => {
  const JSON_LINE =
    '{"ts":"2024-01-02T03:04:05.678Z","level":"info","msg":"request completed","dur_ms":250}';

  test("reads the timestamp, level and message out of a JSON Lines record", () => {
    const [entry] = parseLog(JSON_LINE);

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "json-lines");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
    assert.strictEqual(entry.rawTimestamp, "2024-01-02T03:04:05.678Z");
    assert.strictEqual(entry.severity, "INFO");
  });

  test("keeps the original JSON line in raw", () => {
    const [entry] = parseLog(JSON_LINE);

    assert.strictEqual(entry.raw, JSON_LINE);
  });

  test("appends the remaining fields to the message as key=value", () => {
    const [entry] = parseLog(JSON_LINE);

    assert.strictEqual(entry.message, "request completed dur_ms=250");
  });

  test("renders spilled-over values in a form that stays greppable", () => {
    const [entry] = parseLog(
      '{"ts":"2024-01-02T03:04:05Z","msg":"done","host":"db-01","note":"two words",' +
        '"retries":null,"meta":{"a":1}}'
    );

    assert.strictEqual(
      entry.message,
      'done host=db-01 note="two words" retries=null meta={"a":1}'
    );
  });

  test("reads epoch timestamps written as numbers", () => {
    const [milliseconds] = parseLog('{"time":1704164645678,"msg":"ms"}');
    assert.strictEqual(milliseconds.timestampMs, 1704164645678);

    const [seconds] = parseLog('{"time":1704164645,"msg":"sec"}');
    assert.strictEqual(seconds.timestampMs, 1704164645000);

    const [fractional] = parseLog('{"time":1704164645.678,"msg":"float"}');
    assert.strictEqual(fractional.timestampMs, 1704164645678);
  });

  test("normalizes the level the same way as plain-text severities", () => {
    const [warning] = parseLog('{"ts":"2024-01-02T03:04:05Z","level":"warning","msg":"x"}');
    assert.strictEqual(warning.severity, "WARN");

    const [err] = parseLog('{"ts":"2024-01-02T03:04:05Z","level":"err","msg":"x"}');
    assert.strictEqual(err.severity, "ERROR");
  });

  test("maps the numeric levels used by bunyan-style loggers", () => {
    const [info] = parseLog('{"ts":"2024-01-02T03:04:05Z","level":30,"msg":"x"}');
    assert.strictEqual(info.severity, "INFO");

    // 表にない数値レベル（pino のカスタムレベル等）は捨てずにそのまま残す。
    const [custom] = parseLog('{"ts":"2024-01-02T03:04:05Z","level":35,"msg":"x"}');
    assert.strictEqual(custom.severity, "35");
  });

  test("applies the source offset to a JSON timestamp written without a zone", () => {
    const [entry] = parseLog('{"ts":"2024-01-02 12:04:05","msg":"x"}', {
      sourceUtcOffsetMinutes: 540,
    });

    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("uses the first timestamp field in candidate order and keeps the others as data", () => {
    const [entry] = parseLog('{"t":"2020-01-01T00:00:00Z","time":"2024-01-02T03:04:05Z","msg":"x"}');

    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.message, "x t=2020-01-01T00:00:00Z");
  });

  test("keeps JSON that carries no usable timestamp as an unrecognized line", () => {
    for (const line of [
      '{"level":"info","msg":"no timestamp here"}',
      '{"ts":"abc","msg":"unparsable timestamp"}',
      "[1,2,3]",
    ]) {
      const [entry] = parseLog(line);
      assert.strictEqual(entry.matched, false, `${line} should stay unrecognized`);
      assert.strictEqual(entry.raw, line);
    }
  });

  test("treats a brace-prefixed line that is not JSON as a continuation line", () => {
    const entries = parseLog(
      ["2024-01-02T03:04:05Z ERROR dump follows", "{foo=bar, baz=qux}"].join("\n")
    );

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].lines.length, 2);
  });

  test("recognizes JSON and plain lines in the same file", () => {
    const entries = parseLog(
      [
        "==== starting ====",
        "2024-01-02T03:04:05Z INFO plain line",
        '{"ts":"2024-01-02T03:04:06Z","level":"error","msg":"json line"}',
        "2024-01-02T03:04:07Z INFO plain again",
      ].join("\n")
    );

    // 認識済みの行より前に出たバナーは、従来どおり単独の未認識エントリになる。
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].matched, false);
    assert.strictEqual(entries[1].timestampFormat, "iso8601");
    assert.strictEqual(entries[2].timestampFormat, "json-lines");
    assert.strictEqual(entries[2].severity, "ERROR");
    assert.strictEqual(entries[3].timestampFormat, "iso8601");
  });

  test("sorts JSON Lines together with other formats when merged", () => {
    const merged = mergeLogFiles([
      {
        fileName: "app.log",
        text: [
          "2024-01-02T03:04:04Z INFO before",
          "2024-01-02T03:04:06Z INFO after",
        ].join("\n"),
      },
      {
        fileName: "service.jsonl",
        text: '{"ts":"2024-01-02T03:04:05Z","level":"warn","msg":"between"}',
      },
    ]);

    assert.deepStrictEqual(
      merged.map((item) => item.fileName),
      ["app.log", "service.jsonl", "app.log"]
    );
  });

  test("supports severity filtering and date ranges over JSON Lines", () => {
    const entries = parseLog(
      [
        '{"ts":"2024-01-02T03:04:05Z","level":"info","msg":"one"}',
        '{"ts":"2024-01-03T03:04:05Z","level":"error","msg":"two"}',
      ].join("\n")
    );

    assert.deepStrictEqual(getDistinctSeverities(entries), ["INFO", "ERROR"]);
    assert.strictEqual(filterEntriesBySeverity(entries, new Set(["ERROR"])).length, 1);
    assert.strictEqual(
      filterEntriesByDateRange(entries, { startMs: Date.UTC(2024, 0, 3) }).length,
      1
    );
  });
});

suite("normalize / parseLog timestamps after leading fields (#301)", () => {
  const ACCESS_LOG_LINE =
    '10.0.0.1 - - [02/Jan/2024:03:04:05 +0900] "GET /health HTTP/1.1" 200 1234';

  test("recognizes a Common Log Format line whose timestamp follows the client fields", () => {
    const [entry] = parseLog(ACCESS_LOG_LINE);

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "apache-access-log");
    // 03:04:05+09:00 は UTC では前日の 18:04:05。
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
  });

  test("keeps the fields before the timestamp in the message", () => {
    const [entry] = parseLog(ACCESS_LOG_LINE);

    assert.strictEqual(entry.message, '10.0.0.1 - - "GET /health HTTP/1.1" 200 1234');
  });

  test("points rawTimestamp at the timestamp alone, not at the fields before it", () => {
    const [entry] = parseLog(ACCESS_LOG_LINE);

    assert.strictEqual(entry.rawTimestamp, "[02/Jan/2024:03:04:05 +0900]");
  });

  test("steps over several bracketed fields instead of swallowing the timestamp", () => {
    const [entry] = parseLog("[worker-3] [2024-01-02 03:04:05] job finished");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.rawTimestamp, "[2024-01-02 03:04:05]");
    assert.strictEqual(entry.message, "[worker-3] job finished");
  });

  test("steps over key=value fields placed before the timestamp", () => {
    const [entry] = parseLog("pid=1204 host=web01 2024-01-02T03:04:05Z INFO started");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "pid=1204 host=web01 started");
  });

  test("reads the severity after the timestamp only, leaving a leading level in the message", () => {
    // 前置きの中のセベリティは読まない（判定はタイムスタンプの直後だけ）。
    // 認識できずに行ごと落ちていた従来より良く、規則も1つで済むため。
    const [entry] = parseLog("[INFO] 2024-01-02 03:04:05 app started");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, undefined);
    assert.strictEqual(entry.message, "[INFO] app started");
  });

  test("interleaves an access log with an application log when merged", () => {
    const merged = mergeLogFiles([
      {
        fileName: "app.log",
        text: [
          "2024-01-01T18:04:00Z INFO before the request",
          "2024-01-01T18:04:10Z INFO after the request",
        ].join("\n"),
      },
      { fileName: "access.log", text: ACCESS_LOG_LINE },
    ]);

    assert.deepStrictEqual(
      merged.map((item) => item.fileName),
      ["app.log", "access.log", "app.log"]
    );
  });

  test("does not turn a bare number-heavy line into an entry of its own", () => {
    // 20桁の数字は EPOCH の `\d{10}(?!\d)` に後ろ10桁が当たりうる。前置きとして
    // 読み飛ばした後の位置にも数字が残らないため、未マッチのままであること。
    const entries = parseLog("ts=99999999999999999999 WARNING out-of-range epoch");

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].matched, false);
  });

  test("keeps a continuation line that mentions a date inside the same entry", () => {
    const entries = parseLog(
      [
        "2024-01-02T03:04:05Z ERROR request failed",
        "  see 2024-01-02T03:04:05Z for details",
      ].join("\n")
    );

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].lines.length, 2);
  });

  test("does not change how the bundled demo logs are split into entries", () => {
    // 走査位置を緩めた副作用でエントリが割れていないことを、実物のログで押さえる
    // （スタックトレースの継続行・バナー行を含む）。
    const demoRoot = path.resolve(__dirname, "../../..", "demo");
    const counts: Record<string, number> = {
      "sample.log": 29,
      "large-sample.log": 96,
    };

    for (const [fileName, expected] of Object.entries(counts)) {
      const text = fs.readFileSync(path.join(demoRoot, fileName), "utf8");
      assert.strictEqual(parseLog(text).length, expected, `${fileName} entry count`);
    }
  });
});

suite("normalize / parseLog severity vocabulary (#302)", () => {
  test("recognizes syslog severity names, keeping the spelling written in the log", () => {
    for (const token of ["NOTICE", "EMERG", "ALERT", "SEVERE", "VERBOSE", "PANIC"]) {
      const [entry] = parseLog(`2024-01-02T03:04:05Z ${token} something happened`);
      assert.strictEqual(entry.severity, token, `${token} should be recognized`);
      assert.strictEqual(entry.message, "something happened");
    }
  });

  test("normalizes the syslog abbreviations that have a longer built-in spelling", () => {
    const [err] = parseLog("2024-01-02T03:04:05Z ERR connection refused");
    assert.strictEqual(err.severity, "ERROR");
    assert.strictEqual(err.message, "connection refused");

    const [crit] = parseLog("2024-01-02T03:04:05Z CRIT disk failure");
    assert.strictEqual(crit.severity, "CRITICAL");
    assert.strictEqual(crit.message, "disk failure");
  });

  test("does not confuse an abbreviation with its longer spelling", () => {
    // 長いトークンを先に試していないと `ERROR` が `ERR` として食われ、
    // message に `OR ...` が残る。両方向を message まで見て固定する。
    const [error] = parseLog("2024-01-02T03:04:05Z ERROR connection refused");
    assert.strictEqual(error.severity, "ERROR");
    assert.strictEqual(error.message, "connection refused");

    const [critical] = parseLog("2024-01-02T03:04:05Z CRITICAL disk failure");
    assert.strictEqual(critical.severity, "CRITICAL");
    assert.strictEqual(critical.message, "disk failure");
  });

  test("keeps normalizing WARNING to WARN", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z WARNING disk usage at 85%");
    assert.strictEqual(entry.severity, "WARN");
    assert.strictEqual(entry.message, "disk usage at 85%");
  });

  test("recognizes extra tokens supplied by the caller", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z NOTICE2 internal level", {
      severityTokens: ["NOTICE2"],
    });

    assert.strictEqual(entry.severity, "NOTICE2");
    assert.strictEqual(entry.message, "internal level");
  });

  test("keeps the built-in tokens when extra tokens are supplied", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z INFO still built in", {
      severityTokens: ["NOTICE2"],
    });

    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "still built in");
  });

  test("does not let an extra token shadow a built-in one that starts the same way", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z NOTICE plain notice", {
      severityTokens: ["NOTICE2"],
    });

    assert.strictEqual(entry.severity, "NOTICE");
    assert.strictEqual(entry.message, "plain notice");
  });

  test("treats extra tokens as literal text rather than as a regular expression", () => {
    const [literal] = parseLog("2024-01-02T03:04:05Z LEVEL.1 literal token", {
      severityTokens: ["LEVEL.1"],
    });
    assert.strictEqual(literal.severity, "LEVEL.1");
    assert.strictEqual(literal.message, "literal token");

    // エスケープしていないと `.` が任意の1文字として効き、`LEVELX1` まで拾う。
    const [unrelated] = parseLog("2024-01-02T03:04:05Z LEVELX1 unrelated token", {
      severityTokens: ["LEVEL.1"],
    });
    assert.strictEqual(unrelated.severity, undefined);
    assert.strictEqual(unrelated.message, "LEVELX1 unrelated token");
  });

  test("ignores blank extra tokens instead of matching every line", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z plain message", {
      severityTokens: ["", "   "],
    });

    assert.strictEqual(entry.severity, undefined);
    assert.strictEqual(entry.message, "plain message");
  });
});

suite("normalize / parseLog ISO 8601 timezone designators (#297)", () => {
  test("applies an hour-only UTC offset", () => {
    const [entry] = parseLog("2024-01-02T03:04:05+09 INFO msg");

    // オフセットが読めていれば +09:00 表記と同じ前日18時台になる。落ちていると
    // UTC 扱いのまま 03:04:05 に留まり、`+09 ` が message へ漏れる。
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "msg");
  });

  test("applies a negative hour-only UTC offset", () => {
    const [entry] = parseLog("2024-01-02T03:04:05-05 INFO msg");

    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 8, 4, 5));
    assert.strictEqual(entry.message, "msg");
  });

  test("applies an hour-only UTC offset in bracketed timestamps", () => {
    const [entry] = parseLog("[2024-01-02 03:04:05+09] INFO msg");

    assert.strictEqual(entry.timestampFormat, "bracketed-iso8601");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
    assert.strictEqual(entry.message, "msg");
  });

  test("treats a lowercase z as an explicit UTC designator", () => {
    const [entry] = parseLog("2024-01-02T03:04:05z INFO msg", {
      sourceUtcOffsetMinutes: 540,
    });

    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "msg");
  });

  test("keeps accepting colonless, colon-separated and Z offsets", () => {
    const [colonless] = parseLog("2024-01-02T03:04:05+0900 INFO msg");
    assert.strictEqual(colonless.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
    assert.strictEqual(colonless.message, "msg");

    const [withColon] = parseLog("2024-01-02T03:04:05+09:00 INFO msg");
    assert.strictEqual(withColon.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));

    const [zulu] = parseLog("2024-01-02T03:04:05Z INFO msg", {
      sourceUtcOffsetMinutes: 540,
    });
    assert.strictEqual(zulu.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));

    const [naive] = parseLog("2024-01-02T03:04:05 INFO msg", {
      sourceUtcOffsetMinutes: 540,
    });
    assert.strictEqual(naive.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
  });
});

suite("normalize / timestampFormats (built-in additions, #100)", () => {
  test("parses slash-separated dates", () => {
    const [entry] = parseLog("2024/01/02 03:04:05 INFO hello");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "slash-date");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "hello");
  });

  test("parses slash-separated dates with single-digit month/day/hour", () => {
    const [entry] = parseLog("2024/1/2 3:04:05 WARN low disk");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, "WARN");
  });

  test("parses slash-separated dates with fractional seconds", () => {
    const [entry] = parseLog("2024/01/02 03:04:05.678 message body");

    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
    assert.strictEqual(entry.message, "message body");
  });

  test("rejects invalid slash-separated calendar dates", () => {
    const [entry] = parseLog("2024/13/02 03:04:05 boom");
    assert.strictEqual(entry.matched, false);
  });

  test("parses Apache/Nginx access-log timestamps with a UTC offset", () => {
    const [entry] = parseLog('[02/Jan/2024:03:04:05 +0900] "GET / HTTP/1.1" 200 123');

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "apache-access-log");
    // 03:04:05+09:00 は UTC では前日の 18:04:05。
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
    assert.strictEqual(entry.message, '"GET / HTTP/1.1" 200 123');
  });

  test("parses Apache/Nginx access-log timestamps without an offset as UTC", () => {
    const [entry] = parseLog("[02/Jan/2024:03:04:05] request done");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("rejects an Apache/Nginx access-log timestamp with an unknown month abbreviation", () => {
    const [entry] = parseLog("[02/Foo/2024:03:04:05 +0900] request done");
    assert.strictEqual(entry.matched, false);
  });

  test("parses 10-digit epoch seconds at the start of a line", () => {
    const [entry] = parseLog("1704164645 INFO hello");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "epoch");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "hello");
  });

  test("parses 13-digit epoch milliseconds at the start of a line", () => {
    const [entry] = parseLog("1704164645678 ERROR boom");

    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
    assert.strictEqual(entry.severity, "ERROR");
  });

  test("parses epoch seconds with a fractional part", () => {
    const [entry] = parseLog("1704164645.678 hello");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("does not treat an 11-digit number as an epoch timestamp", () => {
    const [entry] = parseLog("17041646456 hello");
    assert.strictEqual(entry.matched, false);
  });
});

suite("normalize / compileCustomTimestampFormats", () => {
  test("compiles a calendar-part pattern and parses matching lines", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      {
        name: "jp-date",
        pattern:
          "(?<y>\\d{4})年(?<mo>\\d{1,2})月(?<d>\\d{1,2})日 (?<h>\\d{1,2}):(?<mi>\\d{2}):(?<s>\\d{2})",
      },
    ]);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(formats.length, 1);

    const [entry] = parseLog("2024年1月2日 3:04:05 INFO hello", { timestampFormats: formats });
    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampFormat, "jp-date");
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(entry.severity, "INFO");
    assert.strictEqual(entry.message, "hello");
  });

  test("applies timezone capture groups in a custom pattern", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      {
        name: "with-tz",
        pattern:
          "(?<y>\\d{4})\\.(?<mo>\\d{2})\\.(?<d>\\d{2}) (?<h>\\d{2}):(?<mi>\\d{2}):(?<s>\\d{2}) (?<tzs>[+-])(?<tzh>\\d{2}):(?<tzm>\\d{2})",
      },
    ]);

    assert.deepStrictEqual(errors, []);
    const [entry] = parseLog("2024.01.02 03:04:05 +09:00 hello", { timestampFormats: formats });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
  });

  test("supports an epochMs capture group", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      { name: "epoch-ms", pattern: "ts=(?<epochMs>\\d{13})" },
    ]);

    assert.deepStrictEqual(errors, []);
    const [entry] = parseLog("ts=1704164645678 boom", { timestampFormats: formats });
    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("supports an epochSec capture group with an optional ms group", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      { name: "epoch-sec", pattern: "(?<epochSec>\\d{10})#(?<ms>\\d{3})" },
    ]);

    assert.deepStrictEqual(errors, []);
    const [entry] = parseLog("1704164645#678 hello", { timestampFormats: formats });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("anchors patterns to the start of the line even without a leading ^", () => {
    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-ms", pattern: "ts=(?<epochMs>\\d{13})" },
    ]);

    const [entry] = parseLog("prefix ts=1704164645678 boom", { timestampFormats: formats });
    assert.strictEqual(entry.matched, false);
  });

  test("rejects invalid calendar dates parsed by a custom pattern", () => {
    const { formats } = compileCustomTimestampFormats([
      {
        name: "jp-date",
        pattern:
          "(?<y>\\d{4})年(?<mo>\\d{1,2})月(?<d>\\d{1,2})日 (?<h>\\d{1,2}):(?<mi>\\d{2}):(?<s>\\d{2})",
      },
    ]);

    const [entry] = parseLog("2024年13月2日 3:04:05 boom", { timestampFormats: formats });
    assert.strictEqual(entry.matched, false);
  });

  test("rejects out-of-range time components and UTC offsets in custom calendar formats", () => {
    const { formats } = compileCustomTimestampFormats([
      {
        name: "custom-calendar",
        pattern:
          "(?<y>\\d{4})\\.(?<mo>\\d{2})\\.(?<d>\\d{2}) (?<h>\\d{2}):(?<mi>\\d{2}):(?<s>\\d{2})\\.(?<ms>\\d+) (?<tzs>[+-])(?<tzh>\\d{2}):(?<tzm>\\d{2})",
      },
    ]);

    for (const line of [
      "2024.01.02 03:60:00.123 +09:00 invalid minute",
      "2024.01.02 03:04:60.123 +09:00 invalid second",
      "2024.01.02 03:04:05.123 +99:99 invalid offset",
    ]) {
      const [entry] = parseLog(line, { timestampFormats: formats });
      assert.strictEqual(entry.matched, false, line);
      assert.strictEqual(entry.timestampMs, undefined, line);
    }

    const [invalidOffsetWithFallback] = parseLog(
      "2024.01.02 03:04:05.123 +99:99 invalid offset",
      { timestampFormats: formats, sourceUtcOffsetMinutes: 540 }
    );
    assert.strictEqual(invalidOffsetWithFallback.matched, false);
    assert.strictEqual(invalidOffsetWithFallback.timestampMs, undefined);

    const [boundary] = parseLog("2024.01.02 23:59:59.9999 +14:00 valid boundary", {
      timestampFormats: formats,
    });
    assert.strictEqual(boundary.matched, true);
    assert.strictEqual(boundary.timestampMs, Date.UTC(2024, 0, 2, 9, 59, 59, 999));
  });

  test("rejects epochMs values that cannot be represented as a Date", () => {
    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-ms", pattern: "ts=(?<epochMs>\\d+)" },
    ]);

    for (const line of ["ts=99999999999999999999 boom", "ts=8640000000000001 boom"]) {
      const [entry] = parseLog(line, { timestampFormats: formats });
      assert.strictEqual(entry.matched, false, line);
      assert.strictEqual(entry.timestampMs, undefined, line);
    }

    const [boundary] = parseLog("ts=8640000000000000 boom", { timestampFormats: formats });
    assert.strictEqual(boundary.matched, true);
    assert.strictEqual(boundary.timestampMs, 8640000000000000);
  });

  test("rejects epochSec values that cannot be represented as a Date", () => {
    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-sec", pattern: "(?<epochSec>\\d+)s" },
    ]);

    const [entry] = parseLog("99999999999999999999s boom", { timestampFormats: formats });
    assert.strictEqual(entry.matched, false);
    assert.strictEqual(entry.timestampMs, undefined);
  });

  test("rejects an epochSec ms group that is not a digit sequence", () => {
    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-sec", pattern: "(?<epochSec>\\d{10})#(?<ms>[^ ]+)" },
    ]);

    const [entry] = parseLog("1704164645#abc hello", { timestampFormats: formats });
    assert.strictEqual(entry.matched, false);
    assert.strictEqual(entry.timestampMs, undefined);

    const [valid] = parseLog("1704164645#678 hello", { timestampFormats: formats });
    assert.strictEqual(valid.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("keeps lines with an invalid custom epoch renderable as unrecognized lines", () => {
    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-ms", pattern: "ts=(?<epochMs>\\d+)" },
    ]);

    const entries = parseLog("ts=99999999999999999999 boom\nts=1704164645678 ok", {
      timestampFormats: formats,
    });

    const output = formatNormalizedLog(entries);
    assert.ok(output.includes("ts=99999999999999999999 boom"));
    assert.ok(output.includes("2024-01-02T03:04:05.678Z"));
  });

  test("uses a positional fallback name when name is omitted", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      { pattern: "(?<epochMs>\\d{13})" },
    ]);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(formats[0].name, "custom-1");
  });

  test("reports an error for an invalid regular expression", () => {
    const { formats, errors } = compileCustomTimestampFormats([{ name: "broken", pattern: "(" }]);

    assert.strictEqual(formats.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.deepStrictEqual(
      { code: errors[0].code, name: "name" in errors[0] ? errors[0].name : undefined },
      { code: "invalidNamedRegex", name: "broken" }
    );
  });

  test("reports an error when required capture groups are missing", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      { name: "no-groups", pattern: "\\d+" },
    ]);

    assert.strictEqual(formats.length, 0);
    assert.strictEqual(errors.length, 1);
  });

  test("reports an error for entries that are not objects with a string pattern", () => {
    const { formats, errors } = compileCustomTimestampFormats(["oops", { name: "no-pattern" }]);

    assert.strictEqual(formats.length, 0);
    assert.strictEqual(errors.length, 2);
  });

  test("keeps valid entries while reporting invalid ones", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      { name: "broken", pattern: "(" },
      { name: "ok", pattern: "(?<epochMs>\\d{13})" },
    ]);

    assert.strictEqual(formats.length, 1);
    assert.strictEqual(formats[0].name, "ok");
    assert.strictEqual(errors.length, 1);
  });

  test("returns no formats and no errors for an empty setting", () => {
    const { formats, errors } = compileCustomTimestampFormats([]);
    assert.deepStrictEqual(formats, []);
    assert.deepStrictEqual(errors, []);
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
        "2 |                                java.lang.NullPointerException",
        "3 |                                    at com.example.Foo.bar(Foo.java:42)",
        "4 | 2024-01-02T03:04:06.000Z INFO  recovered",
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

    assert.strictEqual(countGapMarkers(output), 0);
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
        "... | 30s gap",
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

    assert.strictEqual(countGapMarkers(output), 0);
  });

  test("formats a sub-second-precision gap duration with one decimal place", () => {
    const text = [
      "2024-01-02T03:04:05.000Z INFO before",
      "2024-01-02T03:04:35.500Z INFO after",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.ok(output.includes("30.5s gap"));
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

    assert.strictEqual(countGapMarkers(output), 1);
    assert.ok(output.includes("60s gap"));
  });

  test("treats a gapThresholdMs of 0 as disabled", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO before",
      "2024-01-02T03:04:06Z INFO after",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 0 });

    assert.strictEqual(countGapMarkers(output), 0);
  });

  test("inserts multiple gap markers for multiple qualifying gaps", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO a",
      "2024-01-02T03:04:35Z INFO b",
      "2024-01-02T03:05:05Z INFO c",
    ].join("\n");

    const output = formatNormalizedLog(parseLog(text), { gapThresholdMs: 30_000 });

    assert.strictEqual(countGapMarkers(output), 2);
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
  test("parseDateBoundary parses a date-only start boundary as UTC midnight", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02", "start"),
      Date.UTC(2024, 0, 2, 0, 0, 0, 0)
    );
  });

  test("parseDateBoundary parses a date-only end boundary as the last instant of that day (issue #93)", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02", "end"),
      Date.UTC(2024, 0, 2, 23, 59, 59, 999)
    );
  });

  test("parseDateBoundary parses a date and time string as UTC regardless of boundary kind", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02T03:04:05", "start"),
      Date.UTC(2024, 0, 2, 3, 4, 5)
    );
    assert.strictEqual(
      parseDateBoundary("2024-01-02T03:04:05", "end"),
      Date.UTC(2024, 0, 2, 3, 4, 5)
    );
    assert.strictEqual(
      parseDateBoundary("2024-01-02 03:04", "start"),
      Date.UTC(2024, 0, 2, 3, 4, 0)
    );
    assert.strictEqual(
      parseDateBoundary("2024-01-02 03:04", "end"),
      Date.UTC(2024, 0, 2, 3, 4, 0)
    );
  });

  test("parseDateBoundary interprets wall-clock input in a fixed display offset (issue #134)", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02T12:04:05", "start", 9 * 60),
      Date.UTC(2024, 0, 2, 3, 4, 5)
    );
  });

  test("parseDateBoundary completes date-only bounds in the fixed display offset (issue #134)", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02", "start", 9 * 60),
      Date.UTC(2024, 0, 1, 15, 0, 0, 0)
    );
    assert.strictEqual(
      parseDateBoundary("2024-01-02", "end", 9 * 60),
      Date.UTC(2024, 0, 2, 14, 59, 59, 999)
    );
  });

  test("parseDateBoundary interprets ordinary local wall-clock input in the host timezone (issue #134)", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02T12:04:05", "start", "local"),
      new Date(2024, 0, 2, 12, 4, 5, 0).getTime()
    );
  });

  test("parseDateBoundary completes a date-only local end boundary at the last instant", () => {
    assert.strictEqual(
      parseDateBoundary("2024-01-02", "end", "local"),
      new Date(2024, 0, 2, 23, 59, 59, 999).getTime()
    );
  });

  test("parseDateBoundary rejects invalid local calendar dates", () => {
    assert.strictEqual(parseDateBoundary("2024-02-30", "start", "local"), undefined);
  });

  test("parseDateBoundary returns undefined for an unrecognized or invalid string", () => {
    assert.strictEqual(parseDateBoundary("not a date", "start"), undefined);
    assert.strictEqual(parseDateBoundary("2024-02-30", "end"), undefined);
    assert.strictEqual(parseDateBoundary("2024-01-02T24:00:00", "start"), undefined);
    assert.strictEqual(parseDateBoundary("2024-01-02T03:60:00", "end"), undefined);
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

  test("filterEntriesByDateRange keeps a whole day when the end boundary is date-only (issue #93)", () => {
    const text = [
      "2024-01-02T00:00:00Z INFO start of day",
      "2024-01-02T23:59:59Z INFO end of day",
      "2024-01-03T00:00:00Z INFO next day",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = filterEntriesByDateRange(entries, {
      startMs: parseDateBoundary("2024-01-02", "start"),
      endMs: parseDateBoundary("2024-01-02", "end"),
    });

    assert.strictEqual(filtered.length, 2);
    assert.deepStrictEqual(
      filtered.map((entry) => entry.message),
      ["start of day", "end of day"]
    );
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
  async function filterOk(
    entries: Parameters<typeof filterEntriesByIgnorePattern>[0],
    patterns: readonly RegExp[]
  ) {
    const result = await filterEntriesByIgnorePattern(entries, patterns);
    assert.strictEqual(result.ok, true);
    return result.entries;
  }

  test("excludes entries whose raw text matches a metacharacter-free pattern (substring match)", async () => {
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat ok",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/heartbeat/i]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });

  test("excludes entries matching a regular expression pattern", async () => {
    const text = [
      "2024-01-02T03:04:05Z DEBUG verbose trace",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/^.*DEBUG.*$/im]);

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

    const filtered = await filterOk(entries, [/com\.example/]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "keep");
  });

  test("keeps every entry when nothing matches", async () => {
    const text = "2024-01-02T03:04:05Z INFO hello";
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/nope/]);

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

    const filtered = await filterOk(entries, [/heartbeat/g]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });

  test("returns quickly for a normal pattern against a moderately sized log (no perceptible slowdown)", async () => {
    const lines = [];
    for (let i = 0; i < 500; i += 1) {
      lines.push(`2024-01-02T03:04:05Z INFO message number ${String(i)}`);
    }
    const entries = parseLog(lines.join("\n"));

    const startedAt = Date.now();
    const filtered = await filterOk(entries, [/number 42$/]);
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(filtered.length, entries.length - 1);
    // ワーカースレッドの起動コストを含めても、通常のパターンは十分速く
    // 終わるべき（既定タイムアウトの 2000ms よりずっと短い）。
    assert.ok(elapsedMs < 1500, `expected a fast result, took ${String(elapsedMs)}ms`);
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
    const result = await filterEntriesByIgnorePattern(entries, [/hello/], {
      timeoutMs: 1,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
    // タイムアウトによって早期に打ち切られていること（＝拡張ホストを
    // ブロックし続けない）ことの確認。ワーカーの起動・終了コストを見込んで
    // 余裕を持たせる。
    assert.ok(elapsedMs < 4000, `expected an early termination, took ${String(elapsedMs)}ms`);
  });

  test("excludes an entry matching any one of several patterns (#206)", async () => {
    // 同じ欄の中は OR。交替正規表現を手で書かなくても、1件ずつ足せば同じ結果に
    // なることを固定する。
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat ok",
      "2024-01-02T03:04:06Z DEBUG verbose trace",
      "2024-01-02T03:04:07Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/heartbeat/, /verbose/]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });

  test("keeps every entry when the pattern list is empty (#206)", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const filtered = await filterOk(entries, []);

    assert.strictEqual(filtered.length, 1);
  });

  test("evaluates each pattern independently even when one of them has a global flag (#206)", async () => {
    // 単一パターンのときと同じ lastIndex リセットが、パターンごとに効くこと。
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat one",
      "2024-01-02T03:04:06Z ERROR boom",
      "2024-01-02T03:04:07Z INFO heartbeat two",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/heartbeat/g, /nothing-matches/]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "boom");
  });
});

suite("normalize / filterEntriesByMatchPattern (#182)", () => {
  /** テストの意図（マッチ結果の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function filterOk(
    entries: Parameters<typeof filterEntriesByMatchPattern>[0],
    patterns: readonly RegExp[]
  ) {
    const result = await filterEntriesByMatchPattern(entries, patterns);
    assert.strictEqual(result.ok, true);
    return result.entries;
  }

  test("keeps only entries whose message matches a metacharacter-free pattern (substring match)", async () => {
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat ok",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/heartbeat/i]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "heartbeat ok");
  });

  test("keeps only entries matching a regular expression pattern", async () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR connection refused",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/^connection\b/im]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "connection refused");
  });

  test("keeps a multi-line entry (e.g. stack trace) if any of its continuation lines match", async () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "    at com.example.Foo.bar(Foo.java:42)",
      "2024-01-02T03:04:06Z INFO unrelated",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/com\.example/]);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message.startsWith("boom"), true);
  });

  test("matches the message only, not the timestamp or severity (#182 の設計判断)", async () => {
    // 一致パターンは無視パターン（entry.raw が対象）とあえて非対称にしている。
    // タイムスタンプ・セベリティは日付範囲欄とセベリティのチェックボックスで
    // 既に絞れるため、ここで当たるとノイズになる。
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "2024-01-02T03:04:06Z INFO ERROR-free startup",
    ].join("\n");
    const entries = parseLog(text);

    const bySeverityWord = await filterOk(entries, [/ERROR/i]);

    assert.strictEqual(bySeverityWord.length, 1);
    assert.strictEqual(bySeverityWord[0].message, "ERROR-free startup");

    const byTimestamp = await filterOk(entries, [/2024-01-02/]);

    assert.strictEqual(byTimestamp.length, 0);
  });

  test("drops every entry when nothing matches", async () => {
    const text = "2024-01-02T03:04:05Z INFO hello";
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/nope/]);

    assert.strictEqual(filtered.length, 0);
  });

  test("keeps every entry independently even when the pattern has a global flag", async () => {
    // g フラグ付きの RegExp#test は呼び出しのたびに lastIndex を進めるため、
    // リセットしないと1件目のマッチが2件目以降の判定を狂わせてしまう。
    const text = [
      "2024-01-02T03:04:05Z INFO heartbeat one",
      "2024-01-02T03:04:06Z ERROR boom",
      "2024-01-02T03:04:07Z INFO heartbeat two",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/heartbeat/g]);

    assert.strictEqual(filtered.length, 2);
    assert.deepStrictEqual(
      filtered.map((entry) => entry.message),
      ["heartbeat one", "heartbeat two"]
    );
  });

  test("returns an empty result without spawning a worker when there are no entries", async () => {
    const filtered = await filterOk([], [/anything/]);

    assert.deepStrictEqual(filtered, []);
  });

  test("terminates and reports a timeout instead of hanging forever when matching doesn't finish in time", async function () {
    this.timeout(5000);

    // 無視パターン側と同じ理由で、破局的バックトラッキングを起こす正規表現は
    // literal で置かず、安全なパターンに極端に短い timeoutMs を与えることで
    // 打ち切りのコードパスを決定的に検証する（filterByIgnorePattern の同名
    // テストのコメント参照）。
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const result = await filterEntriesByMatchPattern(entries, [/hello/], { timeoutMs: 1 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });

  test("keeps an entry matching any one of several patterns (#206)", async () => {
    // 無視パターン側と同じく、同じ欄の中は OR。
    const text = [
      "2024-01-02T03:04:05Z ERROR connection refused",
      "2024-01-02T03:04:06Z ERROR payment declined",
      "2024-01-02T03:04:07Z INFO unrelated",
    ].join("\n");
    const entries = parseLog(text);

    const filtered = await filterOk(entries, [/connection/, /payment/]);

    assert.deepStrictEqual(
      filtered.map((entry) => entry.message),
      ["connection refused", "payment declined"]
    );
  });

  test("keeps every entry when the pattern list is empty (#206)", async () => {
    // 一致パターンは「指定した場合だけ絞る」条件なので、空リストは
    // 「条件なし」＝全件通過。0件に絞ってしまうと、全ての行を消してしまう。
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const filtered = await filterOk(entries, []);

    assert.strictEqual(filtered.length, 1);
  });
});

suite("normalize / filterEntriesByCriteria", () => {
  /** テストの意図（絞り込み結果の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function filterOk(
    entries: Parameters<typeof filterEntriesByCriteria>[0],
    criteria: Parameters<typeof filterEntriesByCriteria>[1]
  ) {
    const result = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(result.ok, true);
    return result.entries;
  }

  const sampleText = [
    "2024-01-01T00:00:00Z ERROR before range",
    "2024-01-02T03:04:05Z INFO in range but wrong severity",
    "2024-01-02T03:04:06Z ERROR in range and matching",
    "2024-01-02T03:04:07Z ERROR heartbeat noise",
    "2024-01-03T00:00:00Z ERROR after range",
  ].join("\n");

  test("returns every entry unchanged when no criteria are specified", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, {});

    assert.strictEqual(filtered.length, entries.length);
  });

  test("applies only the severity filter when only severities are specified", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, { severities: new Set(["INFO"]) });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "in range but wrong severity");
  });

  test("applies only the date range filter when only a date range is specified", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, {
      dateRange: {
        startMs: Date.UTC(2024, 0, 2, 0, 0, 0),
        endMs: Date.UTC(2024, 0, 2, 23, 59, 59),
      },
    });

    assert.strictEqual(filtered.length, 3);
  });

  test("applies only the ignore pattern filter when only a pattern is specified", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, { ignorePatterns: [/heartbeat/] });

    assert.strictEqual(filtered.length, entries.length - 1);
    assert.ok(!filtered.some((entry) => entry.message.includes("heartbeat")));
  });

  test("combines all three criteria with AND semantics", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, {
      severities: new Set(["ERROR"]),
      dateRange: {
        startMs: Date.UTC(2024, 0, 2, 0, 0, 0),
        endMs: Date.UTC(2024, 0, 2, 23, 59, 59),
      },
      ignorePatterns: [/heartbeat/],
    });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "in range and matching");
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const result = await filterEntriesByCriteria(
      entries,
      { ignorePatterns: [/hello/] },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });

  test("applies only the match pattern filter when only a match pattern is specified (#182)", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, { matchPatterns: [/in range/] });

    assert.deepStrictEqual(
      filtered.map((entry) => entry.message),
      ["in range but wrong severity", "in range and matching"]
    );
  });

  test("combines the match pattern with the other criteria using AND semantics (#182)", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, {
      severities: new Set(["ERROR"]),
      matchPatterns: [/range|heartbeat/],
      ignorePatterns: [/heartbeat/],
    });

    assert.deepStrictEqual(
      filtered.map((entry) => entry.message),
      ["before range", "in range and matching", "after range"]
    );
  });

  test("propagates a timeout failure from the match pattern stage (#182)", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const result = await filterEntriesByCriteria(
      entries,
      { matchPatterns: [/hello/] },
      { matchPatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });

  test("ORs the patterns within each field and ANDs the two fields (#206)", async () => {
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, {
      matchPatterns: [/in range/, /heartbeat/],
      ignorePatterns: [/wrong severity/, /noise/],
    });

    // 一致側の OR で3件（in range 2件 + heartbeat 1件）に絞られ、そこから
    // 無視側の OR で2件が落ちる。
    assert.deepStrictEqual(
      filtered.map((entry) => entry.message),
      ["in range and matching"]
    );
  });

  test("treats an empty pattern list as no condition at all (#206)", async () => {
    // 空配列で「一致するものが1件も無い」と解釈すると、パターンを1件も足して
    // いない初期状態で全行が消える。
    const entries = parseLog(sampleText);

    const filtered = await filterOk(entries, { matchPatterns: [], ignorePatterns: [] });

    assert.strictEqual(filtered.length, entries.length);
  });
});

suite("normalize / buildInteractivePayload (#166)", () => {
  const sampleText = [
    "2024-01-01T00:00:00Z ERROR before range",
    "2024-01-02T03:04:05Z INFO in range but wrong severity",
    "2024-01-02T03:04:06Z ERROR in range and matching",
    "2024-01-02T03:04:07Z ERROR heartbeat noise",
    "not a recognizable log line at all",
  ].join("\n");

  test("matches filterEntriesByCriteria + formatNormalizedLogWithLineSources composed manually", async () => {
    const entries = parseLog(sampleText);
    const criteria = { severities: new Set(["ERROR"]) };

    const payload = await buildInteractivePayload(entries, criteria);

    assert.strictEqual(payload.ok, true);

    const filterResult = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(filterResult.ok, true);
    const expected = formatNormalizedLogWithLineSources(filterResult.entries);

    assert.strictEqual(payload.text, expected.text);
    assert.deepStrictEqual(payload.lineSources, expected.lineSources);
  });

  test("computes distinctSeverities from the unfiltered entries, not the filtered result", async () => {
    const entries = parseLog(sampleText);

    const payload = await buildInteractivePayload(entries, { severities: new Set(["ERROR"]) });

    assert.strictEqual(payload.ok, true);
    // INFO のエントリはフィルタで0件になるが、チェックボックス自体は残ってほしい。
    assert.deepStrictEqual(payload.distinctSeverities, getDistinctSeverities(entries));
    assert.ok(payload.distinctSeverities.includes("INFO"));
  });

  test("counts total and visible physical lines separately", async () => {
    const entries = parseLog(sampleText);

    const payload = await buildInteractivePayload(entries, { severities: new Set(["ERROR"]) });

    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.totalLineCount, entries.reduce((n, e) => n + e.lines.length, 0));
    // ERRORの3エントリ。最後の「heartbeat noise」エントリは、次行の
    // 「not a recognizable...」（タイムスタンプなし）を継続行として
    // 取り込むため2行になる（1+1+2=4）。
    assert.strictEqual(payload.visibleLineCount, 4);
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const payload = await buildInteractivePayload(
      entries,
      { ignorePatterns: [/hello/] },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.reason, "timeout");
  });

  test("omits items when collapseThreshold is not specified", async () => {
    const entries = parseLog(sampleText);

    const payload = await buildInteractivePayload(entries, {});

    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.items, undefined);
  });

  test("computes items from the filtered entries when collapseThreshold is specified (#172)", async () => {
    const entries = parseLog(sampleText);
    const criteria = { severities: new Set(["ERROR"]) };

    const payload = await buildInteractivePayload(entries, criteria, { collapseThreshold: 3 });

    assert.strictEqual(payload.ok, true);

    const filterResult = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(filterResult.ok, true);
    assert.deepStrictEqual(
      payload.items,
      buildInteractiveCollapsedLines(filterResult.entries, { threshold: 3 })
    );
  });
});

suite("normalize / buildInteractiveMergedPayload (#168)", () => {
  const files = [
    {
      fileName: "app.log",
      text: [
        "2024-01-01T00:00:00Z ERROR before range",
        "2024-01-02T03:04:06Z ERROR in range and matching",
      ].join("\n"),
    },
    {
      fileName: "worker.log",
      text: [
        "2024-01-02T03:04:05Z INFO in range but wrong severity",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
      ].join("\n"),
    },
  ];

  test("matches filterMergedEntriesByCriteria + formatMergedLogWithLineSources composed manually", async () => {
    const mergedEntries = mergeLogFiles(files);
    const criteria = { severities: new Set(["ERROR"]) };

    const payload = await buildInteractiveMergedPayload(mergedEntries, criteria);

    assert.strictEqual(payload.ok, true);

    const filterResult = await filterMergedEntriesByCriteria(mergedEntries, criteria);
    assert.strictEqual(filterResult.ok, true);
    const expected = formatMergedLogWithLineSources(filterResult.entries);

    assert.strictEqual(payload.text, expected.text);
    assert.deepStrictEqual(payload.lineSources, expected.lineSources);
  });

  test("computes distinctSeverities from the unfiltered merged entries, not the filtered result", async () => {
    const mergedEntries = mergeLogFiles(files);

    const payload = await buildInteractiveMergedPayload(mergedEntries, {
      severities: new Set(["ERROR"]),
    });

    assert.strictEqual(payload.ok, true);
    assert.deepStrictEqual(
      payload.distinctSeverities,
      getDistinctSeverities(mergedEntries.map((merged) => merged.entry))
    );
    assert.ok(payload.distinctSeverities.includes("INFO"));
  });

  test("counts total and visible physical lines across all merged files", async () => {
    const mergedEntries = mergeLogFiles(files);

    const payload = await buildInteractiveMergedPayload(mergedEntries, {
      severities: new Set(["ERROR"]),
    });

    assert.strictEqual(payload.ok, true);
    assert.strictEqual(
      payload.totalLineCount,
      mergedEntries.reduce((n, m) => n + m.entry.lines.length, 0)
    );
    assert.strictEqual(payload.visibleLineCount, 3); // ERRORの3エントリ（いずれも1行）
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const mergedEntries = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO hello" },
    ]);

    const payload = await buildInteractiveMergedPayload(
      mergedEntries,
      { ignorePatterns: [/hello/] },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.reason, "timeout");
  });
});

suite("normalize / buildInteractiveCollapsedLines (#172)", () => {
  test("keeps entries below the threshold as individual line items", () => {
    const text = ["2024-01-02T03:04:05Z INFO A", "2024-01-02T03:04:06Z INFO B"].join("\n");
    const entries = parseLog(text);

    const items = buildInteractiveCollapsedLines(entries, { threshold: 3 });

    assert.deepStrictEqual(
      items,
      formatNormalizedLog(entries)
        .split("\n")
        .map((text, index) => ({ kind: "line", text, lineSource: { fileIndex: 0, line: index + 1 } }))
    );
  });

  test("attaches the original physical line of each line item (#179)", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO A",
      "  detail",
      "2024-01-02T03:04:06Z INFO B",
    ].join("\n");
    const entries = parseLog(text);

    const items = buildInteractiveCollapsedLines(entries, { threshold: 3 });

    assert.deepStrictEqual(
      items.map((item) => (item.kind === "line" ? item.lineSource : undefined)),
      [
        { fileIndex: 0, line: 1 },
        { fileIndex: 0, line: 2 },
        { fileIndex: 0, line: 3 },
      ]
    );
  });

  test("attaches source lines aligned with a group's expanded lines (#179)", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:06Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:07Z ERROR boom",
      "  detail",
    ].join("\n");
    const entries = parseLog(text);

    const items = buildInteractiveCollapsedLines(entries, { threshold: 3 });

    const [item] = items;
    assert.strictEqual(item.kind, "group");
    assert.deepStrictEqual(
      item.lineSources,
      [1, 2, 3, 4, 5, 6].map((line) => ({ fileIndex: 0, line }))
    );
  });

  test("groups entries at or above the threshold into a single group item", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:06Z INFO connect ok",
      "2024-01-02T03:04:07Z INFO connect ok",
    ].join("\n");
    const entries = parseLog(text);

    const items = buildInteractiveCollapsedLines(entries, { threshold: 3 });

    assert.strictEqual(items.length, 1);
    const [item] = items;
    assert.strictEqual(item.kind, "group");
    // 見出しは formatCollapsedLog と同じ内容になる（範囲ラベル・タイムスタンプスパン・繰り返し回数）。
    const collapsedItems = collapseRepeatedEntries(entries, { threshold: 3 });
    assert.strictEqual(item.headerText, formatCollapsedLog(entries, collapsedItems));
    // 展開後の各行は、範囲ラベル("1-3"、3桁)に合わせた幅のガターで揃う。
    assert.deepStrictEqual(item.lines, [
      "  1 | 2024-01-02T03:04:05.000Z INFO connect ok",
      "  2 | 2024-01-02T03:04:06.000Z INFO connect ok",
      "  3 | 2024-01-02T03:04:07.000Z INFO connect ok",
    ]);
  });

  test("shares a gutter width wide enough for both plain line numbers and group range labels", () => {
    const text = [
      "==== banner ====",
      "2024-01-02T03:04:05Z INFO ok",
      "2024-01-02T03:04:06Z INFO ok",
      "2024-01-02T03:04:07Z INFO ok",
    ].join("\n");
    const entries = parseLog(text);

    const items = buildInteractiveCollapsedLines(entries, { threshold: 3 });

    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(items[0], {
      kind: "line",
      text: "  1 | ==== banner ====",
      lineSource: { fileIndex: 0, line: 1 },
    });
    assert.strictEqual(items[1].kind, "group");
    assert.strictEqual(
      items[1].headerText,
      "2-4 | 2024-01-02T03:04:05.000Z INFO ok (x3, ~03:04:07.000Z)"
    );
    // グループ内の展開行も、範囲ラベル("2-4"、3桁)に合わせた幅のガターで揃う。
    assert.deepStrictEqual(items[1].lines, [
      "  2 | 2024-01-02T03:04:05.000Z INFO ok",
      "  3 | 2024-01-02T03:04:06.000Z INFO ok",
      "  4 | 2024-01-02T03:04:07.000Z INFO ok",
    ]);
  });

  test("keeps each grouped entry's own continuation lines in the expanded output", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:06Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:07Z ERROR boom",
      "  detail",
    ].join("\n");
    const entries = parseLog(text);

    const items = buildInteractiveCollapsedLines(entries, { threshold: 3 });

    assert.strictEqual(items.length, 1);
    const [item] = items;
    assert.strictEqual(item.kind, "group");
    // ガター幅は範囲ラベル("1-6"、3桁)に合わせて揃うため、単独で
    // formatNormalizedLog(entries) を呼んだ場合（幅1桁）とは異なる。
    assert.deepStrictEqual(item.lines, [
      "  1 | 2024-01-02T03:04:05.000Z ERROR boom",
      "  2 |                                  detail",
      "  3 | 2024-01-02T03:04:06.000Z ERROR boom",
      "  4 |                                  detail",
      "  5 | 2024-01-02T03:04:07.000Z ERROR boom",
      "  6 |                                  detail",
    ]);
  });

  test("returns no items for an empty entry list", () => {
    assert.deepStrictEqual(buildInteractiveCollapsedLines([]), []);
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

suite("normalize / display mask (#194)", () => {
  const MASK_BOTH = { maskTimestamp: true, maskHost: true };

  test("formatNormalizedLog leaves the output untouched when no mask is given", () => {
    // マスクは Interactive View のトグル専用。既存コマンド（オプションを渡さない
    // 呼び出し）の出力が変わらないことを固定する。
    const entries = parseLog("2024-01-02T03:04:05Z ERROR connect to 10.0.0.1 failed");

    assert.strictEqual(
      formatNormalizedLog(entries),
      "1 | 2024-01-02T03:04:05.000Z ERROR connect to 10.0.0.1 failed"
    );
  });

  test("formatNormalizedLog masks the timestamp, keeping the gutter and severity", () => {
    const entries = parseLog("2024-01-02T03:04:05Z ERROR boom");

    assert.strictEqual(
      formatNormalizedLog(entries, { mask: { maskTimestamp: true } }),
      "1 | <TIMESTAMP> ERROR boom"
    );
  });

  test("formatNormalizedLog masks IP addresses in the header and continuation lines", () => {
    const entries = parseLog(
      [
        "2024-01-02T03:04:05Z ERROR connect to 10.0.0.1 failed",
        "    at com.example.Foo.bar(2001:db8::1)",
      ].join("\n")
    );

    assert.strictEqual(
      formatNormalizedLog(entries, { mask: { maskHost: true } }),
      [
        "1 | 2024-01-02T03:04:05.000Z ERROR connect to <HOST> failed",
        "2 |                                    at com.example.Foo.bar(<HOST>)",
      ].join("\n")
    );
  });

  test("formatNormalizedLog masks the RFC3164 hostname token when masking hosts", () => {
    // 生ログでのみ位置が確定するホスト名トークンを、整形の段階でマスクできる
    // ことの確認（#180 の表示テキスト後段マスクでは届かなかった箇所）。
    const entries = parseLog("Jan  2 03:04:05  web01 myapp: hello", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });

    assert.strictEqual(
      formatNormalizedLog(entries, { mask: MASK_BOTH }),
      "1 | <TIMESTAMP> - <HOST> myapp: hello"
    );
  });

  test("formatNormalizedLog keeps the line count and line sources stable under masking", () => {
    // 行数・行構成が変わらないことが、行ジャンプ（#179）と表示上限（#178）が
    // マスク中もそのまま成立する前提になっている。
    const entries = parseLog(
      [
        "2024-01-02T03:04:05Z ERROR boom from 10.0.0.1",
        "    at com.example.Foo.bar(Foo.java:42)",
        "2024-01-02T03:05:05Z INFO done",
      ].join("\n")
    );
    const options = { gapThresholdMs: 30_000 };

    const plain = formatNormalizedLogWithLineSources(entries, options);
    const masked = formatNormalizedLogWithLineSources(entries, { ...options, mask: MASK_BOTH });

    assert.strictEqual(masked.text.split("\n").length, plain.text.split("\n").length);
    assert.deepStrictEqual(masked.lineSources, plain.lineSources);
  });

  test("formatMergedLog masks the body while keeping the file name / kind columns", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO from 10.0.0.1" },
    ]);

    assert.strictEqual(
      formatMergedLog(merged, { mask: MASK_BOTH }),
      "app.log | app | 1 | <TIMESTAMP> INFO from <HOST>"
    );
  });

  test("buildInteractiveCollapsedLines masks group headers and expanded lines", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect to 10.0.0.1 ok",
      "2024-01-02T03:04:06Z INFO connect to 10.0.0.1 ok",
      "2024-01-02T03:04:07Z INFO connect to 10.0.0.1 ok",
    ].join("\n");
    const items = buildInteractiveCollapsedLines(parseLog(text), {
      threshold: 3,
      mask: MASK_BOTH,
    });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    // 開始/終了が異なるグループはスパン表示のままにする（マスクしても「範囲」
    // であることは残す）。
    assert.strictEqual(
      items[0].headerText,
      "1-3 | <TIMESTAMP> INFO connect to <HOST> ok (x3)"
    );
    assert.deepStrictEqual(items[0].lines, [
      "  1 | <TIMESTAMP> INFO connect to <HOST> ok",
      "  2 | <TIMESTAMP> INFO connect to <HOST> ok",
      "  3 | <TIMESTAMP> INFO connect to <HOST> ok",
    ]);
  });

  test("buildInteractivePayload forwards the mask to both the text and the collapsed items", async () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect to 10.0.0.1 ok",
      "2024-01-02T03:04:06Z ERROR boom",
    ].join("\n");
    const result = await buildInteractivePayload(parseLog(text), {}, {
      collapseThreshold: 3,
      mask: MASK_BOTH,
    });

    assert.ok(result.ok);
    assert.strictEqual(
      result.text,
      ["1 | <TIMESTAMP> INFO  connect to <HOST> ok", "2 | <TIMESTAMP> ERROR boom"].join("\n")
    );
    assert.deepStrictEqual(
      result.items?.map((item) => (item.kind === "line" ? item.text : item.headerText)),
      ["1 | <TIMESTAMP> INFO  connect to <HOST> ok", "2 | <TIMESTAMP> ERROR boom"]
    );
  });

  test("buildInteractiveMergedPayload forwards the mask", async () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO from 10.0.0.1" },
    ]);
    const result = await buildInteractiveMergedPayload(merged, {}, { mask: MASK_BOTH });

    assert.ok(result.ok);
    assert.strictEqual(
      result.text,
      "app.log | app | 1 | <TIMESTAMP> INFO from <HOST>"
    );
  });

  test("buildInteractiveExportText forwards the mask, collapsed and uncollapsed", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO from 10.0.0.1");

    const plain = await buildInteractiveExportText(entries, {}, { mask: MASK_BOTH });
    assert.ok(plain.ok);
    assert.strictEqual(
      plain.formatted.text,
      "1 | <TIMESTAMP> INFO from <HOST>"
    );

    const collapsed = await buildInteractiveExportText(entries, {}, {
      collapseThreshold: 3,
      mask: MASK_BOTH,
    });
    assert.ok(collapsed.ok);
    assert.match(collapsed.formatted.text, /<TIMESTAMP> INFO from <HOST>/);
  });

  test("buildInteractiveMergedExportText forwards the mask", async () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO from 10.0.0.1" },
    ]);
    const result = await buildInteractiveMergedExportText(merged, {}, { mask: MASK_BOTH });

    assert.ok(result.ok);
    assert.strictEqual(
      result.formatted.text,
      "app.log | app | 1 | <TIMESTAMP> INFO from <HOST>"
    );
  });
});

suite("normalize / maskProcessIds (#195)", () => {
  test("masks the pid in a syslog-style tag, keeping the process name and brackets", () => {
    assert.strictEqual(
      maskProcessIds("sshd[1234]: Accepted publickey for root"),
      "sshd[<PID>]: Accepted publickey for root"
    );
  });

  test("masks the pid= / pid: / [pid N] keyword forms regardless of case", () => {
    assert.strictEqual(
      maskProcessIds("worker exited pid=1234 code=0"),
      "worker exited pid=<PID> code=0"
    );
    assert.strictEqual(maskProcessIds("worker exited PID: 1234"), "worker exited PID: <PID>");
    assert.strictEqual(maskProcessIds("[pid 1234] request finished"), "[pid <PID>] request finished");
  });

  test("does not mask thread names or array indices in brackets", () => {
    // log4j のスレッド名列・配列の添字を巻き込まないことを固定する（#195 の受け入れ基準）。
    // `items[0]:` はコロンが続くが1桁なので拾わず、`retries[3] =` はコロンが無いので拾わない。
    const text = "INFO [main] items[0]: ready, retries[3] = 0, [pool-1-thread-3] done";

    assert.strictEqual(maskProcessIds(text), text);
  });

  test("does not mask a bracketed number without a trailing colon", () => {
    // syslog のタグは `name[pid]:` の形に決まっているため、コロンを手がかりに
    // する。コロンが無い `buffer[4096]` のような表記は、PIDらしく見えても
    // 誤マスクを避けて残す（取りこぼしより誤マスクの方が読み手を混乱させるため）。
    const text = "allocated buffer[4096] bytes";

    assert.strictEqual(maskProcessIds(text), text);
  });

  test("does not mask a bracketed number with a leading zero", () => {
    const text = "chunk[007]: written";

    assert.strictEqual(maskProcessIds(text), text);
  });

  test("does not mask timestamps or IP addresses", () => {
    const text = "2024-01-02T03:04:05Z connect to 10.0.0.1 failed";

    assert.strictEqual(maskProcessIds(text), text);
  });

  test("formatNormalizedLog masks the pid only when maskProcessId is enabled", () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO worker pid=1234 started");

    assert.strictEqual(
      formatNormalizedLog(entries),
      "1 | 2024-01-02T03:04:05.000Z INFO worker pid=1234 started"
    );
    assert.strictEqual(
      formatNormalizedLog(entries, { mask: { maskProcessId: true } }),
      "1 | 2024-01-02T03:04:05.000Z INFO worker pid=<PID> started"
    );
  });

  test("formatNormalizedLog masks a single-digit pid in the syslog tag position", () => {
    // syslog（RFC3164）はタグの位置が確定しているため、汎用ルールでは
    // 誤マスクを避けて外している1桁のPID（`systemd[1]:`）もここでは拾える。
    const entries = parseLog("Jan  2 03:04:05 web01 systemd[1]: Started daemon", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });

    assert.strictEqual(
      formatNormalizedLog(entries, { mask: { maskProcessId: true } }),
      "1 | 2024-01-02T03:04:05.000Z - web01 systemd[<PID>]: Started daemon"
    );
    assert.strictEqual(
      formatNormalizedLog(entries, { mask: { maskHost: true, maskProcessId: true } }),
      "1 | 2024-01-02T03:04:05.000Z - <HOST> systemd[<PID>]: Started daemon"
    );
  });

  test("maskLogTextForCopy masks process ids only when the option is enabled", () => {
    // 既定を false にしているのは、既存の `Copy Masked Text` の出力を
    // 変えないため（他の2対象は既定 true）。
    const entries = parseLog("2024-01-02T03:04:05Z INFO worker pid=1234 started");

    assert.strictEqual(maskLogTextForCopy(entries), "<TIMESTAMP> INFO worker pid=1234 started");
    assert.strictEqual(
      maskLogTextForCopy(entries, { maskProcessId: true }),
      "<TIMESTAMP> INFO worker pid=<PID> started"
    );
  });

  test("maskLogTextForCopy masks the syslog tag pid in place, keeping the raw formatting", () => {
    const entries = parseLog("Jan  2 03:04:05 web01 systemd[1]: Started daemon", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
    });

    assert.strictEqual(
      maskLogTextForCopy(entries, {
        maskTimestamp: false,
        maskHost: false,
        maskProcessId: true,
      }),
      "Jan  2 03:04:05 web01 systemd[<PID>]: Started daemon"
    );
  });
});

suite("normalize / maskEntriesByPatterns (#195)", () => {
  /** テストの意図（置換結果の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function maskOk(entries: Parameters<typeof maskEntriesByPatterns>[0], pattern: RegExp) {
    const result = await maskEntriesByPatterns(entries, [pattern]);
    assert.strictEqual(result.ok, true);
    return result.entries;
  }

  test("replaces every match in the message with the placeholder", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO user=alice retried for user=alice");

    const masked = await maskOk(entries, /user=\w+/i);

    assert.strictEqual(masked[0].message, "<MASKED> retried for <MASKED>");
  });

  test("leaves the timestamp and severity untouched", async () => {
    // 置換の対象はメッセージ本文だけ。タイムスタンプ列・セベリティ列まで
    // 消えると時系列を追うビューとして用を成さなくなるため。
    const entries = parseLog("2024-01-02T03:04:05Z ERROR boom");

    const masked = await maskOk(entries, /\d+/);

    assert.strictEqual(masked[0].timestampMs, entries[0].timestampMs);
    assert.strictEqual(masked[0].severity, "ERROR");
    assert.strictEqual(masked[0].message, "boom");
  });

  test("masks each line of a multi-line message without changing the line count", async () => {
    const entries = parseLog(
      [
        "2024-01-02T03:04:05Z ERROR boom token=abc",
        "    at com.example.Foo.bar(token=def)",
      ].join("\n")
    );

    const masked = await maskOk(entries, /token=\w+/);

    assert.deepStrictEqual(masked[0].message.split("\n"), [
      "boom <MASKED>",
      "    at com.example.Foo.bar(<MASKED>)",
    ]);
    assert.strictEqual(masked[0].lines.length, entries[0].lines.length);
  });

  test("cannot swallow line breaks even with a pattern that would span lines", async () => {
    // 行単位で置換するため、`[\s\S]+` のようなパターンでも行数は変わらない。
    // 行数が変わると行ジャンプ（#179）と表示上限（#178）の前提が壊れる。
    const entries = parseLog(
      ["2024-01-02T03:04:05Z ERROR boom", "    at com.example.Foo.bar"].join("\n")
    );

    const masked = await maskOk(entries, /[\s\S]+/);

    assert.strictEqual(masked[0].message, "<MASKED>\n<MASKED>");
  });

  test("returns the entries unchanged when nothing matches", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const masked = await maskOk(entries, /nope/);

    assert.strictEqual(masked[0].message, "hello");
  });

  test("returns an empty result without spawning a worker when there are no entries", async () => {
    const masked = await maskOk([], /anything/);

    assert.deepStrictEqual(masked, []);
  });

  test("terminates and reports a timeout instead of hanging forever", async function () {
    this.timeout(5000);

    // 絞り込みのパターン評価（#182）と同じ理由で、破局的バックトラッキングを
    // 起こす正規表現は literal で置かず、安全なパターンに極端に短い timeoutMs を
    // 与えて打ち切りのコードパスを決定的に検証する。
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const result = await maskEntriesByPatterns(entries, [/hello/], { timeoutMs: 1 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });

  test("masks merged entries while keeping their file index", async () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO user=alice ok" },
    ]);

    const result = await maskMergedEntriesByPatterns(merged, [/user=\w+/]);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entries[0].entry.message, "<MASKED> ok");
    assert.strictEqual(result.entries[0].fileIndex, merged[0].fileIndex);
  });

  test("applies several patterns in order, so a key pattern and a free-form one both take effect", async () => {
    // キー指定欄と任意パターン欄を同時に効かせるための配列適用（issue #212）。
    const entries = parseLog("2024-01-02T03:04:05Z INFO user=alice token=secret");

    const keyPattern = buildKeyMaskPattern("user");
    assert.ok(keyPattern);
    const result = await maskEntriesByPatterns(entries, [keyPattern, /token=\S+/]);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(
      result.entries[0].message,
      "user=<MASKED> <MASKED>"
    );
  });
});

suite("normalize / buildKeyMaskPattern (#212)", () => {
  /** キー欄の入力そのものを受け取り、組み立てた正規表現で置換した結果を返す。 */
  function maskByKeys(keysInput: string, text: string): string {
    const pattern = buildKeyMaskPattern(keysInput);
    return pattern ? text.replace(pattern, "<MASKED>") : text;
  }

  test("masks the value of key=value, keeping the key and the separator", () => {
    assert.strictEqual(
      maskByKeys("user", "Authenticated request user=hoge tenant=acme"),
      "Authenticated request user=<MASKED> tenant=acme"
    );
  });

  test("masks the value of key: value with surrounding spaces", () => {
    assert.strictEqual(
      maskByKeys("user", "Session expired for user: fuga"),
      "Session expired for user: <MASKED>"
    );
  });

  test("masks inside quotes, keeping the quotes themselves", () => {
    // クォートを残すのは、値が空になったのか伏せられたのかを読み手が
    // 見分けられるようにするため。
    assert.strictEqual(
      maskByKeys("token", 'auth ok token="abc 123" retry=0'),
      'auth ok token="<MASKED>" retry=0'
    );
    assert.strictEqual(maskByKeys("token", "auth ok token='abc'"), "auth ok token='<MASKED>'");
  });

  test("accepts several keys separated by commas or spaces", () => {
    assert.strictEqual(
      maskByKeys("user, token session", "user=hoge token=abc session=xyz other=keep"),
      "user=<MASKED> token=<MASKED> session=<MASKED> other=keep"
    );
  });

  test("matches the key case-insensitively", () => {
    assert.strictEqual(maskByKeys("user", "USER=hoge"), "USER=<MASKED>");
  });

  test("stops the value at a delimiter so the rest of the line survives", () => {
    assert.strictEqual(
      maskByKeys("user", "handled (user=hoge, id=3) done"),
      "handled (user=<MASKED>, id=3) done"
    );
  });

  test("does not mask a different key that merely contains the given one", () => {
    // `\b` ではなく `(?<![\w.-])` で判定している理由（#212）。
    assert.strictEqual(maskByKeys("user", "superuser=x user=y"), "superuser=x user=<MASKED>");
    assert.strictEqual(maskByKeys("id", "order.id=42"), "order.id=42");
  });

  test("works with a non-ASCII key", () => {
    // `\b` は ASCII 前提なので、日本語のキー名では機能しない。
    assert.strictEqual(maskByKeys("契約ID", "契約ID=A-1234 を処理"), "契約ID=<MASKED> を処理");
  });

  test("treats regular-expression metacharacters in a key as literal text", () => {
    assert.strictEqual(maskByKeys("a.b", "axb=1 a.b=2"), "axb=1 a.b=<MASKED>");
  });

  test("leaves a key with no value alone", () => {
    // `=` の後の空白を許さないことで、値が空のキーに続く別の語を巻き込まない。
    assert.strictEqual(maskByKeys("user", "user= and user:"), "user= and user:");
  });

  test("does not mask a spaced-out assignment (意図的な取りこぼし)", () => {
    // `user = hoge` を拾うには `=` の後の空白を許す必要があり、それは上の
    // 誤マスクと引き換えになる。設定ダンプ以外ではまず見ない形なので拾わない。
    assert.strictEqual(maskByKeys("user", "user = hoge"), "user = hoge");
  });

  test("returns no pattern for a blank input", () => {
    assert.strictEqual(buildKeyMaskPattern("  , "), undefined);
  });
});

suite("normalize / custom mask pattern in the interactive builders (#195)", () => {
  const ENTRY_TEXT = "2024-01-02T03:04:05Z INFO user=alice from 10.0.0.1";

  test("buildInteractivePayload applies the pattern before formatting, alongside the other masks", async () => {
    const result = await buildInteractivePayload(parseLog(ENTRY_TEXT), {}, {
      mask: { maskHost: true },
      maskPatterns: [/user=\w+/],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.text, "1 | 2024-01-02T03:04:05.000Z INFO <MASKED> from <HOST>");
    assert.strictEqual(result.maskPatternFailure, undefined);
  });

  test("buildInteractivePayload keeps the other masks and reports the failure when the pattern times out", async function () {
    this.timeout(5000);

    // 縮退の仕方は無視パターン（#182）と揃える——効かないのは失敗した
    // マスクだけで、パネルは壊れず他のマスクは効き続ける。
    const result = await buildInteractivePayload(parseLog(ENTRY_TEXT), {}, {
      mask: { maskHost: true },
      maskPatterns: [/user=\w+/],
      maskPatternTimeoutMs: 1,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.maskPatternFailure, "timeout");
    assert.strictEqual(result.text, "1 | 2024-01-02T03:04:05.000Z INFO user=alice from <HOST>");
  });

  test("buildInteractivePayload applies the pattern to the collapsed items as well", async () => {
    const text = [
      "2024-01-02T03:04:05Z INFO user=alice ok",
      "2024-01-02T03:04:06Z INFO user=alice ok",
      "2024-01-02T03:04:07Z INFO user=alice ok",
    ].join("\n");

    const result = await buildInteractivePayload(parseLog(text), {}, {
      collapseThreshold: 3,
      maskPatterns: [/user=\w+/],
    });

    assert.ok(result.ok);
    assert.ok(result.items);
    assert.strictEqual(result.items.length, 1);
    const [item] = result.items;
    assert.strictEqual(item.kind, "group");
    assert.match(item.headerText, /<MASKED> ok/);
  });

  test("buildInteractiveMergedPayload applies the pattern", async () => {
    const merged = mergeLogFiles([{ fileName: "app.log", text: ENTRY_TEXT }]);

    const result = await buildInteractiveMergedPayload(merged, {}, { maskPatterns: [/user=\w+/] });

    assert.ok(result.ok);
    assert.strictEqual(
      result.text,
      "app.log | app | 1 | 2024-01-02T03:04:05.000Z INFO <MASKED> from 10.0.0.1"
    );
  });

  test("buildInteractiveExportText applies the pattern and reports a failure without dropping the export", async function () {
    this.timeout(5000);

    const entries = parseLog(ENTRY_TEXT);

    const applied = await buildInteractiveExportText(entries, {}, { maskPatterns: [/user=\w+/] });
    assert.ok(applied.ok);
    assert.match(applied.formatted.text, /<MASKED> from 10\.0\.0\.1/);

    const failed = await buildInteractiveExportText(entries, {}, {
      maskPatterns: [/user=\w+/],
      maskPatternTimeoutMs: 1,
    });
    assert.ok(failed.ok);
    assert.strictEqual(failed.maskPatternFailure, "timeout");
    assert.match(failed.formatted.text, /user=alice/);
  });

  test("buildInteractiveMergedExportText applies the pattern", async () => {
    const merged = mergeLogFiles([{ fileName: "app.log", text: ENTRY_TEXT }]);

    const result = await buildInteractiveMergedExportText(merged, {}, { maskPatterns: [/user=\w+/] });

    assert.ok(result.ok);
    assert.match(result.formatted.text, /INFO <MASKED> from/);
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
    assert.strictEqual(items[0].entries.length, 3);
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
    assert.strictEqual(items[0].entries.length, 2);
    assert.strictEqual(items[1].kind, "single");
    assert.strictEqual(items[1].entry.message, "B");
    assert.strictEqual(items[2].kind, "single");
    assert.strictEqual(items[2].entry.message, "A");
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
    assert.strictEqual(items[0].entries.length, 2);
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

  test("computes each entry's grouping key at most once regardless of run length", () => {
    // groupingKey は maskHostAddresses を必ず1回呼ぶため、その呼び出し回数を
    // 数えることでキー計算回数（ランの長さに依存して増えていないか）を検証する。
    const entries = parseLog(repeatedEntriesText(50));
    const original = maskForCompare.maskHostAddresses;
    let callCount = 0;
    (maskForCompare as any).maskHostAddresses = (text: string) => {
      callCount++;
      return original(text);
    };

    try {
      collapseRepeatedEntries(entries, { threshold: 3 });
    } finally {
      (maskForCompare as any).maskHostAddresses = original;
    }

    assert.strictEqual(callCount, entries.length);
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
      "1-3 | 2024-01-02T03:04:05.000Z INFO connect ok (x3, ~03:04:07.000Z)"
    );
  });

  test("omits the end timestamp when every entry in the group shares the same timestamp", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:05Z INFO connect ok",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      "1-3 | 2024-01-02T03:04:05.000Z INFO connect ok (x3)"
    );
  });

  test("renders the group's timestamp span in the requested display timezone", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:06Z INFO connect ok",
      "2024-01-02T03:04:07Z INFO connect ok",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items, { displayTimezone: 540 }),
      "1-3 | 2024-01-02T12:04:05.000+09:00 INFO connect ok (x3, ~12:04:07.000+09:00)"
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
      [
        "  1 | ==== banner ====",
        "2-4 | 2024-01-02T03:04:05.000Z INFO ok (x3, ~03:04:07.000Z)",
      ].join("\n")
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
      [
        "1-6 | 2024-01-02T03:04:05.000Z ERROR boom (x3, ~03:04:07.000Z)",
        "  2 |                                  detail",
      ].join("\n")
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

  test("strips a trailing logrotate-style numeric suffix", () => {
    assert.strictEqual(deriveLogKind("app.log.1"), "app");
  });

  test("strips a trailing date suffix appended after logrotate, in addition to the extension", () => {
    assert.strictEqual(deriveLogKind("app.log.2024-01-02"), "app");
  });

  test("derives the same kind for a file and its rotated variants", () => {
    const kind = deriveLogKind("app.log");
    assert.strictEqual(deriveLogKind("app.log.1"), kind);
    assert.strictEqual(deriveLogKind("app.log.2024-01-02"), kind);
  });

  test("keeps unrelated file names with similar prefixes as distinct kinds", () => {
    assert.notStrictEqual(deriveLogKind("error.log"), deriveLogKind("errors.log"));
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

  test("groups a log file and its logrotate-style rotated variants under the same kind", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO current" },
      { fileName: "app.log.1", text: "2024-01-01T03:04:05Z INFO numbered" },
      { fileName: "app.log.2024-01-02", text: "2024-01-02T03:04:06Z INFO dated" },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => m.kind),
      ["app", "app", "app"]
    );
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
      `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO  hello`,
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
      `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | 2 | ${" ".repeat(31)}  at Foo.bar`,
    ].join("\n");

    assert.strictEqual(output, expected);
  });

  test("returns an empty string for no entries", () => {
    assert.strictEqual(formatMergedLog([]), "");
  });

  test("does not insert a gap marker when gapThresholdMs is not specified", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "database.log", text: "2024-01-02T03:05:05Z ERROR after (60s later)" },
    ]);

    const output = formatMergedLog(merged);

    assert.strictEqual(countGapMarkers(output), 0);
  });

  test("inserts a gap marker between merged entries from different files, blanking the fileName/kind columns", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "database.log", text: "2024-01-02T03:04:35Z ERROR after" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 30_000 });

    const fileNameWidth = "database.log".length;
    const kindWidth = "database".length;
    const expected = [
      `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO  before`,
      `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | ... | 30s gap`,
      `${"database.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:35.000Z ERROR after`,
    ].join("\n");

    assert.strictEqual(output, expected);
  });

  test("does not insert a gap marker when the gap is below the threshold", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "database.log", text: "2024-01-02T03:04:34Z ERROR after (29s later)" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 30_000 });

    assert.strictEqual(countGapMarkers(output), 0);
  });

  test("treats a gapThresholdMs of 0 as disabled", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "database.log", text: "2024-01-02T03:04:06Z ERROR after" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 0 });

    assert.strictEqual(countGapMarkers(output), 0);
  });

  test("inserts multiple gap markers for multiple qualifying gaps", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO a" },
      { fileName: "database.log", text: "2024-01-02T03:04:35Z INFO b" },
      { fileName: "app.log", text: "2024-01-02T03:05:05Z INFO c" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 30_000 });

    assert.strictEqual(countGapMarkers(output), 2);
  });

  test("skips the gap check for a pair where an entry lacks a recognized timestamp", () => {
    // タイムスタンプ未認識のエントリは mergeLogFiles により末尾へ回るため、
    // 直前の認識済みエントリとの組でギャップ判定がスキップされることを確認する。
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO matched entry" },
      { fileName: "other.log", text: "totally unrecognized line" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 30_000 });

    assert.strictEqual(countGapMarkers(output), 0);
  });

  test("detects a gap on the filtered entry list, matching the normalized view's existing behavior", async () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO kept before" },
      { fileName: "app.log", text: "2024-01-02T03:04:15Z DEBUG dropped by filter" },
      { fileName: "database.log", text: "2024-01-02T03:04:45Z ERROR kept after" },
    ]);

    const filterResult = await filterMergedEntriesByCriteria(merged, {
      severities: new Set(["INFO", "ERROR"]),
    });
    assert.strictEqual(filterResult.ok, true);

    const output = formatMergedLog(filterResult.entries, { gapThresholdMs: 30_000 });

    assert.strictEqual(countGapMarkers(output), 1);
    assert.ok(output.includes("40s gap"));
  });

  test("does not pass an out-of-range timestamp into merge order, date filtering, or gap detection", async () => {
    const merged = mergeLogFiles([
      { fileName: "before.log", text: "2024-01-02T03:00:00Z INFO before" },
      { fileName: "invalid.log", text: "2024-01-02T03:60:00Z WARN invalid" },
      { fileName: "after.log", text: "2024-01-02T04:30:00Z ERROR after" },
    ]);

    assert.deepStrictEqual(
      merged.map(({ entry }) => entry.message),
      ["before", "after", "2024-01-02T03:60:00Z WARN invalid"]
    );

    const filterResult = await filterMergedEntriesByCriteria(merged, {
      dateRange: {
        startMs: Date.UTC(2024, 0, 2, 3, 59),
        endMs: Date.UTC(2024, 0, 2, 4, 1),
      },
    });
    assert.strictEqual(filterResult.ok, true);
    assert.deepStrictEqual(filterResult.entries, []);

    const output = formatMergedLog(merged, { gapThresholdMs: 30 * 60 * 1000 });
    assert.strictEqual(countGapMarkers(output), 1);
    assert.ok(output.includes("5400s gap"));
  });
});

suite("normalize / filterMergedEntriesByCriteria", () => {
  /** テストの意図（絞り込み結果の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function filterOk(
    mergedEntries: Parameters<typeof filterMergedEntriesByCriteria>[0],
    criteria: Parameters<typeof filterMergedEntriesByCriteria>[1]
  ) {
    const result = await filterMergedEntriesByCriteria(mergedEntries, criteria);
    assert.strictEqual(result.ok, true);
    return result.entries;
  }

  const sampleMerged = mergeLogFiles([
    { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO in range but wrong severity" },
    {
      fileName: "database_20240101.log",
      text: [
        "2024-01-01T00:00:00Z ERROR before range",
        "2024-01-02T03:04:06Z ERROR in range and matching",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
        "2024-01-03T00:00:00Z ERROR after range",
      ].join("\n"),
    },
  ]);

  test("returns every merged entry unchanged when no criteria are specified", async () => {
    const filtered = await filterOk(sampleMerged, {});

    assert.strictEqual(filtered.length, sampleMerged.length);
  });

  test("keeps fileName/kind alongside the entry after filtering by severity", async () => {
    const filtered = await filterOk(sampleMerged, { severities: new Set(["INFO"]) });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].entry.message, "in range but wrong severity");
    assert.strictEqual(filtered[0].fileName, "app.log");
    assert.strictEqual(filtered[0].kind, "app");
  });

  test("applies only the date range filter when only a date range is specified", async () => {
    const filtered = await filterOk(sampleMerged, {
      dateRange: {
        startMs: Date.UTC(2024, 0, 2, 0, 0, 0),
        endMs: Date.UTC(2024, 0, 2, 23, 59, 59),
      },
    });

    assert.strictEqual(filtered.length, 3);
  });

  test("applies only the ignore pattern filter when only a pattern is specified", async () => {
    const filtered = await filterOk(sampleMerged, { ignorePatterns: [/heartbeat/] });

    assert.strictEqual(filtered.length, sampleMerged.length - 1);
    assert.ok(!filtered.some((merged) => merged.entry.message.includes("heartbeat")));
  });

  test("combines all three criteria with AND semantics, preserving fileName/kind", async () => {
    const filtered = await filterOk(sampleMerged, {
      severities: new Set(["ERROR"]),
      dateRange: {
        startMs: Date.UTC(2024, 0, 2, 0, 0, 0),
        endMs: Date.UTC(2024, 0, 2, 23, 59, 59),
      },
      ignorePatterns: [/heartbeat/],
    });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].entry.message, "in range and matching");
    assert.strictEqual(filtered[0].fileName, "database_20240101.log");
    assert.strictEqual(filtered[0].kind, "database");
  });

  test("preserves the merged chronological order after filtering", async () => {
    const filtered = await filterOk(sampleMerged, { severities: new Set(["ERROR", "INFO"]) });

    // sampleMerged はタイムスタンプ順に並べ替え済みのため、期待順もそれに揃える
    // （ファイル投入順ではなく "before range" が先頭に来る）。
    assert.deepStrictEqual(
      filtered.map((merged) => merged.entry.message),
      [
        "before range",
        "in range but wrong severity",
        "in range and matching",
        "heartbeat noise",
        "after range",
      ]
    );
  });

  test("returns an empty array for no merged entries", async () => {
    const filtered = await filterOk([], { severities: new Set(["ERROR"]) });

    assert.deepStrictEqual(filtered, []);
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const result = await filterMergedEntriesByCriteria(
      sampleMerged,
      { ignorePatterns: [/heartbeat/] },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });
});

suite("normalize / assessTimestampRecognition", () => {
  /** タイムスタンプを含まないプレーンな行を count 行分生成する。 */
  function plainLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `plain line ${String(i + 1)}`).join("\n");
  }

  /** ISO 8601 タイムスタンプ付きの行を count 行分生成する。 */
  function timestampedLines(count: number): string {
    return Array.from(
      { length: count },
      (_, i) => `2024-01-02T03:04:${String(i % 60).padStart(2, "0")}Z INFO line ${String(i + 1)}`
    ).join("\n");
  }

  test("warns when no timestamp is recognized in a sufficiently large log", () => {
    const result = assessTimestampRecognition(parseLog(plainLines(12)));

    assert.strictEqual(result.totalLineCount, 12);
    assert.strictEqual(result.unrecognizedLineCount, 12);
    assert.strictEqual(result.unrecognizedRatio, 1);
    assert.strictEqual(result.shouldWarn, true);
  });

  test("does not warn for a normal log where every line has a timestamp", () => {
    const result = assessTimestampRecognition(parseLog(timestampedLines(12)));

    assert.strictEqual(result.totalLineCount, 12);
    assert.strictEqual(result.unrecognizedLineCount, 0);
    assert.strictEqual(result.unrecognizedRatio, 0);
    assert.strictEqual(result.shouldWarn, false);
  });

  test("does not count continuation lines (e.g. stack traces) of recognized entries as unrecognized", () => {
    const stackTrace = Array.from(
      { length: 20 },
      (_, i) => `    at com.example.App.method${String(i)}(App.java:${String(i + 1)})`
    ).join("\n");
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      stackTrace,
      "2024-01-02T03:04:06Z ERROR boom again",
      stackTrace,
    ].join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.totalLineCount, 42);
    assert.strictEqual(result.unrecognizedLineCount, 0);
    assert.strictEqual(result.shouldWarn, false);
  });

  test("warns when timestamp-like lines in an unsupported format are absorbed as continuations", () => {
    const unsupportedTimestampLines = Array.from(
      { length: 11 },
      (_, i) => `02.01.2024 03:04:${String(i).padStart(2, "0")} INFO switched format`
    ).join("\n");
    const text = ["2024-01-02T03:04:00Z INFO recognized", unsupportedTimestampLines].join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.totalLineCount, 12);
    assert.strictEqual(result.unrecognizedLineCount, 0);
    assert.strictEqual(result.suspiciousContinuationLineCount, 11);
    assert.strictEqual(result.shouldWarn, true);
  });

  test("does not warn for indented timestamp-like continuation text or blank lines", () => {
    const continuationLines = Array.from(
      { length: 12 },
      (_, i) =>
        i % 3 === 0
          ? ""
          : `    02.01.2024 03:04:${String(i).padStart(2, "0")} diagnostic detail`
    ).join("\n");
    const text = [
      "2024-01-02T03:04:00Z INFO recognized",
      continuationLines,
      "2024-01-02T03:05:00Z INFO recognized again",
    ].join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.unrecognizedLineCount, 0);
    assert.strictEqual(result.suspiciousContinuationLineCount, 0);
    assert.strictEqual(result.shouldWarn, false);
  });

  test("does not combine isolated timestamp-like continuations across recognized entries", () => {
    const text = Array.from(
      { length: 10 },
      (_, i) =>
        `2024-01-02T03:${String(i).padStart(2, "0")}:00Z INFO recognized\n` +
        `02.01.2024 03:${String(i).padStart(2, "0")}:30 diagnostic detail`
    ).join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.suspiciousContinuationLineCount, 1);
    assert.strictEqual(result.shouldWarn, false);
  });

  test("warns when at least half the lines precede the first recognized timestamp (boundary)", () => {
    const text = [plainLines(6), timestampedLines(6)].join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.unrecognizedRatio, LOW_RECOGNITION_RATIO_THRESHOLD);
    assert.strictEqual(result.shouldWarn, true);
  });

  test("does not warn when the unrecognized ratio is just below the threshold", () => {
    const text = [plainLines(5), timestampedLines(7)].join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.totalLineCount, 12);
    assert.strictEqual(result.unrecognizedLineCount, 5);
    assert.strictEqual(result.shouldWarn, false);
  });

  test("does not warn for logs below the minimum line count", () => {
    const result = assessTimestampRecognition(
      parseLog(plainLines(LOW_RECOGNITION_MIN_LINE_COUNT - 1))
    );

    assert.strictEqual(result.unrecognizedRatio, 1);
    assert.strictEqual(result.shouldWarn, false);
  });

  test("excludes blank lines from both the total and the unrecognized counts", () => {
    const text = ["", plainLines(5), "", "   ", plainLines(5), ""].join("\n");

    const result = assessTimestampRecognition(parseLog(text));

    assert.strictEqual(result.totalLineCount, 10);
    assert.strictEqual(result.unrecognizedLineCount, 10);
    assert.strictEqual(result.shouldWarn, true);
  });

  test("returns zero counts and does not warn for empty input", () => {
    const result = assessTimestampRecognition(parseLog(""));

    assert.strictEqual(result.totalLineCount, 0);
    assert.strictEqual(result.unrecognizedLineCount, 0);
    assert.strictEqual(result.unrecognizedRatio, 0);
    assert.strictEqual(result.shouldWarn, false);
  });
});

suite("normalize / collapse honors the display mask (#245)", () => {
  /** syslog 形式で、PID だけが行ごとに違う3行。 */
  const DIFFERENT_PID_LOG = [
    "Jan  2 03:04:05 host1 sshd[1234]: connection closed",
    "Jan  2 03:04:06 host1 sshd[2345]: connection closed",
    "Jan  2 03:04:07 host1 sshd[3456]: connection closed",
  ].join("\n");

  /** syslog 形式で、ホスト名だけが行ごとに違う3行。 */
  const DIFFERENT_HOST_LOG = [
    "Jan  2 03:04:05 host1 myapp: health check ok",
    "Jan  2 03:04:06 host2 myapp: health check ok",
    "Jan  2 03:04:07 host3 myapp: health check ok",
  ].join("\n");

  function parseSyslog(text: string) {
    return parseLog(text, { timestampFormats: [createSyslogFormat({ assumedYear: 2024 })] });
  }

  test("does not collapse lines that differ only by process id when no mask is configured", () => {
    const items = collapseRepeatedEntries(parseSyslog(DIFFERENT_PID_LOG), { threshold: 2 });

    assert.strictEqual(items.length, 3);
    assert.ok(items.every((item) => item.kind === "single"));
  });

  test("collapses lines that differ only by process id once the process id mask is on", () => {
    const items = collapseRepeatedEntries(parseSyslog(DIFFERENT_PID_LOG), {
      threshold: 2,
      mask: { maskProcessId: true },
    });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    assert.strictEqual(items[0].entries.length, 3);
  });

  test("does not collapse lines that differ only by syslog hostname when no mask is configured", () => {
    const items = collapseRepeatedEntries(parseSyslog(DIFFERENT_HOST_LOG), { threshold: 2 });

    assert.strictEqual(items.length, 3);
    assert.ok(items.every((item) => item.kind === "single"));
  });

  test("collapses lines that differ only by syslog hostname once the host mask is on", () => {
    const items = collapseRepeatedEntries(parseSyslog(DIFFERENT_HOST_LOG), {
      threshold: 2,
      mask: { maskHost: true },
    });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
  });

  test("keeps masking IP addresses without any mask option, as it always has", () => {
    const text = [
      "2024-01-02T03:04:05Z WARNING Connection from 10.0.0.20 refused",
      "2024-01-02T03:04:06Z WARNING Connection from 10.0.0.21 refused",
      "2024-01-02T03:04:07Z WARNING Connection from 10.0.0.22 refused",
    ].join("\n");

    const items = collapseRepeatedEntries(parseLog(text), { threshold: 2 });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
  });

  test("leaves entries with genuinely different messages apart even with every mask on", () => {
    const text = [
      "Jan  2 03:04:05 host1 sshd[1234]: connection closed",
      "Jan  2 03:04:06 host1 sshd[2345]: session opened",
      "Jan  2 03:04:07 host1 sshd[3456]: connection closed",
    ].join("\n");

    const items = collapseRepeatedEntries(parseSyslog(text), {
      threshold: 2,
      mask: { maskHost: true, maskProcessId: true, maskTimestamp: true },
    });

    assert.strictEqual(items.length, 3);
    assert.ok(items.every((item) => item.kind === "single"));
  });

  test("groups the display items too, showing the masked text in the header (#172)", () => {
    const items = buildInteractiveCollapsedLines(parseSyslog(DIFFERENT_PID_LOG), {
      threshold: 2,
      mask: { maskProcessId: true },
    });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    assert.ok(items[0].headerText.includes("<PID>"), "the header should show the masked text");
    assert.match(items[0].headerText, /\(x3[,)]/);
    assert.strictEqual(items[0].lines.length, 3);
    assert.ok(
      items[0].lines.every((line) => line.includes("<PID>")),
      "the expanded lines should stay masked as they are today"
    );
  });

  test("groups the merged display items across files as well (#158)", () => {
    const merged = mergeLogFiles(
      [
        { fileName: "a.log", text: "Jan  2 03:04:05 host1 sshd[1234]: connection closed" },
        { fileName: "b.log", text: "Jan  2 03:04:06 host2 sshd[2345]: connection closed" },
      ],
      { timestampFormats: [createSyslogFormat({ assumedYear: 2024 })] }
    );

    const items = buildInteractiveMergedCollapsedLines(merged, {
      threshold: 2,
      mask: { maskHost: true, maskProcessId: true },
    });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    assert.deepStrictEqual(items[0].headerFileIndices, [0, 1]);
  });

  test("carries the same grouping into the exported virtual document (#175)", async () => {
    const result = await buildInteractiveExportText(
      parseSyslog(DIFFERENT_PID_LOG),
      {},
      { collapseThreshold: 2, mask: { maskProcessId: true } }
    );

    assert.strictEqual(result.ok, true);
    // 折りたたまれていれば見出し1行だけになる（書き出しは折りたたんだ状態を写す）。
    assert.strictEqual(result.formatted.text.split("\n").length, 1);
    assert.ok(result.formatted.text.includes("<PID>"));
  });
});

suite("normalize / assessTimestampRecognitionByFile (#186)", () => {
  /** タイムスタンプを含まないプレーンな行（警告条件を満たす12行）。 */
  const UNRECOGNIZED_LOG = Array.from({ length: 12 }, (_, i) => `plain line ${String(i + 1)}`).join("\n");

  /** 全行が ISO 8601 タイムスタンプ付きの正常なログ（12行）。 */
  const RECOGNIZED_LOG = Array.from(
    { length: 12 },
    (_, i) => `2024-01-02T03:04:${String(i).padStart(2, "0")}Z INFO line ${String(i + 1)}`
  ).join("\n");

  test("assesses each source file separately, so only the unrecognized one warns", () => {
    const merged = mergeLogFiles([
      { fileName: "bad.log", text: UNRECOGNIZED_LOG },
      { fileName: "good.log", text: RECOGNIZED_LOG },
    ]);

    const assessments = assessTimestampRecognitionByFile(merged, 2);

    assert.strictEqual(assessments.length, 2);
    assert.strictEqual(assessments[0].shouldWarn, true);
    assert.strictEqual(assessments[0].unrecognizedRatio, 1);
    assert.strictEqual(assessments[1].shouldWarn, false);
  });

  test("keeps same-named files in different folders apart (#137 と同じ fileIndex 基準)", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: RECOGNIZED_LOG },
      { fileName: "app.log", text: UNRECOGNIZED_LOG },
    ]);

    const assessments = assessTimestampRecognitionByFile(merged, 2);

    assert.strictEqual(assessments[0].shouldWarn, false);
    assert.strictEqual(assessments[1].shouldWarn, true);
  });

  test("returns a non-warning assessment for a file that contributed no entry", () => {
    const merged = mergeLogFiles([
      { fileName: "only.log", text: RECOGNIZED_LOG },
      { fileName: "empty.log", text: "" },
    ]);

    const assessments = assessTimestampRecognitionByFile(merged, 2);

    assert.strictEqual(assessments.length, 2);
    assert.strictEqual(assessments[1].totalLineCount, 0);
    assert.strictEqual(assessments[1].shouldWarn, false);
  });

  test("returns an empty list when nothing is loaded", () => {
    assert.deepStrictEqual(assessTimestampRecognitionByFile([], 0), []);
  });
});

suite("normalize / parseUtcOffsetMinutes (#13)", () => {
  test("parses colon-separated offsets", () => {
    assert.strictEqual(parseUtcOffsetMinutes("+09:00"), 540);
    assert.strictEqual(parseUtcOffsetMinutes("-05:30"), -330);
  });

  test("parses compact and hour-only offsets", () => {
    assert.strictEqual(parseUtcOffsetMinutes("+0900"), 540);
    assert.strictEqual(parseUtcOffsetMinutes("-05"), -300);
  });

  test("treats UTC and Z as a zero offset, case-insensitively", () => {
    assert.strictEqual(parseUtcOffsetMinutes("UTC"), 0);
    assert.strictEqual(parseUtcOffsetMinutes("utc"), 0);
    assert.strictEqual(parseUtcOffsetMinutes("Z"), 0);
    assert.strictEqual(parseUtcOffsetMinutes("+00:00"), 0);
  });

  test("ignores surrounding whitespace", () => {
    assert.strictEqual(parseUtcOffsetMinutes(" +09:00 "), 540);
  });

  test("rejects malformed or out-of-range offsets", () => {
    assert.strictEqual(parseUtcOffsetMinutes(""), undefined);
    assert.strictEqual(parseUtcOffsetMinutes("abc"), undefined);
    assert.strictEqual(parseUtcOffsetMinutes("09:00"), undefined);
    assert.strictEqual(parseUtcOffsetMinutes("+15:00"), undefined);
    assert.strictEqual(parseUtcOffsetMinutes("+09:60"), undefined);
  });
});

suite("normalize / formatTimestampForDisplay (#13)", () => {
  const epochMs = Date.UTC(2024, 0, 2, 3, 4, 5, 678);

  test("renders a zero offset with the Z suffix, matching the existing display", () => {
    assert.strictEqual(formatTimestampForDisplay(epochMs, 0), "2024-01-02T03:04:05.678Z");
  });

  test("renders a positive offset as shifted wall-clock time with the offset suffix", () => {
    assert.strictEqual(formatTimestampForDisplay(epochMs, 540), "2024-01-02T12:04:05.678+09:00");
  });

  test("renders a negative offset, including non-whole-hour minutes", () => {
    assert.strictEqual(formatTimestampForDisplay(epochMs, -330), "2024-01-01T21:34:05.678-05:30");
  });

  test("renders the host-local timezone so that the output round-trips to the same instant", () => {
    // ホストのタイムゾーンに依存させないため、値の決め打ちではなく
    // 「表示文字列を再解析すると元のエポックに戻る」性質で検証する。
    const output = formatTimestampForDisplay(epochMs, "local");
    assert.strictEqual(Date.parse(output), epochMs);
  });
});

suite("normalize / compileFileOffsetRules (#13)", () => {
  test("compiles valid rules and resolves the offset for a matching file name", () => {
    const { rules, errors } = compileFileOffsetRules([
      { filePattern: "server-a.*\\.log", offset: "+09:00" },
      { filePattern: "server-b.*\\.log", offset: "-05:00" },
    ]);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(resolveFileOffsetMinutes("server-a-20240101.log", rules), 540);
    assert.strictEqual(resolveFileOffsetMinutes("server-b-20240101.log", rules), -300);
  });

  test("returns undefined for a file name that matches no rule", () => {
    const { rules } = compileFileOffsetRules([
      { filePattern: "server-a.*\\.log", offset: "+09:00" },
    ]);
    assert.strictEqual(resolveFileOffsetMinutes("other.log", rules), undefined);
  });

  test("uses the first matching rule when multiple rules match", () => {
    const { rules } = compileFileOffsetRules([
      { filePattern: "server-.*", offset: "+09:00" },
      { filePattern: "server-a.*", offset: "-05:00" },
    ]);
    assert.strictEqual(resolveFileOffsetMinutes("server-a.log", rules), 540);
  });

  test("reports errors for invalid entries while keeping valid ones", () => {
    const { rules, errors } = compileFileOffsetRules([
      "oops",
      { filePattern: "(", offset: "+09:00" },
      { filePattern: "ok.*", offset: "bogus" },
      { filePattern: "valid.*", offset: "+02:00" },
    ]);

    assert.strictEqual(errors.length, 3);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(resolveFileOffsetMinutes("valid.log", rules), 120);
  });

  test("returns no rules and no errors for an empty setting", () => {
    const { rules, errors } = compileFileOffsetRules([]);
    assert.deepStrictEqual(rules, []);
    assert.deepStrictEqual(errors, []);
  });
});

suite("normalize / parseLog source timezone (#13)", () => {
  test("applies the source offset to timestamps without explicit zone information", () => {
    const [entry] = parseLog("2024-01-02 12:04:05 INFO hello", { sourceUtcOffsetMinutes: 540 });
    // +09:00 の壁時計 12:04:05 は UTC の 03:04:05。
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("applies a negative source offset", () => {
    const [entry] = parseLog("2024-01-01 22:04:05 INFO hello", { sourceUtcOffsetMinutes: -300 });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("does not shift Z-suffixed timestamps", () => {
    const [entry] = parseLog("2024-01-02T03:04:05Z INFO hello", { sourceUtcOffsetMinutes: 540 });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("does not shift timestamps with an explicit offset", () => {
    const [entry] = parseLog("2024-01-02T03:04:05+02:00 INFO hello", {
      sourceUtcOffsetMinutes: 540,
    });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 1, 4, 5));
  });

  test("does not shift epoch timestamps, which are absolute by definition", () => {
    const [entry] = parseLog("1704164645 INFO hello", { sourceUtcOffsetMinutes: 540 });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("applies the source offset to slash-date timestamps", () => {
    const [entry] = parseLog("2024/01/02 12:04:05 INFO hello", { sourceUtcOffsetMinutes: 540 });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("applies the source offset to syslog timestamps, which never carry a zone", () => {
    const [entry] = parseLog("Jan  2 12:04:05 host app: hello", {
      timestampFormats: [createSyslogFormat({ assumedYear: 2024 })],
      sourceUtcOffsetMinutes: 540,
    });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("applies the source offset to Apache access-log timestamps only when the offset part is omitted", () => {
    const [withoutZone] = parseLog("[02/Jan/2024:12:04:05] request done", {
      sourceUtcOffsetMinutes: 540,
    });
    assert.strictEqual(withoutZone.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));

    const [withZone] = parseLog("[02/Jan/2024:12:04:05 +0900] request done", {
      sourceUtcOffsetMinutes: 0,
    });
    assert.strictEqual(withZone.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("applies the source offset to custom calendar formats without timezone groups", () => {
    const { formats } = compileCustomTimestampFormats([
      {
        name: "jp-date",
        pattern:
          "(?<y>\\d{4})年(?<mo>\\d{1,2})月(?<d>\\d{1,2})日 (?<h>\\d{1,2}):(?<mi>\\d{2}):(?<s>\\d{2})",
      },
    ]);

    const [entry] = parseLog("2024年1月2日 12:04:05 INFO hello", {
      timestampFormats: formats,
      sourceUtcOffsetMinutes: 540,
    });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });
});

suite("normalize / mergeLogFiles per-file timezone (#13)", () => {
  test("merges files with different per-file source offsets into true chronological order", () => {
    // 壁時計上は tokyo.log の方が後（09:00 > 03:00）だが、+09:00 を適用すると
    // UTC では 00:00 となり utc.log（03:00）より前に並ぶのが正しい。
    const merged = mergeLogFiles([
      {
        fileName: "tokyo.log",
        text: "2024-01-02 09:00:00 INFO tokyo-entry",
        sourceUtcOffsetMinutes: 540,
      },
      { fileName: "utc.log", text: "2024-01-02 03:00:00 INFO utc-entry" },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["tokyo-entry", "utc-entry"]
    );
  });

  test("prefers the per-file offset over the offset in shared parse options", () => {
    const merged = mergeLogFiles(
      [
        {
          fileName: "tokyo.log",
          text: "2024-01-02 09:00:00 INFO tokyo-entry",
          sourceUtcOffsetMinutes: 540,
        },
        { fileName: "berlin.log", text: "2024-01-02 02:30:00 INFO berlin-entry" },
      ],
      { sourceUtcOffsetMinutes: 60 }
    );

    // tokyo.log は個別指定の +09:00（UTC 00:00）、berlin.log は共通指定の
    // +01:00（UTC 01:30）で解釈される。
    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["tokyo-entry", "berlin-entry"]
    );
    assert.strictEqual(merged[0].entry.timestampMs, Date.UTC(2024, 0, 2, 0, 0, 0));
    assert.strictEqual(merged[1].entry.timestampMs, Date.UTC(2024, 0, 2, 1, 30, 0));
  });
});

suite("normalize / display timezone in formatters (#13)", () => {
  test("formatNormalizedLog renders timestamps in the requested display timezone", () => {
    const entries = parseLog("[2024-01-02 03:04:05,678] INFO Starting up");
    const output = formatNormalizedLog(entries, { displayTimezone: 540 });

    assert.strictEqual(output, "1 | 2024-01-02T12:04:05.678+09:00 INFO Starting up");
  });

  test("formatNormalizedLog keeps the UTC (Z) display by default", () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");
    assert.strictEqual(formatNormalizedLog(entries), "1 | 2024-01-02T03:04:05.000Z INFO hello");
  });

  test("formatMergedLog renders timestamps in the requested display timezone", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO hello" },
    ]);
    const output = formatMergedLog(merged, { displayTimezone: 540 });

    assert.strictEqual(output, "app.log | app | 1 | 2024-01-02T12:04:05.000+09:00 INFO hello");
  });

  test("formatCollapsedLog renders timestamps in the requested display timezone", () => {
    const entries = parseLog("2024-01-02T03:04:05Z ERROR boom");
    const items = collapseRepeatedEntries(entries, { threshold: 3 });
    const output = formatCollapsedLog(entries, items, { displayTimezone: 540 });

    assert.strictEqual(output, "1 | 2024-01-02T12:04:05.000+09:00 ERROR boom");
  });
});

suite("normalize / compileClockSkewRules (#15)", () => {
  test("compiles valid rules and resolves the first matching one", () => {
    const { rules, errors } = compileClockSkewRules([
      { filePattern: "server-a.*\\.log", offsetSeconds: 37 },
      { filePattern: "server-.*\\.log", offsetSeconds: -5 },
    ]);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(rules.length, 2);
    // 先勝ちなので server-a はより広い2番目の規則ではなく1番目に解決される。
    assert.strictEqual(resolveClockSkewMs("server-a-20240101.log", rules), 37000);
    assert.strictEqual(resolveClockSkewMs("server-b-20240101.log", rules), -5000);
  });

  test("returns undefined when no rule matches", () => {
    const { rules } = compileClockSkewRules([
      { filePattern: "server-a.*\\.log", offsetSeconds: 37 },
    ]);
    assert.strictEqual(resolveClockSkewMs("other.log", rules), undefined);
  });

  test("accepts fractional seconds and converts them to milliseconds", () => {
    const { rules, errors } = compileClockSkewRules([
      { filePattern: "app\\.log", offsetSeconds: 1.5 },
    ]);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(resolveClockSkewMs("app.log", rules), 1500);
  });

  test("skips invalid entries with per-entry errors while keeping valid ones", () => {
    const { rules, errors } = compileClockSkewRules([
      "not-an-object",
      { filePattern: "", offsetSeconds: 1 },
      { filePattern: "[invalid", offsetSeconds: 1 },
      { filePattern: "a\\.log", offsetSeconds: "10" },
      { filePattern: "a\\.log", offsetSeconds: Number.NaN },
      { filePattern: "valid\\.log", offsetSeconds: 10 },
    ]);

    assert.strictEqual(errors.length, 5);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(resolveClockSkewMs("valid.log", rules), 10000);
  });

  test("returns no rules and no errors for an empty setting", () => {
    const { rules, errors } = compileClockSkewRules([]);
    assert.deepStrictEqual(rules, []);
    assert.deepStrictEqual(errors, []);
  });
});

suite("normalize / applyClockSkew (#15)", () => {
  test("shifts recognized timestamps by the skew, leaving the raw text untouched", () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");
    const shifted = applyClockSkew(entries, 37000);

    assert.strictEqual(shifted[0].timestampMs, Date.UTC(2024, 0, 2, 3, 4, 42));
    assert.strictEqual(shifted[0].raw, "2024-01-02T03:04:05Z INFO hello");
    assert.strictEqual(shifted[0].rawTimestamp, "2024-01-02T03:04:05Z");
    // 入力の配列・エントリは変更しない（純粋関数）。
    assert.strictEqual(entries[0].timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("shifts timestamps with an explicit offset too, unlike the source timezone offset", () => {
    // クロックスキューは「時計そのもののずれ」なので、タイムゾーン表記の
    // 有無にかかわらず全タイムスタンプへ適用されるのが正しい。
    const entries = parseLog("2024-01-02T12:04:05+09:00 INFO hello");
    const shifted = applyClockSkew(entries, -5000);
    assert.strictEqual(shifted[0].timestampMs, Date.UTC(2024, 0, 2, 3, 4, 0));
  });

  test("shifts epoch timestamps too", () => {
    const entries = parseLog("1704164645 INFO hello");
    const shifted = applyClockSkew(entries, 1000);
    assert.strictEqual(shifted[0].timestampMs, Date.UTC(2024, 0, 2, 3, 4, 6));
  });

  test("leaves entries without a recognized timestamp unchanged", () => {
    const entries = parseLog("no timestamp here");
    const shifted = applyClockSkew(entries, 37000);
    assert.strictEqual(shifted[0].timestampMs, undefined);
    assert.strictEqual(shifted[0].raw, "no timestamp here");
  });

  test("returns entries as-is for a zero skew", () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");
    const shifted = applyClockSkew(entries, 0);
    assert.strictEqual(shifted[0].timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });
});

suite("normalize / mergeLogFiles per-file clock skew (#15)", () => {
  test("merges files into corrected chronological order when a clock skew is applied", () => {
    // fast.log のホストは時計が40秒進んでいる想定。生の壁時計では
    // fast-entry（03:04:30）が after-entry（03:04:00）より後だが、-40秒の
    // 補正で 03:03:50 となり先頭に並ぶのが正しい。
    const merged = mergeLogFiles([
      { fileName: "fast.log", text: "2024-01-02T03:04:30Z INFO fast-entry", clockSkewMs: -40000 },
      { fileName: "steady.log", text: "2024-01-02T03:04:00Z INFO after-entry" },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => m.entry.message),
      ["fast-entry", "after-entry"]
    );
    assert.strictEqual(merged[0].entry.timestampMs, Date.UTC(2024, 0, 2, 3, 3, 50));
  });

  test("applies the clock skew on top of the per-file source timezone offset", () => {
    // +09:00 の壁時計 12:04:05 は UTC 03:04:05、そこへ +2 秒の補正が乗る。
    const merged = mergeLogFiles([
      {
        fileName: "tokyo.log",
        text: "2024-01-02 12:04:05 INFO tokyo-entry",
        sourceUtcOffsetMinutes: 540,
        clockSkewMs: 2000,
      },
    ]);
    assert.strictEqual(merged[0].entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 7));
  });
});

suite("normalize / formatNormalizedLogWithLineSources (#137)", () => {
  test("maps header and continuation lines to their physical source lines", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "  at Foo.bar",
      "2024-01-02T03:04:06Z INFO next",
    ].join("\n");
    const entries = parseLog(text);

    const { text: output, lineSources } = formatNormalizedLogWithLineSources(entries);

    assert.strictEqual(output, formatNormalizedLog(entries));
    assert.deepStrictEqual(lineSources, [
      { fileIndex: 0, line: 1 },
      { fileIndex: 0, line: 2 },
      { fileIndex: 0, line: 3 },
    ]);
  });

  test("keeps original line numbers for a filtered subset of entries", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO first",
      "2024-01-02T03:04:06Z ERROR second",
      "2024-01-02T03:04:07Z INFO third",
    ].join("\n");
    const filtered = filterEntriesBySeverity(parseLog(text), new Set(["ERROR"]));

    const { lineSources } = formatNormalizedLogWithLineSources(filtered);

    assert.deepStrictEqual(lineSources, [{ fileIndex: 0, line: 2 }]);
  });

  test("maps gap marker lines to undefined", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO before",
      "2024-01-02T03:05:05Z INFO after (60s later)",
    ].join("\n");
    const entries = parseLog(text);

    const { lineSources } = formatNormalizedLogWithLineSources(entries, {
      gapThresholdMs: 30_000,
    });

    assert.deepStrictEqual(lineSources, [
      { fileIndex: 0, line: 1 },
      undefined,
      { fileIndex: 0, line: 2 },
    ]);
  });

  test("returns empty results for no entries", () => {
    const { text, lineSources } = formatNormalizedLogWithLineSources([]);

    assert.strictEqual(text, "");
    assert.deepStrictEqual(lineSources, []);
  });
});

suite("normalize / mergeLogFiles fileIndex (#137)", () => {
  test("assigns each merged entry the index of its input file, distinguishing same-named files", () => {
    // 異なるフォルダの同名ファイル（fileName が同一）でも、入力配列の位置で
    // 元ファイルを識別できることを確認する。
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:06Z INFO from-first" },
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO from-second" },
    ]);

    assert.deepStrictEqual(
      merged.map((m) => ({ message: m.entry.message, fileIndex: m.fileIndex })),
      [
        { message: "from-second", fileIndex: 1 },
        { message: "from-first", fileIndex: 0 },
      ]
    );
  });
});

suite("normalize / formatMergedLogWithLineSources (#137)", () => {
  test("maps each display line to its source file index and physical line", () => {
    const merged = mergeLogFiles([
      {
        fileName: "app.log",
        text: ["2024-01-02T03:04:05Z ERROR boom", "  at Foo.bar"].join("\n"),
      },
      { fileName: "db.log", text: "2024-01-02T03:04:04Z INFO earlier" },
    ]);

    const { text: output, lineSources } = formatMergedLogWithLineSources(merged);

    assert.strictEqual(output, formatMergedLog(merged));
    assert.deepStrictEqual(lineSources, [
      { fileIndex: 1, line: 1 },
      { fileIndex: 0, line: 1 },
      { fileIndex: 0, line: 2 },
    ]);
  });

  test("maps gap marker lines to undefined", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "db.log", text: "2024-01-02T03:04:35Z ERROR after" },
    ]);

    const { lineSources } = formatMergedLogWithLineSources(merged, {
      gapThresholdMs: 30_000,
    });

    assert.deepStrictEqual(lineSources, [
      { fileIndex: 0, line: 1 },
      undefined,
      { fileIndex: 1, line: 1 },
    ]);
  });

  test("keeps the mapping after filtering merged entries", async () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO keep-me" },
      { fileName: "db.log", text: "2024-01-02T03:04:06Z ERROR drop-me" },
    ]);
    const result = await filterMergedEntriesByCriteria(merged, {
      severities: new Set(["INFO"]),
    });
    assert.strictEqual(result.ok, true);

    const { lineSources } = formatMergedLogWithLineSources(result.entries);

    assert.deepStrictEqual(lineSources, [{ fileIndex: 0, line: 1 }]);
  });
});

suite("normalize / formatCollapsedLogWithLineSources (#137)", () => {
  test("maps single entries and their continuation lines like the normalized view", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "  at Foo.bar",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    const { text: output, lineSources } = formatCollapsedLogWithLineSources(entries, items);

    assert.strictEqual(output, formatCollapsedLog(entries, items));
    assert.deepStrictEqual(lineSources, [
      { fileIndex: 0, line: 1 },
      { fileIndex: 0, line: 2 },
    ]);
  });

  test("maps a collapsed group header to the range start line", () => {
    // 折りたたみグループの移動先は「範囲開始行」（グループ先頭エントリの
    // 見出し行）とする仕様（issue #137 の設計メモ）。
    const text = [
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:06Z INFO connect ok",
      "2024-01-02T03:04:07Z INFO connect ok",
      "2024-01-02T03:04:08Z ERROR tail",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    const { lineSources } = formatCollapsedLogWithLineSources(entries, items);

    assert.deepStrictEqual(lineSources, [
      { fileIndex: 0, line: 1 },
      { fileIndex: 0, line: 4 },
    ]);
  });
});

suite("normalize / buildInteractiveExportText (#175)", () => {
  const sampleText = [
    "2024-01-02T03:04:05Z INFO connect ok",
    "2024-01-02T03:04:06Z INFO connect ok",
    "2024-01-02T03:04:07Z INFO connect ok",
    "2024-01-02T03:04:08Z ERROR tail",
  ].join("\n");

  test("matches filterEntriesByCriteria + formatNormalizedLogWithLineSources when collapseThreshold is not specified", async () => {
    const entries = parseLog(sampleText);
    const criteria = { severities: new Set(["INFO", "ERROR"]) };

    const result = await buildInteractiveExportText(entries, criteria);

    assert.strictEqual(result.ok, true);

    const filterResult = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(filterResult.ok, true);
    const expected = formatNormalizedLogWithLineSources(filterResult.entries);

    assert.strictEqual(result.formatted.text, expected.text);
    assert.deepStrictEqual(result.formatted.lineSources, expected.lineSources);
  });

  test("matches collapseRepeatedEntries + formatCollapsedLogWithLineSources when collapseThreshold is specified", async () => {
    const entries = parseLog(sampleText);
    const criteria = {};

    const result = await buildInteractiveExportText(entries, criteria, { collapseThreshold: 3 });

    assert.strictEqual(result.ok, true);

    const items = collapseRepeatedEntries(entries, { threshold: 3 });
    const expected = formatCollapsedLogWithLineSources(entries, items);

    assert.strictEqual(result.formatted.text, expected.text);
    assert.deepStrictEqual(result.formatted.lineSources, expected.lineSources);
    // 折りたたみが実際に効いていること（4行あるINFOの連続がまとまっている）も確認する。
    assert.match(result.formatted.text, /\(x3[,)]/);
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const result = await buildInteractiveExportText(
      entries,
      { ignorePatterns: [/hello/] },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });
});

suite("normalize / buildInteractiveMergedExportText (#175)", () => {
  const files = [
    {
      fileName: "app.log",
      text: [
        "2024-01-01T00:00:00Z ERROR before range",
        "2024-01-02T03:04:06Z ERROR in range and matching",
      ].join("\n"),
    },
    {
      fileName: "worker.log",
      text: [
        "2024-01-02T03:04:05Z INFO in range but wrong severity",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
      ].join("\n"),
    },
  ];

  test("matches filterMergedEntriesByCriteria + formatMergedLogWithLineSources composed manually", async () => {
    const mergedEntries = mergeLogFiles(files);
    const criteria = { severities: new Set(["ERROR"]) };

    const result = await buildInteractiveMergedExportText(mergedEntries, criteria);

    assert.strictEqual(result.ok, true);

    const filterResult = await filterMergedEntriesByCriteria(mergedEntries, criteria);
    assert.strictEqual(filterResult.ok, true);
    const expected = formatMergedLogWithLineSources(filterResult.entries);

    assert.strictEqual(result.formatted.text, expected.text);
    assert.deepStrictEqual(result.formatted.lineSources, expected.lineSources);
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const mergedEntries = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO hello" },
    ]);

    const result = await buildInteractiveMergedExportText(
      mergedEntries,
      { ignorePatterns: [/hello/] },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });
});

suite("normalize / file visibility (#170)", () => {
  const files = [
    { fileName: "app.log", text: "2024-01-02T03:04:05Z ERROR from app" },
    { fileName: "worker.log", text: "2024-01-02T03:04:06Z INFO from worker" },
  ];

  test("keeps only the entries whose file is visible", () => {
    const mergedEntries = mergeLogFiles(files);

    const kept = filterMergedEntriesByFileIndex(mergedEntries, new Set([1]));

    assert.deepStrictEqual(
      kept.map((merged) => merged.fileName),
      ["worker.log"]
    );
  });

  test("keeps every entry when no file selection is given", () => {
    const mergedEntries = mergeLogFiles(files);

    assert.deepStrictEqual(filterMergedEntriesByFileIndex(mergedEntries, undefined), mergedEntries);
  });

  test("drops every entry when no file is visible", () => {
    const mergedEntries = mergeLogFiles(files);

    assert.deepStrictEqual(filterMergedEntriesByFileIndex(mergedEntries, new Set()), []);
  });

  test("treats a missing file selection as everything visible", () => {
    assert.strictEqual(isFileIndexVisible(undefined, SINGLE_FILE_INDEX), true);
  });

  test("reports whether a single index is visible", () => {
    assert.strictEqual(isFileIndexVisible(new Set([0]), SINGLE_FILE_INDEX), true);
    assert.strictEqual(isFileIndexVisible(new Set([1]), SINGLE_FILE_INDEX), false);
  });

  test("hides a merged file's lines while keeping the severities and total of every loaded file", async () => {
    const mergedEntries = mergeLogFiles(files);

    const payload = await buildInteractiveMergedPayload(
      mergedEntries,
      {},
      { visibleFileIndices: new Set([0]) }
    );

    assert.strictEqual(payload.ok, true);
    assert.match(payload.text, /from app/);
    assert.doesNotMatch(payload.text, /from worker/);
    // 非表示にしたファイルのセベリティも、チェックボックスを消さないよう残す
    // （セベリティ絞り込みで0件になったときと同じ扱い）。
    assert.deepStrictEqual(payload.distinctSeverities, ["ERROR", "INFO"]);
    assert.strictEqual(payload.totalLineCount, 2);
    assert.strictEqual(payload.visibleLineCount, 1);
  });

  test("hides the only file of a single-file view without losing its severities or total", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z ERROR from app");

    const payload = await buildInteractivePayload(entries, {}, { visibleFileIndices: new Set() });

    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.text, "");
    assert.deepStrictEqual(payload.distinctSeverities, ["ERROR"]);
    assert.strictEqual(payload.totalLineCount, 1);
    assert.strictEqual(payload.visibleLineCount, 0);
  });

  test("writes out only the visible files when exporting a merged view", async () => {
    const mergedEntries = mergeLogFiles(files);

    const result = await buildInteractiveMergedExportText(
      mergedEntries,
      {},
      { visibleFileIndices: new Set([1]) }
    );

    assert.strictEqual(result.ok, true);
    assert.match(result.formatted.text, /from worker/);
    assert.doesNotMatch(result.formatted.text, /from app/);
  });

  test("writes out nothing when the only file of a single-file view is hidden", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z ERROR from app");

    const result = await buildInteractiveExportText(entries, {}, { visibleFileIndices: new Set() });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.formatted.text, "");
  });
});

suite("normalize / limitInteractiveDisplay (#178)", () => {
  test("returns the content unchanged when the line count is within the limit", () => {
    const content = { text: ["a", "b", "c"].join("\n") };

    const limited = limitInteractiveDisplay(content, 3);

    assert.strictEqual(limited.text, content.text);
    assert.strictEqual(limited.displayedLineCount, undefined);
  });

  test("keeps only the leading lines of text when the limit is exceeded", () => {
    const content = { text: ["a", "b", "c", "d"].join("\n") };

    const limited = limitInteractiveDisplay(content, 2);

    assert.strictEqual(limited.text, ["a", "b"].join("\n"));
    assert.strictEqual(limited.displayedLineCount, 2);
  });

  test("treats a non-positive limit as unlimited", () => {
    const content = { text: ["a", "b", "c"].join("\n") };

    const limited = limitInteractiveDisplay(content, 0);

    assert.strictEqual(limited.text, content.text);
    assert.strictEqual(limited.displayedLineCount, undefined);
  });

  test("counts a collapsed group by its expanded line count", () => {
    const content = {
      text: "",
      items: [
        { kind: "group", headerText: "g1", lines: ["l1", "l2", "l3"] },
        { kind: "line", text: "l4" },
      ] as const,
    };

    const limited = limitInteractiveDisplay(content, 3);

    assert.deepStrictEqual(limited.items, [content.items[0]]);
    assert.strictEqual(limited.displayedLineCount, 3);
  });

  test("keeps whole items and stops before the one that would exceed the limit", () => {
    const content = {
      text: "",
      items: [
        { kind: "line", text: "l1" },
        { kind: "group", headerText: "g1", lines: ["l2", "l3", "l4"] },
        { kind: "line", text: "l5" },
      ] as const,
    };

    // 1行目(1) + グループ(3) = 4 は上限3を超えるため、グループ手前で止まる。
    const limited = limitInteractiveDisplay(content, 3);

    assert.deepStrictEqual(limited.items, [content.items[0]]);
    assert.strictEqual(limited.displayedLineCount, 1);
  });

  test("truncates a single group's lines when the group alone exceeds the limit", () => {
    const content = {
      text: "",
      items: [{ kind: "group", headerText: "g1", lines: ["l1", "l2", "l3"] }] as const,
    };

    const limited = limitInteractiveDisplay(content, 2);

    assert.deepStrictEqual(limited.items, [
      { kind: "group", headerText: "g1", lines: ["l1", "l2"] },
    ]);
    assert.strictEqual(limited.displayedLineCount, 2);
  });

  test("truncates text and items together so both display paths respect the limit", () => {
    const content = {
      text: ["l1", "l2", "l3"].join("\n"),
      items: [
        { kind: "line", text: "l1" },
        { kind: "line", text: "l2" },
        { kind: "line", text: "l3" },
      ] as const,
    };

    const limited = limitInteractiveDisplay(content, 2);

    assert.strictEqual(limited.text, ["l1", "l2"].join("\n"));
    assert.deepStrictEqual(limited.items, [content.items[0], content.items[1]]);
    assert.strictEqual(limited.displayedLineCount, 2);
  });

  test("truncates lineSources together with the text they describe (#179)", () => {
    const content = {
      text: ["l1", "l2", "l3"].join("\n"),
      lineSources: [
        { fileIndex: 0, line: 1 },
        undefined,
        { fileIndex: 0, line: 2 },
      ] as const,
    };

    const limited = limitInteractiveDisplay(content, 2);

    assert.deepStrictEqual(limited.lineSources, [{ fileIndex: 0, line: 1 }, undefined]);
  });

  test("truncates a group's lineSources together with its lines (#179)", () => {
    const content = {
      text: "",
      items: [
        {
          kind: "group",
          headerText: "g1",
          lines: ["l1", "l2", "l3"],
          lineSources: [
            { fileIndex: 0, line: 1 },
            { fileIndex: 0, line: 2 },
            { fileIndex: 0, line: 3 },
          ],
        },
      ] as const,
    };

    const limited = limitInteractiveDisplay(content, 2);

    assert.deepStrictEqual(limited.items, [
      {
        kind: "group",
        headerText: "g1",
        lines: ["l1", "l2"],
        lineSources: [
          { fileIndex: 0, line: 1 },
          { fileIndex: 0, line: 2 },
        ],
      },
    ]);
  });
});

suite("normalize / compileHighlightRules (#18)", () => {
  test("compiles a rule with a name, a pattern and a palette color", () => {
    const { rules, errors } = compileHighlightRules([
      { name: "OOM", pattern: "OutOfMemory", color: "red" },
    ]);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].name, "OOM");
    assert.strictEqual(rules[0].color, "red");
    // 絞り込みの2欄（#182、#206）と同じ規則で解釈する: 大文字小文字を無視し、
    // 一致箇所を全て拾う。
    assert.strictEqual(rules[0].regex.test("java.lang.OUTOFMEMORYERROR"), true);
    assert.strictEqual(rules[0].regex.global, true);
  });

  test("falls back to a generated name and the default color when they are omitted", () => {
    const { rules, errors } = compileHighlightRules([{ pattern: "timeout" }]);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(rules[0].name, "highlight-1");
    assert.strictEqual(rules[0].color, DEFAULT_HIGHLIGHT_COLOR);
  });

  test("keeps the valid rules and reports the invalid ones one by one", () => {
    // 設定1項目のタイポで、残りのハイライトまで効かなくなるのを防ぐ
    // （`compileCustomTimestampFormats` と同じ縮退の仕方）。
    const { rules, errors } = compileHighlightRules([
      { name: "ok", pattern: "fine", color: "blue" },
      "not-an-object",
      { name: "no-pattern", color: "red" },
      { name: "bad-regex", pattern: "(unterminated" },
      { name: "bad-color", pattern: "fine", color: "chartreuse" },
    ]);

    assert.deepStrictEqual(
      rules.map((rule) => rule.name),
      ["ok"]
    );
    assert.strictEqual(errors.length, 4);
    assert.deepStrictEqual(errors[0], { code: "notAnObject", index: 1 });
    assert.deepStrictEqual(errors[1], { code: "missingNamedPattern", name: "no-pattern" });
    assert.ok(errors[2].code === "invalidNamedRegex" && errors[2].name === "bad-regex");
    // 使える色が分かること（色コードではなく名前で選ぶため）。
    assert.ok(errors[3].code === "invalidHighlightColor" && errors[3].name === "bad-color");
    assert.ok(errors[3].allowedColors.includes("red"));
  });
});

suite("normalize / highlightDisplayLines (#18)", () => {
  /** テストの意図（範囲の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function highlightOk(lines: readonly string[], settings: readonly unknown[]) {
    const { rules } = compileHighlightRules(settings);
    const result = await highlightDisplayLines(lines, rules);
    assert.strictEqual(result.ok, true);
    return new Map(result.highlights);
  }

  test("returns every occurrence in a line, with the rule's color", async () => {
    const line = "timeout while waiting, timeout again";

    const highlights = await highlightOk([line], [{ pattern: "timeout", color: "orange" }]);

    assert.deepStrictEqual(highlights.get(line), [
      { start: 0, end: 7, color: "orange" },
      { start: 23, end: 30, color: "orange" },
    ]);
  });

  test("keys the result by line text, so repeated lines are computed once (#18)", async () => {
    // ログは同じ行が繰り返されることが多い。行ごとに持つより、行文字列で
    // 引ける形にしたほうがメッセージが小さく、Webview側も引くだけで済む。
    const line = "OutOfMemory";

    const highlights = await highlightOk([line, "unrelated", line], [{ pattern: "OutOfMemory" }]);

    assert.strictEqual(highlights.size, 1);
    assert.ok(highlights.has(line));
  });

  test("omits lines that match nothing", async () => {
    const highlights = await highlightOk(["nothing here"], [{ pattern: "OutOfMemory" }]);

    assert.strictEqual(highlights.size, 0);
  });

  test("matches case-insensitively, like the filter pattern fields", async () => {
    const line = "Connection TIMED OUT";

    const highlights = await highlightOk([line], [{ pattern: "timed out" }]);

    assert.deepStrictEqual(highlights.get(line), [{ start: 11, end: 20, color: DEFAULT_HIGHLIGHT_COLOR }]);
  });

  test("lets the rule listed first win when two rules overlap", async () => {
    // 範囲が重なると描画時にどちらの色を出すか決められないため、設定の並びを
    // 優先順位として扱う（後勝ちだと、上に足したルールが効かなくなって驚く）。
    const line = "OutOfMemoryError";

    const highlights = await highlightOk([line], [
      { pattern: "OutOfMemory", color: "red" },
      { pattern: "MemoryError", color: "blue" },
    ]);

    assert.deepStrictEqual(highlights.get(line), [{ start: 0, end: 11, color: "red" }]);
  });

  test("keeps non-overlapping matches from several rules, sorted by position", async () => {
    const line = "OutOfMemory then a timeout";

    const highlights = await highlightOk([line], [
      { pattern: "timeout", color: "orange" },
      { pattern: "OutOfMemory", color: "red" },
    ]);

    assert.deepStrictEqual(highlights.get(line), [
      { start: 0, end: 11, color: "red" },
      { start: 19, end: 26, color: "orange" },
    ]);
  });

  test("terminates on a pattern that can match an empty string", async function () {
    this.timeout(5000);

    // 幅0のマッチは lastIndex が進まないため、進めないと無限ループになる。
    const highlights = await highlightOk(["abc"], [{ pattern: "x*" }]);

    // 幅0のマッチは描画しても何も見えないので、範囲としては残さない。
    assert.strictEqual(highlights.size, 0);
  });

  test("returns an empty result without spawning a worker when there are no rules", async () => {
    const highlights = await highlightOk(["anything"], []);

    assert.strictEqual(highlights.size, 0);
  });

  test("terminates and reports a timeout instead of hanging forever", async function () {
    this.timeout(5000);

    // 絞り込み・マスクと同じく、破局的バックトラッキングを起こす正規表現は
    // literal で置かず、安全なパターンに極端に短い timeoutMs を与えて
    // 打ち切りのコードパスを決定的に検証する。
    const { rules } = compileHighlightRules([{ pattern: "hello" }]);

    const result = await highlightDisplayLines(["hello"], rules, { timeoutMs: 1 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "timeout");
  });
});

suite("normalize / merged collapse (#158)", () => {
  /**
   * 2台のサーバが同じハートビートを出し、マージするとタイムスタンプ順に
   * 交互へ並ぶ状況。折りたたみが最も効いてほしい場面（issue #158 の動機）。
   */
  function interleavedHeartbeats() {
    return mergeLogFiles([
      {
        fileName: "server-a.log",
        text: [
          "2024-01-02T03:04:05Z INFO heartbeat ok",
          "2024-01-02T03:04:15Z INFO heartbeat ok",
        ].join("\n"),
      },
      {
        fileName: "server-b.log",
        text: [
          "2024-01-02T03:04:06Z INFO heartbeat ok",
          "2024-01-02T03:04:16Z INFO heartbeat ok",
        ].join("\n"),
      },
    ]);
  }

  test("collapseRepeatedMergedEntries groups repeats across different files", () => {
    // 由来ファイルでグループを分けると、交互に並ぶぶん1件も畳めない。
    const items = collapseRepeatedMergedEntries(interleavedHeartbeats(), { threshold: 3 });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "group");
    assert.deepStrictEqual(
      items[0].entries.map((merged) => merged.fileName),
      ["server-a.log", "server-b.log", "server-a.log", "server-b.log"]
    );
  });

  test("collapseRepeatedMergedEntries leaves a run below the threshold as singles", () => {
    const items = collapseRepeatedMergedEntries(interleavedHeartbeats(), { threshold: 5 });

    assert.strictEqual(items.length, 4);
    assert.ok(items.every((item) => item.kind === "single"));
  });

  test("collapseRepeatedMergedEntries keeps the source file of every grouped entry", () => {
    // ここが失われると、折りたたみからの Go to Source Line が全部1ファイル目へ飛ぶ。
    const items = collapseRepeatedMergedEntries(interleavedHeartbeats(), { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.deepStrictEqual(
      items[0].entries.map((merged) => merged.fileIndex),
      [0, 1, 0, 1]
    );
  });

  test("names the first file and marks that there are others in the group header", () => {
    const items = buildInteractiveMergedCollapsedLines(interleavedHeartbeats(), { threshold: 3 });

    assert.strictEqual(items.length, 1);
    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.match(items[0].headerText, /server-a\.log, etc\./);
    assert.match(items[0].headerText, /\(x4[,)]/);
  });

  test("keeps the multi-source mark short enough not to widen the columns much (#288)", () => {
    // ファイル名列の幅は候補値の最長で決まるため、印が長いとその列を使う全行が
    // 右へずれる。印だけで列が広がる量を、ファイル名そのものより短く保つ。
    const items = buildInteractiveMergedCollapsedLines(interleavedHeartbeats(), { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    // 列は `padEnd` で揃うので、他により長いファイル名があると末尾に空白が付く。
    // ここで見たいのは印の長さなので、パディングを落としてから比べる。
    const fileNameColumn = items[0].headerText.split(" | ")[0].trimEnd();
    assert.strictEqual(fileNameColumn, "server-a.log, etc.");
    assert.strictEqual(fileNameColumn.length - "server-a.log".length, 6);
  });

  test("reports every source file of the group, de-duplicated and in order", () => {
    // 展開しなくても由来が分かるようにする（見出しには代表1件しか出せないため）。
    // 名前ではなくインデックスで返し、フルパスへの解決は Webview 側に任せる。
    const items = buildInteractiveMergedCollapsedLines(interleavedHeartbeats(), { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.deepStrictEqual(items[0].headerFileIndices, [0, 1]);
  });

  test("marks a group spanning same-named files in different folders as multi-file (#137)", () => {
    // demo/merge-demo のように、別フォルダの同名ファイルをマージする構成。
    // 名前の一致で判定すると1ファイルのグループに見えてしまう。
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO heartbeat ok" },
      {
        fileName: "app.log",
        text: [
          "2024-01-02T03:04:06Z INFO heartbeat ok",
          "2024-01-02T03:04:07Z INFO heartbeat ok",
        ].join("\n"),
      },
    ]);

    const items = buildInteractiveMergedCollapsedLines(merged, { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.match(items[0].headerText, /app\.log, etc\./);
    assert.deepStrictEqual(items[0].headerFileIndices, [0, 1]);
    // 種別は両方 "app" で違いが無いので、そちらには印を付けない。
    assert.doesNotMatch(items[0].headerText, /app, etc\./);
  });

  test("shows the plain file name when the whole group comes from one file", () => {
    const merged = mergeLogFiles([
      {
        fileName: "server-a.log",
        text: [
          "2024-01-02T03:04:05Z INFO polling",
          "2024-01-02T03:04:06Z INFO polling",
          "2024-01-02T03:04:07Z INFO polling",
        ].join("\n"),
      },
    ]);

    const items = buildInteractiveMergedCollapsedLines(merged, { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.match(items[0].headerText, /server-a\.log/);
    assert.doesNotMatch(items[0].headerText, /, etc\./);
  });

  test("keeps each expanded line pointing at its own source file (#137)", () => {
    const items = buildInteractiveMergedCollapsedLines(interleavedHeartbeats(), { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.deepStrictEqual(
      items[0].lineSources?.map((source) => source.fileIndex),
      [0, 1, 0, 1]
    );
  });

  test("does not show a line-number range for a group spanning several files", () => {
    // 由来ファイルが違えば行番号は同じスケールではないため、範囲表示は意味を
    // 持たず、先頭より小さい終端（例: 8-5）にもなりうる。代表1件の行番号を出す。
    const merged = mergeLogFiles([
      {
        fileName: "server-a.log",
        text: [
          "2024-01-02T03:00:00Z INFO boot",
          "2024-01-02T03:00:01Z INFO boot",
          "2024-01-02T03:04:05Z INFO heartbeat ok",
          "2024-01-02T03:04:15Z INFO heartbeat ok",
        ].join("\n"),
      },
      {
        fileName: "server-b.log",
        text: [
          "2024-01-02T03:04:06Z INFO heartbeat ok",
          "2024-01-02T03:04:16Z INFO heartbeat ok",
        ].join("\n"),
      },
    ]);

    const items = buildInteractiveMergedCollapsedLines(merged, { threshold: 3 });

    const group = items.find((item) => item.kind === "group");
    assert.ok(group);
    // 先頭は server-a.log の3行目、末尾は server-b.log の2行目。範囲にすると 3-2。
    assert.doesNotMatch(group.headerText, /3-2/);
    assert.match(group.headerText, /\| +3 /);
  });

  test("keeps the file / kind columns aligned between the header and the expanded lines", () => {
    // 見出しだけ列がずれると、折りたたみを開いた瞬間に読みにくくなる（#174）。
    const items = buildInteractiveMergedCollapsedLines(interleavedHeartbeats(), { threshold: 3 });

    if (items[0].kind !== "group") {
      throw new Error("unreachable");
    }
    const columnsOf = (text: string) => text.split(" | ").slice(0, 2).map((part) => part.length);
    const headerColumns = columnsOf(items[0].headerText);
    for (const line of items[0].lines) {
      assert.deepStrictEqual(columnsOf(line), headerColumns);
    }
  });

  test("buildInteractiveMergedPayload collapses when a threshold is given", async () => {
    const payload = await buildInteractiveMergedPayload(interleavedHeartbeats(), {}, {
      collapseThreshold: 3,
    });

    assert.strictEqual(payload.ok, true);
    assert.ok(payload.items);
    assert.strictEqual(payload.items.length, 1);
    assert.strictEqual(payload.items[0].kind, "group");
  });

  test("buildInteractiveMergedPayload leaves the expanded text when no threshold is given", async () => {
    const payload = await buildInteractiveMergedPayload(interleavedHeartbeats(), {});

    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.items, undefined);
    assert.strictEqual(payload.text.split("\n").length, 4);
  });

  test("buildInteractiveMergedExportText carries the collapsed state over (#175)", async () => {
    // 書き出しだけ展開表示になると、#175 で揃えた「書き出しは表示の状態を
    // 引き継ぐ」が崩れる。
    const result = await buildInteractiveMergedExportText(interleavedHeartbeats(), {}, {
      collapseThreshold: 3,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.formatted.text.split("\n").length, 1);
    assert.match(result.formatted.text, /\(x4[,)]/);
    assert.match(result.formatted.text, /server-a\.log, etc\./);
  });

  test("buildInteractiveMergedExportText points the group header at the range start", async () => {
    const result = await buildInteractiveMergedExportText(interleavedHeartbeats(), {}, {
      collapseThreshold: 3,
    });

    if (!result.ok) {
      throw new Error("unreachable");
    }
    assert.deepStrictEqual(result.formatted.lineSources, [{ fileIndex: 0, line: 1 }]);
  });
});

suite("normalize / column alignment (#174)", () => {
  test("pads the severity column so every message starts at the same column", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO starting",
      "2024-01-02T03:04:06Z ERROR boom",
      "2024-01-02T03:04:07Z WARN slow",
    ].join("\n");

    assert.strictEqual(
      formatNormalizedLog(parseLog(text)),
      [
        "1 | 2024-01-02T03:04:05.000Z INFO  starting",
        "2 | 2024-01-02T03:04:06.000Z ERROR boom",
        "3 | 2024-01-02T03:04:07.000Z WARN  slow",
      ].join("\n")
    );
  });

  test("uses the widest severity actually displayed, not a fixed width", () => {
    // INFO しか出ないなら詰める余白は要らない。
    const text = [
      "2024-01-02T03:04:05Z INFO starting",
      "2024-01-02T03:04:06Z INFO done",
    ].join("\n");

    assert.strictEqual(
      formatNormalizedLog(parseLog(text)),
      [
        "1 | 2024-01-02T03:04:05.000Z INFO starting",
        "2 | 2024-01-02T03:04:06.000Z INFO done",
      ].join("\n")
    );
  });

  test("counts the placeholder of an unrecognized severity in the column width", () => {
    const text = [
      "2024-01-02T03:04:05Z ERROR boom",
      "2024-01-02T03:04:06Z something without a severity",
    ].join("\n");

    assert.strictEqual(
      formatNormalizedLog(parseLog(text)),
      [
        "1 | 2024-01-02T03:04:05.000Z ERROR boom",
        "2 | 2024-01-02T03:04:06.000Z -     something without a severity",
      ].join("\n")
    );
  });

  test("leaves entries without a recognized timestamp untouched", () => {
    // タイムスタンプもセベリティも出ない行は列そのものが無いので詰めない。
    // 先頭に置くのは、タイムスタンプのある行の後ろだとそのエントリの継続行に
    // 畳まれてしまい、独立したエントリにならないため。
    const text = ["==== banner ====", "2024-01-02T03:04:05Z ERROR boom"].join("\n");

    assert.strictEqual(
      formatNormalizedLog(parseLog(text)),
      ["1 | ==== banner ====", "2 | 2024-01-02T03:04:05.000Z ERROR boom"].join("\n")
    );
  });

  test("aligns the severity column in the merged view too", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO starting" },
      { fileName: "db.log", text: "2024-01-02T03:04:06Z ERROR boom" },
    ]);

    assert.strictEqual(
      formatMergedLog(merged),
      [
        "app.log | app | 1 | 2024-01-02T03:04:05.000Z INFO  starting",
        "db.log  | db  | 1 | 2024-01-02T03:04:06.000Z ERROR boom",
      ].join("\n")
    );
  });

  test("keeps the compare view unpadded so severity sets cannot desynchronize the diff", () => {
    // 左右で登場するセベリティが違うと列幅も変わり、本文が同じ行まで差分に
    // なってしまう。比較ビューだけは揃えない。
    const text = ["2024-01-02T03:04:05Z INFO starting", "2024-01-02T03:04:06Z ERROR boom"].join(
      "\n"
    );

    assert.strictEqual(
      formatMaskedLogForCompare(parseLog(text)),
      ["1 | <TIMESTAMP> INFO starting", "2 | <TIMESTAMP> ERROR boom"].join("\n")
    );
  });

  test("moves the group's end timestamp to the suffix so the header lines up with normal rows", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect ok",
      "2024-01-02T03:04:06Z INFO connect ok",
      "2024-01-02T03:04:07Z INFO connect ok",
      "2024-01-02T03:04:10Z ERROR boom",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      [
        "1-3 | 2024-01-02T03:04:05.000Z INFO  connect ok (x3, ~03:04:07.000Z)",
        "  4 | 2024-01-02T03:04:10.000Z ERROR boom",
      ].join("\n")
    );
  });

  test("spells the end timestamp out in full when the group crosses a date boundary", () => {
    const text = [
      "2024-01-02T23:59:58Z INFO connect ok",
      "2024-01-02T23:59:59Z INFO connect ok",
      "2024-01-03T00:00:01Z INFO connect ok",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      "1-3 | 2024-01-02T23:59:58.000Z INFO connect ok (x3, ~2024-01-03T00:00:01.000Z)"
    );
  });

  test("drops the span entirely when masking makes both ends render the same", () => {
    const text = [
      "2024-01-02T03:04:05Z INFO connect to 10.0.0.1 ok",
      "2024-01-02T03:04:06Z INFO connect to 10.0.0.2 ok",
      "2024-01-02T03:04:07Z INFO connect to 10.0.0.3 ok",
    ].join("\n");
    const entries = parseLog(text);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });

    assert.strictEqual(
      formatCollapsedLog(entries, items, {
        mask: { maskTimestamp: true, maskHost: true },
      }),
      "1-3 | <TIMESTAMP> INFO connect to <HOST> ok (x3)"
    );
  });
});

suite("normalize / continuation line indent (#256)", () => {
  const STACK_TRACE = [
    "2024-01-02T03:04:05Z ERROR Unhandled exception",
    "java.lang.NullPointerException",
    "    at com.example.Foo.bar(Foo.java:42)",
    "2024-01-02T03:04:06Z INFO recovered",
  ].join("\n");

  test("indents continuation lines to the message column, keeping their own indent", () => {
    // 見出しの「タイムスタンプ + 空白 + セベリティ + 空白」分だけ字下げする。
    const indent = " ".repeat("2024-01-02T03:04:05.000Z".length + 1 + "ERROR".length + 1);

    assert.strictEqual(
      formatNormalizedLog(parseLog(STACK_TRACE)),
      [
        "1 | 2024-01-02T03:04:05.000Z ERROR Unhandled exception",
        `2 | ${indent}java.lang.NullPointerException`,
        `3 | ${indent}    at com.example.Foo.bar(Foo.java:42)`,
        "4 | 2024-01-02T03:04:06.000Z INFO  recovered",
      ].join("\n")
    );
  });

  test("widens the indent with the display timezone", () => {
    const indent = " ".repeat("2024-01-02T12:04:05.000+09:00".length + 1 + "ERROR".length + 1);

    assert.strictEqual(
      formatNormalizedLog(parseLog(STACK_TRACE), { displayTimezone: 540 }),
      [
        "1 | 2024-01-02T12:04:05.000+09:00 ERROR Unhandled exception",
        `2 | ${indent}java.lang.NullPointerException`,
        `3 | ${indent}    at com.example.Foo.bar(Foo.java:42)`,
        "4 | 2024-01-02T12:04:06.000+09:00 INFO  recovered",
      ].join("\n")
    );
  });

  test("narrows the indent when the timestamp is masked", () => {
    const indent = " ".repeat("<TIMESTAMP>".length + 1 + "ERROR".length + 1);

    assert.strictEqual(
      formatNormalizedLog(parseLog(STACK_TRACE), { mask: { maskTimestamp: true } }),
      [
        "1 | <TIMESTAMP> ERROR Unhandled exception",
        `2 | ${indent}java.lang.NullPointerException`,
        `3 | ${indent}    at com.example.Foo.bar(Foo.java:42)`,
        "4 | <TIMESTAMP> INFO  recovered",
      ].join("\n")
    );
  });

  test("leaves the continuation lines of a timestamp-less entry where they are", () => {
    // 見出し自体がガター直後から始まるので、継続行を字下げすると自分の見出しより
    // 右にずれてしまう。
    const text = ["==== banner ====", "  second line of the banner"].join("\n");

    assert.strictEqual(
      formatNormalizedLog(parseLog(text)),
      ["1 | ==== banner ====", "2 |   second line of the banner"].join("\n")
    );
  });

  test("indents continuation lines in the merged view too", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: STACK_TRACE },
      { fileName: "db.log", text: "2024-01-02T03:04:07Z ERROR boom" },
    ]);
    const indent = " ".repeat("2024-01-02T03:04:05.000Z".length + 1 + "ERROR".length + 1);

    assert.strictEqual(
      formatMergedLog(merged),
      [
        "app.log | app | 1 | 2024-01-02T03:04:05.000Z ERROR Unhandled exception",
        `        |     | 2 | ${indent}java.lang.NullPointerException`,
        `        |     | 3 | ${indent}    at com.example.Foo.bar(Foo.java:42)`,
        "app.log | app | 4 | 2024-01-02T03:04:06.000Z INFO  recovered",
        "db.log  | db  | 1 | 2024-01-02T03:04:07.000Z ERROR boom",
      ].join("\n")
    );
  });

  test("indents the representative's continuation lines in a collapsed group", () => {
    const repeated = [
      "2024-01-02T03:04:05Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:06Z ERROR boom",
      "  detail",
      "2024-01-02T03:04:07Z ERROR boom",
      "  detail",
    ].join("\n");
    const entries = parseLog(repeated);
    const items = collapseRepeatedEntries(entries, { threshold: 3 });
    const indent = " ".repeat("2024-01-02T03:04:05.000Z".length + 1 + "ERROR".length + 1);

    assert.strictEqual(
      formatCollapsedLog(entries, items),
      [
        "1-6 | 2024-01-02T03:04:05.000Z ERROR boom (x3, ~03:04:07.000Z)",
        `  2 | ${indent}  detail`,
      ].join("\n")
    );
  });

  test("keeps the compare view's continuation lines unindented", () => {
    // #174 と同じ理由。左右で見出しの幅が食い違うと、本文が同じ行まで差分になる。
    assert.strictEqual(
      formatMaskedLogForCompare(parseLog(STACK_TRACE)),
      [
        "1 | <TIMESTAMP> ERROR Unhandled exception",
        "2 | java.lang.NullPointerException",
        "3 |     at com.example.Foo.bar(Foo.java:42)",
        "4 | <TIMESTAMP> INFO recovered",
      ].join("\n")
    );
  });
});
