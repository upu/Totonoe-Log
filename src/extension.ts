import * as vscode from "vscode";
import {
  NORMALIZED_VIEW_SCHEME,
  NormalizedViewContentProvider,
  createShowNormalizedViewCommand,
} from "./normalizedView";
import {
  COMPARE_VIEW_SCHEME,
  CompareViewContentProvider,
  createCompareLogsCommand,
} from "./compareView";
import { copyMaskedLogText } from "./copyMasked";
import { createGoToSourceLineCommand } from "./goToSourceLine";
import {
  MERGED_VIEW_SCHEME,
  MergedViewContentProvider,
  createMergeSelectedFilesCommand,
  createMergedViewFilenameHoverProvider,
} from "./mergedView";
import {
  InteractiveViewPanelController,
  createShowInteractiveViewCommand,
} from "./interactiveView";
import { createSetViewFilterCommand } from "./setViewFilter";

export function activate(context: vscode.ExtensionContext): void {
  const normalizedViewProvider = new NormalizedViewContentProvider();
  const compareViewProvider = new CompareViewContentProvider();
  const mergedViewProvider = new MergedViewContentProvider(context.globalStorageUri);
  const interactiveViewController = new InteractiveViewPanelController(
    context.extensionUri,
    normalizedViewProvider,
    mergedViewProvider
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      MERGED_VIEW_SCHEME,
      mergedViewProvider
    ),
    mergedViewProvider,
    vscode.commands.registerCommand(
      "totonoeLog.mergeSelectedFiles",
      createMergeSelectedFilesCommand(mergedViewProvider)
    ),
    vscode.languages.registerHoverProvider(
      { scheme: MERGED_VIEW_SCHEME },
      createMergedViewFilenameHoverProvider(mergedViewProvider)
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
    // 絞り込みは「開き方」ではなく、開いたビューに対する表示状態として設定する
    // （issue #248）。対象になるのは行対応情報と同じく、絞り込み材料を登録して
    // いる正規化ビューとマージビューの2スキーム。
    vscode.commands.registerCommand(
      "totonoeLog.setViewFilter",
      createSetViewFilterCommand(
        new Map([
          [NORMALIZED_VIEW_SCHEME, normalizedViewProvider],
          [MERGED_VIEW_SCHEME, mergedViewProvider],
        ])
      )
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
    vscode.commands.registerCommand("totonoeLog.copyMaskedText", copyMaskedLogText),
    // 行対応情報を登録するのは正規化ビュー（絞り込み・折りたたみ含む）と
    // マージビューの2プロバイダのみ。比較ビューは diff 表示専用のため対象外。
    vscode.commands.registerCommand(
      "totonoeLog.goToSourceLine",
      createGoToSourceLineCommand([normalizedViewProvider, mergedViewProvider])
    ),
    interactiveViewController,
    vscode.commands.registerCommand(
      "totonoeLog.showInteractiveView",
      createShowInteractiveViewCommand(interactiveViewController)
    ),
    // Interactive View の行の右クリックメニュー専用（issue #191）。メニューから
    // 渡される `data-vscode-context` の内容を引数に受け取る。
    vscode.commands.registerCommand(
      "totonoeLog.goToSourceLineFromInteractiveView",
      (context: unknown) => interactiveViewController.revealSourceLineFromContext(context)
    )
  );
}

export function deactivate(): void {}
