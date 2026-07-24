import * as assert from "node:assert";
import {
  parseLog,
  createSyslogFormat,
  compileCustomTimestampFormats,
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
  filterEntriesByCriteria,
  filterMergedEntriesByCriteria,
  assessTimestampRecognition,
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
} from "../../normalize";
import * as maskForCompare from "../../normalize/maskForCompare";

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

    const [boundary] = parseLog("2024.01.02 23:59:59.9999 +14:00 valid boundary", {
      timestampFormats: formats,
    });
    assert.strictEqual(boundary.matched, true);
    assert.strictEqual(boundary.timestampMs, Date.UTC(2024, 0, 2, 9, 59, 59, 999));
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
    assert.ok(errors[0].includes("broken"));
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

suite("normalize / filterEntriesByCriteria", () => {
  /** テストの意図（絞り込み結果の検証）を明確にするための、成功時のみ通すヘルパー。 */
  async function filterOk(
    entries: Parameters<typeof filterEntriesByCriteria>[0],
    criteria: Parameters<typeof filterEntriesByCriteria>[1]
  ) {
    const result = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
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

    const filtered = await filterOk(entries, { ignorePattern: /heartbeat/ });

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
      ignorePattern: /heartbeat/,
    });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "in range and matching");
  });

  test("propagates a timeout failure from the ignore pattern stage", async () => {
    const entries = parseLog("2024-01-02T03:04:05Z INFO hello");

    const result = await filterEntriesByCriteria(
      entries,
      { ignorePattern: /hello/ },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.reason, "timeout");
    }
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
    if (!payload.ok) {
      throw new Error("unreachable");
    }

    const filterResult = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(filterResult.ok, true);
    if (!filterResult.ok) {
      throw new Error("unreachable");
    }
    const expected = formatNormalizedLogWithLineSources(filterResult.entries);

    assert.strictEqual(payload.text, expected.text);
    assert.deepStrictEqual(payload.lineSources, expected.lineSources);
  });

  test("computes distinctSeverities from the unfiltered entries, not the filtered result", async () => {
    const entries = parseLog(sampleText);

    const payload = await buildInteractivePayload(entries, { severities: new Set(["ERROR"]) });

    assert.strictEqual(payload.ok, true);
    if (!payload.ok) {
      throw new Error("unreachable");
    }
    // INFO のエントリはフィルタで0件になるが、チェックボックス自体は残ってほしい。
    assert.deepStrictEqual(payload.distinctSeverities, getDistinctSeverities(entries));
    assert.ok(payload.distinctSeverities.includes("INFO"));
  });

  test("counts total and visible physical lines separately", async () => {
    const entries = parseLog(sampleText);

    const payload = await buildInteractivePayload(entries, { severities: new Set(["ERROR"]) });

    assert.strictEqual(payload.ok, true);
    if (!payload.ok) {
      throw new Error("unreachable");
    }
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
      { ignorePattern: /hello/ },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(payload.ok, false);
    if (!payload.ok) {
      assert.strictEqual(payload.reason, "timeout");
    }
  });

  test("omits items when collapseThreshold is not specified", async () => {
    const entries = parseLog(sampleText);

    const payload = await buildInteractivePayload(entries, {});

    assert.strictEqual(payload.ok, true);
    if (!payload.ok) {
      throw new Error("unreachable");
    }
    assert.strictEqual(payload.items, undefined);
  });

  test("computes items from the filtered entries when collapseThreshold is specified (#172)", async () => {
    const entries = parseLog(sampleText);
    const criteria = { severities: new Set(["ERROR"]) };

    const payload = await buildInteractivePayload(entries, criteria, { collapseThreshold: 3 });

    assert.strictEqual(payload.ok, true);
    if (!payload.ok) {
      throw new Error("unreachable");
    }

    const filterResult = await filterEntriesByCriteria(entries, criteria);
    assert.strictEqual(filterResult.ok, true);
    if (!filterResult.ok) {
      throw new Error("unreachable");
    }
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
    if (!payload.ok) {
      throw new Error("unreachable");
    }

    const filterResult = await filterMergedEntriesByCriteria(mergedEntries, criteria);
    assert.strictEqual(filterResult.ok, true);
    if (!filterResult.ok) {
      throw new Error("unreachable");
    }
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
    if (!payload.ok) {
      throw new Error("unreachable");
    }
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
    if (!payload.ok) {
      throw new Error("unreachable");
    }
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
      { ignorePattern: /hello/ },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(payload.ok, false);
    if (!payload.ok) {
      assert.strictEqual(payload.reason, "timeout");
    }
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
        .map((text) => ({ kind: "line", text }))
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
    if (item.kind !== "group") {
      throw new Error("unreachable");
    }
    // 見出しは formatCollapsedLog と同じ内容になる（範囲ラベル・タイムスタンプスパン・×N）。
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
    assert.deepStrictEqual(items[0], { kind: "line", text: "  1 | ==== banner ====" });
    assert.strictEqual(items[1].kind, "group");
    if (items[1].kind !== "group") {
      throw new Error("unreachable");
    }
    assert.strictEqual(
      items[1].headerText,
      "2-4 | 2024-01-02T03:04:05.000Z 〜 2024-01-02T03:04:07.000Z INFO ok (×3)"
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
    if (item.kind !== "group") {
      throw new Error("unreachable");
    }
    // ガター幅は範囲ラベル("1-6"、3桁)に合わせて揃うため、単独で
    // formatNormalizedLog(entries) を呼んだ場合（幅1桁）とは異なる。
    assert.deepStrictEqual(item.lines, [
      "  1 | 2024-01-02T03:04:05.000Z ERROR boom",
      "  2 |   detail",
      "  3 | 2024-01-02T03:04:06.000Z ERROR boom",
      "  4 |   detail",
      "  5 | 2024-01-02T03:04:07.000Z ERROR boom",
      "  6 |   detail",
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
      "1-3 | 2024-01-02T03:04:05.000Z 〜 2024-01-02T03:04:07.000Z INFO connect ok (×3)"
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
      "1-3 | 2024-01-02T03:04:05.000Z INFO connect ok (×3)"
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
      "1-3 | 2024-01-02T12:04:05.000+09:00 〜 2024-01-02T12:04:07.000+09:00 INFO connect ok (×3)"
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
        "2-4 | 2024-01-02T03:04:05.000Z 〜 2024-01-02T03:04:07.000Z INFO ok (×3)",
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
        "1-6 | 2024-01-02T03:04:05.000Z 〜 2024-01-02T03:04:07.000Z ERROR boom (×3)",
        "  2 |   detail",
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

  test("does not insert a gap marker when gapThresholdMs is not specified", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "database.log", text: "2024-01-02T03:05:05Z ERROR after (60s later)" },
    ]);

    const output = formatMergedLog(merged);

    assert.ok(!output.includes("空白"));
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
      `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO before`,
      `${" ".repeat(fileNameWidth)} | ${" ".repeat(kindWidth)} | ... | 30秒の空白`,
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

    assert.ok(!output.includes("空白"));
  });

  test("treats a gapThresholdMs of 0 as disabled", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO before" },
      { fileName: "database.log", text: "2024-01-02T03:04:06Z ERROR after" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 0 });

    assert.ok(!output.includes("空白"));
  });

  test("inserts multiple gap markers for multiple qualifying gaps", () => {
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO a" },
      { fileName: "database.log", text: "2024-01-02T03:04:35Z INFO b" },
      { fileName: "app.log", text: "2024-01-02T03:05:05Z INFO c" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 30_000 });

    assert.strictEqual((output.match(/秒の空白/g) ?? []).length, 2);
  });

  test("skips the gap check for a pair where an entry lacks a recognized timestamp", () => {
    // タイムスタンプ未認識のエントリは mergeLogFiles により末尾へ回るため、
    // 直前の認識済みエントリとの組でギャップ判定がスキップされることを確認する。
    const merged = mergeLogFiles([
      { fileName: "app.log", text: "2024-01-02T03:04:05Z INFO matched entry" },
      { fileName: "other.log", text: "totally unrecognized line" },
    ]);

    const output = formatMergedLog(merged, { gapThresholdMs: 30_000 });

    assert.ok(!output.includes("空白"));
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
    if (!filterResult.ok) {
      throw new Error("unreachable");
    }

    const output = formatMergedLog(filterResult.entries, { gapThresholdMs: 30_000 });

    assert.strictEqual((output.match(/秒の空白/g) ?? []).length, 1);
    assert.ok(output.includes("40秒の空白"));
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
    if (!filterResult.ok) {
      throw new Error("unreachable");
    }
    assert.deepStrictEqual(filterResult.entries, []);

    const output = formatMergedLog(merged, { gapThresholdMs: 30 * 60 * 1000 });
    assert.strictEqual((output.match(/秒の空白/g) ?? []).length, 1);
    assert.ok(output.includes("5400秒の空白"));
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    const filtered = await filterOk(sampleMerged, { ignorePattern: /heartbeat/ });

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
      ignorePattern: /heartbeat/,
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
      { ignorePattern: /heartbeat/ },
      { ignorePatternTimeoutMs: 1 }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.reason, "timeout");
    }
  });
});

suite("normalize / assessTimestampRecognition", () => {
  /** タイムスタンプを含まないプレーンな行を count 行分生成する。 */
  function plainLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `plain line ${i + 1}`).join("\n");
  }

  /** ISO 8601 タイムスタンプ付きの行を count 行分生成する。 */
  function timestampedLines(count: number): string {
    return Array.from(
      { length: count },
      (_, i) => `2024-01-02T03:04:${String(i % 60).padStart(2, "0")}Z INFO line ${i + 1}`
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
      (_, i) => `    at com.example.App.method${i}(App.java:${i + 1})`
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
    if (!result.ok) {
      throw new Error("unreachable");
    }

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
