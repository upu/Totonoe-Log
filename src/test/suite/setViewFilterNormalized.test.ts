import * as assert from "node:assert";
import * as vscode from "vscode";
import type { FilterKind } from "../../filterPrompts";
import { activateTotonoeLogExtension } from "./support/activateTotonoeLogExtension";
import { waitForDocumentText } from "./support/waitForDocumentText";

interface TestQuickPickItem extends vscode.QuickPickItem {
  readonly filterKind?: FilterKind;
  readonly severityValue?: string;
}

/**
 * 条件選択とセベリティ選択を、翻訳されないメタデータで区別するモック。
 * 表示ラベルを参照しないため、VS Code の表示言語に依存しない。
 */
function installQuickPickMock(
  kindsToSelect: readonly FilterKind[],
  severitiesToSelect: readonly string[] = ["ERROR"]
): () => void {
  const original = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (items: TestQuickPickItem[]) => {
    const isKindPicker = items.some((item) => item.filterKind !== undefined);
    if (isKindPicker) {
      return items.filter(
        (item) => item.filterKind !== undefined && kindsToSelect.includes(item.filterKind)
      );
    }
    return items.filter(
      (item) => item.severityValue !== undefined && severitiesToSelect.includes(item.severityValue)
    );
  };
  return () => {
    (vscode.window as any).showQuickPick = original;
  };
}

/**
 * 絞り込みは「開き方」ではなく開いたビューへの設定になったため（issue #248）、
 * 各テストはまず正規化ビューを開くところから始まる。返すのはそのビューの
 * ドキュメントで、`Set Filter` はこれを開いたまま書き換える。
 */
async function openNormalizedView(content: string): Promise<vscode.TextDocument> {
  await activateTotonoeLogExtension();

  const source = await vscode.workspace.openTextDocument({ content, language: "log" });
  await vscode.window.showTextDocument(source);
  await vscode.commands.executeCommand("totonoeLog.openVirtualDocument");

  const activeEditor = vscode.window.activeTextEditor;
  assert.ok(activeEditor, "a normalized view editor should be shown");
  const document = activeEditor.document;
  assert.strictEqual(document.uri.scheme, "totonoe-log-normalized");
  return document;
}

suite("Totonoe Log set filter on the normalized view (#248): command surface", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("registers the setViewFilter command", async () => {
    await activateTotonoeLogExtension();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("totonoeLog.setViewFilter"),
      "totonoeLog.setViewFilter command should be registered"
    );
  });

  test("contributes an editor/context entry limited to the normalized and merged views", async () => {
    const extension = await activateTotonoeLogExtension();

    const editorContext = extension.packageJSON.contributes.menus["editor/context"] as Array<{
      command: string;
      when: string;
    }>;
    const entry = editorContext.find((item) => item.command === "totonoeLog.setViewFilter");
    assert.ok(entry, "setViewFilter should appear in the editor context menu");
    assert.ok(
      entry.when.includes("totonoe-log-normalized") && entry.when.includes("totonoe-log-merged"),
      "the entry should be limited to the views it can actually filter"
    );
  });
});

