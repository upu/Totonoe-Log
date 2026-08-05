import * as assert from "node:assert";
import * as vscode from "vscode";
import { waitForDocumentText } from "./support/waitForDocumentText";

suite("Totonoe Log extension", () => {
  test("activates and registers the openVirtualDocument command", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    assert.ok(extension, "extension should be discoverable by id");

    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.openVirtualDocument"),
      "totonoeLog.openVirtualDocument command should be registered"
    );
  });

  test("no longer offers the commands the Interactive View replaced (#184, #233)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    // Interactive View のライブトグルで代替できるため廃止した4コマンド。
    const removedCommands = [
      "totonoeLog.showNormalizedViewFilteredBySeverity",
      "totonoeLog.showNormalizedViewFilteredByDateRange",
      "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity",
      "totonoeLog.showNormalizedViewFilteredByIgnorePattern",
      // Interactive View の「繰り返しを折りたたむ」＋書き出しに役割が
      // 吸収されたため廃止（issue #233）。#158 でマージ表示にも折りたたみが
      // 入り、このコマンドにできて Interactive View にできないことは無くなった。
      "totonoeLog.showCollapsedView",
      // 「開く時点で条件を決め打ちする」形をやめ、開いたビューに対する
      // `Set Filter` へ統合したため廃止（issue #248）。
      "totonoeLog.showNormalizedViewFiltered",
      "totonoeLog.mergeSelectedFilesFiltered",
    ];

    const commands = await vscode.commands.getCommands(true);
    const contributed = (
      extension!.packageJSON.contributes.commands as Array<{ command: string }>
    ).map((item) => item.command);

    for (const removed of removedCommands) {
      assert.ok(!commands.includes(removed), `${removed} should no longer be registered`);
      assert.ok(!contributed.includes(removed), `${removed} should no longer be contributed`);
    }

    assert.ok(
      contributed.includes("totonoeLog.setViewFilter"),
      "the command the filtered variants were folded into should remain"
    );
    assert.ok(
      contributed.includes("totonoeLog.showInteractiveView"),
      "the replacement for all of the above should remain"
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

    await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", uriA, [uriA, uriB]);

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", uri, [
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

suite("Totonoe Log merge from the explorer context menu", () => {
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
          "totonoeLog.openVirtualDocument",
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
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO  hello`,
        ].join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("opens a single selected file as a normalized view instead of warning (#249)", async () => {
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

      // 以前は「マージするには2つ以上のログファイルを選択してください。」と
      // 断っていたが、これは1コマンドに統合する前の分割の副作用でしかない。
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appUri, [appUri]);

      const activeEditor = vscode.window.activeTextEditor;
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z INFO hello"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", subDirUri, [
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
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO  hello`,
        ].join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (
      items: Array<vscode.QuickPickItem & { filterKind?: string }>
    ) => items.filter((item) => item.filterKind === "dateRange");

    const originalShowInputBox = vscode.window.showInputBox;
    const prompts: string[] = [];
    (vscode.window as any).showInputBox = async (
      options: vscode.InputBoxOptions
    ): Promise<string> => {
      prompts.push(options.prompt ?? "");
      return "2024-01-02 12:04:05";
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
      const document = vscode.window.activeTextEditor!.document;
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");

      const expected = "2 | 2024-01-02T12:04:05.000+09:00 INFO target";
      assert.strictEqual(
        await waitForDocumentText(document, (text) => text === expected),
        expected
      );
      assert.ok(
        prompts.every((prompt) => prompt.includes("display timezone +09:00")),
        "both boundary prompts should explain the display-timezone basis in English"
      );
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      const tokyoLogUri = vscode.Uri.file(tokyoLogPath);
      const utcLogUri = vscode.Uri.file(utcLogPath);
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", tokyoLogUri, [
        tokyoLogUri,
        utcLogUri,
      ]);

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      // オフセット適用後、両エントリの間は3時間空いており、既定のギャップ検出
      // しきい値（30秒）を超えるため「XX s gap」のギャップ区切り行が挿入される
      // （issue #102、マージビューへのギャップ検出追加）。
      const expected = [
        "tokyo.log | tokyo | 1 | 2024-01-02T00:00:00.000Z INFO tokyo-entry",
        "          |       | ... | 10800s gap",
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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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

      const fastLogUri = vscode.Uri.file(fastLogPath);
      const steadyLogUri = vscode.Uri.file(steadyLogPath);
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", fastLogUri, [
        fastLogUri,
        steadyLogUri,
      ]);

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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
    /(?:Could not recognize the timestamp format|may begin with an unsupported timestamp format)/;

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
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
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
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
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
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
      });
      assert.strictEqual(firstRun.length, 1, "the first run should warn");

      await vscode.window.showTextDocument(source);
      const secondRun = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
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
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
      });

      assert.strictEqual(warnings.length, 0);
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
        const warnings = await collectRecognitionWarningsWhile(async () => {
          await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", uris[0], uris);
        });

        assert.strictEqual(warnings.length, 1, "only the unrecognized file should warn");
        assert.ok(warnings[0].includes("bad.log"));
        assert.ok(!warnings[0].includes("good.log"));
      }
    );
  });

  test("leaves the warning to the Interactive View panel instead of a modal (#186)", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles([{ name: "interactive.log", content: UNRECOGNIZED_LOG }], async (uris) => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");

      const warnings = await collectRecognitionWarningsWhile(async () => {
        await vscode.commands.executeCommand("totonoeLog.showInteractiveView", uris[0], uris);
      });

      // 開いたままのパネルは追加読み込み・設定変更のたびに描き直されるため、
      // 認識率はパネル内の警告行（読み込まれている限り出続ける表示状態）で
      // 伝える。モーダルを併用すると同じ内容が二重に出る。
      assert.strictEqual(warnings.length, 0, "the interactive view should not show a modal warning");
    });
  });
});

