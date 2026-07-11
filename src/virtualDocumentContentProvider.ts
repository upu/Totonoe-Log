import * as vscode from "vscode";

/** 正規化ビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const NORMALIZED_VIEW_SCHEME = "totonoe-log-normalized";
/** マージビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const MERGED_VIEW_SCHEME = "totonoe-log-merged";
/** 比較ビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const COMPARE_VIEW_SCHEME = "totonoe-log-compare";

/**
 * Totonoe Log 自身が発行する仮想ドキュメントのスキーム一覧。
 * 各コマンドの冒頭で共通ガードとして使うため、判定ロジックをここに集約する
 * （個々のコマンド実装がスキーム文字列を重複して知る必要をなくす）。
 */
const TOTONOE_LOG_VIEW_SCHEMES: ReadonlySet<string> = new Set([
  NORMALIZED_VIEW_SCHEME,
  MERGED_VIEW_SCHEME,
  COMPARE_VIEW_SCHEME,
]);

/**
 * 指定したドキュメントが、Totonoe Log 自身が発行した仮想ドキュメント
 *（正規化・マージ・比較ビュー。折りたたみビューも正規化ビューと同じ
 * スキームを使う）かどうかを判定する。
 */
export function isTotonoeLogVirtualDocument(document: vscode.TextDocument): boolean {
  return TOTONOE_LOG_VIEW_SCHEMES.has(document.uri.scheme);
}

/**
 * 対象のドキュメントが Totonoe Log 自身の仮想ドキュメントである場合、警告を
 * 表示して呼び出し側に処理を中断させる共通ガード。正規化・フィルタ系・
 * コピー系の各コマンドは、アクティブエディタ取得直後にこれを呼び出す。
 *
 * 仮想ドキュメントは行番号ガター（`"1 | "`）やマージビューの列
 *（`"app.log | app | "`）が行頭に付いた独自フォーマットのテキストであり、
 * `parseLog` はタイムスタンプ形式を行頭アンカーで判定するためどの行にも
 * マッチせず、全エントリが無言で未認識扱いになってしまう（issue #57）。
 * それを静かに返す代わりに、ここで検出して警告を出す。
 *
 * @returns 処理を中断すべきなら `true`（呼び出し側は早期リターンする）。
 */
export function guardAgainstVirtualDocumentSource(
  sourceDocument: vscode.TextDocument
): boolean {
  if (!isTotonoeLogVirtualDocument(sourceDocument)) {
    return false;
  }

  vscode.window.showWarningMessage(
    "Totonoe Log: このビューに対しては実行できません。元のログファイルに対して実行してください。"
  );
  return true;
}

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
