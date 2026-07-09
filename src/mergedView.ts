import * as vscode from "vscode";
import { mergeLogFiles, formatMergedLog, type LogFileInput } from "./normalize";
import { VirtualDocumentContentProvider } from "./virtualDocumentContentProvider";

/** マージビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const MERGED_VIEW_SCHEME = "totonoe-log-merged";

/** マージビュー用の {@link vscode.TextDocumentContentProvider}。 */
export class MergedViewContentProvider extends VirtualDocumentContentProvider {
  constructor() {
    super(MERGED_VIEW_SCHEME);
  }
}

let mergedViewCounter = 0;

/** 選択されたファイル群を読み込み、{@link mergeLogFiles} に渡す入力へ変換する。 */
async function readLogFiles(fileUris: readonly vscode.Uri[]): Promise<LogFileInput[]> {
  return Promise.all(
    fileUris.map(async (fileUri) => {
      const document = await vscode.workspace.openTextDocument(fileUri);
      const fileName = fileUri.path.split("/").pop() ?? "log";
      return { fileName, text: document.getText() };
    })
  );
}

/**
 * ファイル選択ダイアログで、マージ対象のログファイルを複数選ばせ、時系列
 * 順にマージした読み取り専用の仮想ドキュメントとして開くコマンドの本体。
 * ファイルごとの日時フォーマットが違っても、正規化エンジンが共通の
 * タイムスタンプに変換するため正しく時系列に並ぶ。
 */
export function createShowMergedViewCommand(
  provider: MergedViewContentProvider
): () => Promise<void> {
  return async function showMergedView(): Promise<void> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: "選択",
      title: "マージするログファイルを選択してください（複数選択可）",
    });
    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const files = await readLogFiles(fileUris);
    const mergedEntries = mergeLogFiles(files);
    const content = formatMergedLog(mergedEntries);

    mergedViewCounter += 1;
    const uri = vscode.Uri.from({
      scheme: MERGED_VIEW_SCHEME,
      path: `/merged-${mergedViewCounter}.log`,
    });

    provider.register(uri, content);

    const mergedDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(mergedDocument, { preview: false });
  };
}
