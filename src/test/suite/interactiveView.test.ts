import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  addNewlyAppearedSeverities,
  buildIgnoredInputWarning,
  compileMaskPattern,
  getLoadedDistinctSeverities,
  resolveIncomingCriteria,
  toFilterCriteria,
} from "../../interactiveViewCriteria";
import { mergeLogFiles, parseLog } from "../../normalize";
import {
  normalizeFileVisibility,
  removeFileVisibilityAt,
  selectNewFileUris,
  toVisibleFileIndices,
} from "../../interactiveViewFiles";
import { parseWebviewLineSource } from "../../interactiveViewContext";
import { classifyInteractiveViewConfigChange } from "../../interactiveViewConfigWatch";
import {
  resolveHighlightRulesTarget,
  toHighlightRuleRows,
  toHighlightRuleSettings,
} from "../../highlightRuleSettings";
import { DEFAULT_HIGHLIGHT_COLOR } from "../../normalize";
import { reresolveLogFileOffsets } from "../../logFileReading";
import type {
  SerializedFilterCriteria,
  SerializedFilterPattern,
} from "../../webview/interactiveView/protocol";

/** パターン欄1行分。テストの関心はほぼ入力文字列なので、既定でON（有効）とする。 */
function pattern(source: string, enabled = true): SerializedFilterPattern {
  return { source, enabled };
}

/**
 * `toFilterCriteria` が見るのは絞り込み条件だけなので、表示状態のフィールド
 * （折りたたみ・マスク）は既定値で埋め、各テストは関心のある入力だけを渡す。
 */
function serializedCriteria(
  overrides: Partial<SerializedFilterCriteria> = {}
): SerializedFilterCriteria {
  return {
    severities: [],
    dateRangeStart: "",
    dateRangeEnd: "",
    ignorePatterns: [],
    matchPatterns: [],
    collapseEnabled: false,
    mask: {
      enabled: false,
      maskTimestamp: true,
      maskHost: true,
      maskProcessId: false,
      keys: "",
      pattern: "",
    },
    visibleFiles: [],
    ...overrides,
  };
}

