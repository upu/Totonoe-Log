import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseLog,
  compileCustomTimestampFormats,
  inferTimestampPattern,
  previewTimestampFormat,
  collectUnrecognizedLines,
  type TimestampPatternInferenceFailureReason,
} from "../../normalize";

/** 提案が通ったときの `pattern` を返す、テストの意図を明確にするためのヘルパー。 */
function inferredPattern(
  line: string,
  start: number,
  end: number,
  options?: Parameters<typeof inferTimestampPattern>[3]
): string {
  const result = inferTimestampPattern(line, start, end, options);
  assert.strictEqual(result.ok, true, `expected a proposal for "${line.slice(start, end)}"`);
  return result.proposal.pattern;
}

function assertRejected(
  line: string,
  start: number,
  end: number,
  reason: TimestampPatternInferenceFailureReason
): void {
  const result = inferTimestampPattern(line, start, end);
  assert.strictEqual(result.ok, false, `expected rejection for "${line.slice(start, end)}"`);
  assert.strictEqual(result.reason, reason);
}

suite("normalize / inferTimestampPattern (#320)", () => {
  test("infers a dotted DD.MM.YYYY pattern from the unrecognized-format demo log", () => {
    const demoRoot = path.resolve(__dirname, "../../..", "demo");
    const text = fs.readFileSync(path.join(demoRoot, "unrecognized-format.log"), "utf8");
    const [firstLine] = text.split(/\r\n|\r|\n/);

    const pattern = inferredPattern(firstLine, 0, "02.01.2024 03:04:00".length);
    const { formats } = compileCustomTimestampFormats([{ name: "dotted-date", pattern }]);
    const [entry] = parseLog(text, { timestampFormats: formats });
    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 0));
  });

  test("infers an ISO-like pattern with a T separator and a colon-separated offset", () => {
    const line = "2024-01-02T03:04:05+09:00 hello";
    const result = inferTimestampPattern(line, 0, "2024-01-02T03:04:05+09:00".length);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(
      [...result.proposal.groupNames].sort(),
      ["d", "h", "mi", "mo", "s", "tzh", "tzm", "tzs", "y"].sort()
    );

    const compiled = compileCustomTimestampFormats([{ name: "iso-like", pattern: result.proposal.pattern }]);
    assert.deepStrictEqual(compiled.errors, []);
    const [entry] = parseLog(line, { timestampFormats: compiled.formats });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 1, 18, 4, 5));
  });

  test("infers a slash-separated pattern with fractional milliseconds", () => {
    const line = "2024/1/2 3:04:05.678 hello";
    const pattern = inferredPattern(line, 0, "2024/1/2 3:04:05.678".length);
    const { formats } = compileCustomTimestampFormats([{ name: "slash", pattern }]);
    const [entry] = parseLog(line, { timestampFormats: formats });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("infers a 13-digit epochMs pattern", () => {
    const line = "ts=1704164645678 boom";
    const result = inferTimestampPattern(line, 3, 3 + "1704164645678".length);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.proposal.groupNames, ["epochMs"]);

    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-ms", pattern: result.proposal.pattern },
    ]);
    const [entry] = parseLog(line, { timestampFormats: formats });
    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("infers a 10-digit epochSec pattern with a fractional part", () => {
    const line = "1704164645.678 hello";
    const result = inferTimestampPattern(line, 0, "1704164645.678".length);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.proposal.groupNames, ["epochSec", "ms"]);

    const { formats } = compileCustomTimestampFormats([
      { name: "epoch-sec", pattern: result.proposal.pattern },
    ]);
    const [entry] = parseLog(line, { timestampFormats: formats });
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5, 678));
  });

  test("infers the Z, combined-offset, and hour-only offset timezone shapes", () => {
    const cases: readonly [string, number][] = [
      ["2024-01-02T03:04:05Z hello", Date.UTC(2024, 0, 2, 3, 4, 5)],
      ["2024-01-02T03:04:05z hello", Date.UTC(2024, 0, 2, 3, 4, 5)],
      ["2024-01-02T03:04:05+0900 hello", Date.UTC(2024, 0, 1, 18, 4, 5)],
      ["2024-01-02T03:04:05+09 hello", Date.UTC(2024, 0, 1, 18, 4, 5)],
    ];
    for (const [line, expected] of cases) {
      const timestampText = line.split(" ")[0];
      const pattern = inferredPattern(line, 0, timestampText.length);
      const compiled = compileCustomTimestampFormats([{ name: "tz-case", pattern }]);
      assert.deepStrictEqual(compiled.errors, [], line);
      const [entry] = parseLog(line, { timestampFormats: compiled.formats });
      assert.strictEqual(entry.timestampMs, expected, line);
    }
  });

  test("resolves the ambiguous day/month order from the year's position by default", () => {
    // 年が先頭（ISO風）→ 月→日、年が末尾（DD.MM.YYYY風）→ 日→月、という既定の
    // 使い分けを、それぞれの並びの実データで確認する。
    const isoLike = inferTimestampPattern("2024-03-02 03:04:05", 0, "2024-03-02 03:04:05".length);
    assert.strictEqual(isoLike.ok, true);
    assert.strictEqual(isoLike.proposal.ambiguousDayMonthOrder, true);
    const isoCompiled = compileCustomTimestampFormats([
      { name: "iso", pattern: isoLike.proposal.pattern },
    ]);
    const [isoEntry] = parseLog("2024-03-02 03:04:05", { timestampFormats: isoCompiled.formats });
    // year-first のときの既定は mdy: 03=month, 02=day → 3月2日。
    assert.strictEqual(isoEntry.timestampMs, Date.UTC(2024, 2, 2, 3, 4, 5));

    const dottedPattern = inferredPattern("02.03.2024 03:04:05", 0, "02.03.2024 03:04:05".length);
    const dottedCompiled = compileCustomTimestampFormats([{ name: "dotted", pattern: dottedPattern }]);
    const [dottedEntry] = parseLog("02.03.2024 03:04:05", { timestampFormats: dottedCompiled.formats });
    // year-last のときの既定は dmy: 02=day, 03=month → 3月2日。
    assert.strictEqual(dottedEntry.timestampMs, Date.UTC(2024, 2, 2, 3, 4, 5));
  });

  test("honors an explicit dayMonthOrder override for an ambiguous date", () => {
    const line = "2024-03-02 03:04:05";
    const pattern = inferredPattern(line, 0, line.length, { dayMonthOrder: "dmy" });
    const { formats } = compileCustomTimestampFormats([{ name: "override", pattern }]);
    const [entry] = parseLog(line, { timestampFormats: formats });
    // dmy を明示すると 03=day, 02=month → 2月3日。
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 1, 3, 3, 4, 5));
  });

  test("still matches when the selection does not start at the beginning of the line", () => {
    const line = "worker3: 2024-01-02T03:04:05Z hello";
    const timestampStart = line.indexOf("2024");
    const pattern = inferredPattern(
      line,
      timestampStart,
      timestampStart + "2024-01-02T03:04:05Z".length
    );
    const { formats } = compileCustomTimestampFormats([{ name: "prefixed", pattern }]);
    const [entry] = parseLog(line, { timestampFormats: formats });
    assert.strictEqual(entry.matched, true);
    assert.strictEqual(entry.timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  test("rejects a selection containing a month name", () => {
    assertRejected("Jan 2 03:04:05 host app: hi", 0, "Jan 2 03:04:05".length, "monthName");
  });

  test("rejects a two-digit year", () => {
    assertRejected("24-01-02 03:04:05", 0, "24-01-02 03:04:05".length, "twoDigitYear");
  });

  test("rejects a selection missing required fields", () => {
    assertRejected("03:04:05 hello", 0, "03:04:05".length, "missingFields");
  });

  test("rejects an empty selection", () => {
    assertRejected("   ", 0, 3, "emptySelection");
  });
});

suite("normalize / inferTimestampPattern suggestedName (#329)", () => {
  function suggestedNameFor(line: string, start: number, end: number): string {
    const result = inferTimestampPattern(line, start, end);
    assert.strictEqual(result.ok, true, `expected a proposal for "${line.slice(start, end)}"`);
    return result.proposal.suggestedName;
  }

  test("reflects the separators and field order of a dotted DD.MM.YYYY selection", () => {
    const name = suggestedNameFor(
      "02.01.2024 03:04:00 INFO started",
      0,
      "02.01.2024 03:04:00".length
    );
    assert.strictEqual(name, "DD.MM.YYYY_hh:mm:ss");
  });

  test("collapses the date/time boundary separator to an underscore regardless of its original character", () => {
    // ISO風の "T" 区切りも、DD.MM.YYYY の空白と同じ位置（日付と時刻の境界）
    // だけを "_" にする——日付内・時刻内の "-" ":" はそのまま残す。
    const name = suggestedNameFor("2024-01-02T03:04:05 hello", 0, "2024-01-02T03:04:05".length);
    assert.strictEqual(name, "YYYY-MM-DD_hh:mm:ss");
  });

  test("includes a fractional-seconds placeholder when the selection has one", () => {
    const name = suggestedNameFor(
      "02.01.2024 03:04:00.678 hello",
      0,
      "02.01.2024 03:04:00.678".length
    );
    assert.strictEqual(name, "DD.MM.YYYY_hh:mm:ss.SSS");
  });

  test("reflects an explicit dayMonthOrder override in the day/month placeholder order", () => {
    const line = "02.03.2024 03:04:05";
    const asDmy = inferTimestampPattern(line, 0, line.length, { dayMonthOrder: "dmy" });
    assert.strictEqual(asDmy.ok, true);
    assert.strictEqual(asDmy.proposal.suggestedName, "DD.MM.YYYY_hh:mm:ss");

    const asMdy = inferTimestampPattern(line, 0, line.length, { dayMonthOrder: "mdy" });
    assert.strictEqual(asMdy.ok, true);
    assert.strictEqual(asMdy.proposal.suggestedName, "MM.DD.YYYY_hh:mm:ss");
  });

  test("keeps the existing epoch names unchanged", () => {
    assert.strictEqual(suggestedNameFor("ts=1704164645678 boom", 3, 3 + 13), "custom-epoch-ms");
    assert.strictEqual(suggestedNameFor("1704164645.678 hello", 0, "1704164645.678".length), "custom-epoch-sec");
  });
});

suite("normalize / previewTimestampFormat (#320)", () => {
  test("returns the same error codes compileCustomTimestampFormats would produce", () => {
    const preview = previewTimestampFormat("broken", "(", ["2024-01-02 03:04:05"]);
    assert.strictEqual(preview.matches.length, 0);
    assert.strictEqual(preview.errors.length, 1);
    assert.strictEqual(preview.errors[0].code, "invalidNamedRegex");

    const missingGroups = previewTimestampFormat("no-groups", "\\d+", ["123"]);
    assert.strictEqual(missingGroups.errors[0].code, "missingTimestampGroups");
  });

  test("reports per-line matches, distinguishing regex match from valid parse", () => {
    const preview = previewTimestampFormat(
      "jp-date",
      "(?<y>\\d{4})\\.(?<mo>\\d{2})\\.(?<d>\\d{2}) (?<h>\\d{2}):(?<mi>\\d{2}):(?<s>\\d{2})",
      ["2024.01.02 03:04:05 hello", "2024.13.02 03:04:05 invalid month", "no timestamp here"]
    );
    assert.deepStrictEqual(preview.errors, []);
    assert.strictEqual(preview.matches.length, 3);

    assert.strictEqual(preview.matches[0].matched, true);
    assert.strictEqual(preview.matches[0].timestampMs, Date.UTC(2024, 0, 2, 3, 4, 5));
    assert.strictEqual(preview.matches[0].capturedGroups?.y, "2024");

    // 正規表現としてはマッチするが、13月という無効な日時。
    assert.strictEqual(preview.matches[1].matched, false);
    assert.notStrictEqual(preview.matches[1].matchedText, undefined);
    assert.strictEqual(preview.matches[1].timestampMs, undefined);

    assert.strictEqual(preview.matches[2].matched, false);
    assert.strictEqual(preview.matches[2].matchedText, undefined);
  });
});

suite("normalize / collectUnrecognizedLines (#320)", () => {
  test("collects lines only from the leading unmatched block, up to the limit", () => {
    // matched: false になり得るのは「最初に認識できたタイムスタンプより前の
    // 行」だけ（timestampCoverage.ts）。一度認識済みエントリが始まると、
    // 以降の未認識行はその継続行として吸収され、別エントリにはならない
    // ——"after the first match" の行が結果に混ざらないことも合わせて確認する。
    const entries = parseLog(
      "unrecognized one\nunrecognized two\nunrecognized three\n2024-01-02T03:04:05Z INFO ok\nafter the first match"
    );
    const lines = collectUnrecognizedLines(entries, 2);
    assert.deepStrictEqual(lines, ["unrecognized one", "unrecognized two"]);
  });

  test("skips blank lines, which are not evidence of an unsupported format", () => {
    const entries = parseLog("unrecognized one\n\nunrecognized two\n2024-01-02T03:04:05Z INFO ok");
    const lines = collectUnrecognizedLines(entries, 10);
    assert.deepStrictEqual(lines, ["unrecognized one", "unrecognized two"]);
  });

  test("flattens the continuation lines of a single unmatched block (unrecognized-format.log)", () => {
    // このファイルは全体で1エントリ（末尾の改行由来の空行を含め13行）になる。
    // lines[0] だけでは先頭行しか拾えないため、continuation を1行ずつ
    // 展開できていることを確認する。
    const demoRoot = path.resolve(__dirname, "../../..", "demo");
    const text = fs.readFileSync(path.join(demoRoot, "unrecognized-format.log"), "utf8");
    const entries = parseLog(text);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].matched, false);
    assert.strictEqual(entries[0].lines.length, 13);

    const lines = collectUnrecognizedLines(entries, 5);
    assert.strictEqual(lines.length, 5);
    assert.strictEqual(lines[0], "02.01.2024 03:04:00 INFO Batch job started");
    assert.strictEqual(lines[4], "02.01.2024 03:04:04 WARN Retrying connection (attempt 2)");
  });
});
