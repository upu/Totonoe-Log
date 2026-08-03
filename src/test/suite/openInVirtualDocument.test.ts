import * as assert from "node:assert";
import * as vscode from "vscode";
import { waitForDocumentText } from "./support/waitForDocumentText";

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
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(tempDir, name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      paths[name] = filePath;
    }
    return await run(paths);
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

suite("Totonoe Log open in virtual document (#249): command surface", () => {
  test("registers the openVirtualDocument command and drops the two it replaces", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    const contributed = (
      extension!.packageJSON.contributes.commands as Array<{ command: string }>
    ).map((item) => item.command);

    assert.ok(
      commands.includes("totonoeLog.openVirtualDocument"),
      "totonoeLog.openVirtualDocument command should be registered"
    );
    for (const removed of ["totonoeLog.showNormalizedView", "totonoeLog.mergeSelectedFiles"]) {
      assert.ok(!commands.includes(removed), `${removed} should no longer be registered`);
      assert.ok(!contributed.includes(removed), `${removed} should no longer be contributed`);
    }
  });

  test("shows the explorer entry for any non-folder, not just multi-selections", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const explorerContext = extension!.packageJSON.contributes.menus["explorer/context"] as Array<{
      command: string;
      when: string;
    }>;
    const entry = explorerContext.find(
      (item) => item.command === "totonoeLog.openVirtualDocument"
    );
    assert.ok(entry, "openVirtualDocument should appear in the explorer context menu");
    assert.strictEqual(
      entry!.when,
      "!explorerResourceIsFolder",
      "a single selected file must be enough to offer the command"
    );
  });
});

suite("Totonoe Log open in virtual document (#249): view selection", () => {
  test("opens a normalized view for a single file selected in the explorer", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles({ "app.log": "2024-01-02T03:04:05Z ERROR boom" }, async (paths) => {
      const appLogUri = vscode.Uri.file(paths["app.log"]);

      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appLogUri, [
        appLogUri,
      ]);

      const activeEditor = vscode.window.activeTextEditor;
      assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
      // 単一ファイルなのでファイル名/種類列は付かない。
      assert.strictEqual(
        activeEditor!.document.getText(),
        "1 | 2024-01-02T03:04:05.000Z ERROR boom"
      );
    });
  });

  test("opens a merged view for two or more files, spanning folders", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "sub/db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const appLogUri = vscode.Uri.file(paths["app.log"]);
        const dbLogUri = vscode.Uri.file(paths["sub/db.log"]);

        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appLogUri, [
          appLogUri,
          dbLogUri,
        ]);

        const activeEditor = vscode.window.activeTextEditor;
        assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-merged");
        const text = activeEditor!.document.getText();
        assert.ok(text.includes("app.log"), "the merged view should carry the file name column");
        assert.ok(text.includes("db.log"), "a file from another folder should be merged in");
      }
    );
  });

  test("falls back to the active editor when run from the palette, unsaved changes included", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z ERROR unsaved edit",
      language: "log",
    });
    await vscode.window.showTextDocument(source);

    await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

    const activeEditor = vscode.window.activeTextEditor;
    assert.strictEqual(activeEditor!.document.uri.scheme, "totonoe-log-normalized");
    assert.strictEqual(
      activeEditor!.document.getText(),
      "1 | 2024-01-02T03:04:05.000Z ERROR unsaved edit"
    );

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("warns instead of opening when the selection holds only folders", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles({ "sub/app.log": "2024-01-02T03:04:05Z INFO starting" }, async (paths) => {
      const path = await import("node:path");
      const subDirUri = vscode.Uri.file(path.dirname(paths["sub/app.log"]));

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
        // フォルダだけを選んだ場合、フォルダは除外されて対象が残らない。
        // アクティブエディタへは落とさない——エクスプローラで選んだつもりの
        // 対象と、たまたま開いていたログが食い違うため。
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", subDirUri, [
          subDirUri,
        ]);
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(warningMessage, "a warning should explain that no log file was selected");
      assert.notStrictEqual(
        vscode.window.activeTextEditor!.document.uri.scheme,
        "totonoe-log-normalized"
      );
      assert.notStrictEqual(
        vscode.window.activeTextEditor!.document.uri.scheme,
        "totonoe-log-merged"
      );
    });
  });
});

suite("Totonoe Log open in virtual document (#249): downstream commands", () => {
  test("keeps Go to Source Line working from both the single-file and merged results", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const appLogUri = vscode.Uri.file(paths["app.log"]);
        const dbLogUri = vscode.Uri.file(paths["db.log"]);

        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", dbLogUri, [
          dbLogUri,
        ]);
        vscode.window.activeTextEditor!.selection = new vscode.Selection(0, 0, 0, 0);
        await vscode.commands.executeCommand("totonoeLog.goToSourceLine");
        assert.strictEqual(
          vscode.window.activeTextEditor!.document.uri.fsPath,
          dbLogUri.fsPath,
          "the single-file result should map back to its source"
        );

        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appLogUri, [
          appLogUri,
          dbLogUri,
        ]);
        assert.strictEqual(
          vscode.window.activeTextEditor!.document.uri.scheme,
          "totonoe-log-merged"
        );
        vscode.window.activeTextEditor!.selection = new vscode.Selection(0, 0, 0, 0);
        await vscode.commands.executeCommand("totonoeLog.goToSourceLine");
        assert.strictEqual(
          vscode.window.activeTextEditor!.document.uri.fsPath,
          appLogUri.fsPath,
          "the merged result should map back to the first entry's source"
        );
      }
    );
  });

  test("can be filtered afterwards in both shapes (#248 keeps working)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const appLogUri = vscode.Uri.file(paths["app.log"]);
        const dbLogUri = vscode.Uri.file(paths["db.log"]);

        const originalShowQuickPick = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async (
          items: Array<vscode.QuickPickItem & { filterKind?: string; severityValue?: string }>
        ) => {
          const isKindPicker = items.some((item) => item.filterKind !== undefined);
          return isKindPicker
            ? items.filter((item) => item.filterKind === "severity")
            : items.filter((item) => item.severityValue === "ERROR");
        };

        try {
          await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appLogUri, [
            appLogUri,
            dbLogUri,
          ]);
          const merged = vscode.window.activeTextEditor!.document;
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
          assert.ok(
            !(await waitForDocumentText(merged, (text) => !text.includes("INFO starting"))).includes(
              "INFO starting"
            ),
            "the merged result opened by the unified command should be filterable"
          );
        } finally {
          (vscode.window as any).showQuickPick = originalShowQuickPick;
        }
      }
    );
  });
});
