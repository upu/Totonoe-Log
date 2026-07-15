import * as vscode from "vscode";
import { assessTimestampRecognition, type LogEntry } from "./normalize";

/**
 * セッション中に警告済みの元ファイルのキー（URI文字列）。同じファイルへ
 * コマンドを実行し直すたびに同じ警告が繰り返されると煩わしいため、
 * ウィンドウのセッション中は同一ファイルに対する警告を1回に抑える
 * （issue #101 の頻度制御）。
 */
const warnedSourceKeys = new Set<string>();

/**
 * タイムスタンプ認識率が低い場合に警告通知を表示する（issue #101）。
 * 「警告すべきか」の判定は純粋ロジック層の {@link assessTimestampRecognition}
 * に委ね、この層は頻度制御（同一ファイルにつきセッション中1回）と通知文言の
 * 組み立てだけを担う。カスタム形式設定（`totonoeLog.timestampFormats`、
 * issue #100）への導線を文言に含める。
 */
export function warnIfLowTimestampRecognition(
  sourceUri: vscode.Uri,
  entries: readonly LogEntry[]
): void {
  const sourceKey = sourceUri.toString();
  if (warnedSourceKeys.has(sourceKey)) {
    return;
  }

  const assessment = assessTimestampRecognition(entries);
  if (!assessment.shouldWarn) {
    return;
  }

  warnedSourceKeys.add(sourceKey);

  const fileName = sourceUri.path.split("/").pop() ?? sourceUri.toString();
  const percent = Math.round(assessment.unrecognizedRatio * 100);
  vscode.window.showWarningMessage(
    `Totonoe Log: ${fileName} の行の約${percent}%でタイムスタンプ形式を認識できませんでした。組み込み形式に合わないログは、設定「totonoeLog.timestampFormats」でカスタム形式を追加すると認識できます。`
  );
}