suite("logFileReading / explorer selection helpers (#181)", () => {
  async function withTempDir(
    run: (tempDir: string) => Promise<void>
  ): Promise<void> {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-selection-"));
    try {
      await run(tempDir);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  test("resolves the selected uris, dropping folders", async () => {
    const { resolveExplorerSelectionUris } = await import("../../logFileReading");
    await withTempDir(async (tempDir) => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const logPath = path.join(tempDir, "app.log");
      const nestedDir = path.join(tempDir, "nested");
      await fs.writeFile(logPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.mkdir(nestedDir);

      const resolved = await resolveExplorerSelectionUris(vscode.Uri.file(logPath), [
        vscode.Uri.file(logPath),
        vscode.Uri.file(nestedDir),
      ]);

      assert.deepStrictEqual(
        resolved.map((uri) => uri.fsPath),
        [vscode.Uri.file(logPath).fsPath]
      );
    });
  });

  test("falls back to the clicked uri when the selection array is absent", async () => {
    const { resolveExplorerSelectionUris } = await import("../../logFileReading");
    await withTempDir(async (tempDir) => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const logPath = path.join(tempDir, "app.log");
      await fs.writeFile(logPath, "2024-01-02T03:04:05Z INFO hello");

      const resolved = await resolveExplorerSelectionUris(vscode.Uri.file(logPath), undefined);

      assert.deepStrictEqual(
        resolved.map((uri) => uri.fsPath),
        [vscode.Uri.file(logPath).fsPath]
      );
    });
  });

  test("returns an empty array when invoked with no uris at all (command palette)", async () => {
    const { resolveExplorerSelectionUris } = await import("../../logFileReading");

    assert.deepStrictEqual(await resolveExplorerSelectionUris(undefined, undefined), []);
    assert.deepStrictEqual(await resolveExplorerSelectionUris(undefined, []), []);
  });

  test("loadLogFiles keeps each uri paired with the file it was read from", async () => {
    const { loadLogFiles } = await import("../../logFileReading");
    await withTempDir(async (tempDir) => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "db.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:04Z ERROR boom");

      const loaded = await loadLogFiles([
        vscode.Uri.file(appLogPath),
        vscode.Uri.file(dbLogPath),
      ]);

      assert.deepStrictEqual(
        loaded.map((file) => [file.uri.fsPath, file.input.fileName, file.input.text]),
        [
          [vscode.Uri.file(appLogPath).fsPath, "app.log", "2024-01-02T03:04:05Z INFO hello"],
          [vscode.Uri.file(dbLogPath).fsPath, "db.log", "2024-01-02T03:04:04Z ERROR boom"],
        ]
      );
    });
  });
});
