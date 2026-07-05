import * as vscode from "vscode";
import {
  NORMALIZED_VIEW_SCHEME,
  NormalizedViewContentProvider,
  createShowNormalizedViewCommand,
} from "./normalizedView";

/**
 * Placeholder command for the Totonoe Log merged/normalized view.
 * The real implementation (log parsing, normalization, merging, filtering,
 * collapsing, and comparing) will be built up incrementally, one issue/PR
 * at a time. See the project README for the feature roadmap.
 */
async function showMergedView(): Promise<void> {
  vscode.window.showInformationMessage(
    "Totonoe Log: feature not implemented yet. Stay tuned!"
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const normalizedViewProvider = new NormalizedViewContentProvider();

  context.subscriptions.push(
    vscode.commands.registerCommand("totonoeLog.showMergedView", showMergedView),
    vscode.workspace.registerTextDocumentContentProvider(
      NORMALIZED_VIEW_SCHEME,
      normalizedViewProvider
    ),
    vscode.commands.registerCommand(
      "totonoeLog.showNormalizedView",
      createShowNormalizedViewCommand(normalizedViewProvider)
    )
  );
}

export function deactivate(): void {}
