import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Totonoe Log extension", () => {
  test("activates and registers the showMergedView command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    assert.ok(extension, "extension should be discoverable by id");

    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showMergedView"),
      "totonoeLog.showMergedView command should be registered"
    );
  });

  test("registers the showNormalizedView command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showNormalizedView"),
      "totonoeLog.showNormalizedView command should be registered"
    );
  });
});

suite("Totonoe Log normalized view", () => {
  test("opens a read-only virtual document with the normalized content", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z ERROR boom",
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a normalized view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "1 | 2024-01-02T03:04:05.000Z ERROR boom"
    );
  });

  test("does not duplicate the file extension in the virtual document name", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const tempFilePath = path.join(tempDir, "app.log");
      await fs.writeFile(tempFilePath, "2024-01-02T03:04:05Z INFO hello");

      const source = await vscode.workspace.openTextDocument(vscode.Uri.file(tempFilePath));
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a normalized view editor should be shown");
      assert.match(activeEditor!.document.uri.path, /^\/app\.normalized-\d+\.log$/);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("keeps a leading dot intact for dotfiles with no other extension", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const tempFilePath = path.join(tempDir, ".env");
      await fs.writeFile(tempFilePath, "2024-01-02T03:04:05Z INFO hello");

      const source = await vscode.workspace.openTextDocument(vscode.Uri.file(tempFilePath));
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a normalized view editor should be shown");
      assert.match(activeEditor!.document.uri.path, /^\/\.env\.normalized-\d+\.log$/);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("release() clears cached content for the normalized-view scheme", async () => {
    const { NormalizedViewContentProvider, NORMALIZED_VIEW_SCHEME } = await import(
      "../../normalizedView"
    );
    const provider = new NormalizedViewContentProvider();
    const uri = vscode.Uri.from({ scheme: NORMALIZED_VIEW_SCHEME, path: "/sample.normalized-1.log" });

    provider.register(uri, "cached content");
    assert.strictEqual(provider.provideTextDocumentContent(uri), "cached content");

    provider.release(uri);
    assert.strictEqual(
      provider.provideTextDocumentContent(uri),
      "",
      "release() should drop the cached content for the given uri"
    );

    provider.dispose();
  });

  test("ignores release() for uris outside the normalized-view scheme", async () => {
    const { NormalizedViewContentProvider } = await import("../../normalizedView");
    const provider = new NormalizedViewContentProvider();

    const otherUri = vscode.Uri.parse("untitled:not-a-normalized-view");
    provider.register(otherUri, "should stay");
    provider.release(otherUri);

    assert.strictEqual(provider.provideTextDocumentContent(otherUri), "should stay");
    provider.dispose();
  });

  test("shows a warning when there is no active editor to normalize", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // コマンドが例外を投げずに完了することのみを確認する（警告メッセージの
    // 表示自体は vscode.window.showWarningMessage をモックしない限り検証できない）。
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
    });
  });
});

suite("Totonoe Log normalized view filtered by severity", () => {
  test("registers the showNormalizedViewFilteredBySeverity command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showNormalizedViewFilteredBySeverity"),
      "totonoeLog.showNormalizedViewFilteredBySeverity command should be registered"
    );
  });

  test("shows only entries matching the severities picked by the user", async function () {
    // 実物のドキュメントを開く操作を伴うため、CI環境の負荷次第で既定の
    // 2000msを超えることがある（issue #72）。前例に合わせて個別に緩和する。
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO starting",
        "2024-01-02T03:04:06Z ERROR boom",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) =>
      items.filter((item) => item.label === "ERROR");

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredBySeverity");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "2 | 2024-01-02T03:04:06.000Z ERROR boom"
    );
  });

  test("does nothing when the severity picker is dismissed", async function () {
    // 実物のドキュメントを開く操作を伴うため、CI環境の負荷次第で既定の
    // 2000msを超えることがある（issue #72）。前例に合わせて個別に緩和する。
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredBySeverity");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("shows a warning when there is no active editor to filter", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredBySeverity");
    });
  });
});

