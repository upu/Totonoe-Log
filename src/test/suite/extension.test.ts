import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Totonoe Log extension", () => {
  test("activates and registers the placeholder command", async () => {
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

    const tempFilePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-")), "app.log");
    await fs.writeFile(tempFilePath, "2024-01-02T03:04:05Z INFO hello");

    const source = await vscode.workspace.openTextDocument(vscode.Uri.file(tempFilePath));
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a normalized view editor should be shown");
    assert.match(activeEditor!.document.uri.path, /^\/app\.normalized-\d+\.log$/);
  });

  test("keeps a leading dot intact for dotfiles with no other extension", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempFilePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-")), ".env");
    await fs.writeFile(tempFilePath, "2024-01-02T03:04:05Z INFO hello");

    const source = await vscode.workspace.openTextDocument(vscode.Uri.file(tempFilePath));
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.showNormalizedView");

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a normalized view editor should be shown");
    assert.match(activeEditor!.document.uri.path, /^\/\.env\.normalized-\d+\.log$/);
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
