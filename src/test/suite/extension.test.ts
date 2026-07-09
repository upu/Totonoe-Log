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

  test("shows only entries matching the severities picked by the user", async () => {
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
    assert.ok(infoMessage?.includes("3"), "the hidden line count should be reported");
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
