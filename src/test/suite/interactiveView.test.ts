import * as assert from "node:assert";
import * as vscode from "vscode";
import { toFilterCriteria } from "../../interactiveViewCriteria";

suite("interactiveViewCriteria / toFilterCriteria (#166)", () => {
  test("converts checked severities into a Set as-is", () => {
    const { criteria, errors } = toFilterCriteria(
      {
        severities: ["ERROR", "INFO"],
        dateRangeStart: "",
        dateRangeEnd: "",
        ignorePattern: "",
      },
      0
    );

    assert.deepStrictEqual(criteria.severities, new Set(["ERROR", "INFO"]));
    assert.strictEqual(criteria.dateRange, undefined);
    assert.strictEqual(criteria.ignorePattern, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("omits dateRange entirely when both boundary inputs are blank", () => {
    const { criteria, errors } = toFilterCriteria(
      {
        severities: [],
        dateRangeStart: "  ",
        dateRangeEnd: "",
        ignorePattern: "",
      },
      0
    );

    assert.strictEqual(criteria.dateRange, undefined);
    assert.deepStrictEqual(errors, []);
  });

  test("parses a valid date range boundary", () => {
    const { criteria, errors } = toFilterCriteria(
      {
        severities: [],
        dateRangeStart: "2024-01-02",
        dateRangeEnd: "2024-01-03",
        ignorePattern: "",
      },
      0
    );

    assert.deepStrictEqual(criteria.dateRange, {
      startMs: Date.UTC(2024, 0, 2, 0, 0, 0, 0),
      endMs: Date.UTC(2024, 0, 3, 23, 59, 59, 999),
    });
    assert.deepStrictEqual(errors, []);
  });

  test("drops an unparseable date boundary and reports an error", () => {
    const { criteria, errors } = toFilterCriteria(
      {
        severities: [],
        dateRangeStart: "not-a-date",
        dateRangeEnd: "",
        ignorePattern: "",
      },
      0
    );

    assert.deepStrictEqual(criteria.dateRange, { startMs: undefined, endMs: undefined });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /開始日時を解釈できませんでした/);
  });

  test("compiles a valid ignore pattern case-insensitively", () => {
    const { criteria, errors } = toFilterCriteria(
      {
        severities: [],
        dateRangeStart: "",
        dateRangeEnd: "",
        ignorePattern: "heartbeat",
      },
      0
    );

    assert.ok(criteria.ignorePattern instanceof RegExp);
    assert.strictEqual(criteria.ignorePattern!.test("HEARTBEAT"), true);
    assert.deepStrictEqual(errors, []);
  });

  test("drops an invalid regex and reports an error", () => {
    const { criteria, errors } = toFilterCriteria(
      {
        severities: [],
        dateRangeStart: "",
        dateRangeEnd: "",
        ignorePattern: "(unterminated",
      },
      0
    );

    assert.strictEqual(criteria.ignorePattern, undefined);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /正規表現として解釈できませんでした/);
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
