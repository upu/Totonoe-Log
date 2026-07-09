import * as vscode from "vscode";
import {
  NORMALIZED_VIEW_SCHEME,
  NormalizedViewContentProvider,
  createShowNormalizedViewCommand,
  createShowNormalizedViewFilteredBySeverityCommand,
  createShowNormalizedViewFilteredByDateRangeCommand,
  createShowNormalizedViewFilteredByDateRangeAndSeverityCommand,
  createShowCollapsedViewCommand,
} from "./normalizedView";
import {
  COMPARE_VIEW_SCHEME,
  CompareViewContentProvider,
  createCompareLogsCommand,
} from "./compareView";
import { copyMaskedLogText } from "./copyMasked";
import {
  MERGED_VIEW_SCHEME,
  MergedViewContentProvider,
  createShowMergedViewCommand,
} from "./mergedView";

export function activate(context: vscode.ExtensionContext): void {
  const normalizedViewProvider = new NormalizedViewContentProvider();
  const compareViewProvider = new CompareViewContentProvider();
  const mergedViewProvider = new MergedViewContentProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      MERGED_VIEW_SCHEME,
      mergedViewProvider
    ),
    mergedViewProvider,
    vscode.commands.registerCommand(
      "totonoeLog.showMergedView",
      createShowMergedViewCommand(mergedViewProvider)
    ),
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
    vscode.commands.registerCommand(
      "totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity",
      createShowNormalizedViewFilteredByDateRangeAndSeverityCommand(normalizedViewProvider)
    ),
    vscode.commands.registerCommand(
      "totonoeLog.showCollapsedView",
      createShowCollapsedViewCommand(normalizedViewProvider)
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      COMPARE_VIEW_SCHEME,
      compareViewProvider
    ),
    compareViewProvider,
    vscode.commands.registerCommand(
      "totonoeLog.compareLogs",
      createCompareLogsCommand(compareViewProvider)
    ),
    vscode.commands.registerCommand("totonoeLog.copyMaskedText", copyMaskedLogText)
  );
}

export function deactivate(): void {}
