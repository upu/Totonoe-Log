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
 * 認識率警告のアクションボタン（issue #321）から Interactive View を開く
 * 実装。`warnIfLowTimestampRecognition` の呼び出し元（正規化/マージビュー系の
 * 全コマンド）は、この時点では Interactive View の存在すら知らない薄い
 * ユーティリティなので、それらのシグネチャを変えて依存を持ち込む代わりに
 * `extension.ts` の `activate()` から1回だけ遅延登録する。
 */
export type TimestampFormatHelperOpener = (sourceUri: vscode.Uri) => void | Promise<void>;
let timestampFormatHelperOpener: TimestampFormatHelperOpener | undefined;

/** {@link timestampFormatHelperOpener} を登録する。テストでも直接呼べるよう公開する。 */
export function registerTimestampFormatHelperOpener(opener: TimestampFormatHelperOpener): void {
  timestampFormatHelperOpener = opener;
}

/**
 * タイムスタンプ認識率が低い場合に警告通知を表示する（issue #101）。
 * 「警告すべきか」の判定は純粋ロジック層の {@link assessTimestampRecognition}
 * に委ね、この層は頻度制御（同一ファイルにつきセッション中1回）と通知文言の
 * 組み立てだけを担う。カスタム形式設定（`totonoeLog.timestampFormats`、
 * issue #100）への導線を文言に含め、開き手が登録されていれば通知に
 * アクションボタンを添えて Interactive View のタイムスタンプ形式パネルへ
 * 直接飛べるようにする（issue #316、#321）。
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
  const message = vscode.l10n.t("Totonoe Log: {0}", warning);
  const opener = timestampFormatHelperOpener;
  if (!opener) {
    vscode.window.showWarningMessage(message);
    return;
  }

  const actionLabel = vscode.l10n.t("Open Timestamp Format Helper");
  void vscode.window.showWarningMessage(message, actionLabel).then((choice) => {
    if (choice === actionLabel) {
      return opener(sourceUri);
    }
    return undefined;
  });
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
    return vscode.l10n.t(
      "{0}: {1} lines may begin with an unsupported timestamp format. Add a custom format in the totonoeLog.timestampFormats setting to recognize them.",
      fileName,
      assessment.suspiciousContinuationLineCount
    );
  }

  const percent = Math.round(assessment.unrecognizedRatio * 100);
  return vscode.l10n.t(
    "{0}: Could not recognize the timestamp format in about {1}% of lines. For logs that do not match built-in formats, add a custom format in the totonoeLog.timestampFormats setting.",
    fileName,
    percent
  );
}
