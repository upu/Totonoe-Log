import * as vscode from "vscode";

/**
 * URIごとにテキスト内容を保持する読み取り専用の仮想ドキュメントプロバイダ。
 * 正規化ビュー・比較ビューなど、スキームだけが異なる複数の機能が共有する
 * 基底実装。ドキュメントが閉じられたら保持内容を解放し、コマンドを繰り返し
 * 実行してもメモリが増え続けないようにする。
 */
export class VirtualDocumentContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly contentByUri = new Map<string, string>();
  private readonly closeListener: vscode.Disposable;

  constructor(private readonly scheme: string) {
    this.closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
      this.release(document.uri);
    });
  }

  register(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(uri.toString(), content);
  }

  /** 指定した URI の保持内容を破棄する。対象スキーム以外の URI は無視する。 */
  release(uri: vscode.Uri): void {
    if (uri.scheme === this.scheme) {
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
