import * as vscode from "vscode";
import { formatMaskedLogForCompare } from "./normalize";
import {
  VirtualDocumentContentProvider,
  COMPARE_VIEW_SCHEME,
} from "./virtualDocumentContentProvider";
import { parseLogWithConfiguredFormats } from "./timestampFormatSettings";

// スキーム定義は virtualDocumentContentProvider.ts に集約している
// （既存の import 元を変えずに済むよう、ここから再エクスポートする）。
export { COMPARE_VIEW_SCHEME };

/** 比較ビュー用の {@link vscode.TextDocumentContentProvider}。 */
export class CompareViewContentProvider extends VirtualDocumentContentProvider {
  constructor() {
    super(COMPARE_VIEW_SCHEME);
  }
}

let compareViewCounter = 0;

/** ファイル選択ダイアログでログファイルを1つ選ばせる。キャンセル時は undefined を返す。 */
async function promptForLogFile(dialogTitle: string): Promise<vscode.Uri | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    openLabel: vscode.l10n.t("Select"),
    title: dialogTitle,
  });
  return selection?.[0];
}

/**
 * 指定したログファイルを読み込んでマスク済みテキストへ整形し、比較ビューの
 * 仮想ドキュメントとして登録する。同じ元ファイル名同士を比較しても URI が
 * 衝突しないよう、呼び出し側が渡す `sideTag`（連番+left/right）を名前に含める。
 */
async function buildMaskedVirtualDocument(
  provider: CompareViewContentProvider,
  fileUri: vscode.Uri,
  sideTag: string
): Promise<vscode.Uri> {
  const sourceDocument = await vscode.workspace.openTextDocument(fileUri);
  const entries = parseLogWithConfiguredFormats(sourceDocument.getText());
  const content = formatMaskedLogForCompare(entries);

  const baseName = fileUri.path.split("/").pop() ?? "log";
  // 先頭のドット（`.env` などのドットファイル）は拡張子とみなさず、
  // 直前に別の文字がある最後の拡張子だけを除去する。
  const nameWithoutExtension = baseName.replace(/(?<=[^.])\.[^./]+$/, "");
  const uri = vscode.Uri.from({
    scheme: COMPARE_VIEW_SCHEME,
    path: `/${nameWithoutExtension}.compare-${sideTag}.log`,
  });

  provider.register(uri, content);
  return uri;
}

/**
 * 2つのログファイルを選ばせ、日付・ホスト情報などの可変部分をマスクした
 * テキスト同士をVSCode標準のdiffエディタで比較するコマンドの本体。
 */
export function createCompareLogsCommand(
  provider: CompareViewContentProvider
): () => Promise<void> {
  return async function compareLogs(): Promise<void> {
    const firstFileUri = await promptForLogFile(
      vscode.l10n.t("Select the first log file to compare")
    );
    if (!firstFileUri) {
      return;
    }

    const secondFileUri = await promptForLogFile(
      vscode.l10n.t("Select the second log file to compare")
    );
    if (!secondFileUri) {
      return;
    }

    compareViewCounter += 1;
    const leftUri = await buildMaskedVirtualDocument(
      provider,
      firstFileUri,
      `${compareViewCounter}-left`
    );
    const rightUri = await buildMaskedVirtualDocument(
      provider,
      secondFileUri,
      `${compareViewCounter}-right`
    );

    const leftName = leftUri.path.split("/").pop();
    const rightName = rightUri.path.split("/").pop();
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${leftName} ↔ ${rightName}`
    );
  };
}