suite("interactiveViewCriteria / toFilterCriteria (#166)", () => {
  test("converts checked severities into a Set as-is", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ severities: ["ERROR", "INFO"] }), 0);

    assert.deepStrictEqual(criteria.severities, new Set(["ERROR", "INFO"]));
    assert.strictEqual(criteria.dateRange, undefined);
    assert.strictEqual(criteria.ignorePatterns, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("omits dateRange entirely when both boundary inputs are blank", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ dateRangeStart: "  " }), 0);

    assert.strictEqual(criteria.dateRange, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("parses a valid date range boundary", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ dateRangeStart: "2024-01-02", dateRangeEnd: "2024-01-03" }), 0);

    assert.deepStrictEqual(criteria.dateRange, {
      startMs: Date.UTC(2024, 0, 2, 0, 0, 0, 0),
      endMs: Date.UTC(2024, 0, 3, 23, 59, 59, 999),
    });
    assert.deepStrictEqual(errors, []);
  });

  test("ignores the date condition entirely when no boundary survived, and reports an error (#220)", () => {
    // 以前は `{ startMs: undefined, endMs: undefined }` を返していた。
    // `filterEntriesByDateRange` は DateRange が付いた時点でタイムスタンプ
    // 未認識のエントリを常に除外するため、日付条件は実質効いていないのに
    // 未認識行だけが黙って消えていた（issue #220）。
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ dateRangeStart: "not-a-date" }), 0);

    assert.strictEqual(criteria.dateRange, undefined);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /開始日時を解釈できませんでした/);
  });

  test("ignores the date condition when both boundaries are unparseable, reporting both (#220)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ dateRangeStart: "not-a-date", dateRangeEnd: "nope" }),
      0
    );

    assert.strictEqual(criteria.dateRange, undefined);
    assert.strictEqual(errors.length, 2);
  });

  test("keeps the boundary that did parse when only the other one is invalid (#220)", () => {
    // 片側が有効なら、その片側だけの範囲として適用する。入力済みの有効な境界を
    // 捨てないため（issue #220 の案1）。この場合はタイムスタンプ未認識行が
    // 除外されるが、ユーザーが実際に日付で絞り込んでいる以上それが筋。
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ dateRangeStart: "not-a-date", dateRangeEnd: "2024-01-03" }),
      0
    );

    assert.deepStrictEqual(criteria.dateRange, {
      startMs: undefined,
      endMs: Date.UTC(2024, 0, 3, 23, 59, 59, 999),
    });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /開始日時を解釈できませんでした/);
  });

  test("keeps a valid start when the end is the invalid one (#220)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ dateRangeStart: "2024-01-02", dateRangeEnd: "nope" }),
      0
    );

    assert.deepStrictEqual(criteria.dateRange, {
      startMs: Date.UTC(2024, 0, 2, 0, 0, 0, 0),
      endMs: undefined,
    });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /終了日時を解釈できませんでした/);
  });

  test("applies a one-sided range when only one boundary was entered", () => {
    // 既存挙動。片側だけ入力した場合はそのまま片側の範囲になる。
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ dateRangeStart: "2024-01-02" }), 0);

    assert.deepStrictEqual(criteria.dateRange, {
      startMs: Date.UTC(2024, 0, 2, 0, 0, 0, 0),
      endMs: undefined,
    });
    assert.deepStrictEqual(errors, []);
  });

  test("compiles a valid ignore pattern case-insensitively", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ ignorePatterns: [pattern("heartbeat")] }),
      0
    );

    assert.strictEqual(criteria.ignorePatterns?.length, 1);
    assert.strictEqual(criteria.ignorePatterns![0].test("HEARTBEAT"), true);
    assert.deepStrictEqual(errors, []);
  });

  test("drops an invalid regex and reports an error", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ ignorePatterns: [pattern("(unterminated")] }),
      0
    );

    assert.strictEqual(criteria.ignorePatterns, undefined);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /正規表現として解釈できませんでした/);
  });

  test("omits matchPatterns when the only row is blank (#182)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ matchPatterns: [pattern("  ")] }),
      0
    );

    assert.strictEqual(criteria.matchPatterns, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("compiles a valid match pattern case-insensitively (#182)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ matchPatterns: [pattern("timeout")] }),
      0
    );

    assert.strictEqual(criteria.matchPatterns?.length, 1);
    assert.strictEqual(criteria.matchPatterns![0].test("TIMEOUT"), true);
    assert.deepStrictEqual(errors, []);
  });

  test("drops an invalid match pattern and reports an error naming the field (#182)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({ matchPatterns: [pattern("(unterminated")] }),
      0
    );

    assert.strictEqual(criteria.matchPatterns, undefined);
    assert.strictEqual(errors.length, 1);
    // 入力欄が2つになるため、どちらの欄が不正なのかがメッセージから分かること。
    assert.match(errors[0], /一致パターン/);
    // 1件しか無いときは位置を添えない（「1件目」だけ言われても情報にならない）。
    assert.doesNotMatch(errors[0], /件目/);
  });

  test("compiles every enabled row, keeping the order they appear in (#206)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({
        matchPatterns: [pattern("connection"), pattern("payment")],
        ignorePatterns: [pattern("heartbeat"), pattern("polling")],
      }),
      0
    );

    assert.deepStrictEqual(
      criteria.matchPatterns?.map((compiled) => compiled.source),
      ["connection", "payment"]
    );
    assert.deepStrictEqual(
      criteria.ignorePatterns?.map((compiled) => compiled.source),
      ["heartbeat", "polling"]
    );
    assert.deepStrictEqual(errors, []);
  });

  test("skips rows whose checkbox is off, without removing them from the form (#206)", () => {
    // 個別ON/OFFは「消さずに一時的に外す」ための表示状態なので、条件からは
    // 外れるがエラーにもならない。
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({
        matchPatterns: [pattern("connection"), { source: "payment", enabled: false }],
      }),
      0
    );

    assert.deepStrictEqual(
      criteria.matchPatterns?.map((compiled) => compiled.source),
      ["connection"]
    );
    assert.deepStrictEqual(errors, []);
  });

  test("skips blank rows silently and keeps the rest (#206)", () => {
    // 空の欄は「まだ入力中」とみなす。エラーにすると、+ 追加 を押した直後に
    // 必ず警告が出てしまう。
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({
        ignorePatterns: [pattern("heartbeat"), pattern("   "), pattern("polling")],
      }),
      0
    );

    assert.deepStrictEqual(
      criteria.ignorePatterns?.map((compiled) => compiled.source),
      ["heartbeat", "polling"]
    );
    assert.deepStrictEqual(errors, []);
  });

  test("keeps duplicated rows as they were entered (#206)", () => {
    // 同じ欄の中は OR なので結果は変わらない。勝手に取り除くと、エコーバックで
    // ユーザーの入力を書き換えてしまう。
    const { criteria } = toFilterCriteria(
      serializedCriteria({ ignorePatterns: [pattern("heartbeat"), pattern("heartbeat")] }),
      0
    );

    assert.strictEqual(criteria.ignorePatterns?.length, 2);
  });

  test("names the offending row when several rows are present (#206)", () => {
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({
        matchPatterns: [pattern("connection"), pattern("(unterminated"), pattern("payment")],
      }),
      0
    );

    // 不正な1件だけを落とし、残りは適用する——どれが原因かは文言で分かる。
    assert.deepStrictEqual(
      criteria.matchPatterns?.map((compiled) => compiled.source),
      ["connection", "payment"]
    );
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /一致パターン/);
    assert.match(errors[0], /2件目/);
  });

  test("omits the field entirely when every row is blank or off (#206)", () => {
    // `undefined` にしておかないと、条件が空でもワーカーが起動してしまう。
    const { criteria, errors } = toFilterCriteria(
      serializedCriteria({
        matchPatterns: [pattern(""), { source: "payment", enabled: false }],
        ignorePatterns: [],
      }),
      0
    );

    assert.strictEqual(criteria.matchPatterns, undefined);
    assert.strictEqual(criteria.ignorePatterns, undefined);
    assert.deepStrictEqual(errors, []);
  });
});

