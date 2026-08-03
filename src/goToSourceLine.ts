import * as vscode from "vscode";
import {
  isTotonoeLogVirtualDocument,
  type SourceLineMap,
  type VirtualDocumentContentProvider,
} from "./virtualDocumentContentProvider";
import { revealSourceLine } from "./revealSourceLine";

/**
 * Totonoe Log の仮想ドキュメント上のカーソル行から、対応する元ログファイルの
 * 物理行へ移動するコマンドの本体（issue #137 の案1）。仮想ドキュメント
 * 登録時に各ビューが保持した「表示行 → 元URI・元行」の対応表
 * （{@link VirtualDocumentContentProvider.getSourceLineMap}）を現在行で引く
 * だけなので、正規化・絞り込み・折りたたみ・マージの全ビューで共通に動く。
 *
 * `providers` には行対応情報を登録するプロバイダ（正規化ビュー・マージ
 * ビュー）を渡す。URI 文字列をキーに引くため、自分のビュー以外の URI では
 * 単に `undefined` が返り、順に試すだけで正しいプロバイダに解決される。
 */
export function createGoToSourceLineCommand(
  providers: readonly VirtualDocumentContentProvider[]
): () => Promise<void> {
  return async function goToSourceLine(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !isTotonoeLogVirtualDocument(activeEditor.document)) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Totonoe Log: Run this command from a Totonoe Log view.")
      );
      return;
    }

    const viewUri = activeEditor.document.uri;
    let sourceLineMap: SourceLineMap | undefined;
    for (const provider of providers) {
      sourceLineMap = provider.getSourceLineMap(viewUri);
      if (sourceLineMap) {
        break;
      }
    }
    if (!sourceLineMap) {
      // 比較ビュー等の対象外ビュー、またはビュー内容の解放後（issue #92 と
      // 同じ状況）で対応情報が無い場合。
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Totonoe Log: This view has no source-line mapping. Run the command again to reopen the view."
        )
      );
      return;
    }

    const lineSource = sourceLineMap.lineSources[activeEditor.selection.active.line];
    if (!lineSource) {
      vscode.window.showInformationMessage(
        vscode.l10n.t(
          "Totonoe Log: This generated line, such as a gap marker, has no corresponding source-log line."
        )
      );
      return;
    }

    const sourceUri = sourceLineMap.sourceUris[lineSource.fileIndex];
    if (!sourceUri) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Totonoe Log: Could not resolve the source log file.")
      );
      return;
    }

    await revealSourceLine(sourceUri, lineSource.line);
  };
}
