import * as vscode from "vscode";
import { applyClockSkew, type LogEntry, type LogFileInput } from "./normalize";
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
  const entries = parseLogFileEntries(buildLogFileInputFromDocument(sourceDocument));
  warnIfLowTimestampRecognition(sourceDocument.uri, entries);
  return entries;
}

/**
 * 既に読み込み済みの {@link LogFileInput} を、{@link parseSourceLog} と同じ設定
 * （設定反映済みフォーマット・ソースオフセット・クロックスキュー補正）で
 * パースする（issue #181）。エクスプローラから選んだファイルはエディタで
 * 開かれていないため `TextDocument` を用意できず、ディスクから読んだ入力を
 * そのままパースする経路が必要になる。
 *
 * 認識率の警告（issue #101）はここでは出さない——Interactive View は
 * パネル内の警告行にまとめて出す（issue #186）ため、パース経路で通知まで
 * 済ませてしまうと同じ内容が二重に伝わる。
 */
export function parseLogFileEntries(input: LogFileInput): LogEntry[] {
  const parsedEntries = parseLogWithConfiguredFormats(input.text, input.sourceUtcOffsetMinutes);
  return applyClockSkew(parsedEntries, input.clockSkewMs ?? 0);
}

/**
 * 既に開いているドキュメントから {@link LogFileInput}（`mergeLogFiles` への
 * 入力形式）を組み立てる。`readLogFiles`（`logFileReading.ts`）はディスクから
 * 読み直す前提だが、こちらは既にエディタが内容をデコード済みのドキュメントを
 * 対象にするため `sourceDocument.getText()` をそのまま使い、二重読み込みを
 * 避ける。Interactive View（issue #168）が、単一ファイル表示から
 * 複数ファイルのマージ表示に切り替わる際、最初のファイルを追加ファイルと
 * 同じ形式で `mergeLogFiles` に渡すために使う。
 */
export function buildLogFileInputFromDocument(sourceDocument: vscode.TextDocument): LogFileInput {
  const fileName = sourceDocument.uri.path.split("/").pop() ?? "";
  return {
    fileName,
    text: sourceDocument.getText(),
    sourceUtcOffsetMinutes: createSourceOffsetResolver()(fileName),
    clockSkewMs: createClockSkewResolver()(fileName),
  };
}
