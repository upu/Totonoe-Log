import * as assert from "node:assert";
import * as vscode from "vscode";
import { waitForDocumentText } from "./support/waitForDocumentText";

suite("Totonoe Log go to source line (#137): command surface", () => {
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
});

suite("Totonoe Log go to source line (#137): normalized views", () => {
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

    await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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
    // 1回目は条件選択（セベリティのみ）、2回目はセベリティ選択（ERROR のみ）。
    (vscode.window as any).showQuickPick = async (
      items: Array<vscode.QuickPickItem & { filterKind?: string; severityValue?: string }>
    ) =>
      items.filter(
        (item) => item.filterKind === "severity" || item.severityValue === "ERROR"
      );

    await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
    const view = vscode.window.activeTextEditor!.document;
    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
    await waitForDocumentText(view, (text) => !text.includes("INFO starting"));

    const viewEditor = vscode.window.activeTextEditor;
    assert.strictEqual(viewEditor!.document.uri.scheme, "totonoe-log-normalized");
    // 絞り込み後の表示1行目は、元ファイルでは2行目の ERROR エントリ。
    viewEditor!.selection = new vscode.Selection(0, 0, 0, 0);

    await vscode.commands.executeCommand("totonoeLog.goToSourceLine");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the source editor should be shown");
    assert.strictEqual(activeEditor!.document.uri.toString(), source.uri.toString());
    assert.strictEqual(activeEditor!.selection.start.line, 1);
  });
});

suite("Totonoe Log go to source line (#137): merged views", () => {
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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", uriA, [uriA, uriB]);

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

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

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
});

suite("Totonoe Log go to source line (#137): edge cases", () => {
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
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", keptUri, [
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
          warningMessage?.includes("Could not open the source log file"),
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