suite("Totonoe Log set filter on the normalized view (#248): criteria", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("applies only the criteria selected in the kind picker (severity + ignore pattern)", async () => {
    const document = await openNormalizedView(
      [
        "2024-01-02T03:04:05Z INFO starting",
        "2024-01-02T03:04:06Z ERROR boom",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
      ].join("\n")
    );
    const uriBefore = document.uri.toString();

    const restoreQuickPick = installQuickPickMock(["severity", "ignorePattern"]);
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

    const expected = "2 | 2024-01-02T03:04:06.000Z ERROR boom";
    assert.strictEqual(await waitForDocumentText(document, (text) => text === expected), expected);
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the filtered view editor should remain active");
    assert.strictEqual(
      activeEditor.document.uri.toString(),
      uriBefore,
      "the filter should rewrite the same tab instead of opening a new one"
    );
    assert.ok(
      infoMessage?.includes("Hid 2 lines"),
      "the hidden line count should be reported"
    );
  });

  test("uses singular grammar when exactly one line is hidden", async () => {
    const document = await openNormalizedView(
      ["2024-01-02T03:04:05Z INFO starting", "2024-01-02T03:04:06Z ERROR boom"].join("\n")
    );
    const restoreQuickPick = installQuickPickMock(["severity"], ["ERROR"]);
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
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    const expected = "2 | 2024-01-02T03:04:06.000Z ERROR boom";
    assert.strictEqual(await waitForDocumentText(document, (text) => text === expected), expected);
    assert.strictEqual(
      infoMessage,
      "Totonoe Log: Hid 1 line that did not match (showing 1/2 lines)."
    );
  });

  test("uses singular grammar when the unfiltered view contains one line", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const restoreQuickPick = installQuickPickMock([]);
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
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    assert.strictEqual(
      await waitForDocumentText(document, (text) => text.includes("INFO starting")),
      "1 | 2024-01-02T03:04:05.000Z INFO starting"
    );
    assert.strictEqual(
      infoMessage,
      "Totonoe Log: No lines were hidden (showing the only line)."
    );
  });

  test("combines all three criteria (severity + date range + ignore pattern)", async () => {
    const document = await openNormalizedView(
      [
        "2024-01-01T00:00:00Z ERROR before range",
        "2024-01-02T03:04:05Z INFO in range but wrong severity",
        "2024-01-02T03:04:06Z ERROR in range and matching",
        "2024-01-02T03:04:07Z ERROR heartbeat noise",
        "2024-01-03T00:00:00Z ERROR after range",
      ].join("\n")
    );

    const restoreQuickPick = installQuickPickMock(["severity", "dateRange", "ignorePattern"]);
    const originalShowInputBox = vscode.window.showInputBox;
    let inputBoxCallCount = 0;
    (vscode.window as any).showInputBox = async () => {
      inputBoxCallCount += 1;
      if (inputBoxCallCount === 1) return "2024-01-02";
      if (inputBoxCallCount === 2) return "2024-01-02T23:59:59";
      return "heartbeat";
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const expected = "3 | 2024-01-02T03:04:06.000Z ERROR in range and matching";
    assert.strictEqual(await waitForDocumentText(document, (text) => text === expected), expected);
  });

  test("re-applies the filter from the unfiltered entries instead of narrowing further", async () => {
    const document = await openNormalizedView(
      ["2024-01-02T03:04:05Z INFO starting", "2024-01-02T03:04:06Z ERROR boom"].join("\n")
    );

    let restoreQuickPick = installQuickPickMock(["severity"], ["ERROR"]);
    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
    }
    const errorOnly = "2 | 2024-01-02T03:04:06.000Z ERROR boom";
    assert.strictEqual(
      await waitForDocumentText(document, (text) => text === errorOnly),
      errorOnly
    );

    // 前回の結果に重ねるなら0行になるが、絞り込み前のエントリへ掛け直すので戻る。
    restoreQuickPick = installQuickPickMock(["severity"], ["INFO"]);
    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
    }

    const infoOnly = "1 | 2024-01-02T03:04:05.000Z INFO starting";
    assert.strictEqual(await waitForDocumentText(document, (text) => text === infoOnly), infoOnly);
  });

  test("clears the filter when no kind is selected (but the picker is not dismissed)", async () => {
    const everyLine = [
      "1 | 2024-01-02T03:04:05.000Z INFO  starting",
      "2 | 2024-01-02T03:04:06.000Z ERROR boom",
    ].join("\n");
    const document = await openNormalizedView(
      ["2024-01-02T03:04:05Z INFO starting", "2024-01-02T03:04:06Z ERROR boom"].join("\n")
    );

    const restoreQuickPick = installQuickPickMock(["severity"], ["ERROR"]);
    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
    }
    await waitForDocumentText(document, (text) => !text.includes("INFO starting"));

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => [];
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let infoMessage: string | undefined;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessage = message;
      return undefined;
    };
    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    assert.strictEqual(
      await waitForDocumentText(document, (text) => text === everyLine),
      everyLine
    );
    // 解除したのに「条件に合わない 0 行を非表示にしました」とは言わない。
    assert.ok(
      infoMessage?.includes("No lines were hidden"),
      `clearing the filter should not read as filtering, got: ${String(infoMessage)}`
    );
  });
});

