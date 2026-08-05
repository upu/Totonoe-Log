import * as assert from "node:assert";
import * as vscode from "vscode";
import { activateTotonoeLogExtension } from "./support/activateTotonoeLogExtension";

suite("Totonoe Log virtual document guard: unit behavior", () => {
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
      assert.ok(warningMessage?.includes("Run it on the source log file instead"));

      warningMessage = undefined;
      const ordinaryDocument = { uri: vscode.Uri.parse("untitled:not-a-view") } as vscode.TextDocument;
      assert.strictEqual(guardAgainstVirtualDocumentSource(ordinaryDocument), false);
      assert.strictEqual(warningMessage, undefined);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });
});

suite("Totonoe Log virtual document guard: normalized views", () => {
  test("re-running Show Normalized View against an already-open normalized view warns and opens nothing new", async () => {
    await activateTotonoeLogExtension();

    const source = await vscode.workspace.openTextDocument({
      content: "2024-01-02T03:04:05Z INFO starting",
      language: "log",
    });
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

    await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
    const normalizedEditor = vscode.window.activeTextEditor;
    assert.ok(normalizedEditor, "a normalized view editor should be shown");
    const normalizedUri = normalizedEditor.document.uri.toString();
    assert.strictEqual(normalizedEditor.document.uri.scheme, "totonoe-log-normalized");

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warningMessage: string | undefined;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.ok(
      warningMessage?.includes("Run it on the source log file instead"),
      "a warning should be shown when the source is Totonoe Log's own view"
    );
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the normalized view editor should remain active");
    assert.strictEqual(
      activeEditor.document.uri.toString(),
      normalizedUri,
      "no new virtual document should have been opened"
    );
  });

  // 「絞り込み系コマンドも仮想ドキュメント上では警告する」テストは削除した。
  // 絞り込みは開いたビューに対して実行するのが正しい使い方になったため
  // （issue #248）、ガードの対象ではなくなっている。仮想ドキュメントを
  // 入力として読もうとするコマンド（Show Normalized View / Copy Masked Text）
  // のガードは、この前後のテストで引き続き確認している。

  test("copyMaskedText warns and leaves the clipboard untouched when a normalized view is active", async () => {
    await activateTotonoeLogExtension();

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

    await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
    const normalizedEditor = vscode.window.activeTextEditor;
    assert.ok(normalizedEditor, "a normalized view editor should be shown");
    assert.strictEqual(normalizedEditor.document.uri.scheme, "totonoe-log-normalized");

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
      warningMessage?.includes("Run it on the source log file instead"),
      "a warning should be shown when copying from a virtual view"
    );
    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      sentinel,
      "the clipboard should not be overwritten"
    );
  });
});

suite("Totonoe Log virtual document guard: merged and compare views", () => {
  test("Show Normalized View warns when a merged view is active", async () => {
    await activateTotonoeLogExtension();

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-log-"));
    try {
      const appLogPath = path.join(tempDir, "app.log");
      const dbLogPath = path.join(tempDir, "db.log");
      await fs.writeFile(appLogPath, "2024-01-02T03:04:05Z INFO hello");
      await fs.writeFile(dbLogPath, "2024-01-02T03:04:06Z INFO world");

      const appLogUri = vscode.Uri.file(appLogPath);
      const dbLogUri = vscode.Uri.file(dbLogPath);
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument", appLogUri, [
        appLogUri,
        dbLogUri,
      ]);

      const mergedEditor = vscode.window.activeTextEditor;
      assert.ok(mergedEditor, "a merged view editor should be shown");
      assert.strictEqual(mergedEditor.document.uri.scheme, "totonoe-log-merged");
      const mergedUri = mergedEditor.document.uri.toString();

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      assert.ok(
        warningMessage?.includes("Run it on the source log file instead"),
        "a warning should be shown when normalizing from a merged view"
      );
      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "the merged view editor should remain active");
      assert.strictEqual(
        activeEditor.document.uri.toString(),
        mergedUri,
        "no new view should be opened"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("Set Filter warns when a compare view is active", async () => {
    await activateTotonoeLogExtension();

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

      const compareEditor = vscode.window.activeTextEditor;
      assert.ok(compareEditor, "a compare view editor should be shown");
      assert.strictEqual(compareEditor.document.uri.scheme, "totonoe-log-compare");
      const compareUri = compareEditor.document.uri.toString();

      const originalShowWarningMessage = vscode.window.showWarningMessage;
      let warningMessage: string | undefined;
      (vscode.window as any).showWarningMessage = async (message: string) => {
        warningMessage = message;
        return undefined;
      };

      try {
        await vscode.commands.executeCommand("totonoeLog.setViewFilter");
      } finally {
        (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      }

      // 比較ビューは Totonoe Log のビューではあるが、絞り込み材料を持たない
      // （タイムスタンプごとマスクした diff 用のテキストで、元エントリから
      // 作り直せない）。「ビューが無い」ではなく「対応していない」と案内する。
      assert.ok(
        warningMessage?.includes("This view does not support filtering"),
        `a compare view should be reported as unsupported, got: ${String(warningMessage)}`
      );
      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "the compare view editor should remain active");
      assert.strictEqual(
        activeEditor.document.uri.toString(),
        compareUri,
        "no new view should be opened"
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

suite("Totonoe Log virtual document guard: ordinary logs", () => {
  test("normal log files are unaffected by the guard", async () => {
    await activateTotonoeLogExtension();

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
      await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(warningMessage, undefined, "an ordinary log file should not trigger the guard");
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "a normalized view editor should be shown");
    assert.strictEqual(activeEditor.document.uri.scheme, "totonoe-log-normalized");
  });
});
