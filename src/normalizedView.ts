import * as vscode from "vscode";
import {
  parseLog,
  formatNormalizedLog,
  getDistinctSeverities,
  filterEntriesBySeverity,
  UNRECOGNIZED_SEVERITY_KEY,
} from "./normalize";

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
let severityFilteredViewCounter = 0;

/**
 * 正規化ビュー系コマンドが共有する、仮想ドキュメントの発行・登録・表示処理。
 * 同じ元ファイルに対して繰り返しコマンドを実行しても、連番付きの新しい URI
 * を発行して既存タブと衝突しないようにする。
 */
async function openVirtualNormalizedDocument(
  provider: NormalizedViewContentProvider,
  sourceDocument: vscode.TextDocument,
  content: string,
  fileTag: string,
  counter: number
): Promise<void> {
  const sourceBaseName = sourceDocument.uri.path.split("/").pop() ?? "log";
  // 先頭のドット（`.env` などのドットファイル）は拡張子とみなさず、
  // 直前に別の文字がある最後の拡張子だけを除去する。
  const sourceNameWithoutExtension = sourceBaseName.replace(/(?<=[^.])\.[^./]+$/, "");
  const uri = vscode.Uri.from({
    scheme: NORMALIZED_VIEW_SCHEME,
    path: `/${sourceNameWithoutExtension}.${fileTag}-${counter}.log`,
  });

  provider.register(uri, content);

  const normalizedDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(normalizedDocument, { preview: false });
}

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

    normalizedViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "normalized",
      normalizedViewCounter
    );
  };
}

/** セベリティ選択ピッカーで、セベリティ未認識のエントリを表す選択肢のラベル。 */
const UNRECOGNIZED_SEVERITY_LABEL = "(no severity)";

/**
 * アクティブなエディタの内容を正規化し、ユーザーがチェックボックス的に選択した
 * セベリティのエントリだけを読み取り専用の仮想ドキュメントとして開くコマンド。
 */
export function createShowNormalizedViewFilteredBySeverityCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedViewFilteredBySeverity(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    const entries = parseLog(sourceDocument.getText());
    const distinctSeverities = getDistinctSeverities(entries);

    const items: vscode.QuickPickItem[] = distinctSeverities.map((severity) => ({
      label: severity === UNRECOGNIZED_SEVERITY_KEY ? UNRECOGNIZED_SEVERITY_LABEL : severity,
      picked: true,
    }));

    const selectedItems = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "表示するセベリティを選択してください",
    });

    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedItems === undefined) {
      return;
    }

    const selectedSeverities = new Set(
      selectedItems.map((item) =>
        item.label === UNRECOGNIZED_SEVERITY_LABEL ? UNRECOGNIZED_SEVERITY_KEY : item.label
      )
    );
    const filteredEntries = filterEntriesBySeverity(entries, selectedSeverities);
    const content = formatNormalizedLog(filteredEntries);

    severityFilteredViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "severity-filtered",
      severityFilteredViewCounter
    );
  };
}