suite("interactiveViewCriteria / compileMaskPattern (#195)", () => {
  test("returns no pattern for a blank input", () => {
    const { pattern, errors } = compileMaskPattern("  ");

    assert.strictEqual(pattern, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("compiles a pattern that replaces every occurrence, case-insensitively", () => {
    // マスクは絞り込みと違い「一致したか」ではなく「全ての一致箇所を置換する」
    // ため、g フラグ込みでコンパイルされていることを挙動で固定する。
    const { pattern, errors } = compileMaskPattern("user=\\w+");

    assert.ok(pattern instanceof RegExp);
    assert.strictEqual(
      "USER=alice and user=bob".replace(pattern!, "<MASKED>"),
      "<MASKED> and <MASKED>"
    );
    assert.deepStrictEqual(errors, []);
  });

  test("drops an invalid pattern and reports an error naming the field", () => {
    const { pattern, errors } = compileMaskPattern("(unterminated");

    assert.strictEqual(pattern, undefined);
    assert.strictEqual(errors.length, 1);
    // 入力欄が3つ（一致・無視・マスク）になるため、どの欄が不正なのかが分かること。
    assert.match(errors[0], /マスクパターン/);
  });
});

suite("interactiveViewCriteria / resolveIncomingCriteria (#217)", () => {
  test("takes the mask fields from the request itself, so a value typed just before Export survives", () => {
    // #217 の本体。テキスト欄は300msデバウンスされるため、入力直後に Export を
    // 押すと、拡張機能側が最後に受け取っていた条件（マスク欄が空）で書き出して
    // しまい、伏せたつもりの情報が残っていた。書き出し要求が運んできた条件を
    // そのまま使うことを固定する。
    const justTyped = serializedCriteria({
      mask: {
        enabled: true,
        maskTimestamp: true,
        maskHost: true,
        maskProcessId: false,
        keys: "token",
        pattern: "secret-\\w+",
      },
    });

    const resolved = resolveIncomingCriteria(justTyped, 1);

    assert.strictEqual(resolved.mask.keys, "token");
    assert.strictEqual(resolved.mask.pattern, "secret-\\w+");
    assert.strictEqual(resolved.mask.enabled, true);
  });

  test("takes the filter and display fields from the request too", () => {
    const incoming = serializedCriteria({
      severities: ["ERROR"],
      dateRangeStart: "2024-01-02",
      dateRangeEnd: "2024-01-03",
      matchPatterns: [pattern("timeout")],
      ignorePatterns: [pattern("heartbeat"), pattern("polling", false)],
      collapseEnabled: true,
    });

    const resolved = resolveIncomingCriteria(incoming, 1);

    assert.deepStrictEqual(resolved.severities, ["ERROR"]);
    assert.strictEqual(resolved.dateRangeStart, "2024-01-02");
    assert.strictEqual(resolved.dateRangeEnd, "2024-01-03");
    assert.deepStrictEqual(resolved.matchPatterns, [{ source: "timeout", enabled: true }]);
    // OFF の行も、消さずにそのまま返す（フォームの表示状態なので #206）。
    assert.deepStrictEqual(resolved.ignorePatterns, [
      { source: "heartbeat", enabled: true },
      { source: "polling", enabled: false },
    ]);
    assert.strictEqual(resolved.collapseEnabled, true);
  });

  test("fits visibleFiles to the current file count, as the filter path does", () => {
    // 絞り込みメッセージと同じくファイル数のずれを吸収する（issue #170）。
    // 書き出しだけ別扱いにすると、ファイル追加直後の書き出しで表示ON/OFFが
    // ずれる。
    const resolved = resolveIncomingCriteria(serializedCriteria({ visibleFiles: [false] }), 3);

    assert.deepStrictEqual(resolved.visibleFiles, [false, true, true]);
  });

  test("drops visibility entries for files that are already gone", () => {
    const resolved = resolveIncomingCriteria(
      serializedCriteria({ visibleFiles: [true, false, true] }),
      1
    );

    assert.deepStrictEqual(resolved.visibleFiles, [true]);
  });
});

suite("interactiveViewCriteria / buildIgnoredInputWarning (#217)", () => {
  test("stays silent when every input was understood", () => {
    assert.strictEqual(buildIgnoredInputWarning([]), undefined);
  });

  test("says the condition was not applied, so a silently dropped mask is noticed", () => {
    // 書き出しは押した時点の入力をそのまま使うため、その入力がまだ一度も
    // 描画されておらず、パネル内の警告行を見ていないことがある。不正なマスク
    // パターンが黙って外れたまま共有されるのを防ぐ。
    const warning = buildIgnoredInputWarning([
      'マスクパターンを正規表現として解釈できませんでした: "(unterminated"',
    ]);

    assert.ok(warning !== undefined);
    assert.match(warning, /マスクパターン/);
    assert.match(warning, /適用せずに書き出しました/);
  });

  test("joins several ignored inputs into one warning", () => {
    const warning = buildIgnoredInputWarning([
      '開始日時を解釈できませんでした: "not-a-date"',
      'マスクパターンを正規表現として解釈できませんでした: "(unterminated"',
    ]);

    assert.ok(warning !== undefined);
    assert.match(warning, /開始日時/);
    assert.match(warning, /マスクパターン/);
  });
});

suite("interactiveViewCriteria / severity defaults (#200)", () => {
  const single = parseLog("2024-01-02T03:04:05Z ERROR boom");
  const merged = mergeLogFiles([
    { fileName: "app.log", text: "2024-01-02T03:04:05Z WARN slow" },
    { fileName: "db.log", text: "2024-01-02T03:04:06Z INFO ok" },
  ]);

  test("reads the severities from the merged cache when that is the one in use", () => {
    // マージ表示中は単一ファイルのキャッシュが空になる。そこだけを見ていたため
    // 全セベリティがOFFで開いてしまっていた（issue #200）。
    // 並びはマージ後の時系列順（WARN のエントリの方が早い）。
    assert.deepStrictEqual(getLoadedDistinctSeverities([], merged), ["WARN", "INFO"]);
  });

  test("reads the severities from the single-file cache when that is the one in use", () => {
    assert.deepStrictEqual(getLoadedDistinctSeverities(single, []), ["ERROR"]);
  });

  test("returns an empty list when nothing is loaded", () => {
    assert.deepStrictEqual(getLoadedDistinctSeverities([], []), []);
  });

  test("checks severities that only appear after loading more files", () => {
    // 追加前は ERROR だけ、追加後に WARN が現れたケース。
    assert.deepStrictEqual(
      addNewlyAppearedSeverities(["ERROR"], ["ERROR"], ["ERROR", "WARN"]),
      ["ERROR", "WARN"]
    );
  });

  test("keeps severities the user had explicitly unchecked", () => {
    // INFO は既に現れていて外されている（明示的な操作なので尊重する）。
    assert.deepStrictEqual(
      addNewlyAppearedSeverities(["ERROR"], ["ERROR", "INFO"], ["ERROR", "INFO", "WARN"]),
      ["ERROR", "WARN"]
    );
  });

  test("does not duplicate a severity that is already checked", () => {
    assert.deepStrictEqual(
      addNewlyAppearedSeverities(["ERROR", "WARN"], ["ERROR", "WARN"], ["ERROR", "WARN"]),
      ["ERROR", "WARN"]
    );
  });
});

suite("interactiveViewFiles / selectNewFileUris (#168)", () => {
  test("returns candidates unchanged when nothing is already loaded", () => {
    const result = selectNewFileUris([], ["file:///a.log", "file:///b.log"]);
    assert.deepStrictEqual(result, ["file:///a.log", "file:///b.log"]);
  });

  test("excludes candidates that are already loaded", () => {
    const result = selectNewFileUris(
      ["file:///a.log"],
      ["file:///a.log", "file:///b.log"]
    );
    assert.deepStrictEqual(result, ["file:///b.log"]);
  });

  test("de-duplicates repeated candidates while preserving first-seen order", () => {
    const result = selectNewFileUris([], ["file:///b.log", "file:///a.log", "file:///b.log"]);
    assert.deepStrictEqual(result, ["file:///b.log", "file:///a.log"]);
  });

  test("returns an empty array when every candidate is already loaded", () => {
    const result = selectNewFileUris(["file:///a.log"], ["file:///a.log"]);
    assert.deepStrictEqual(result, []);
  });
});

suite("interactiveViewFiles / file visibility (#170)", () => {
  test("fills in newly loaded files as visible", () => {
    assert.deepStrictEqual(normalizeFileVisibility([false], 3), [false, true, true]);
  });

  test("drops the flags of files that are no longer loaded", () => {
    assert.deepStrictEqual(normalizeFileVisibility([true, false, true], 2), [true, false]);
  });

  test("keeps the flags untouched when the length already matches", () => {
    assert.deepStrictEqual(normalizeFileVisibility([true, false], 2), [true, false]);
  });

  test("starts from an empty state as everything visible", () => {
    assert.deepStrictEqual(normalizeFileVisibility([], 2), [true, true]);
  });

  test("collects the indices of the files that are visible", () => {
    assert.deepStrictEqual(toVisibleFileIndices([true, false, true]), new Set([0, 2]));
  });

  test("collects no index when every file is hidden", () => {
    assert.deepStrictEqual(toVisibleFileIndices([false, false]), new Set());
  });

  test("shifts the remaining flags down when a file is removed", () => {
    assert.deepStrictEqual(removeFileVisibilityAt([true, false, true], 0), [false, true]);
    assert.deepStrictEqual(removeFileVisibilityAt([true, false, true], 1), [true, true]);
  });

  test("leaves the flags untouched when the removed index does not exist", () => {
    assert.deepStrictEqual(removeFileVisibilityAt([true, false], 5), [true, false]);
  });
});

suite("interactiveViewContext / parseWebviewLineSource (#191)", () => {
  test("accepts a context object carrying a valid line source", () => {
    const parsed = parseWebviewLineSource({
      webviewSection: "totonoeLogInteractiveLine",
      lineSource: { fileIndex: 1, line: 42 },
    });

    assert.deepStrictEqual(parsed, { fileIndex: 1, line: 42 });
  });

  test("rejects a context object without a line source", () => {
    assert.strictEqual(parseWebviewLineSource({ webviewSection: "totonoeLogInteractiveLine" }), undefined);
    assert.strictEqual(parseWebviewLineSource(undefined), undefined);
    assert.strictEqual(parseWebviewLineSource("lineSource"), undefined);
  });

  test("rejects out-of-range or non-integer values", () => {
    // 1始まりの行番号・0始まりのファイル位置として成立しない値は、URI解決前に落とす。
    assert.strictEqual(parseWebviewLineSource({ lineSource: { fileIndex: 0, line: 0 } }), undefined);
    assert.strictEqual(parseWebviewLineSource({ lineSource: { fileIndex: -1, line: 1 } }), undefined);
    assert.strictEqual(parseWebviewLineSource({ lineSource: { fileIndex: 0, line: 1.5 } }), undefined);
    assert.strictEqual(
      parseWebviewLineSource({ lineSource: { fileIndex: 0, line: Number.NaN } }),
      undefined
    );
    assert.strictEqual(parseWebviewLineSource({ lineSource: { fileIndex: "0", line: "1" } }), undefined);
  });
});

/**
 * Webviewパネルがタブとして `vscode.window.tabGroups` に反映されるまでには、
 * パネル生成呼び出しの完了から1ティック以上のラグがありうる。テストの
 * flaky化を避けるため、短い間隔で一定時間ポーリングする。
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 25
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

suite("Totonoe Log interactive view (#166)", () => {
  test("registers the showInteractiveView command under its final id (#184)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showInteractiveView"),
      "totonoeLog.showInteractiveView command should be registered"
    );
    assert.ok(
      !commands.includes("totonoeLog.showInteractiveViewAlpha"),
      "the alpha-era command id should be gone"
    );

    const command = (
      extension!.packageJSON.contributes.commands as Array<{ command: string; title: string }>
    ).find((item) => item.command === "totonoeLog.showInteractiveView");
    assert.ok(command, "the command should be contributed in package.json");
    assert.strictEqual(command!.title, "Totonoe Log: Show Interactive View");
  });

  test("registers the webview context menu jump command, hidden from the palette (#191)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.goToSourceLineFromInteractiveView"),
      "totonoeLog.goToSourceLineFromInteractiveView command should be registered"
    );

    const menus = extension!.packageJSON.contributes.menus as Record<
      string,
      Array<{ command: string; when?: string }>
    >;
    const contextEntry = menus["webview/context"].find(
      (item) => item.command === "totonoeLog.goToSourceLineFromInteractiveView"
    );
    assert.ok(contextEntry, "webview/context should have a jump entry");
    assert.strictEqual(contextEntry!.when, "webviewSection == totonoeLogInteractiveLine");

    // 行のコンテキストからしか意味を持たないコマンドなので、パレットには出さない。
    const paletteEntry = menus.commandPalette.find(
      (item) => item.command === "totonoeLog.goToSourceLineFromInteractiveView"
    );
    assert.ok(paletteEntry, "commandPalette should have an entry hiding the command");
    assert.strictEqual(paletteEntry!.when, "false");
  });

  test("offers an explorer context menu entry for any file, single or multiple (#181, #201)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const menus = extension!.packageJSON.contributes.menus as Record<
      string,
      Array<{ command: string; when?: string }>
    >;
    const explorerEntry = menus["explorer/context"].find(
      (item) => item.command === "totonoeLog.showInteractiveView"
    );
    assert.ok(explorerEntry, "explorer/context should have an Interactive View entry");
    // マージ系（`listMultiSelection`）と違い1ファイルでも成立するため、
    // フォルダ以外なら出す（issue #201）。
    assert.strictEqual(explorerEntry!.when, "!explorerResourceIsFolder");
  });

  test("opens a single-file webview from an explorer single selection (#201)", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-interactive-single-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      const appLogUri = vscode.Uri.file(appLogPath);

      await vscode.commands.executeCommand("workbench.action.closeAllEditors");

      // 単一クリックでは VSCode が選択配列を渡さないことがあるため、
      // クリックされた項目だけで開けることを確認する。
      await vscode.commands.executeCommand("totonoeLog.showInteractiveView", appLogUri);

      const hasWebviewTab = (): boolean =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some((tab) => tab.input instanceof vscode.TabInputWebview);
      assert.ok(await waitFor(hasWebviewTab), "a webview tab should be opened");

      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("opens a webview tab from an explorer multi-selection, with no active editor (#181)", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-interactive-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "db.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:04Z ERROR boom");
      const appLogUri = vscode.Uri.file(appLogPath);
      const dbLogUri = vscode.Uri.file(dbLogPath);

      // エクスプローラ経由はアクティブエディタを前提にできないため、
      // 開いているエディタが無い状態から開けることまで含めて確認する。
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");

      await vscode.commands.executeCommand(
        "totonoeLog.showInteractiveView",
        appLogUri,
        [appLogUri, dbLogUri]
      );

      const hasWebviewTab = (): boolean =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some((tab) => tab.input instanceof vscode.TabInputWebview);
      assert.ok(await waitFor(hasWebviewTab), "a webview tab should be opened");

      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("opens a webview tab when invoked against an active log editor", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z ERROR boom",
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showInteractiveView");

    const webviewTab = (): vscode.Tab | undefined =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputWebview);
    assert.ok(await waitFor(() => webviewTab() !== undefined), "a webview tab should be opened");

    const tab = webviewTab()!;
    assert.ok(
      tab.label.startsWith("Totonoe Log: "),
      `the panel title should carry no (Alpha) marker, got "${tab.label}" (#184)`
    );
    // VSCode は `createWebviewPanel` の viewType に内部の接頭辞を付けてタブへ
    // 持たせるため、末尾一致で確認する。
    const viewType = (tab.input as vscode.TabInputWebview).viewType;
    assert.ok(
      viewType.endsWith("totonoeLog.interactiveView"),
      `the webview view type should have dropped its alpha suffix, got "${viewType}" (#184)`
    );

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});

suite("highlightRuleSettings / toHighlightRuleRows (#238)", () => {
  test("turns each setting entry into an editable row", () => {
    const rows = toHighlightRuleRows([
      { name: "OOM", pattern: "OutOfMemory", color: "red" },
      { name: "timeout", pattern: "timed? ?out", color: "orange" },
    ]);

    assert.deepStrictEqual(rows, [
      { name: "OOM", pattern: "OutOfMemory", color: "red" },
      { name: "timeout", pattern: "timed? ?out", color: "orange" },
    ]);
  });

  test("fills in the omitted name and color so every row has something to show", () => {
    const rows = toHighlightRuleRows([{ pattern: "timeout" }]);

    assert.deepStrictEqual(rows, [
      { name: "", pattern: "timeout", color: DEFAULT_HIGHLIGHT_COLOR },
    ]);
  });

  test("keeps a rule whose pattern is an invalid regex, so it can be repaired in the panel (#238)", () => {
    // ハイライトとしては compileHighlightRules が弾くが、パネルからは見えて
    // 直せる必要がある——隠すと「設定したのに一覧に無い」になる。
    const rows = toHighlightRuleRows([{ name: "broken", pattern: "(unterminated" }]);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].pattern, "(unterminated");
  });

  test("falls back to the default color when the configured one is not in the palette", () => {
    // ドロップダウンに無い値は選択状態を作れないため、既定色に寄せる。
    const rows = toHighlightRuleRows([{ pattern: "timeout", color: "chartreuse" }]);

    assert.strictEqual(rows[0].color, DEFAULT_HIGHLIGHT_COLOR);
  });

  test("skips entries that are not objects at all", () => {
    const rows = toHighlightRuleRows(["nonsense", null, { pattern: "kept" }]);

    assert.deepStrictEqual(
      rows.map((row) => row.pattern),
      ["kept"]
    );
  });

  test("treats a setting that is not an array as no rules at all", () => {
    // 設定は手で書けるので、宣言したスキーマ（array）どおりとは限らない。
    // ここで落ちると、ハイライトの読み取り経路ごと例外になる。
    assert.deepStrictEqual(toHighlightRuleRows({ pattern: "oops" } as never), []);
  });

  test("falls back to empty strings when the fields are not strings", () => {
    const rows = toHighlightRuleRows([{ name: 42, pattern: null, color: 7 }]);

    assert.deepStrictEqual(rows, [
      { name: "", pattern: "", color: DEFAULT_HIGHLIGHT_COLOR },
    ]);
  });
});

suite("highlightRuleSettings / toHighlightRuleSettings (#238)", () => {
  test("writes back the pattern, the color and a non-empty name", () => {
    const settings = toHighlightRuleSettings([
      { name: "OOM", pattern: "OutOfMemory", color: "red" },
    ]);

    assert.deepStrictEqual(settings, [{ name: "OOM", pattern: "OutOfMemory", color: "red" }]);
  });

  test("omits an empty name instead of writing an empty string", () => {
    // 設定ファイルに `"name": ""` が並ぶのを避ける（省略時は highlight-<番号>）。
    const settings = toHighlightRuleSettings([
      { name: "  ", pattern: "timeout", color: "orange" },
    ]);

    assert.deepStrictEqual(settings, [{ pattern: "timeout", color: "orange" }]);
  });

  test("drops rows whose pattern is still blank (#238)", () => {
    // 「+ 追加」を押した直後の行は、まだルールではないので設定に書かない。
    const settings = toHighlightRuleSettings([
      { name: "", pattern: "  ", color: "red" },
      { name: "", pattern: "kept", color: "blue" },
    ]);

    assert.deepStrictEqual(settings, [{ pattern: "kept", color: "blue" }]);
  });

  test("survives rows that are not shaped as expected", () => {
    // Webview からのメッセージは型が保証されないため、壊れた行で設定の
    // 書き戻しが例外になると表示の更新ごと壊れる。
    const settings = toHighlightRuleSettings([
      "nonsense",
      null,
      { pattern: 42 },
      { pattern: "kept", color: "chartreuse" },
    ]);

    assert.deepStrictEqual(settings, [{ pattern: "kept", color: DEFAULT_HIGHLIGHT_COLOR }]);
  });

  test("keeps the row order, since it is the overlap precedence (#18)", () => {
    const settings = toHighlightRuleSettings([
      { name: "", pattern: "first", color: "red" },
      { name: "", pattern: "second", color: "blue" },
    ]);

    assert.deepStrictEqual(
      settings.map((setting) => setting.pattern),
      ["first", "second"]
    );
  });
});

suite("highlightRuleSettings / resolveHighlightRulesTarget (#238)", () => {
  test("writes back to the workspace when the rules are defined there", () => {
    // チームで共有している設定を、書き戻しでユーザー設定側へ逃がさない。
    assert.strictEqual(
      resolveHighlightRulesTarget({ workspaceValue: [] }, true),
      vscode.ConfigurationTarget.Workspace
    );
  });

  test("writes back to the user settings when the rules are defined there", () => {
    assert.strictEqual(
      resolveHighlightRulesTarget({ globalValue: [] }, true),
      vscode.ConfigurationTarget.Global
    );
  });

  test("uses the user settings the first time, when the rules are defined nowhere", () => {
    // 何もしていないのに .vscode/settings.json が生まれて、gitの作業ツリーが
    // 汚れる驚きを避ける。
    assert.strictEqual(
      resolveHighlightRulesTarget({}, true),
      vscode.ConfigurationTarget.Global
    );
  });

  test("falls back to the user settings when no workspace is open to write to", () => {
    assert.strictEqual(
      resolveHighlightRulesTarget({ workspaceValue: [] }, false),
      vscode.ConfigurationTarget.Global
    );
  });
});

suite("interactiveViewConfigWatch / classifyInteractiveViewConfigChange (#183)", () => {
  /** `vscode.ConfigurationChangeEvent#affectsConfiguration` の代わりに使う、指定した設定だけを「変わった」と答える述語。 */
  function changed(...sections: readonly string[]): (section: string) => boolean {
    return (section) => sections.includes(section);
  }

  test("requires a re-parse when a setting that changes the parse result changes", () => {
    // パース結果に影響する設定（issue #183）。表示だけ作り直しても反映されない。
    for (const section of [
      "totonoeLog.timestampFormats",
      "totonoeLog.timezone.sourceOffset",
      "totonoeLog.timezone.fileOffsets",
      "totonoeLog.clockSkew.fileOffsets",
    ]) {
      assert.strictEqual(
        classifyInteractiveViewConfigChange(changed(section)),
        "reparse",
        `${section} should require a re-parse`
      );
    }
  });

  test("only needs a redisplay when a setting that affects formatting changes", () => {
    for (const section of [
      "totonoeLog.timezone.display",
      "totonoeLog.gap.thresholdSeconds",
      "totonoeLog.collapse.threshold",
      "totonoeLog.interactiveView.maxDisplayLines",
      // ハイライトルール（issue #18）は描画にだけ効くので送り直すだけでよい。
      "totonoeLog.highlightRules",
    ]) {
      assert.strictEqual(
        classifyInteractiveViewConfigChange(changed(section)),
        "redisplay",
        `${section} should only need a redisplay`
      );
    }
  });

  test("ignores settings the interactive view does not read", () => {
    assert.strictEqual(classifyInteractiveViewConfigChange(changed("editor.fontSize")), "none");
    assert.strictEqual(classifyInteractiveViewConfigChange(() => false), "none");
  });

  test("prefers the re-parse effect when both kinds of setting change at once", () => {
    assert.strictEqual(
      classifyInteractiveViewConfigChange(
        changed("totonoeLog.timezone.display", "totonoeLog.timestampFormats")
      ),
      "reparse"
    );
  });
});

suite("logFileReading / reresolveLogFileOffsets (#183)", () => {
  const loadedFile = {
    uri: vscode.Uri.file("/logs/app.log"),
    input: {
      fileName: "app.log",
      text: "2024-01-02 03:04:05 INFO hello",
      sourceUtcOffsetMinutes: 0,
      clockSkewMs: 0,
    },
  };

  test("picks up the offsets configured after the files were loaded", async function () {
    this.timeout(10000);
    const timezoneConfig = vscode.workspace.getConfiguration("totonoeLog.timezone");
    const clockSkewConfig = vscode.workspace.getConfiguration("totonoeLog.clockSkew");
    await timezoneConfig.update(
      "fileOffsets",
      [{ filePattern: "app\\.log", offset: "+09:00" }],
      vscode.ConfigurationTarget.Global
    );
    await clockSkewConfig.update(
      "fileOffsets",
      [{ filePattern: "app\\.log", offsetSeconds: 60 }],
      vscode.ConfigurationTarget.Global
    );

    try {
      const [reresolved] = reresolveLogFileOffsets([loadedFile]);

      // 読み込み時に解決した値が入力に焼き付いているため、再パースするだけでは
      // 設定変更が反映されない（issue #183）。
      assert.strictEqual(reresolved.input.sourceUtcOffsetMinutes, 540);
      assert.strictEqual(reresolved.input.clockSkewMs, 60000);
      // 再読み込みはしないので、本文とURIはそのまま引き継ぐ。
      assert.strictEqual(reresolved.input.text, loadedFile.input.text);
      assert.strictEqual(reresolved.input.fileName, "app.log");
      assert.strictEqual(reresolved.uri.toString(), loadedFile.uri.toString());
    } finally {
      await timezoneConfig.update("fileOffsets", undefined, vscode.ConfigurationTarget.Global);
      await clockSkewConfig.update("fileOffsets", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("falls back to no correction when no rule matches", () => {
    const [reresolved] = reresolveLogFileOffsets([
      { ...loadedFile, input: { ...loadedFile.input, sourceUtcOffsetMinutes: 540, clockSkewMs: 60000 } },
    ]);

    assert.strictEqual(reresolved.input.sourceUtcOffsetMinutes, 0);
    assert.strictEqual(reresolved.input.clockSkewMs, 0);
  });
});