suite("Totonoe Log normalized view filtered by date range", () => {
  test("registers the showNormalizedViewFilteredByDateRange command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showNormalizedViewFilteredByDateRange"),
      "totonoeLog.showNormalizedViewFilteredByDateRange command should be registered"
    );
  });

  test("shows only entries within the date range entered by the user", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-01T00:00:00Z INFO before range",
        "2024-01-02T03:04:05Z INFO in range",
        "2024-01-03T00:00:00Z INFO after range",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowInputBox = vscode.window.showInputBox;
    let callCount = 0;
    (vscode.window as any).showInputBox = async () => {
      callCount += 1;
      return callCount === 1 ? "2024-01-02" : "2024-01-02T23:59:59";
    };

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let infoMessage: string | undefined;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredByDateRange");
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "2 | 2024-01-02T03:04:05.000Z INFO in range"
    );
    assert.ok(infoMessage?.includes("2"), "the hidden line count should be reported");
  });

  test("does nothing when the start date prompt is dismissed", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredByDateRange");
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("shows a warning and does nothing when an entered date cannot be parsed", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "not a date";

    try {
      await assert.doesNotReject(async () => {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredByDateRange");
      });
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("shows a warning when there is no active editor to filter", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredByDateRange");
    });
  });
});

suite("Totonoe Log normalized view filtered by date range and severity", () => {
  test("registers the showNormalizedViewFilteredByDateRangeAndSeverity command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity"),
      "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity command should be registered"
    );
  });

  test("shows only entries matching both the picked severities and the date range", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-01T00:00:00Z ERROR before range",
        "2024-01-02T03:04:05Z INFO in range but wrong severity",
        "2024-01-02T03:04:06Z ERROR in range and matching",
        "2024-01-03T00:00:00Z ERROR after range",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) =>
      items.filter((item) => item.label === "ERROR");

    const originalShowInputBox = vscode.window.showInputBox;
    let callCount = 0;
    (vscode.window as any).showInputBox = async () => {
      callCount += 1;
      return callCount === 1 ? "2024-01-02" : "2024-01-02T23:59:59";
    };

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let infoMessage: string | undefined;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity"
      );
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "3 | 2024-01-02T03:04:06.000Z ERROR in range and matching"
    );
    assert.ok(
      infoMessage?.includes("条件に合わない 3 行"),
      "the hidden line count should be reported"
    );
  });

  test("does nothing when the severity picker is dismissed", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity"
      );
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("does nothing when a date prompt is dismissed after picking severities", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => items;

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity"
      );
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("shows a warning when there is no active editor to filter", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity"
      );
    });
  });
});

