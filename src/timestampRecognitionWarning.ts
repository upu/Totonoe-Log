import * as vscode from "vscode";
import {
  assessTimestampRecognition,
  type LogEntry,
  type TimestampRecognitionAssessment,
} from "./normalize";

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

  const fileName = sourceUri.path.split("/").pop() ?? sourceUri.toString();
  const warning = buildWarningText(fileName, assessTimestampRecognition(entries));
  if (warning === undefined) {
    return;
  }

  warnedSourceKeys.add(sourceKey);
  vscode.window.showWarningMessage(`Totonoe Log: ${warning}`);
}

/**
 * 認識率が低いファイルの警告文を、読み込み済みファイルの一覧に対してまとめて
 * 作る（issue #186）。Interactive View がパネル内の警告行に出すための入口で、
 * `fileNames` と `assessments` は同じ並び（`fileIndex` の順）で受け取る。
 *
 * モーダル通知（{@link warnIfLowTimestampRecognition}）と違い、同じファイルを
 * 何度渡しても抑制しない——パネル内の警告行は再描画のたびに作り直される
 * 表示状態であり、読み込まれている限り出続けるのが正しい。抑制すると
 * 「絞り込みを触ったら警告だけ消えた」という見え方になってしまう。
 */
export function buildLowTimestampRecognitionWarnings(
  fileNames: readonly string[],
  assessments: readonly TimestampRecognitionAssessment[]
): string[] {
  return assessments
    .map((assessment, index) => buildWarningText(fileNames[index], assessment))
    .filter((warning): warning is string => warning !== undefined);
}

/**
 * 警告すべき場合の本文を作る（警告不要なら `undefined`）。モーダル通知と
 * パネル内の警告行で文言を共有するため、通知固有の接頭辞（`Totonoe Log: `）は
 * 付けずに返す。どちらの経路でも、原因を直せる設定
 * （`totonoeLog.timestampFormats`、issue #100）への導線を含める。
 */
function buildWarningText(
  fileName: string,
  assessment: TimestampRecognitionAssessment
): string | undefined {
  if (!assessment.shouldWarn) {
    return undefined;
  }
  if (assessment.hasSuspiciousTimestampSwitch) {
    return `${fileName} の${assessment.suspiciousContinuationLineCount}行が、未対応のタイムスタンプ形式で始まっている可能性があります。設定「totonoeLog.timestampFormats」でカスタム形式を追加すると認識できます。`;
  }

  const percent = Math.round(assessment.unrecognizedRatio * 100);
  return `${fileName} の行の約${percent}%でタイムスタンプ形式を認識できませんでした。組み込み形式に合わないログは、設定「totonoeLog.timestampFormats」でカスタム形式を追加すると認識できます。`;
}
