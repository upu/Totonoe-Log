import * as vscode from "vscode";

/**
 * 元ログファイルの指定行をエディタで開いて見せる、ジャンプ処理の共通部分。
 * `Go to Source Line` コマンド（issue #137、仮想ドキュメント側）と
 * Interactive View の行クリック（issue #179、Webview側）は、行対応情報
 * （{@link LineSource}）の引き方だけが異なり、URIを開いて該当行を選択する
 * ところから先は同じ振る舞い（ファイルが開けない場合の警告、末尾行への
 * 丸め）にしたいため、ここに切り出して共有する。
 *
 * `line` は元ファイルの物理行番号（1始まり）。ビューを開いた後に元ファイルが
 * 短くなった場合に備えて末尾行へ丸め、Webviewから届いた値が範囲外でも
 * 例外にならないよう先頭行側にも丸める。
 */
export async function revealSourceLine(sourceUri: vscode.Uri, line: number): Promise<void> {
  let sourceDocument: vscode.TextDocument;
  try {
    sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
  } catch {
    // 削除・移動・リネームや権限エラーなど、原因を問わず開けなかった場合。
    vscode.window.showWarningMessage(
      "Totonoe Log: 元ログファイルを開けませんでした。ファイルが削除・移動されていないか確認してください。"
    );
    return;
  }

  const targetLine = Math.min(Math.max(line - 1, 0), sourceDocument.lineCount - 1);
  await vscode.window.showTextDocument(sourceDocument, {
    preview: false,
    selection: sourceDocument.lineAt(targetLine).range,
  });
}
