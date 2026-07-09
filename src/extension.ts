import * as vscode from "vscode";
import {
  NORMALIZED_VIEW_SCHEME,
  NormalizedViewContentProvider,
  createShowNormalizedViewCommand,
  createShowNormalizedViewFilteredBySeverityCommand,
  createShowNormalizedViewFilteredByDateRangeCommand,
} from "./normalizedView";
import {
  COMPARE_VIEW_SCHEME,
  CompareViewContentProvider,
  createCompareLogsCommand,
} from "./compareView";

/**
 * `totonoeLog.showMergedView` のプレースホルダーコマンド。
 * 実際のマージ表示機能（複数ログファイルの統合表示）は、他の機能
 * （正規化・絞り込み・折りたたみ・比較）と同様に issue/PR 単位で
 * 段階的に実装していく。ロードマップはプロジェクトの README を参照。
 */
async function showMergedView(): Promise<void> {
  vscode.window.showInformationMessage(
    "Totonoe Log: feature not implemented yet. Stay tuned!"
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const normalizedViewProvider = new NormalizedViewContentProvider();
  const compareViewProvider = new CompareViewContentProvider();

  context.subscriptions.push(
    vscode.commands.registerCommand("totonoeLog.showMergedView", showMergedView),
    vscode.workspace.registerTextDocumentContentProvider(
      NORMALIZED_VIEW_SCHEME,
      normalizedViewProvider
    ),
    normalizedViewProvider,
    vscode.commands.registerCommand(
      "totonoeLog.showNormalizedView",
      createShowNormalizedViewCommand(normalizedViewProvider)
    ),
    vscode.commands.registerCommand(
      "totonoeLog.showNormalizedViewFilteredBySeverity",
      createShowNormalizedViewFilteredBySeverityCommand(normalizedViewProvider)
    ),
    vscode.commands.registerCommand(
      "totonoeLog.showNormalizedViewFilteredByDateRange",
      createShowNormalizedViewFilteredByDateRangeCommand(normalizedViewProvider)
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      COMPARE_VIEW_SCHEME,
      compareViewProvider
    ),
    compareViewProvider,
    vscode.commands.registerCommand(
      "totonoeLog.compareLogs",
      createCompareLogsCommand(compareViewProvider)
    )
  );
}

export function deactivate(): void {}
