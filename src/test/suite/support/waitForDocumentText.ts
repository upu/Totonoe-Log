import * as vscode from "vscode";

/**
 * `Set Filter`（issue #248）は `TextDocumentContentProvider` の `onDidChange`
 * を発火して開いているタブの内容を差し替える。VSCode が内容を取り直すのは
 * コマンドの完了後なので、期待する本文になるまで待つ。
 *
 * 条件を満たさないままタイムアウトした場合も最後に読んだ本文を返す
 * ——待ち切れなかったことを「一致しなかった」として呼び出し側の
 * `assert` に判定させ、失敗時に実際の内容が見えるようにするため。
 */
export async function waitForDocumentText(
  document: vscode.TextDocument,
  matches: (text: string) => boolean,
  timeoutMs = 5000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = document.getText();
  while (!matches(text) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    text = document.getText();
  }
  return text;
}
