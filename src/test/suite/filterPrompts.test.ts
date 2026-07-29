import * as assert from "node:assert";
import * as vscode from "vscode";
import { promptFilterCriteriaForKinds, type FilterKind } from "../../filterPrompts";
import { parseLog } from "../../normalize";

/**
 * 正規化ビューとマージビューが共有する条件プロンプト（{@link promptFilterCriteriaForKinds}）
 * のテスト（issue #221）。コマンド全体の挙動は `extension.test.ts` が押さえて
 * いるが、共通化した順序・キャンセル判定そのものはこちらで直接固定する。
 */

const ENTRIES = parseLog(
  ["2024-01-02T03:04:05Z INFO starting", "2024-01-02T03:04:06Z ERROR boom"].join("\n")
);

/** テスト対象が出すプロンプトの呼び出し回数と、モックの後始末をまとめて扱う。 */
interface PromptMock {
  readonly quickPickCalls: () => number;
  readonly inputBoxCalls: () => number;
  readonly warnings: () => readonly string[];
  readonly restore: () => void;
}

/**
 * セベリティ選択ピッカーと入力ボックスをモックする。`severityPick` が
 * `undefined` を返せばピッカーのキャンセル、`inputs` の要素が `undefined` を
 * 返せば入力ボックスのキャンセルを表す。
 */
function installPromptMocks(options: {
  severityLabels?: readonly string[] | undefined;
  inputs?: readonly (string | undefined)[];
}): PromptMock {
  const originalQuickPick = vscode.window.showQuickPick;
  const originalInputBox = vscode.window.showInputBox;
  const originalWarning = vscode.window.showWarningMessage;

  let quickPickCalls = 0;
  let inputBoxCalls = 0;
  const warnings: string[] = [];

  (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
    quickPickCalls += 1;
    if (options.severityLabels === undefined) {
      return undefined;
    }
    return items.filter((item) => options.severityLabels!.includes(item.label));
  };
  (vscode.window as any).showInputBox = async () => {
    const input = options.inputs?.[inputBoxCalls];
    inputBoxCalls += 1;
    return input;
  };
  (vscode.window as any).showWarningMessage = async (message: string) => {
    warnings.push(message);
    return undefined;
  };

  return {
    quickPickCalls: () => quickPickCalls,
    inputBoxCalls: () => inputBoxCalls,
    warnings: () => warnings,
    restore: () => {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showInputBox = originalInputBox;
      (vscode.window as any).showWarningMessage = originalWarning;
    },
  };
}

function kinds(...selected: readonly FilterKind[]): Set<FilterKind> {
  return new Set(selected);
}

suite("Totonoe Log filter prompts (shared)", () => {
  test("prompts for every selected kind and builds the combined criteria", async () => {
    const mock = installPromptMocks({
      severityLabels: ["ERROR"],
      inputs: ["2024-01-02", "2024-01-02T23:59:59", "heartbeat"],
    });

    try {
      const criteria = await promptFilterCriteriaForKinds(
        kinds("severity", "dateRange", "ignorePattern"),
        ENTRIES,
        0
      );

      assert.ok(criteria);
      assert.deepStrictEqual([...criteria!.severities!], ["ERROR"]);
      assert.strictEqual(criteria!.dateRange?.startMs, Date.UTC(2024, 0, 2));
      assert.strictEqual(criteria!.dateRange?.endMs, Date.UTC(2024, 0, 2, 23, 59, 59));
      assert.strictEqual(criteria!.ignorePattern?.source, "heartbeat");
      assert.strictEqual(criteria!.ignorePattern?.flags, "im");
      assert.strictEqual(mock.quickPickCalls(), 1);
      assert.strictEqual(mock.inputBoxCalls(), 3);
    } finally {
      mock.restore();
    }
  });

  test("asks nothing and returns empty criteria when no kind is selected", async () => {
    const mock = installPromptMocks({ severityLabels: ["ERROR"], inputs: ["heartbeat"] });

    try {
      const criteria = await promptFilterCriteriaForKinds(kinds(), ENTRIES, 0);

      assert.deepStrictEqual(criteria, {
        severities: undefined,
        dateRange: undefined,
        ignorePattern: undefined,
      });
      assert.strictEqual(mock.quickPickCalls(), 0);
      assert.strictEqual(mock.inputBoxCalls(), 0);
    } finally {
      mock.restore();
    }
  });

  test("keeps a date range with no boundary when both inputs are left empty", async () => {
    const mock = installPromptMocks({ inputs: ["", ""] });

    try {
      const criteria = await promptFilterCriteriaForKinds(kinds("dateRange"), ENTRIES, 0);

      assert.deepStrictEqual(criteria?.dateRange, { startMs: undefined, endMs: undefined });
    } finally {
      mock.restore();
    }
  });

  test("aborts without asking the remaining prompts when the severity picker is dismissed", async () => {
    const mock = installPromptMocks({ severityLabels: undefined, inputs: ["heartbeat"] });

    try {
      const criteria = await promptFilterCriteriaForKinds(
        kinds("severity", "ignorePattern"),
        ENTRIES,
        0
      );

      assert.strictEqual(criteria, undefined);
      assert.strictEqual(mock.inputBoxCalls(), 0);
    } finally {
      mock.restore();
    }
  });

  test("aborts when the start date prompt is dismissed", async () => {
    const mock = installPromptMocks({ inputs: [undefined, "2024-01-02"] });

    try {
      const criteria = await promptFilterCriteriaForKinds(
        kinds("dateRange", "ignorePattern"),
        ENTRIES,
        0
      );

      assert.strictEqual(criteria, undefined);
      assert.strictEqual(mock.inputBoxCalls(), 1);
    } finally {
      mock.restore();
    }
  });

  test("aborts when the end date prompt is dismissed", async () => {
    const mock = installPromptMocks({ inputs: ["2024-01-02", undefined] });

    try {
      const criteria = await promptFilterCriteriaForKinds(kinds("dateRange"), ENTRIES, 0);

      assert.strictEqual(criteria, undefined);
      assert.strictEqual(mock.inputBoxCalls(), 2);
    } finally {
      mock.restore();
    }
  });

  test("aborts and warns when a date boundary cannot be interpreted", async () => {
    const mock = installPromptMocks({ inputs: ["not-a-date"] });

    try {
      const criteria = await promptFilterCriteriaForKinds(kinds("dateRange"), ENTRIES, 0);

      assert.strictEqual(criteria, undefined);
      assert.ok(mock.warnings().some((message) => message.includes("日時を解釈できませんでした")));
    } finally {
      mock.restore();
    }
  });

  test("aborts when the ignore pattern prompt is dismissed or left empty", async () => {
    for (const input of [undefined, ""]) {
      const mock = installPromptMocks({ inputs: [input] });

      try {
        const criteria = await promptFilterCriteriaForKinds(kinds("ignorePattern"), ENTRIES, 0);
        assert.strictEqual(criteria, undefined);
      } finally {
        mock.restore();
      }
    }
  });

  test("aborts and warns when the ignore pattern is not a valid regular expression", async () => {
    const mock = installPromptMocks({ inputs: ["("] });

    try {
      const criteria = await promptFilterCriteriaForKinds(kinds("ignorePattern"), ENTRIES, 0);

      assert.strictEqual(criteria, undefined);
      assert.ok(
        mock.warnings().some((message) => message.includes("正規表現として解釈できませんでした"))
      );
    } finally {
      mock.restore();
    }
  });
});
