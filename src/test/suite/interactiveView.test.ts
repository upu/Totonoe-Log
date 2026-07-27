import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  addNewlyAppearedSeverities,
  getLoadedDistinctSeverities,
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
import { reresolveLogFileOffsets } from "../../logFileReading";
import type { SerializedFilterCriteria } from "../../webview/interactiveView/protocol";

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
    ignorePattern: "",
    matchPattern: "",
    collapseEnabled: false,
    mask: { enabled: false, maskTimestamp: true, maskHost: true },
    visibleFiles: [],
    ...overrides,
  };
}

suite("interactiveViewCriteria / toFilterCriteria (#166)", () => {
  test("converts checked severities into a Set as-is", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ severities: ["ERROR", "INFO"] }), 0);

    assert.deepStrictEqual(criteria.severities, new Set(["ERROR", "INFO"]));
    assert.strictEqual(criteria.dateRange, undefined);
    assert.strictEqual(criteria.ignorePattern, undefined);
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

  test("drops an unparseable date boundary and reports an error", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ dateRangeStart: "not-a-date" }), 0);

    assert.deepStrictEqual(criteria.dateRange, { startMs: undefined, endMs: undefined });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /開始日時を解釈できませんでした/);
  });

  test("compiles a valid ignore pattern case-insensitively", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ ignorePattern: "heartbeat" }), 0);

    assert.ok(criteria.ignorePattern instanceof RegExp);
    assert.strictEqual(criteria.ignorePattern!.test("HEARTBEAT"), true);
    assert.deepStrictEqual(errors, []);
  });

  test("drops an invalid regex and reports an error", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ ignorePattern: "(unterminated" }), 0);

    assert.strictEqual(criteria.ignorePattern, undefined);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /正規表現として解釈できませんでした/);
  });

  test("omits matchPattern when the input is blank (#182)", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ matchPattern: "  " }), 0);

    assert.strictEqual(criteria.matchPattern, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("compiles a valid match pattern case-insensitively (#182)", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ matchPattern: "timeout" }), 0);

    assert.ok(criteria.matchPattern instanceof RegExp);
    assert.strictEqual(criteria.matchPattern!.test("TIMEOUT"), true);
    assert.deepStrictEqual(errors, []);
  });

  test("drops an invalid match pattern and reports an error naming the field (#182)", () => {
    const { criteria, errors } = toFilterCriteria(serializedCriteria({ matchPattern: "(unterminated" }), 0);

    assert.strictEqual(criteria.matchPattern, undefined);
    assert.strictEqual(errors.length, 1);
    // 入力欄が2つになるため、どちらの欄が不正なのかがメッセージから分かること。
    assert.match(errors[0], /一致パターン/);
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

suite("Totonoe Log interactive view (alpha, #166)", () => {
  test("registers the showInteractiveViewAlpha command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showInteractiveViewAlpha"),
      "totonoeLog.showInteractiveViewAlpha command should be registered"
    );
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
      (item) => item.command === "totonoeLog.showInteractiveViewAlpha"
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
      await vscode.commands.executeCommand("totonoeLog.showInteractiveViewAlpha", appLogUri);

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
        "totonoeLog.showInteractiveViewAlpha",
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

    await vscode.commands.executeCommand("totonoeLog.showInteractiveViewAlpha");

    const hasWebviewTab = (): boolean =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some((tab) => tab.input instanceof vscode.TabInputWebview);
    assert.ok(await waitFor(hasWebviewTab), "a webview tab should be opened");

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
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
