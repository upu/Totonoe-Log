import * as vscode from "vscode";
import {
  openNormalizedViewForDocument,
  openNormalizedViewForFile,
  type NormalizedViewContentProvider,
} from "./normalizedView";
import { openMergedView, type MergedViewContentProvider } from "./mergedView";
import { getSourceDocumentOrWarn } from "./logSourceDocument";
import { resolveExplorerSelectionUris } from "./logFileReading";

/**
 * 選んだログを読み取り専用の仮想ドキュメントとして開くコマンド（issue #249）。
 *
 * 以前は入力が1ファイルか複数ファイルかで `Show Normalized View` と
 * `Merge Selected Files` に分かれていた。ユーザーから見れば「いま見ている
 * ログを Totonoe Log のビューで開く」という同じ操作なのに、対象の数で
 * コマンド名も起動導線も変わり、1ファイルを選んで `Merge Selected Files` を
 * 実行すると「2つ以上選べ」と怒られていた。
 *
 * 入力の解決は `Show Interactive View`（`createShowInteractiveViewCommand`）と
 * 同じ規則に揃える——エクスプローラの選択があればそれを、無ければアクティブ
 * エディタを対象にし、2ファイル以上ならマージ表示へ切り替える。違いは出力先
 * （Webview か仮想ドキュメントか）だけになる。
 *
 * 経路によって読み取り元が変わる点も Interactive View と同じ: エクスプローラ
 * 経由はディスクから読み、コマンドパレット経由はエディタの内容（未保存の変更を
 * 含む）を読む。
 */
export function createOpenVirtualDocumentCommand(
  normalizedProvider: NormalizedViewContentProvider,
  mergedProvider: MergedViewContentProvider
): (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => Promise<void> {
  return async function openVirtualDocument(
    clickedUri?: vscode.Uri,
    selectedUris?: vscode.Uri[]
  ): Promise<void> {
    const fromExplorer = clickedUri !== undefined || (selectedUris?.length ?? 0) > 0;
    const explorerUris = await resolveExplorerSelectionUris(clickedUri, selectedUris);

    if (explorerUris.length >= 2) {
      await openMergedView(mergedProvider, explorerUris);
      return;
    }
    if (explorerUris.length === 1) {
      await openNormalizedViewForFile(normalizedProvider, explorerUris[0]);
      return;
    }

    if (fromExplorer) {
      // 選択はあったがフォルダしか含まれていなかった。ここでアクティブ
      // エディタへ落とすと、選んだつもりの対象と関係ないログが開いてしまう。
      vscode.window.showWarningMessage(
        "Totonoe Log: 選択にログファイルが含まれていません。フォルダではなくファイルを選んでください。"
      );
      return;
    }

    const sourceDocument = getSourceDocumentOrWarn("開く");
    if (!sourceDocument) {
      return;
    }
    await openNormalizedViewForDocument(normalizedProvider, sourceDocument);
  };
}