suite("Totonoe Log normalized view filtered by ignore pattern", () => {
  test("registers the showNormalizedViewFilteredByIgnorePattern command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showNormalizedViewFilteredByIgnorePattern"),
      "totonoeLog.showNormalizedViewFilteredByIgnorePattern command should be registered"
    );
  });

  test("hides entries whose raw text matches the entered pattern", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO heartbeat ok",
        "2024-01-02T03:04:06Z ERROR boom",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "heartbeat";

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let infoMessage: string | undefined;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
      );
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "2 | 2024-01-02T03:04:06.000Z ERROR boom"
    );
    assert.ok(infoMessage?.includes("パターンに一致したエントリの 1 行"), "the hidden line count should be reported");
  });

  test("counts every physical line of a hidden multi-line entry, including non-matching continuation lines", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z ERROR boom",
        "    at com.example.Foo.bar(Foo.java:42)",
        "2024-01-02T03:04:06Z INFO keep",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "boom";

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let infoMessage: string | undefined;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
      );
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "3 | 2024-01-02T03:04:06.000Z INFO keep"
    );
    // マッチしたエントリは2物理行分（ERROR行＋スタックトレースの継続行）
    // にまたがっており、"boom" を含むのは先頭行だけである点に注意。
    assert.ok(
      infoMessage?.includes("パターンに一致したエントリの 2 行"),
      "the hidden line count should include the entry's continuation lines"
    );
  });

  test("supports a regular expression pattern", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z DEBUG verbose trace",
        "2024-01-02T03:04:06Z ERROR boom",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "^.*DEBUG.*$";

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
      );
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "2 | 2024-01-02T03:04:06.000Z ERROR boom"
    );
  });

  test("does nothing when the pattern prompt is dismissed", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
      );
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("trims surrounding whitespace from the entered pattern before matching", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO heartbeat ok",
        "2024-01-02T03:04:06Z ERROR boom",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "  heartbeat  ";

    try {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
      );
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "2 | 2024-01-02T03:04:06.000Z ERROR boom"
    );
  });

  test("shows a warning and does nothing when the entered pattern is not a valid regular expression", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "(unclosed";

    try {
      await assert.doesNotReject(async () => {
        await vscode.commands.executeCommand(
          "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
        );
      });
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("shows a warning when there is no active editor to filter", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand(
        "totonoeLog.showNormalizedViewFilteredByIgnorePattern"
      );
    });
  });
});

suite("Totonoe Log compare view", () => {
  test("registers the compareLogs command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.compareLogs"),
      "totonoeLog.compareLogs command should be registered"
    );
  });

  test("opens a diff between masked versions of the two selected files", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const firstPath = path.join(tempDir, "left.log");
      const secondPath = path.join(tempDir, "right.log");
      await fs.writeFile(firstPath, "2024-01-02T03:04:05Z ERROR connect to 192.168.1.10 failed");
      await fs.writeFile(secondPath, "2024-01-02T09:04:05Z ERROR connect to 10.0.0.1 failed");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      let callCount = 0;
      (vscode.window as any).showOpenDialog = async () => {
        callCount += 1;
        return [vscode.Uri.file(callCount === 1 ? firstPath : secondPath)];
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.compareLogs");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a diff editor should be shown");
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-compare");
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | <TIMESTAMP> ERROR connect to <HOST> failed"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("does nothing when the first file picker is cancelled", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowOpenDialog = vscode.window.showOpenDialog;
    (vscode.window as any).showOpenDialog = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.compareLogs");
    } finally {
      (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-compare");
  });

  test("does nothing when the second file picker is cancelled", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const firstPath = path.join(tempDir, "left.log");
      await fs.writeFile(firstPath, "2024-01-02T03:04:05Z INFO starting");

      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO starting",
        language: "log",
      });
      await vscode.window.showTextDocument(source);
      await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      let callCount = 0;
      (vscode.window as any).showOpenDialog = async () => {
        callCount += 1;
        return callCount === 1 ? [vscode.Uri.file(firstPath)] : undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.compareLogs");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "the original editor should remain active");
      assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-compare");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

suite("Totonoe Log copy masked text", () => {
  test("registers the copyMaskedText command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.copyMaskedText"),
      "totonoeLog.copyMaskedText command should be registered"
    );
  });

  test("copies masked text of the whole document when there is no selection", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO connect to 192.168.1.10 failed",
      language: "log",
    });
    const editor = await vscode.window.showTextDocument(source);
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    await vscode.commands.executeCommand("totonoeLog.copyMaskedText");

    const clipboardText = await vscode.env.clipboard.readText();
    assert.strictEqual(clipboardText, "<TIMESTAMP> INFO connect to <HOST> failed");
  });

  test("copies masked text of only the selected range when there is a selection", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO first line",
        "2024-01-02T03:04:06Z INFO second line 10.0.0.1",
      ].join("\n"),
      language: "log",
    });
    const editor = await vscode.window.showTextDocument(source);
    const secondLineRange = source.lineAt(1).range;
    editor.selection = new vscode.Selection(secondLineRange.start, secondLineRange.end);

    await vscode.commands.executeCommand("totonoeLog.copyMaskedText");

    const clipboardText = await vscode.env.clipboard.readText();
    assert.strictEqual(clipboardText, "<TIMESTAMP> INFO second line <HOST>");
  });

  test("shows a warning when there is no active editor to copy from", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.copyMaskedText");
    });
  });

  test("does not mask hosts when totonoeLog.copyMasked.maskHost is disabled", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.copyMasked");
    await config.update("maskHost", false, vscode.ConfigurationTarget.Global);

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO connect to 192.168.1.10 failed",
        language: "log",
      });
      const editor = await vscode.window.showTextDocument(source);
      editor.selection = new vscode.Selection(0, 0, 0, 0);

      await vscode.commands.executeCommand("totonoeLog.copyMaskedText");

      const clipboardText = await vscode.env.clipboard.readText();
      assert.strictEqual(clipboardText, "<TIMESTAMP> INFO connect to 192.168.1.10 failed");
    } finally {
      await config.update("maskHost", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite("Totonoe Log collapsed view", () => {
  test("registers the showCollapsedView command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showCollapsedView"),
      "totonoeLog.showCollapsedView command should be registered"
    );
  });

  test("collapses repeated entries into a single line annotated with the repeat count", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO connect ok",
        "2024-01-02T03:04:06Z INFO connect ok",
        "2024-01-02T03:04:07Z INFO connect ok",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showCollapsedView");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a collapsed view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "1-3 | 2024-01-02T03:04:05.000Z INFO connect ok (×3)"
    );
  });

  test("respects the totonoeLog.collapse.threshold setting", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.collapse");
    await config.update("threshold", 5, vscode.ConfigurationTarget.Global);

    try {
      const source = await vscode.workspace.openTextDocument({
        content: [
          "2024-01-02T03:04:05Z INFO connect ok",
          "2024-01-02T03:04:06Z INFO connect ok",
          "2024-01-02T03:04:07Z INFO connect ok",
        ].join("\n"),
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showCollapsedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a collapsed view editor should be shown");
      assert.strictEqual(
        activeEditor!.document.getText(),
        [
          "1 | 2024-01-02T03:04:05.000Z INFO connect ok",
          "2 | 2024-01-02T03:04:06.000Z INFO connect ok",
          "3 | 2024-01-02T03:04:07.000Z INFO connect ok",
        ].join("\n")
      );
    } finally {
      await config.update("threshold", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("shows a warning when there is no active editor to collapse", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.showCollapsedView");
    });
  });
});