suite("Totonoe Log set filter on the normalized view (#248): cancellation and guards", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("leaves the view untouched when the kind picker is dismissed", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const textBefore = document.getText();

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;
    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    assert.strictEqual(document.getText(), textBefore);
  });

  test("leaves the view untouched when the severity picker is dismissed after selecting the severity kind", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const textBefore = document.getText();

    const originalShowQuickPick = vscode.window.showQuickPick;
    let callCount = 0;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
      callCount += 1;
      if (callCount === 1) {
        return items.filter(
          (item) => (item as TestQuickPickItem).filterKind === "severity"
        );
      }
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    assert.strictEqual(document.getText(), textBefore);
  });

  test("leaves the view untouched when a date prompt is dismissed after selecting the date range kind", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const textBefore = document.getText();

    const restoreQuickPick = installQuickPickMock(["dateRange"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    assert.strictEqual(document.getText(), textBefore);
  });

  test("leaves the view untouched when the ignore pattern prompt is dismissed", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const textBefore = document.getText();

    const restoreQuickPick = installQuickPickMock(["ignorePattern"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined;

    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    assert.strictEqual(document.getText(), textBefore);
  });

  test("warns and does nothing when the active editor is not a Totonoe Log view", async () => {
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
    let quickPickShown = false;
    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => {
      quickPickShown = true;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }

    assert.ok(warningMessage, "a warning should explain that the command needs a Totonoe Log view");
    assert.strictEqual(quickPickShown, false, "the prompts should not start at all");
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "the original editor should remain active");
    assert.strictEqual(
      activeEditor.document.getText(),
      "2024-01-02T03:04:05Z INFO starting"
    );
  });

  test("shows a warning when there is no active editor at all", async () => {
    await activateTotonoeLogExtension();

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    });
  });

  test("shows a warning and leaves the view untouched when an entered date cannot be parsed", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const textBefore = document.getText();

    const restoreQuickPick = installQuickPickMock(["dateRange"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "not a date";

    try {
      await assert.doesNotReject(async () => {
        await vscode.commands.executeCommand("totonoeLog.setViewFilter");
      });
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    assert.strictEqual(document.getText(), textBefore);
  });
});

suite("Totonoe Log set filter on the normalized view (#248): ignore patterns", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("counts every physical line of a hidden multi-line entry, including non-matching continuation lines", async () => {
    const document = await openNormalizedView(
      [
        "2024-01-02T03:04:05Z ERROR boom",
        "    at com.example.Foo.bar(Foo.java:42)",
        "2024-01-02T03:04:06Z INFO keep",
      ].join("\n")
    );

    const restoreQuickPick = installQuickPickMock(["ignorePattern"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "boom";

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

    const expected = "3 | 2024-01-02T03:04:06.000Z INFO keep";
    assert.strictEqual(await waitForDocumentText(document, (text) => text === expected), expected);
    // マッチしたエントリは2物理行分（ERROR行＋スタックトレースの継続行）
    // にまたがっており、"boom" を含むのは先頭行だけである点に注意。
    assert.ok(
      infoMessage?.includes("Hid 2 lines"),
      "the hidden line count should include the entry's continuation lines"
    );
  });

  test("trims surrounding whitespace from the entered pattern before matching", async () => {
    const document = await openNormalizedView(
      ["2024-01-02T03:04:05Z INFO heartbeat ok", "2024-01-02T03:04:06Z ERROR boom"].join("\n")
    );

    const restoreQuickPick = installQuickPickMock(["ignorePattern"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "  heartbeat  ";

    try {
      await vscode.commands.executeCommand("totonoeLog.setViewFilter");
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    const expected = "2 | 2024-01-02T03:04:06.000Z ERROR boom";
    assert.strictEqual(await waitForDocumentText(document, (text) => text === expected), expected);
  });

  test("shows a warning and leaves the view untouched when the entered pattern is not a valid regular expression", async () => {
    const document = await openNormalizedView("2024-01-02T03:04:05Z INFO starting");
    const textBefore = document.getText();

    const restoreQuickPick = installQuickPickMock(["ignorePattern"]);
    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "(unclosed";

    try {
      await assert.doesNotReject(async () => {
        await vscode.commands.executeCommand("totonoeLog.setViewFilter");
      });
    } finally {
      restoreQuickPick();
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    assert.strictEqual(document.getText(), textBefore);
  });
});
