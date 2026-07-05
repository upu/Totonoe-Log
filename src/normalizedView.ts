import * as vscode from "vscode";
import { parseLog, formatNormalizedLog } from "./normalize";

/** 正規化ビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const NORMALIZED_VIEW_SCHEME = "totonoe-log-normalized";

/**
 * 正規化ビュー用の {@link vscode.TextDocumentContentProvider}。
 *
 * 仮想ドキュメントの内容は開いた瞬間のスナップショットとして URI ごとに
 * 保持する。同じ元ファイルに対して再度コマンドを実行した場合も、新しい
 * URI（連番付き）を発行して既存のタブと衝突しないようにする。
 */
export class NormalizedViewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contentByUri = new Map<string, string>();

  register(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(uri.toString(), content);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? "";
  }
}

let normalizedViewCounter = 0;

/**
 * アクティブなエディタの内容を正規化し、読み取り専用の仮想ドキュメントとして
 * 開くコマンドの本体。VSCode 標準の検索・コピー・diff エディタがそのまま
 * 使える仮想ドキュメント方式（`TextDocumentContentProvider`）を採用する。
 */
export function createShowNormalizedViewCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedView(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 正規化するログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    const entries = parseLog(sourceDocument.getText());
    const content = formatNormalizedLog(entries);

    const sourceBaseName = sourceDocument.uri.path.split("/").pop() ?? "log";
    normalizedViewCounter += 1;
    const uri = vscode.Uri.from({
      scheme: NORMALIZED_VIEW_SCHEME,
      path: `/${sourceBaseName}.normalized-${normalizedViewCounter}.log`,
    });

    provider.register(uri, content);

    const normalizedDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(normalizedDocument, { preview: false });
  };
}
