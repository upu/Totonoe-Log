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
});
