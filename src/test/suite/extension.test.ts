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
    assert.notStrictEqual(activeEditor!.document.uri.scheme, "file");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "1 | 2024-01-02T03:04:05.000Z ERROR boom"
    );
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
