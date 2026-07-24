import * as vscode from "vscode";
import { applyClockSkew, type LogEntry } from "./normalize";
import { guardAgainstVirtualDocumentSource } from "./virtualDocumentContentProvider";
import { parseLogWithConfiguredFormats } from "./timestampFormatSettings";
import { createSourceOffsetResolver } from "./timezoneSettings";
import { createClockSkewResolver } from "./clockSkewSettings";
import { warnIfLowTimestampRecognition } from "./timestampRecognitionWarning";

/**
 * アクティブなエディタ上のログファイルを取得する。エディタが無い場合、または
 * 対象が Totonoe Log 自身の仮想ドキュメントである場合（`guardAgainstVirtualDocumentSource`
 * が判定）は警告を表示し、呼び出し側に処理を中断させるため `undefined` を返す。
 * 正規化・フィルタ系・折りたたみ・アルファ版インタラクティブビューの全コマンドが
 * 冒頭で行う同一の手順を集約した。
 *
 * `actionLabel` は「正規化する」「絞り込む」「折りたたむ」等、警告文の
 * 「〜ログファイルが開かれていません。」に前置する動詞句。
 */
export function getSourceDocumentOrWarn(actionLabel: string): vscode.TextDocument | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showWarningMessage(
      `Totonoe Log: ${actionLabel}ログファイルが開かれていません。`
    );
    return undefined;
  }

  const sourceDocument = activeEditor.document;
  if (guardAgainstVirtualDocumentSource(sourceDocument)) {
    return undefined;
  }

  return sourceDocument;
}

/**
 * 元ドキュメントを設定反映済みのフォーマット一覧・ソースオフセット
 * （issue #13）でパースし、クロックスキュー補正（issue #15）と、タイム
 * スタンプ認識率が低い場合の警告通知（issue #101）まで済ませる。正規化
 * ビュー系の全コマンドがパース直後に同じ判定を必要とするため一箇所に
 * まとめる。
 */
export function parseSourceLog(sourceDocument: vscode.TextDocument): LogEntry[] {
  const fileName = sourceDocument.uri.path.split("/").pop() ?? "";
  const sourceUtcOffsetMinutes = createSourceOffsetResolver()(fileName);
  const parsedEntries = parseLogWithConfiguredFormats(
    sourceDocument.getText(),
    sourceUtcOffsetMinutes
  );
  const entries = applyClockSkew(parsedEntries, createClockSkewResolver()(fileName));
  warnIfLowTimestampRecognition(sourceDocument.uri, entries);
  return entries;
}
