import * as assert from "node:assert";
import {
  parseLog,
  createSyslogFormat,
  formatNormalizedLog,
  formatMaskedLogForCompare,
  getDistinctSeverities,
  filterEntriesBySeverity,
  parseDateBoundary,
  filterEntriesByDateRange,
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

  test("filterEntriesByDateRange excludes entries without a recognized timestamp", () => {
    const text = ["==== banner ====", "2024-01-02T03:04:05Z INFO hello"].join("\n");
    const entries = parseLog(text);

    const filtered = filterEntriesByDateRange(entries, {});

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, "hello");
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
