import * as assert from "node:assert";
import {
  parseLog,
  createSyslogFormat,
  formatNormalizedLog,
  getDistinctSeverities,
  filterEntriesBySeverity,
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