suite("Totonoe Log merged view", () => {
  test("merges the selected files into a single chronologically-ordered view", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "database_20240101.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:04Z ERROR boom");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [
        vscode.Uri.file(appLogPath),
        vscode.Uri.file(dbLogPath),
      ];

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");

      const fileNameWidth = "database_20240101.log".length;
      const kindWidth = "database".length;
      assert.strictEqual(
        activeEditor!.document.getText(),
        [
          `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:04.000Z ERROR boom`,
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO hello`,
        ].join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("does nothing when the file picker is cancelled", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowOpenDialog = vscode.window.showOpenDialog;
    (vscode.window as any).showOpenDialog = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.showMergedView");
    } finally {
      (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");
  });
});

suite("Totonoe Log merge selected files (explorer context menu)", () => {
  test("registers the mergeSelectedFiles command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.mergeSelectedFiles"),
      "totonoeLog.mergeSelectedFiles command should be registered"
    );
  });

  test("merges the files passed as the explorer multi-selection, without prompting a file picker", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "database_20240101.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:04Z ERROR boom");

      const appUri = vscode.Uri.file(appLogPath);
      const dbUri = vscode.Uri.file(dbLogPath);

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      // ピッカーが呼ばれたらテストとして誤りなので、呼ばれたことが分かるよう失敗させる。
      (vscode.window as any).showOpenDialog = async () => {
        throw new Error("showOpenDialog should not be called when uris are passed explicitly");
      };

      try {
        // エクスプローラのコンテキストメニューは (クリックされた項目, 選択項目全体の配列) を渡す。
        await vscode.commands.executeCommand(
          "totonoeLog.mergeSelectedFiles",
          appUri,
          [appUri, dbUri]
        );
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");

      const fileNameWidth = "database_20240101.log".length;
      const kindWidth = "database".length;
      assert.strictEqual(
        activeEditor!.document.getText(),
        [
          `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:04.000Z ERROR boom`,
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO hello`,
        ].join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("shows a warning and does nothing when fewer than two files are selected", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      const appUri = vscode.Uri.file(appLogPath);

      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO starting",
        language: "log",
      });
      await vscode.window.showTextDocument(source);
      await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.mergeSelectedFiles", appUri, [appUri]);
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(
        warningMessage?.includes("2つ以上"),
        "a warning should explain that at least two files are required"
      );
      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "the original editor should remain active");
      assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ignores folders included in the selection and merges the remaining files", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "database_20240101.log");
      const subDirPath = path.join(tempDir, "subdir");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:04Z ERROR boom");
      await fs.mkdir(subDirPath);

      const appUri = vscode.Uri.file(appLogPath);
      const dbUri = vscode.Uri.file(dbLogPath);
      const subDirUri = vscode.Uri.file(subDirPath);

      await vscode.commands.executeCommand("totonoeLog.mergeSelectedFiles", subDirUri, [
        subDirUri,
        appUri,
        dbUri,
      ]);

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");

      const fileNameWidth = "database_20240101.log".length;
      const kindWidth = "database".length;
      assert.strictEqual(
        activeEditor!.document.getText(),
        [
          `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:04.000Z ERROR boom`,
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO hello`,
        ].join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

suite("Totonoe Log virtual document guard", () => {
  test("isTotonoeLogVirtualDocument recognizes the normalized, merged, and compare schemes", async () => {
    const { isTotonoeLogVirtualDocument } = await import("../../virtualDocumentContentProvider");

    const schemes = ["totonoe-log-normalized", "totonoe-log-merged", "totonoe-log-compare"];
    for (const scheme of schemes) {
      const fakeDocument = { uri: vscode.Uri.parse(`${scheme}:/sample.log`) } as vscode.TextDocument;
      assert.ok(
        isTotonoeLogVirtualDocument(fakeDocument),
        `${scheme} should be recognized as a Totonoe Log virtual document`
      );
    }

    const ordinaryDocument = { uri: vscode.Uri.parse("untitled:not-a-view") } as vscode.TextDocument;
    assert.strictEqual(isTotonoeLogVirtualDocument(ordinaryDocument), false);
  });

  test("guardAgainstVirtualDocumentSource warns and returns true only for Totonoe Log's own schemes", async () => {
    const { guardAgainstVirtualDocumentSource } = await import(
      "../../virtualDocumentContentProvider"
    );

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      const virtualDocument = {
        uri: vscode.Uri.parse("totonoe-log-merged:/sample.log"),
      } as vscode.TextDocument;
      assert.strictEqual(guardAgainstVirtualDocumentSource(virtualDocument), true);
      assert.ok(warningMessage?.includes("元のログファイルに対して実行してください"));

      warningMessage = undefined;
      const ordinaryDocument = { uri: vscode.Uri.parse("untitled:not-a-view") } as vscode.TextDocument;
      assert.strictEqual(guardAgainstVirtualDocumentSource(ordinaryDocument), false);
      assert.strictEqual(warningMessage, undefined);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("re-running Show Normalized View against an already-open normalized view warns and opens nothing new", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
    const normalizedUri = vscode.window.activeTextEditor?.document.uri.toString();
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, "totonoe-log-normalized");

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.ok(
      warningMessage?.includes("元のログファイルに対して実行してください"),
      "a warning should be shown when the source is Totonoe Log's own view"
    );
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      normalizedUri,
      "no new virtual document should have been opened"
    );
  });

  test("filter commands warn and open nothing new when a normalized view is active", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
    const normalizedUri = vscode.window.activeTextEditor?.document.uri.toString();
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, "totonoe-log-normalized");

    const guardedCommands = [
      "totonoeLog.showNormalizedViewFilteredBySeverity",
      "totonoeLog.showNormalizedViewFilteredByDateRange",
      "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity",
      "totonoeLog.showNormalizedViewFilteredByIgnorePattern",
      "totonoeLog.showCollapsedView",
    ];

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    // 絞り込み系コマンドはガードで早期リターンする前提だが、万一ガードが
    // 効かずにピッカーへ進んだ場合にテストがハングしないよう、
    // showQuickPick / showInputBox もあわせてキャンセル相当にしておく。
    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showQuickPick = async () => undefined;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      for (const command of guardedCommands) {
        let warningMessage: string | undefined;
        (vscode.window as any).showWarningMessage = async (message: string) => {
          warningMessage = message;
          return undefined;
        };

        await vscode.commands.executeCommand(command);

        assert.ok(
          warningMessage?.includes("元のログファイルに対して実行してください"),
          `${command} should warn when the active editor is a normalized view`
        );
        assert.strictEqual(
          vscode.window.activeTextEditor?.document.uri.toString(),
          normalizedUri,
          `${command} should not open a new view`
        );
      }
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      (vscode.window as any).showQuickPick = originalShowQuickPick;
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("copyMaskedText warns and leaves the clipboard untouched when a collapsed view is active", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO connect ok",
        "2024-01-02T03:04:06Z INFO connect ok",
        "2024-01-02T03:04:07Z INFO connect ok",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    await vscode.commands.executeCommand("totonoeLog.showCollapsedView");
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, "totonoe-log-normalized");

    const sentinel = "sentinel-before-guarded-copy";
    await vscode.env.clipboard.writeText(sentinel);

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.copyMaskedText");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.ok(
      warningMessage?.includes("元のログファイルに対して実行してください"),
      "a warning should be shown when copying from a collapsed view"
    );
    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      sentinel,
      "the clipboard should not be overwritten"
    );
  });

  test("filter commands warn when a merged view is active", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(appLogPath)];

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, "totonoe-log-merged");
      const mergedUri = vscode.window.activeTextEditor?.document.uri.toString();

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredBySeverity");
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(
        warningMessage?.includes("元のログファイルに対して実行してください"),
        "a warning should be shown when filtering from a merged view"
      );
      assert.strictEqual(
        vscode.window.activeTextEditor?.document.uri.toString(),
        mergedUri,
        "no new view should be opened"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("filter commands warn when a compare view is active", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const firstPath = path.join(tempDir, "left.log");
      const secondPath = path.join(tempDir, "right.log");
      await fs.writeFile(firstPath, "2024-01-02T03:04:05Z ERROR connect to 192.168.1.10 failed");
      await fs.writeFile(secondPath, "2024-01-02T09:04:05Z ERROR connect to 10.0.0.1 failed");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      let callCount = 0;
      (vscode.window as any).showOpenDialog = async () => {
        callCount += 1;
        return [vscode.Uri.file(callCount === 1 ? firstPath : secondPath)];
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.compareLogs");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, "totonoe-log-compare");
      const compareUri = vscode.window.activeTextEditor?.document.uri.toString();

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredByDateRange");
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(
        warningMessage?.includes("元のログファイルに対して実行してください"),
        "a warning should be shown when filtering from a compare view"
      );
      assert.strictEqual(
        vscode.window.activeTextEditor?.document.uri.toString(),
        compareUri,
        "no new view should be opened"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("normal log files are unaffected by the guard", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(warningMessage, undefined, "an ordinary log file should not trigger the guard");
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, "totonoe-log-normalized");
  });
});
