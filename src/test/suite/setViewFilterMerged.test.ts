import * as assert from "node:assert";
import * as vscode from "vscode";
import { waitForDocumentText } from "./support/waitForDocumentText";

/**
 * 条件選択ピッカーとセベリティ選択ピッカーを、選択肢のラベルで区別する
 * モック。正規化ビュー側のスイートと同じ役割だが、対象のビューが違う
 * テストスイート間で暗黙の結合を作らないよう意図的に分けている。
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

/** 指定したファイル群をマージして開き、そのビューのドキュメントを返す。 */
async function openMergedView(fileUris: readonly vscode.Uri[]): Promise<vscode.TextDocument> {
  await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", fileUris[0], [
    ...fileUris,
  ]);
  const document = vscode.window.activeTextEditor!.document;
  assert.strictEqual(document.uri.scheme, "totonoe-log-merged");
  return document;
}

suite("Totonoe Log set filter on the merged view (#248): filtering and navigation", () => {
  test("applies only the criteria selected in the kind picker, keeping fileName/kind columns", async () => {
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
        const document = await openMergedView([
          vscode.Uri.file(paths["app.log"]),
          vscode.Uri.file(paths["database_20240101.log"]),
        ]);

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
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
        } finally {
          restoreQuickPick();
          (vscode.window as any).showInputBox = originalShowInputBox;
          (vscode.window as any).showInformationMessage = originalShowInformationMessage;
        }

        const fileNameWidth = "database_20240101.log".length;
        const kindWidth = "database".length;
        const expected = `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:06.000Z ERROR boom`;
        assert.strictEqual(
          await waitForDocumentText(document, (text) => text === expected),
          expected
        );
        assert.ok(
          infoMessage?.includes("条件に合わない 2 行"),
          "the hidden line count should be reported"
        );
      }
    );
  });

  test("keeps the source mapping so Go to Source Line still reaches the original file", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const dbLogUri = vscode.Uri.file(paths["db.log"]);
        const document = await openMergedView([vscode.Uri.file(paths["app.log"]), dbLogUri]);

        const restoreQuickPick = installFilterKindQuickPickMock(["セベリティ"]);
        try {
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
        } finally {
          restoreQuickPick();
        }
        await waitForDocumentText(document, (text) => !text.includes("INFO starting"));

        const mergedEditor = vscode.window.activeTextEditor!;
        mergedEditor.selection = new vscode.Selection(0, 0, 0, 0);
        await vscode.commands.executeCommand("totonoeLog.goToSourceLine");

        assert.strictEqual(
          vscode.window.activeTextEditor!.document.uri.fsPath,
          dbLogUri.fsPath,
          "Go to Source Line should still reach the original file after filtering"
        );
      }
    );
  });
});

suite("Totonoe Log set filter on the merged view (#248): clearing and cancellation", () => {
  test("clears the filter when no kind is selected (but the picker is not dismissed)", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const document = await openMergedView([
          vscode.Uri.file(paths["app.log"]),
          vscode.Uri.file(paths["db.log"]),
        ]);

        const restoreQuickPick = installFilterKindQuickPickMock(["セベリティ"]);
        try {
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
        } finally {
          restoreQuickPick();
        }
        await waitForDocumentText(document, (text) => !text.includes("INFO starting"));

        const originalShowQuickPick = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => [];
        try {
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
        } finally {
          (vscode.window as any).showQuickPick = originalShowQuickPick;
        }

        const fileNameWidth = "app.log".length;
        const kindWidth = "app".length;
        const everyLine = [
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:05.000Z INFO  starting`,
          `${"db.log".padEnd(fileNameWidth)} | ${"db".padEnd(kindWidth)} | 1 | 2024-01-02T03:04:06.000Z ERROR boom`,
        ].join("\n");
        assert.strictEqual(
          await waitForDocumentText(document, (text) => text === everyLine),
          everyLine
        );
      }
    );
  });

  test("leaves the view untouched when the kind picker is dismissed", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const document = await openMergedView([
          vscode.Uri.file(paths["app.log"]),
          vscode.Uri.file(paths["db.log"]),
        ]);
        const textBefore = document.getText();

        const originalShowQuickPick = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => undefined;
        try {
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
        } finally {
          (vscode.window as any).showQuickPick = originalShowQuickPick;
        }

        assert.strictEqual(document.getText(), textBefore);
      }
    );
  });

  test("leaves the view untouched when a prompt is dismissed after picking a kind", async () => {
    const extension = vscode.extensions.getExtension("upu.totonoe-log");
    await extension!.activate();

    await withTempLogFiles(
      {
        "app.log": "2024-01-02T03:04:05Z INFO starting",
        "db.log": "2024-01-02T03:04:06Z ERROR boom",
      },
      async (paths) => {
        const document = await openMergedView([
          vscode.Uri.file(paths["app.log"]),
          vscode.Uri.file(paths["db.log"]),
        ]);
        const textBefore = document.getText();

        const restoreQuickPick = installFilterKindQuickPickMock(["無視パターン"]);
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined;

        try {
          await vscode.commands.executeCommand("totonoeLog.setViewFilter");
        } finally {
          restoreQuickPick();
          (vscode.window as any).showInputBox = originalShowInputBox;
        }

        assert.strictEqual(document.getText(), textBefore);
      }
    );
  });
});
