import * as vscode from "vscode";
import { maskLogTextForCopy, type MaskForCopyOptions } from "./normalize";
import { guardAgainstVirtualDocumentSource } from "./virtualDocumentContentProvider";
import { parseLogWithConfiguredFormats } from "./timestampFormatSettings";

/** マスク対象のON/OFFを読み込むVSCode設定のセクション名。 */
const CONFIG_SECTION = "totonoeLog.copyMasked";

/**
 * `totonoeLog.copyMasked.*` 設定を読む。Interactive View のマスクトグル
 * （issue #194）とも共有し、設定を増やさずマスクの対象を揃える。
 */
export function readMaskOptions(): MaskForCopyOptions {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    maskTimestamp: config.get<boolean>("maskTimestamp", true),
    maskHost: config.get<boolean>("maskHost", true),
    // 後から足した対象なので既定はOFF（issue #195）。既定でONにすると、
    // 設定を触っていないユーザーのコピー結果が黙って変わってしまう。
    maskProcessId: config.get<boolean>("maskProcessId", false),
  };
}

/**
 * アクティブなエディタの選択範囲（未選択時は全体）を対象に、タイムスタンプ・
 * ホスト名/IPアドレスをマスクしたテキストをクリップボードへコピーする
 * コマンドの本体。外部のdiffツールに貼り付けやすくするための機能で、元の
 * 生テキストのフォーマットは保ったまま該当箇所だけを置き換える
 * （{@link maskLogTextForCopy} 参照）。
 */
export async function copyMaskedLogText(): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showWarningMessage(
      "Totonoe Log: コピーするログファイルが開かれていません。"
    );
    return;
  }

  const document = activeEditor.document;
  if (guardAgainstVirtualDocumentSource(document)) {
    return;
  }

  const selection = activeEditor.selection;
  const sourceText = selection.isEmpty ? document.getText() : document.getText(selection);

  const entries = parseLogWithConfiguredFormats(sourceText);
  const maskedText = maskLogTextForCopy(entries, readMaskOptions());
  await vscode.env.clipboard.writeText(maskedText);

  vscode.window.showInformationMessage(
    "Totonoe Log: マスク済みテキストをクリップボードにコピーしました。"
  );
}
