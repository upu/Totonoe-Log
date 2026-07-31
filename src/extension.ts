import * as vscode from "vscode";
import { NORMALIZED_VIEW_SCHEME, NormalizedViewContentProvider } from "./normalizedView";
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
  createMergedViewFilenameHoverProvider,
} from "./mergedView";
import {
  InteractiveViewPanelController,
  createShowInteractiveViewCommand,
} from "./interactiveView";
import { createSetViewFilterCommand } from "./setViewFilter";
import { createOpenVirtualDocumentCommand } from "./openVirtualDocument";

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
    vscode.languages.registerHoverProvider(
      { scheme: MERGED_VIEW_SCHEME },
      createMergedViewFilenameHoverProvider(mergedViewProvider)
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      NORMALIZED_VIEW_SCHEME,
      normalizedViewProvider
    ),
    normalizedViewProvider,
    // 対象が1ファイルか複数かでコマンドを分けない（issue #249）。入力の解決は
    // Show Interactive View と同じで、出力先が仮想ドキュメントになるだけ。
    vscode.commands.registerCommand(
      "totonoeLog.openVirtualDocument",
      createOpenVirtualDocumentCommand(normalizedViewProvider, mergedViewProvider)
    ),
    // 絞り込みは「開き方」ではなく、開いたビューに対する表示状態として設定する
    // （issue #248）。実際に絞り込めるのは絞り込み材料を登録している正規化
    // ビューとマージビューだけだが、比較ビューも Totonoe Log のビューとして
    // 渡す——渡さないと「絞り込むビューがありません」と案内してしまい、
    // ビューはあるが絞り込みに対応していない事実と食い違うため。
    vscode.commands.registerCommand(
      "totonoeLog.setViewFilter",
      createSetViewFilterCommand(
        new Map([
          [NORMALIZED_VIEW_SCHEME, normalizedViewProvider],
          [MERGED_VIEW_SCHEME, mergedViewProvider],
          [COMPARE_VIEW_SCHEME, compareViewProvider],
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
