import * as assert from "node:assert";
import {
  compileClockSkewRules,
  compileCustomTimestampFormats,
  compileFileOffsetRules,
  compileHighlightRules,
  SETTINGS_VALIDATION_ERROR_CODES,
  type SettingsValidationError,
} from "../../normalize";
import {
  formatSettingsValidationError,
  formatSettingsValidationErrors,
} from "../../settingsErrorMessages";

/**
 * 正規表現の `reason` は実行環境（V8）が出す文言なので、値そのものではなく
 * 「エンジンの説明が失われず運ばれていること」だけを確かめる。
 */
function assertRegexPropertyError(
  error: SettingsValidationError | undefined,
  expected: { index: number; property: string }
): void {
  assert.ok(error !== undefined && error.code === "invalidRegexProperty");
  assert.strictEqual(error.index, expected.index);
  assert.strictEqual(error.property, expected.property);
  assert.ok(error.reason.length > 0);
}

function assertNamedRegexError(
  error: SettingsValidationError | undefined,
  expected: { name: string }
): void {
  assert.ok(error !== undefined && error.code === "invalidNamedRegex");
  assert.strictEqual(error.name, expected.name);
  assert.ok(error.reason.length > 0);
}

/**
 * (2) 設定バリデーションのエラー文言（issue #279、案A）。`src/normalize/` は
 * VSCode API に依存できないため、文言そのものではなくメッセージコードと
 * パラメータを返し、組み立ては extension host 側が `vscode.l10n.t()` で行う。
 */
suite("normalize / settings validation errors (#279)", () => {
  test("compileFileOffsetRules reports message codes instead of prose", () => {
    const { rules, errors } = compileFileOffsetRules([
      "not an object",
      { offset: "+09:00" },
      { filePattern: "[", offset: "+09:00" },
      { filePattern: "app", offset: "nope" },
      { filePattern: "app", offset: "+09:00" },
    ]);

    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(
      errors.map((error) => error.code),
      ["notAnObject", "missingStringProperty", "invalidRegexProperty", "invalidUtcOffset"]
    );
    assert.deepStrictEqual(errors[0], { code: "notAnObject", index: 0 });
    assert.deepStrictEqual(errors[1], {
      code: "missingStringProperty",
      index: 1,
      property: "filePattern",
    });
    assertRegexPropertyError(errors[2], { index: 2, property: "filePattern" });
    assert.deepStrictEqual(errors[3], { code: "invalidUtcOffset", index: 3 });
  });

  test("compileClockSkewRules reports message codes instead of prose", () => {
    const { rules, errors } = compileClockSkewRules([
      null,
      { offsetSeconds: -40 },
      { filePattern: "(", offsetSeconds: -40 },
      { filePattern: "app", offsetSeconds: "-40" },
      { filePattern: "app", offsetSeconds: -40 },
    ]);

    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(errors[0], { code: "notAnObject", index: 0 });
    assert.deepStrictEqual(errors[1], {
      code: "missingStringProperty",
      index: 1,
      property: "filePattern",
    });
    assertRegexPropertyError(errors[2], { index: 2, property: "filePattern" });
    assert.deepStrictEqual(errors[3], { code: "invalidOffsetSeconds", index: 3 });
  });

  test("compileCustomTimestampFormats reports message codes instead of prose", () => {
    const { formats, errors } = compileCustomTimestampFormats([
      42,
      { name: "no-pattern" },
      { name: "broken", pattern: "(" },
      { name: "no-groups", pattern: "\\d+" },
      { name: "ok", pattern: "(?<epochMs>\\d+)" },
    ]);

    assert.strictEqual(formats.length, 1);
    assert.deepStrictEqual(errors[0], { code: "notAnObject", index: 0 });
    assert.deepStrictEqual(errors[1], { code: "missingNamedPattern", name: "no-pattern" });
    assertNamedRegexError(errors[2], { name: "broken" });
    assert.deepStrictEqual(errors[3], {
      code: "missingTimestampGroups",
      name: "no-groups",
      requiredGroups: ["y", "mo", "d", "h", "mi", "s"],
    });
  });

  test("compileHighlightRules reports message codes instead of prose", () => {
    const { rules, errors } = compileHighlightRules([
      "not an object",
      { name: "no-pattern" },
      { name: "broken", pattern: "(" },
      { name: "bad-color", pattern: "boom", color: "chartreuse" },
      { name: "ok", pattern: "boom", color: "red" },
    ]);

    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(errors[0], { code: "notAnObject", index: 0 });
    assert.deepStrictEqual(errors[1], { code: "missingNamedPattern", name: "no-pattern" });
    assertNamedRegexError(errors[2], { name: "broken" });
    assert.deepStrictEqual(errors[3], {
      code: "invalidHighlightColor",
      name: "bad-color",
      allowedColors: ["red", "orange", "yellow", "green", "blue", "purple"],
      actual: '"chartreuse"',
    });
  });

  test("falls back to a generated name when the entry omits one", () => {
    const { errors } = compileHighlightRules([{ pattern: "(" }]);

    assertNamedRegexError(errors[0], { name: "highlight-1" });
  });
});

