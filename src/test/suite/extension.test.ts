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
      // Windows CI では、直前の closeAllEditors がファイルハンドルを解放し
      // きる前に rm が走ることがあり、EBUSY で間欠的に失敗する
      // （このファイル内の全ての一時ディレクトリ削除で同様の対策をしている）。
      // maxRetries/retryDelay で短い線形バックオフを挟み、解放を待ってから
      // 再試行する。
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("release() clears cached content for the normalized-view scheme", async () => {
    const { NormalizedViewContentProvider, NORMALIZED_VIEW_SCHEME } = await import(
      "../../normalizedView"
    );
    const { CONTENT_LOST_PLACEHOLDER } = await import("../../virtualDocumentContentProvider");
    const provider = new NormalizedViewContentProvider();
    const uri = vscode.Uri.from({ scheme: NORMALIZED_VIEW_SCHEME, path: "/sample.normalized-1.log" });

    provider.register(uri, "cached content");
    assert.strictEqual(provider.provideTextDocumentContent(uri), "cached content");

    provider.release(uri);
    assert.strictEqual(
      provider.provideTextDocumentContent(uri),
      CONTENT_LOST_PLACEHOLDER,
      "release() should drop the cached content for the given uri"
    );

    provider.dispose();
  });

  test("provideTextDocumentContent returns a visible placeholder instead of a silent blank when content is missing (issue #92)", async () => {
    // VSCode の onDidCloseTextDocument は、ユーザーがタブを閉じていなくても
    // 内部的に TextDocument の参照を解放した際に発火しうる。その場合でも
    // タブ自体は残り続けるため、再度 provideTextDocumentContent が呼ばれても
    // register() は呼ばれない（= 保持内容が失われたまま）。この状況を
    // register() を一度も呼ばずに provideTextDocumentContent を呼ぶことで
    // 再現し、無言の空文字列ではなく分かる形のプレースホルダーが返ることを
    // 確認する。
    const { NormalizedViewContentProvider, NORMALIZED_VIEW_SCHEME } = await import(
      "../../normalizedView"
    );
    const { CONTENT_LOST_PLACEHOLDER } = await import("../../virtualDocumentContentProvider");
    const provider = new NormalizedViewContentProvider();
    const uri = vscode.Uri.from({
      scheme: NORMALIZED_VIEW_SCHEME,
      path: "/never-registered.normalized-1.log",
    });

    const content = provider.provideTextDocumentContent(uri);
    assert.strictEqual(content, CONTENT_LOST_PLACEHOLDER);
    assert.notStrictEqual(content, "", "should not silently return a blank document");

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

suite("Totonoe Log normalized view filtered (combined)", () => {
  /**
   * 「どの条件で絞り込むか」を尋ねる1回目の QuickPick と、選択した条件ごとの
   * 2回目以降の QuickPick（セベリティ選択）を、選択肢のラベルで区別する
   * モック。1回目は `kindLabels` に含まれるラベルの選択肢だけを持つため、
   * それで判別できる。
   */
  function installQuickPickMock(kindsToSelect: readonly string[]): () => void {
    const original = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
      const isKindPicker = items.some((item) =>
        ["セベリティ", "日付範囲", "無視パターン"].includes(item.label)
      );
      if (isKindPicker) {
        return items.filter((item) => kindsToSelect.includes(item.label));
      }
      // セベリティ選択ピッカー: ERROR のみ選択する。
      return items.filter((item) => item.label === "ERROR");
    };
    return () => {
      (vscode.window as any).showQuickPick = original;
    };
  }

  test("registers the showNormalizedViewFiltered command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showNormalizedViewFiltered"),
      "totonoeLog.showNormalizedViewFiltered command should be registered"
    );
  });

  test("applies only the criteria selected in the kind picker (severity + ignore pattern)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO starting",
        "2024-01-02T03:04:06Z ERROR boom",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const restoreQuickPick = installQuickPickMock(["セベリティ", "無視パターン"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "heartbeat";

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let infoMessage: string | undefined;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      restoreQuickPick();
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
    assert.ok(
      infoMessage?.includes("条件に合わない 2 行"),
      "the hidden line count should be reported"
    );
  });

  test("combines all three criteria (severity + date range + ignore pattern)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-01T00:00:00Z ERROR before range",
        "2024-01-02T03:04:05Z INFO in range but wrong severity",
        "2024-01-02T03:04:06Z ERROR in range and matching",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
        "2024-01-03T00:00:00Z ERROR after range",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const restoreQuickPick = installQuickPickMock(["セベリティ", "日付範囲", "無視パターン"]);

    const originalShowInputBox = vscode.window.showInputBox;
    let inputBoxCallCount = 0;
    (vscode.window as any).showInputBox = async () => {
      inputBoxCallCount += 1;
      if (inputBoxCallCount === 1) return "2024-01-02";
      if (inputBoxCallCount === 2) return "2024-01-02T23:59:59";
      return "heartbeat";
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "3 | 2024-01-02T03:04:06.000Z ERROR in range and matching"
    );
  });

  test("opens an unfiltered normalized view when no kind is selected (but the picker is not dismissed)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => [];

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a normalized view editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "1 | 2024-01-02T03:04:05.000Z INFO starting"
    );
  });

  test("does nothing when the kind picker is dismissed", async () => {
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
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("does nothing when the severity picker is dismissed after selecting the severity kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const originalShowQuickPick = vscode.window.showQuickPick;
    let callCount = 0;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
      callCount += 1;
      if (callCount === 1) {
        return items.filter((item) => item.label === "セベリティ");
      }
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("does nothing when a date prompt is dismissed after selecting the date range kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const restoreQuickPick = installQuickPickMock(["日付範囲"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
  });

  test("does nothing when the ignore pattern prompt is dismissed after selecting the ignore pattern kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    const restoreQuickPick = installQuickPickMock(["無視パターン"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
    } finally {
      restoreQuickPick();
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
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFiltered");
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      "1-3 | 2024-01-02T03:04:05.000Z 〜 2024-01-02T03:04:07.000Z INFO connect ok (×3)"
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("decodes a Shift_JIS source using the resource-scoped files.encoding setting", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    const filesConfig = vscode.workspace.getConfiguration("files");
    const previousEncoding = filesConfig.inspect<string>("encoding")?.globalValue;
    try {
      const shiftJisLogPath = path.join(tempDir, "shift-jis.log");
      const asciiPrefix = Buffer.from("2024-01-02T03:04:05Z INFO ");
      const japaneseText = Buffer.from([0x93, 0xfa, 0x96, 0x7b]);
      await fs.writeFile(shiftJisLogPath, Buffer.concat([asciiPrefix, japaneseText]));

      const utf8LogPath = path.join(tempDir, "ascii.log");
      await fs.writeFile(utf8LogPath, "2024-01-02T03:04:04Z INFO before");

      await filesConfig.update("encoding", "shiftjis", vscode.ConfigurationTarget.Global);

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [
        vscode.Uri.file(shiftJisLogPath),
        vscode.Uri.file(utf8LogPath),
      ];

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.ok(
        activeEditor!.document.getText().includes("INFO 日本"),
        "the Shift_JIS message should be decoded without replacement characters"
      );
    } finally {
      await filesConfig.update("encoding", previousEncoding, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("warns and falls back to UTF-8 for an unsupported files.encoding value", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const logPath = path.join(tempDir, "unsupported-encoding.log");
      await fs.writeFile(logPath, "2024-01-02T03:04:05Z INFO fallback");

      const originalGetConfiguration = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (
        section?: string,
        scope?: vscode.ConfigurationScope | null
      ) => {
        if (section === "files") {
          return {
            get: (key: string, defaultValue: unknown) =>
              key === "encoding" ? "unsupported-test-encoding" : defaultValue,
          };
        }
        return originalGetConfiguration(section, scope);
      };

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(logPath)];

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(warningMessage?.includes("unsupported-test-encoding"));
      assert.ok(warningMessage?.includes("UTF-8"));
      assert.ok(vscode.window.activeTextEditor?.document.getText().includes("INFO fallback"));
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  test("opens the complete merged result when its formatted content exceeds 50MB", async function () {
    this.timeout(60000);

    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const oneMb = 1024 * 1024;
      const targetSizeBytes = 52 * oneMb;
      const lineCount = 60;
      const linePrefix = (index: number): string =>
        `2024-01-02T03:00:${String(index).padStart(2, "0")}Z INFO line-${String(index).padStart(3, "0")} `;
      const paddingLength = Math.ceil(targetSizeBytes / lineCount) - linePrefix(0).length;
      const bigLogPath = path.join(tempDir, "big.log");
      await fs.writeFile(
        bigLogPath,
        Array.from(
          { length: lineCount },
          (_, i) => `${linePrefix(i)}${"x".repeat(paddingLength)}`
        ).join("\n")
      );

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(bigLogPath)];

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(activeTab, "the large merged result should be opened in a tab");
      assert.ok(
        activeTab!.input instanceof vscode.TabInputText,
        "the large merged result should use a text editor tab"
      );

      const resultUri = (activeTab!.input as vscode.TabInputText).uri;
      assert.notStrictEqual(
        resultUri.scheme,
        "totonoe-log-merged",
        "the large result should bypass virtual-document synchronization via extension storage"
      );

      const resultStat = await vscode.workspace.fs.stat(resultUri);
      assert.ok(
        resultStat.size > 50 * oneMb,
        `the complete formatted result should exceed 50MB (actual: ${resultStat.size} bytes)`
      );

      const resultBytes = await vscode.workspace.fs.readFile(resultUri);
      assert.ok(
        Buffer.from(resultBytes.buffer, resultBytes.byteOffset, resultBytes.byteLength).includes(
          "line-059"
        ),
        "the last source line should be present in the materialized merged result"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("reads a source file that exceeds VSCode's ~50MB document sync limit without losing content (issue #98)", async function () {
    // 巨大ファイルの生成・読み込み・マージ処理を含むため、既定の2000msでは
    // 収まらない（他の実ファイル操作テストと同じ理由でissue #72の前例に倣う）。
    this.timeout(60000);

    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      // VSCodeは `vscode.workspace.openTextDocument` 経由での拡張機能への
      // ファイル同期を約50MB超で拒否する（バイナリのAPI制限であり設定では
      // 緩められない、issue #98の本体）。この制限を確実に超えつつ、マージ
      // 処理のコスト（エントリ数に比例）は抑えたいので、行数は少なく1行
      // あたりを長くして総サイズを稼ぐ。
      //
      // マージ後の表示（仮想ドキュメントを開く処理）にも同じ50MB制限が
      // 別途かかるため（このテストで検証する読み込み側の制限とは別レイヤー、
      // issue #98のスコープ外）、ファイル選択ダイアログ→絞り込みコマンドを
      // 通し、フィルタ後の表示内容自体は小さく保つ。巨大ファイルの末尾の
      // 1行だけを ERROR にしてセベリティ絞り込みでその1行だけを残すことで、
      // 「ファイル全体が末尾まで読み込まれたこと」を、表示側の制限を踏まずに
      // 検証できる。
      const oneMb = 1024 * 1024;
      const targetSizeBytes = 52 * oneMb;
      const bigLineCount = 60;
      const lastIndex = bigLineCount - 1;
      const linePrefix = (index: number): string => {
        const severity = index === lastIndex ? "ERROR" : "INFO";
        return `2024-01-02T03:00:${String(index).padStart(2, "0")}Z ${severity} line-${String(index).padStart(3, "0")} `;
      };
      const paddingLength = Math.ceil(targetSizeBytes / bigLineCount) - linePrefix(0).length;
      const bigLogLines = Array.from(
        { length: bigLineCount },
        (_, i) => `${linePrefix(i)}${"x".repeat(paddingLength)}`
      );
      const bigLogPath = path.join(tempDir, "big.log");
      await fs.writeFile(bigLogPath, bigLogLines.join("\n"));

      const bigLogStats = await fs.stat(bigLogPath);
      assert.ok(
        bigLogStats.size > 50 * oneMb,
        `test fixture should exceed VSCode's ~50MB sync limit (actual: ${bigLogStats.size} bytes)`
      );

      const smallLogPath = path.join(tempDir, "small.log");
      await fs.writeFile(smallLogPath, "2024-01-02T02:59:59Z ERROR boom");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [
        vscode.Uri.file(bigLogPath),
        vscode.Uri.file(smallLogPath),
      ];

      const originalShowQuickPick = vscode.window.showQuickPick;
      (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
        const isKindPicker = items.some((item) => item.label === "セベリティ");
        // 条件種類ピッカーでは「セベリティ」だけを選び、セベリティ選択
        // ピッカーでは ERROR だけを選ぶ。
        return isKindPicker
          ? items.filter((item) => item.label === "セベリティ")
          : items.filter((item) => item.label === "ERROR");
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
        (vscode.window as any).showQuickPick = originalShowQuickPick;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a filtered merged view editor should be shown");
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");

      const mergedLines = activeEditor!.document.getText().split("\n");
      // small.log (02:59:59) と big.log の末尾行（03:00:59）の間は60秒空いており、
      // 既定のギャップ検出しきい値（30秒）を超えるため「XX秒の空白」の区切り行が
      // 間に挿入される（issue #102、マージビューへのギャップ検出追加）。
      assert.strictEqual(
        mergedLines.length,
        3,
        "the two ERROR entries plus a gap marker line should remain after filtering"
      );
      assert.ok(
        mergedLines[0].includes("small.log") && mergedLines[0].includes("ERROR boom"),
        "the small file's earlier ERROR entry should sort first"
      );
      assert.ok(
        mergedLines[1].includes("秒の空白"),
        "a gap marker should separate the two entries (60s gap exceeds the default 30s threshold)"
      );
      assert.ok(
        mergedLines[2].includes(`line-${String(lastIndex).padStart(3, "0")}`),
        "the big file's last line (only reachable by reading the whole ~52MB file) must be present"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

suite("Totonoe Log merged view filename hover (#150)", () => {
  test("shows the full source path when hovering the file name column", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const dirA = path.join(tempDir, "app-server");
      const dirB = path.join(tempDir, "web-server");
      await fs.mkdir(dirA);
      await fs.mkdir(dirB);
      const appAPath = path.join(dirA, "app.log");
      const appBPath = path.join(dirB, "app.log");
      await fs.writeFile(appAPath, "2024-01-02T03:04:05Z INFO from-a");
      await fs.writeFile(appBPath, "2024-01-02T03:04:06Z ERROR from-b");

      const uriA = vscode.Uri.file(appAPath);
      const uriB = vscode.Uri.file(appBPath);

      await vscode.commands.executeCommand("totonoeLog.mergeSelectedFiles", uriA, [uriA, uriB]);

      const viewEditor = vscode.window.activeTextEditor;
      assert.ok(viewEditor, "a merged view editor should be shown");
      const viewUri = viewEditor!.document.uri;

      // 時系列マージ後の表示2行目（0始まりで1）は b/app.log 由来のエントリ。
      const hovers = (await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        viewUri,
        new vscode.Position(1, 0)
      )) as vscode.Hover[];

      assert.strictEqual(hovers.length, 1, "exactly one hover should be provided");
      const hoverText = hovers[0].contents
        .map((content) => (typeof content === "string" ? content : content.value))
        .join("\n");
      // vscode.Uri.fsPath はWindowsでドライブレターを小文字化するため、
      // 大文字小文字を無視して比較する（パス自体は大小文字を区別しない）。
      assert.ok(
        hoverText.toLowerCase().includes(appBPath.toLowerCase()),
        `hover text should include the full source path (${appBPath}), got: ${hoverText}`
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("shows no hover outside the file name column", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appPath = path.join(tempDir, "app.log");
      await fs.writeFile(appPath, "2024-01-02T03:04:05Z INFO hello");
      const uri = vscode.Uri.file(appPath);

      await vscode.commands.executeCommand("totonoeLog.mergeSelectedFiles", uri, [
        uri,
        uri,
      ]);

      const viewEditor = vscode.window.activeTextEditor;
      assert.ok(viewEditor, "a merged view editor should be shown");
      const viewUri = viewEditor!.document.uri;
      const lineText = viewEditor!.document.lineAt(0).text;
      const afterColumnCharacter = lineText.length - 1;

      const hovers = (await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        viewUri,
        new vscode.Position(0, afterColumnCharacter)
      )) as vscode.Hover[];

      assert.strictEqual(
        hovers.length,
        0,
        "no hover should be provided outside the file name column"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

suite("Totonoe Log merged view filtered (combined)", () => {
  /**
   * "セベリティ" / "日付範囲" / "無視パターン" の条件選択ピッカーを、指定した
   * 種類だけ選んで確定するようにモックする。正規化ビューの統合絞り込みテスト
   * が使う `installQuickPickMock` と同じ役割だが、こちらは
   * `showMergedViewFiltered` 用に別定義する（テストファイル内で重複がある点は
   * 承知のうえ、対象コマンドが違うテストスイート間で暗黙の結合を作らないよう
   * 意図的に分けている）。
   */
  function installFilterKindQuickPickMock(kindsToSelect: readonly string[]): () => void {
    const original = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
      const isKindPicker = items.some((item) =>
        ["セベリティ", "日付範囲", "無視パターン"].includes(item.label)
      );
      if (isKindPicker) {
        return items.filter((item) => kindsToSelect.includes(item.label));
      }
      // セベリティ選択ピッカー: ERROR のみ選択する。
      return items.filter((item) => item.label === "ERROR");
    };
    return () => {
      (vscode.window as any).showQuickPick = original;
    };
  }

  async function withTempLogFiles<T>(
    files: Record<string, string>,
    run: (paths: Record<string, string>) => Promise<T>
  ): Promise<T> {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const paths: Record<string, string> = {};
      for (const [fileName, content] of Object.entries(files)) {
        const filePath = path.join(tempDir, fileName);
        await fs.writeFile(filePath, content);
        paths[fileName] = filePath;
      }
      return await run(paths);
    } finally {
      // Windows ではエディタが開いたままだと一時ファイルが削除できないため、
      // 削除前に必ず閉じる（"Totonoe Log merged view" 内の既存テストと同じ手順）。
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  test("registers the showMergedViewFiltered command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.showMergedViewFiltered"),
      "totonoeLog.showMergedViewFiltered command should be registered"
    );
  });

  test("merges the selected files and applies only the criteria selected in the kind picker, keeping fileName/kind columns", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "database_20240101.log": [
          "2024-01-02T03:04:06Z ERROR boom",
          "2024-01-02T03:04:07Z ERROR heartbeat noise",
        ].join("\n"),
      },
      async (paths) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => [
          vscode.Uri.file(paths["app.log"]),
          vscode.Uri.file(paths["database_20240101.log"]),
        ];

        const restoreQuickPick = installFilterKindQuickPickMock(["セベリティ", "無視パターン"]);
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => "heartbeat";

        const originalShowInformationMessage = vscode.window.showInformationMessage;
        let infoMessage: string | undefined;
        (vscode.window as any).showInformationMessage = async (message: string) => {
          infoMessage = message;
          return undefined;
        };

        try {
          await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
          restoreQuickPick();
          (vscode.window as any).showInputBox = originalShowInputBox;
          (vscode.window as any).showInformationMessage = originalShowInformationMessage;
        }

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, "a filtered merged view editor should be shown");
        assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");

        const fileNameWidth = "database_20240101.log".length;
        const kindWidth = "database".length;
        assert.strictEqual(
          activeEditor!.document.getText(),
          `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:06.000Z ERROR boom`
        );
        assert.ok(
          infoMessage?.includes("条件に合わない 2 行"),
          "the hidden line count should be reported"
        );
      }
    );
  });

  test("opens an unfiltered merged view when no kind is selected (but the picker is not dismissed)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => [
          vscode.Uri.file(paths["app.log"]),
          vscode.Uri.file(paths["db.log"]),
        ];

        const originalShowQuickPick = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => [];

        try {
          await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
          (vscode.window as any).showQuickPick = originalShowQuickPick;
        }

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, "a merged view editor should be shown");
        assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");

        const fileNameWidth = "app.log".length;
        const kindWidth = "app".length;
        assert.strictEqual(
          activeEditor!.document.getText(),
          [
            `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO starting`,
            `${"db.log".padEnd(fileNameWidth)} | ${"db".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:06.000Z ERROR boom`,
          ].join("\n")
        );
      }
    );

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
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
      await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
    } finally {
      (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    }

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");
  });

  test("does nothing when the kind picker is dismissed", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      { "app.log": "2024-01-02T03:04:05Z INFO starting" },
      async (paths) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(paths["app.log"])];

        const originalShowQuickPick = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => undefined;

        try {
          await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
          (vscode.window as any).showQuickPick = originalShowQuickPick;
        }

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(!activeEditor || activeEditor.document.uri.scheme !== "totonoe-log-merged");
      }
    );
  });

  test("does nothing when the severity picker is dismissed after selecting the severity kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      { "app.log": "2024-01-02T03:04:05Z INFO starting" },
      async (paths) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(paths["app.log"])];

        const originalShowQuickPick = vscode.window.showQuickPick;
        let callCount = 0;
        (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
          callCount += 1;
          if (callCount === 1) {
            return items.filter((item) => item.label === "セベリティ");
          }
          return undefined;
        };

        try {
          await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
          (vscode.window as any).showQuickPick = originalShowQuickPick;
        }

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(!activeEditor || activeEditor.document.uri.scheme !== "totonoe-log-merged");
      }
    );
  });

  test("does nothing when a date prompt is dismissed after selecting the date range kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      { "app.log": "2024-01-02T03:04:05Z INFO starting" },
      async (paths) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(paths["app.log"])];

        const restoreQuickPick = installFilterKindQuickPickMock(["日付範囲"]);
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined;

        try {
          await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
          restoreQuickPick();
          (vscode.window as any).showInputBox = originalShowInputBox;
        }

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(!activeEditor || activeEditor.document.uri.scheme !== "totonoe-log-merged");
      }
    );
  });

  test("does nothing when the ignore pattern prompt is dismissed after selecting the ignore pattern kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      { "app.log": "2024-01-02T03:04:05Z INFO starting" },
      async (paths) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(paths["app.log"])];

        const restoreQuickPick = installFilterKindQuickPickMock(["無視パターン"]);
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined;

        try {
          await vscode.commands.executeCommand("totonoeLog.showMergedViewFiltered");
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
          restoreQuickPick();
          (vscode.window as any).showInputBox = originalShowInputBox;
        }

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(!activeEditor || activeEditor.document.uri.scheme !== "totonoe-log-merged");
      }
    );
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      "totonoeLog.showNormalizedViewFiltered",
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

