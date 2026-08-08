import * as assert from "node:assert";
import * as vscode from "vscode";
import { activateTotonoeLogExtension } from "./support/activateTotonoeLogExtension";

suite("Totonoe Log merged view: regular files", () => {
  test("merges the selected files into a single chronologically-ordered view", async () => {
    await activateTotonoeLogExtension();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "database_20240101.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:04Z ERROR boom");

      const appLogUri = vscode.Uri.file(appLogPath);
      const dbLogUri = vscode.Uri.file(dbLogPath);
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appLogUri, [
        appLogUri,
        dbLogUri,
      ]);

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.strictEqual(activeEditor.document.uri.scheme, "totonoe-log-merged");

      const fileNameWidth = "database_20240101.log".length;
      const kindWidth = "database".length;
      assert.strictEqual(
        activeEditor.document.getText(),
        [
          `${"database_20240101.log".padEnd(fileNameWidth)} | ${"database".padEnd(kindWidth)} | 2024-01-02T03:04:04.000Z ERROR boom`,
          `${"app.log".padEnd(fileNameWidth)} | ${"app".padEnd(kindWidth)} | 2024-01-02T03:04:05.000Z INFO  hello`,
        ].join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("decodes a Shift_JIS source using the resource-scoped files.encoding setting", async () => {
    await activateTotonoeLogExtension();

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

      const shiftJisLogUri = vscode.Uri.file(shiftJisLogPath);
      const utf8LogUri = vscode.Uri.file(utf8LogPath);
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", shiftJisLogUri, [
        shiftJisLogUri,
        utf8LogUri,
      ]);

      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.ok(
        activeEditor.document.getText().includes("INFO 日本"),
        "the Shift_JIS message should be decoded without replacement characters"
      );
    } finally {
      await filesConfig.update("encoding", previousEncoding, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("warns and falls back to UTF-8 for an unsupported files.encoding value", async () => {
    await activateTotonoeLogExtension();

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

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      const logUri = vscode.Uri.file(logPath);
      try {
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", logUri, [
          logUri,
          logUri,
        ]);
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(warningMessage?.includes("unsupported-test-encoding"));
      assert.ok(warningMessage?.includes("UTF-8"));
      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "a merged view editor should be shown");
      assert.ok(activeEditor.document.getText().includes("INFO fallback"));
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

suite("Totonoe Log merged view: large files", () => {
  test("opens the complete merged result when its formatted content exceeds 50MB", async function () {
    this.timeout(60000);

    await activateTotonoeLogExtension();

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

      const bigLogUri = vscode.Uri.file(bigLogPath);
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", bigLogUri, [
        bigLogUri,
        bigLogUri,
      ]);

      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(activeTab, "the large merged result should be opened in a tab");
      assert.ok(
        activeTab.input instanceof vscode.TabInputText,
        "the large merged result should use a text editor tab"
      );

      const resultUri = activeTab.input.uri;
      assert.notStrictEqual(
        resultUri.scheme,
        "totonoe-log-merged",
        "the large result should bypass virtual-document synchronization via extension storage"
      );

      const resultStat = await vscode.workspace.fs.stat(resultUri);
      assert.ok(
        resultStat.size > 50 * oneMb,
        `the complete formatted result should exceed 50MB (actual: ${String(resultStat.size)} bytes)`
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

    await activateTotonoeLogExtension();

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
      // 検証するのは読み込み側の制限だけ。マージ後の表示にも同じ50MB制限が
      // 別レイヤーでかかる（issue #98のスコープ外）ため、マージコマンド経由
      // ではなく、そのコマンドが使う読み込み関数（`loadLogFiles`）を直接
      // 通す。以前は「マージしてから絞り込む」コマンドで表示内容を小さく
      // 保っていたが、絞り込みが表示後の操作になった（issue #248）ため、
      // 表示を経由せずに読み込み結果そのものを確かめる形に変えた。
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
        `test fixture should exceed VSCode's ~50MB sync limit (actual: ${String(bigLogStats.size)} bytes)`
      );

      const { loadLogFiles } = await import("../../logFileReading");
      const [loaded] = await loadLogFiles([vscode.Uri.file(bigLogPath)]);

      assert.ok(
        loaded.input.text.includes(`line-${String(lastIndex).padStart(3, "0")}`),
        "the big file's last line (only reachable by reading the whole ~52MB file) must be present"
      );
      assert.strictEqual(loaded.input.fileName, "big.log");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