/**
 * 文言の組み立ては extension host 側の責務（issue #279、案A）。テストホストの
 * 表示言語は `en` なので、`vscode.l10n.t()` はソース文字列をそのまま返す。
 */
suite("settingsErrorMessages (#279)", () => {
  const samples: Record<
    (typeof SETTINGS_VALIDATION_ERROR_CODES)[number],
    { error: SettingsValidationError; expected: string }
  > = {
    notAnObject: {
      error: { code: "notAnObject", index: 0 },
      expected: "Entry 1: not an object",
    },
    missingStringProperty: {
      error: { code: "missingStringProperty", index: 1, property: "filePattern" },
      expected: "Entry 2: filePattern (string) is missing",
    },
    invalidRegexProperty: {
      error: {
        code: "invalidRegexProperty",
        index: 2,
        property: "filePattern",
        reason: "Invalid group",
      },
      expected: "Entry 3: filePattern is not a valid regular expression (Invalid group)",
    },
    invalidUtcOffset: {
      error: { code: "invalidUtcOffset", index: 3 },
      expected: 'Entry 4: offset is invalid (specify a UTC offset such as "+09:00")',
    },
    invalidOffsetSeconds: {
      error: { code: "invalidOffsetSeconds", index: 4 },
      expected:
        "Entry 5: offsetSeconds is invalid (specify a number of seconds such as -40 or 1.5)",
    },
    missingNamedPattern: {
      error: { code: "missingNamedPattern", name: "custom-1" },
      expected: "custom-1: pattern (string) is missing",
    },
    invalidNamedRegex: {
      error: { code: "invalidNamedRegex", name: "custom-1", reason: "Invalid group" },
      expected: "custom-1: not a valid regular expression (Invalid group)",
    },
    missingTimestampGroups: {
      error: {
        code: "missingTimestampGroups",
        name: "custom-1",
        requiredGroups: ["year", "month", "day"],
      },
      expected:
        "custom-1: named capture groups are missing (include all of year month day, or epochMs / epochSec)",
    },
    invalidHighlightColor: {
      error: {
        code: "invalidHighlightColor",
        name: "highlight-1",
        allowedColors: ["yellow", "red"],
        actual: '"chartreuse"',
      },
      expected: 'highlight-1: color must be one of yellow / red (given: "chartreuse")',
    },
  };

  test("renders every message code", () => {
    // コードを増やして訳を書き忘れると、ここで気づける。
    assert.deepStrictEqual(
      Object.keys(samples).sort(),
      [...SETTINGS_VALIDATION_ERROR_CODES].sort()
    );

    for (const code of SETTINGS_VALIDATION_ERROR_CODES) {
      const { error, expected } = samples[code];
      assert.strictEqual(formatSettingsValidationError(error), expected, code);
    }
  });

  test("joins several errors into one warning line", () => {
    assert.strictEqual(
      formatSettingsValidationErrors([
        { code: "notAnObject", index: 0 },
        { code: "invalidUtcOffset", index: 1 },
      ]),
      'Entry 1: not an object / Entry 2: offset is invalid (specify a UTC offset such as "+09:00")'
    );
  });
});
