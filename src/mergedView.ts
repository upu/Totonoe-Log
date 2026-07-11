import * as vscode from "vscode";
import { mergeLogFiles, formatMergedLog, type LogFileInput } from "./normalize";
import {
  VirtualDocumentContentProvider,
  MERGED_VIEW_SCHEME,
} from "./virtualDocumentContentProvider";

// スキーム定義は virtualDocumentContentProvider.ts に集約している
// （既存の import 元を変えずに済むよう、ここから再エクスポートする）。
export { MERGED_VIEW_SCHEME };

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
 * 指定されたファイル群を時系列順にマージし、読み取り専用の仮想ドキュメントとして
 * 開く。ファイル選択ダイアログ経由・エクスプローラのコンテキストメニュー経由の
 * どちらのコマンドからも共通で使う本体処理。ファイルごとの日時フォーマットが
 * 違っても、正規化エンジンが共通のタイムスタンプに変換するため正しく時系列に並ぶ。
 */
async function openMergedView(
  provider: MergedViewContentProvider,
  fileUris: readonly vscode.Uri[]
): Promise<void> {
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
}

/**
 * ファイル選択ダイアログで、マージ対象のログファイルを複数選ばせ、時系列
 * 順にマージした読み取り専用の仮想ドキュメントとして開くコマンドの本体。
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

    await openMergedView(provider, fileUris);
  };
}

/** フォルダを除いたファイルの URI だけを残す。 */
async function filterOutFolders(uris: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (const uri of uris) {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) === 0) {
      files.push(uri);
    }
  }
  return files;
}

/**
 * エクスプローラで複数選択したログファイルを、ファイル選択ダイアログを
 * 経由せずに直接マージするコマンドの本体。VSCode はエクスプローラの
 * コンテキストメニューコマンドに `(クリックされた項目, 選択項目全体の配列)`
 * を渡すため、`selectedUris` を優先して使い、単一クリック時のフォールバックと
 * して `clickedUri` を使う。選択範囲にフォルダが混ざっていても無視して続行する。
 */
export function createMergeSelectedFilesCommand(
  provider: MergedViewContentProvider
): (clickedUri: vscode.Uri, selectedUris?: vscode.Uri[]) => Promise<void> {
  return async function mergeSelectedFiles(
    clickedUri: vscode.Uri,
    selectedUris?: vscode.Uri[]
  ): Promise<void> {
    const candidateUris =
      selectedUris && selectedUris.length > 0 ? selectedUris : clickedUri ? [clickedUri] : [];
    const fileUris = await filterOutFolders(candidateUris);

    if (fileUris.length < 2) {
      await vscode.window.showWarningMessage(
        "マージするには2つ以上のログファイルを選択してください。"
      );
      return;
    }

    await openMergedView(provider, fileUris);
  };
}
