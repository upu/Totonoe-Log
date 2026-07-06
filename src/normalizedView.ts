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
 * ドキュメントが閉じられたら `contentByUri` から削除し、コマンドを繰り返し
 * 実行してもメモリが増え続けないようにする。
 */
export class NormalizedViewContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contentByUri = new Map<string, string>();
  private readonly closeListener: vscode.Disposable;

  constructor() {
    this.closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
      this.release(document.uri);
    });
  }

  register(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(uri.toString(), content);
  }

  /** 指定した URI の保持内容を破棄する。対象スキーム以外の URI は無視する。 */
  release(uri: vscode.Uri): void {
    if (uri.scheme === NORMALIZED_VIEW_SCHEME) {
      this.contentByUri.delete(uri.toString());
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? "";
  }

  dispose(): void {
    this.closeListener.dispose();
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
    const sourceNameWithoutExtension = sourceBaseName.replace(/\.[^./]+$/, "");
    normalizedViewCounter += 1;
    const uri = vscode.Uri.from({
      scheme: NORMALIZED_VIEW_SCHEME,
      path: `/${sourceNameWithoutExtension}.normalized-${normalizedViewCounter}.log`,
    });

    provider.register(uri, content);

    const normalizedDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(normalizedDocument, { preview: false });
  };
}