suite("Totonoe Log custom timestamp formats", () => {
  test("recognizes a custom format configured via totonoeLog.timestampFormats", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog");
    await config.update(
      "timestampFormats",
      [
        {
          name: "jp-date",
          pattern:
            "(?<y>\\d{4})年(?<mo>\\d{2})月(?<d>\\d{2})日 (?<h>\\d{2}):(?<mi>\\d{2}):(?<s>\\d{2})",
        },
      ],
      vscode.ConfigurationTarget.Global
    );

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024年01月02日 03:04:05 INFO custom format entry",
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a normalized view editor should be shown");
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO custom format entry"
      );
    } finally {
      await config.update("timestampFormats", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("warns about invalid custom format entries and keeps parsing with the rest", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog");
    await config.update(
      "timestampFormats",
      [{ name: "broken", pattern: "(" }],
      vscode.ConfigurationTarget.Global
    );

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO built-in still works",
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      assert.ok(
        warningMessage?.includes("timestampFormats"),
        "a warning should be shown for the invalid custom format entry"
      );
      const activeEditor = vscode.window.activeTextEditor;
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO built-in still works"
      );
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      await config.update("timestampFormats", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite("Totonoe Log timezone settings (#13)", () => {
  test("renders normalized timestamps in the timezone configured via totonoeLog.timezone.display", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.timezone");
    await config.update("display", "+09:00", vscode.ConfigurationTarget.Global);

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO hello",
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a normalized view editor should be shown");
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T12:04:05.000+09:00 INFO hello"
      );
    } finally {
      await config.update("display", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("filters by the wall-clock time shown in the configured display timezone (issue #134)", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.timezone");
    await config.update("display", "+09:00", vscode.ConfigurationTarget.Global);

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:04Z INFO before",
        "2024-01-02T03:04:05Z INFO target",
        "2024-01-02T03:04:06Z INFO after",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    const originalShowInputBox = vscode.window.showInputBox;
    const prompts: string[] = [];
    (vscode.window as any).showInputBox = async (
      options: vscode.InputBoxOptions
    ): Promise<string> => {
      prompts.push(options.prompt ?? "");
      return "2024-01-02 12:04:05";
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.showNormalizedViewFilteredByDateRange");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a filtered normalized view editor should be shown");
      assert.strictEqual(
        activeEditor!.document.getText(),
        "2 | 2024-01-02T12:04:05.000+09:00 INFO target"
      );
      assert.ok(
        prompts.every((prompt) => prompt.includes("表示タイムゾーン +09:00 基準")),
        "both boundary prompts should explain the display-timezone basis"
      );
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
      await config.update("display", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("interprets zone-less timestamps with the offset configured via totonoeLog.timezone.sourceOffset", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.timezone");
    await config.update("sourceOffset", "+09:00", vscode.ConfigurationTarget.Global);

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02 12:04:05 INFO hello",
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a normalized view editor should be shown");
      // +09:00 の壁時計 12:04:05 は UTC の 03:04:05。表示は既定（UTC）のまま。
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO hello"
      );
    } finally {
      await config.update("sourceOffset", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("applies per-file source offsets configured via totonoeLog.timezone.fileOffsets to the merged view", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const config = vscode.workspace.getConfiguration("totonoeLog.timezone");
    await config.update(
      "fileOffsets",
      [{ filePattern: "tokyo.*\\.log", offset: "+09:00" }],
      vscode.ConfigurationTarget.Global
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-tz-"));
    try {
      const tokyoLogPath = path.join(tempDir, "tokyo.log");
      const utcLogPath = path.join(tempDir, "utc.log");
      // 壁時計上は tokyo.log の方が後（09:00 > 03:00）だが、+09:00 を適用すると
      // UTC 00:00 になり utc.log（03:00）より前に並ぶのが正しい。
      await fs.writeFile(tokyoLogPath, "2024-01-02 09:00:00 INFO tokyo-entry");
      await fs.writeFile(utcLogPath, "2024-01-02 03:00:00 INFO utc-entry");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [
        vscode.Uri.file(tokyoLogPath),
        vscode.Uri.file(utcLogPath),
      ];

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      // オフセット適用後、両エントリの間は3時間空いており、既定のギャップ検出
      // しきい値（30秒）を超えるため「XX秒の空白」の区切り行が挿入される
      // （issue #102、マージビューへのギャップ検出追加）。
      const expected = [
        "tokyo.log | tokyo | 1 | 2024-01-02T00:00:00.000Z INFO tokyo-entry",
        "          |       | ... | 10800秒の空白",
        "utc.log   | utc   | 1 | 2024-01-02T03:00:00.000Z INFO utc-entry",
      ].join("\n");
      assert.strictEqual(activeEditor!.document.getText(), expected);
    } finally {
      await config.update("fileOffsets", undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("warns about an invalid timezone setting and falls back to UTC", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.timezone");
    await config.update("display", "bogus", vscode.ConfigurationTarget.Global);

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO hello",
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      assert.ok(
        warningMessage?.includes("timezone"),
        "a warning should be shown for the invalid timezone setting"
      );
      const activeEditor = vscode.window.activeTextEditor;
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO hello"
      );
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      await config.update("display", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite("Totonoe Log clock skew settings (#15)", () => {
  test("applies the per-file clock skew configured via totonoeLog.clockSkew.fileOffsets to the normalized view", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const config = vscode.workspace.getConfiguration("totonoeLog.clockSkew");
    await config.update(
      "fileOffsets",
      [{ filePattern: "skewed.*\\.log", offsetSeconds: -40 }],
      vscode.ConfigurationTarget.Global
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-skew-"));
    try {
      const skewedLogPath = path.join(tempDir, "skewed.log");
      // このホストの時計は40秒進んでいる想定。タイムゾーン表記付きの
      // タイムスタンプにも補正がかかる（時計そのもののずれの補正のため）。
      await fs.writeFile(skewedLogPath, "2024-01-02T03:04:45Z INFO hello");

      const source = await vscode.workspace.openTextDocument(vscode.Uri.file(skewedLogPath));
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a normalized view editor should be shown");
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO hello"
      );
    } finally {
      await config.update("fileOffsets", undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("applies per-file clock skews configured via totonoeLog.clockSkew.fileOffsets to the merged view", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const config = vscode.workspace.getConfiguration("totonoeLog.clockSkew");
    await config.update(
      "fileOffsets",
      [{ filePattern: "fast.*\\.log", offsetSeconds: -40 }],
      vscode.ConfigurationTarget.Global
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-skew-"));
    try {
      const fastLogPath = path.join(tempDir, "fast.log");
      const steadyLogPath = path.join(tempDir, "steady.log");
      // 生の壁時計では fast.log（03:04:30）の方が後だが、-40秒の補正で
      // 03:03:50 となり steady.log（03:04:00）より前に並ぶのが正しい。
      await fs.writeFile(fastLogPath, "2024-01-02T03:04:30Z INFO fast-entry");
      await fs.writeFile(steadyLogPath, "2024-01-02T03:04:00Z INFO steady-entry");

      const originalShowOpenDialog = vscode.window.showOpenDialog;
      (vscode.window as any).showOpenDialog = async () => [
        vscode.Uri.file(fastLogPath),
        vscode.Uri.file(steadyLogPath),
      ];

      try {
        await vscode.commands.executeCommand("totonoeLog.showMergedView");
      } finally {
        (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      const expected = [
        "fast.log   | fast   | 1 | 2024-01-02T03:03:50.000Z INFO fast-entry",
        "steady.log | steady | 1 | 2024-01-02T03:04:00.000Z INFO steady-entry",
      ].join("\n");
      assert.strictEqual(activeEditor!.document.getText(), expected);
    } finally {
      await config.update("fileOffsets", undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("warns about invalid clock skew entries and continues with the valid ones", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.clockSkew");
    await config.update(
      "fileOffsets",
      [{ filePattern: "[invalid", offsetSeconds: 1 }],
      vscode.ConfigurationTarget.Global
    );

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      const source = await vscode.workspace.openTextDocument({
        content: "2024-01-02T03:04:05Z INFO hello",
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      assert.ok(
        warningMessage?.includes("clockSkew"),
        "a warning should be shown for the invalid clock skew setting"
      );
      const activeEditor = vscode.window.activeTextEditor;
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO hello"
      );
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      await config.update("fileOffsets", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite("Totonoe Log low timestamp recognition warning", () => {
  /** タイムスタンプを含まないプレーンな行（警告条件を満たす12行）。 */
  const UNRECOGNIZED_LOG = Array.from({ length: 12 }, (_, i) => `plain line ${i + 1}`).join("\n");

  /** 全行が ISO 8601 タイムスタンプ付きの正常なログ（12行）。 */
  const RECOGNIZED_LOG = Array.from(
    { length: 12 },
    (_, i) => `2024-01-02T03:04:${String(i).padStart(2, "0")}Z INFO line ${i + 1}`
  ).join("\n");

  /** 認識率警告の通知本文を判定するパターン。 */
  const WARNING_PATTERN =
    /タイムスタンプ形式(?:を認識できませんでした|で始まっている可能性があります)/;

  /**
   * showWarningMessage をモックして action 実行中に表示された警告本文を集める。
   * 認識率警告と無関係な警告（設定不正など）を拾わないよう、認識率警告の
   * 文言だけに絞って返す。
   */
  async function collectRecognitionWarningsWhile(action: () => Promise<void>): Promise<string[]> {
    const messages: string[] = [];
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      messages.push(message);
      return undefined;
    };
    try {
      await action();
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
    return messages.filter((message) => WARNING_PATTERN.test(message));
  }

  /** 一時ディレクトリにログファイルを作って action に渡し、後片付けまで行う。 */
  async function withTempLogFiles(
    files: ReadonlyArray<{ name: string; content: string }>,
    action: (uris: vscode.Uri[]) => Promise<void>
  ): Promise<void> {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const uris: vscode.Uri[] = [];
      for (const file of files) {
        const filePath = path.join(tempDir, file.name);
        await fs.writeFile(filePath, file.content);
        uris.push(vscode.Uri.file(filePath));
      }
      await action(uris);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  test("warns when opening the normalized view for a log with mostly unrecognized timestamps", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles([{ name: "unrecognized.log", content: UNRECOGNIZED_LOG }], async (uris) => {
      const source = await vscode.workspace.openTextDocument(uris[0]);
      await vscode.window.showTextDocument(source);

      const warnings = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
      });

      assert.strictEqual(warnings.length, 1, "exactly one recognition warning should be shown");
      assert.ok(warnings[0].includes("unrecognized.log"), "the warning should name the file");
      assert.ok(warnings[0].includes("100%"), "the warning should report the unrecognized ratio");
      assert.ok(
        warnings[0].includes("totonoeLog.timestampFormats"),
        "the warning should point to the custom format setting"
      );
    });
  });

  test("warns when an unsupported timestamp format takes over after a recognized line", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const unsupportedTimestampLines = Array.from(
      { length: 11 },
      (_, i) => `02.01.2024 03:04:${String(i).padStart(2, "0")} INFO switched format`
    ).join("\n");
    const mixedLog = [
      "2024-01-02T03:04:00Z INFO recognized",
      unsupportedTimestampLines,
    ].join("\n");

    await withTempLogFiles([{ name: "switched-format.log", content: mixedLog }], async (uris) => {
      const source = await vscode.workspace.openTextDocument(uris[0]);
      await vscode.window.showTextDocument(source);

      const warnings = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
      });

      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes("switched-format.log"));
      assert.ok(warnings[0].includes("totonoeLog.timestampFormats"));
    });
  });

  test("shows the warning only once per file within a session", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles([{ name: "repeat.log", content: UNRECOGNIZED_LOG }], async (uris) => {
      const source = await vscode.workspace.openTextDocument(uris[0]);
      await vscode.window.showTextDocument(source);

      const firstRun = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
      });
      assert.strictEqual(firstRun.length, 1, "the first run should warn");

      await vscode.window.showTextDocument(source);
      const secondRun = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
      });
      assert.strictEqual(secondRun.length, 0, "the second run on the same file should not warn again");
    });
  });

  test("does not warn for a log whose timestamps are recognized", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles([{ name: "recognized.log", content: RECOGNIZED_LOG }], async (uris) => {
      const source = await vscode.workspace.openTextDocument(uris[0]);
      await vscode.window.showTextDocument(source);

      const warnings = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showNormalizedView");
      });

      assert.strictEqual(warnings.length, 0);
    });
  });

  test("warns via the collapsed view too (derived views share the check)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles([{ name: "collapsed-source.log", content: UNRECOGNIZED_LOG }], async (uris) => {
      const source = await vscode.workspace.openTextDocument(uris[0]);
      await vscode.window.showTextDocument(source);

      const warnings = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showCollapsedView");
      });

      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes("collapsed-source.log"));
    });
  });

  test("warns per file in the merged view, only for files with low recognition", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      [
        { name: "bad.log", content: UNRECOGNIZED_LOG },
        { name: "good.log", content: RECOGNIZED_LOG },
      ],
      async (uris) => {
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        (vscode.window as any).showOpenDialog = async () => uris;

        try {
          const warnings = await collectRecognitionWarningsWhile(async () => {
            await vscode.commands.executeCommand("totonoeLog.showMergedView");
          });

          assert.strictEqual(warnings.length, 1, "only the unrecognized file should warn");
          assert.ok(warnings[0].includes("bad.log"));
          assert.ok(!warnings[0].includes("good.log"));
        } finally {
          (vscode.window as any).showOpenDialog = originalShowOpenDialog;
        }
      }
    );
  });
});

suite("Totonoe Log go to source line (#137)", () => {
  test("registers the goToSourceLine command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.goToSourceLine"),
      "totonoeLog.goToSourceLine command should be registered"
    );
  });

  test("registers an editor/context menu entry limited to normalized/merged views (#149)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const editorContextMenu: Array<{ command: string; when?: string }> =
      extension!.packageJSON.contributes.menus["editor/context"];
    const entry = editorContextMenu.find((item) => item.command === "totonoeLog.goToSourceLine");
    assert.ok(entry, "editor/context should have a totonoeLog.goToSourceLine entry");
    assert.strictEqual(
      entry!.when,
      "resourceScheme == totonoe-log-normalized || resourceScheme == totonoe-log-merged",
      // 比較ビュー（totonoe-log-compare）は #149 の対象外のため、正規化・
      // マージビューのスキームのみを明示的に指定する。
      "the menu entry should only appear on normalized/merged views, not the compare view"
    );
  });

  test("jumps from a normalized view continuation line to its physical source line", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z ERROR boom",
        "  at Foo.bar",
        "2024-01-02T03:04:06Z INFO next",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

    const viewEditor = vscode.window.activeTextEditor;
    assert.ok(viewEditor, "a normalized view editor should be shown");
    assert.strictEqual(viewEditor!.document.uri.scheme, "totonoe-log-normalized");
    // 表示2行目（0始まりで1）は継続行「  at Foo.bar」＝元ファイルの物理2行目。
    viewEditor!.selection = new vscode.Selection(1, 0, 1, 0);

    await vscode.commands.executeCommand("totonoeLog.goToSourceLine");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the source editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.toString(), source.uri.toString());
    assert.strictEqual(activeEditor!.selection.start.line, 1);
    assert.strictEqual(activeEditor!.selection.start.character, 0);
  });

  test("keeps the source mapping in a severity-filtered view", async function () {
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

    const viewEditor = vscode.window.activeTextEditor;
    assert.ok(viewEditor, "a filtered normalized view editor should be shown");
    assert.strictEqual(viewEditor!.document.uri.scheme, "totonoe-log-normalized");
    // 絞り込み後の表示1行目は、元ファイルでは2行目の ERROR エントリ。
    viewEditor!.selection = new vscode.Selection(0, 0, 0, 0);

    await vscode.commands.executeCommand("totonoeLog.goToSourceLine");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the source editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.toString(), source.uri.toString());
    assert.strictEqual(activeEditor!.selection.start.line, 1);
  });

  test("jumps to the correct file from a merged view even when same-named files live in different folders", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const dirA = path.join(tempDir, "a");
      const dirB = path.join(tempDir, "b");
      await fs.mkdir(dirA);
      await fs.mkdir(dirB);
      const appAPath = path.join(dirA, "app.log");
      const appBPath = path.join(dirB, "app.log");
      await fs.writeFile(appAPath, "2024-01-02T03:04:05Z INFO from-a");
      await fs.writeFile(appBPath, "2024-01-02T03:04:06Z ERROR from-b");

      const uriA = vscode.Uri.file(appAPath);
      const uriB = vscode.Uri.file(appBPath);

      await vscode.commands.executeCommand("totonoeLog.mergeSelectedFiles", uriA, [uriA, uriB]);

      const viewEditor = vscode.window.activeTextEditor;
      assert.ok(viewEditor, "a merged view editor should be shown");
      assert.strictEqual(viewEditor!.document.uri.scheme, "totonoe-log-merged");
      // 時系列マージ後の表示2行目（0始まりで1）は b/app.log 由来のエントリ。
      viewEditor!.selection = new vscode.Selection(1, 0, 1, 0);

      await vscode.commands.executeCommand("totonoeLog.goToSourceLine");

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "the source editor should be shown");
      assert.strictEqual(activeEditor!.document.uri.toString(), uriB.toString());
      assert.strictEqual(activeEditor!.selection.start.line, 0);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("jumps from a collapsed group header to the range start line", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: [
        "2024-01-02T03:04:05Z INFO connect ok",
        "2024-01-02T03:04:06Z INFO connect ok",
        "2024-01-02T03:04:07Z INFO connect ok",
        "2024-01-02T03:04:08Z ERROR tail",
      ].join("\n"),
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showCollapsedView");

    const viewEditor = vscode.window.activeTextEditor;
    assert.ok(viewEditor, "a collapsed view editor should be shown");
    // 表示1行目は「1-3」の折りたたみグループ見出し行＝範囲開始行（物理1行目）へ移動する。
    viewEditor!.selection = new vscode.Selection(0, 0, 0, 0);

    await vscode.commands.executeCommand("totonoeLog.goToSourceLine");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the source editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.toString(), source.uri.toString());
    assert.strictEqual(activeEditor!.selection.start.line, 0);
  });

  test("stays on the view without navigating when the cursor is on a gap marker line", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const config = vscode.workspace.getConfiguration("totonoeLog.gap");
    await config.update("thresholdSeconds", 30, vscode.ConfigurationTarget.Global);
    try {
      const source = await vscode.workspace.openTextDocument({
        content: [
          "2024-01-02T03:04:05Z INFO before",
          "2024-01-02T03:05:05Z INFO after (60s later)",
        ].join("\n"),
        language: "log",
      });
      await vscode.window.showTextDocument(source);

      await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

      const viewEditor = vscode.window.activeTextEditor;
      assert.ok(viewEditor, "a normalized view editor should be shown");
      assert.ok(
        viewEditor!.document.getText().includes("空白"),
        "the view should contain a gap marker line"
      );
      // 表示2行目（0始まりで1）はギャップマーカー行で、元ログに対応する行がない。
      viewEditor!.selection = new vscode.Selection(1, 0, 1, 0);

      await assert.doesNotReject(async () => {
        await vscode.commands.executeCommand("totonoeLog.goToSourceLine");
      });

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "an editor should remain active");
      assert.strictEqual(
        activeEditor!.document.uri.scheme,
        "totonoe-log-normalized",
        "the command should not navigate away from the view for a generated line"
      );
    } finally {
      await config.update("thresholdSeconds", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("does nothing harmful when invoked outside a Totonoe Log view", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO plain file",
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.goToSourceLine");
    });

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.strictEqual(activeEditor!.document.uri.toString(), source.uri.toString());
  });

  test("warns instead of crashing when the source file was deleted before navigating (#156)", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const keptPath = path.join(tempDir, "a.log");
      const deletedPath = path.join(tempDir, "b.log");
      await fs.writeFile(keptPath, "2024-01-02T03:04:05Z INFO from-a");
      await fs.writeFile(deletedPath, "2024-01-02T03:04:06Z ERROR from-b");

      const keptUri = vscode.Uri.file(keptPath);
      const deletedUri = vscode.Uri.file(deletedPath);

      // マージビューは vscode.workspace.fs.readFile で元ファイルを読むため
      // （openTextDocument を経由しない）、この時点では VSCode 側に元ファイルの
      // ドキュメントキャッシュが残らず、削除後の openTextDocument が確実に失敗する。
      await vscode.commands.executeCommand("totonoeLog.mergeSelectedFiles", keptUri, [
        keptUri,
        deletedUri,
      ]);

      const viewEditor = vscode.window.activeTextEditor;
      assert.ok(viewEditor, "a merged view editor should be shown");
      assert.strictEqual(viewEditor!.document.uri.scheme, "totonoe-log-merged");
      // 時系列マージ後の表示2行目（0始まりで1）は b.log 由来のエントリ。
      viewEditor!.selection = new vscode.Selection(1, 0, 1, 0);

      await fs.rm(deletedPath);

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await assert.doesNotReject(async () => {
          await vscode.commands.executeCommand("totonoeLog.goToSourceLine");
        });
        assert.ok(
          warningMessage?.includes("元ログファイルを開けませんでした"),
          `expected a warning about the missing source file, got: ${warningMessage}`
        );
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "an editor should remain active");
      assert.strictEqual(
        activeEditor!.document.uri.scheme,
        "totonoe-log-merged",
        "the command should not navigate away from the view when the source file is missing"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("release() drops the source line map together with the content", async () => {
    const { NormalizedViewContentProvider, NORMALIZED_VIEW_SCHEME } = await import(
      "../../normalizedView"
    );
    const provider = new NormalizedViewContentProvider();
    const uri = vscode.Uri.from({
      scheme: NORMALIZED_VIEW_SCHEME,
      path: "/sample.normalized-1.log",
    });
    const sourceUri = vscode.Uri.parse("untitled:source.log");

    provider.register(uri, "1 | line", {
      sourceUris: [sourceUri],
      lineSources: [{ fileIndex: 0, line: 1 }],
    });
    assert.ok(provider.getSourceLineMap(uri), "the map should be retained after register()");

    provider.release(uri);
    assert.strictEqual(
      provider.getSourceLineMap(uri),
      undefined,
      "release() should drop the source line map for the given uri"
    );

    provider.dispose();
  });
});
