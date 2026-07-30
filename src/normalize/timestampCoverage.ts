import type { LogEntry } from "./types";
import type { MergedEntry } from "./mergeLogFiles";

/**
 * タイムスタンプ認識率の警告（issue #101）を出す最低行数（空行を除く）。
 * 数行だけの断片的なテキストでは、形式が未対応でも「大量の行が1つの巨大な
 * エントリに吸収されて調査しづらい」という問題自体が起きにくいため、
 * 警告を出さずノイズを避ける。
 */
export const LOW_RECOGNITION_MIN_LINE_COUNT = 10;

/**
 * 未認識行の割合がこの値以上なら警告する。未認識行は「最初に認識できた
 * タイムスタンプより前に現れた行」に限られる（下記
 * {@link assessTimestampRecognition} 参照）ため、正常なログではヘッダ等の
 * 前置きの数行程度にしかならない。50% は正常なログとの間に十分な余裕を
 * 持たせた値（issue #101 の設計メモの例に従う）。
 */
export const LOW_RECOGNITION_RATIO_THRESHOLD = 0.5;

/**
 * 認識済みエントリへ吸収された、日付・時刻らしい継続行を形式切替の兆候と
 * みなす最低行数。少数の日時入りメッセージでは通知せず、巨大な1エントリに
 * なる規模の連続した未対応形式だけを拾う。
 */
const SUSPICIOUS_CONTINUATION_MIN_LINE_COUNT = 10;

/**
 * 行頭にインデントを許さないことで、スタックトレースや整形済みの複数行
 * メッセージを候補から外す。区切り文字や年月日の順序は決め打ちしすぎず、
 * 未対応形式へ切り替わった可能性を診断するための軽量な判定に留める。
 */
const TIMESTAMP_LIKE_CONTINUATION_REGEX =
  /^(?:\[|\()?(?:(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})[T ]|\d{4}年\d{1,2}月\d{1,2}日\s+)\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s|$)/;

/** {@link assessTimestampRecognition} が返す、タイムスタンプ認識率の評価結果。 */
export interface TimestampRecognitionAssessment {
  /** 空行を除いた全行数。 */
  readonly totalLineCount: number;
  /** タイムスタンプ未認識と判定した行数（空行を除く）。 */
  readonly unrecognizedLineCount: number;
  /** 日付・時刻らしい継続行が連続した最長区間の行数。 */
  readonly suspiciousContinuationLineCount: number;
  /** `unrecognizedLineCount / totalLineCount`。全行が空行の場合は 0。 */
  readonly unrecognizedRatio: number;
  /** 未対応形式への切替が疑われる継続行が十分に多い場合は true。 */
  readonly hasSuspiciousTimestampSwitch: boolean;
  /** 認識率が低く、ユーザーへ警告すべきなら true。 */
  readonly shouldWarn: boolean;
}

/**
 * パース結果からタイムスタンプ認識率を評価する（issue #101）。
 *
 * 「未認識行」として数えるのは `matched: false` のエントリ（最初に認識できた
 * タイムスタンプより前に現れた行、または1行も認識できなかった場合の全行）に
 * 属する行だけに限定する。認識済みエントリの継続行（スタックトレース等）は
 * 正常な複数行エントリの一部であって形式未対応の兆候ではないため、未認識行に
 * 含めない（継続行の多いログでの誤検知を避ける）。ただし、インデントなしで
 * 日付・時刻らしい行頭を持つ継続行が多数ある場合は、途中で未対応形式へ切り
 * 替わった兆候として別集計する。空行は形式未対応の証拠にならないため、
 * 分母・分子のどちらからも除外する。
 */
export function assessTimestampRecognition(
  entries: readonly LogEntry[]
): TimestampRecognitionAssessment {
  let totalLineCount = 0;
  let unrecognizedLineCount = 0;
  let suspiciousContinuationLineCount = 0;
  let currentSuspiciousContinuationLineCount = 0;

  for (const entry of entries) {
    for (let lineIndex = 0; lineIndex < entry.lines.length; lineIndex++) {
      const line = entry.lines[lineIndex];
      if (line.trim().length === 0) {
        continue;
      }
      totalLineCount += 1;
      if (!entry.matched) {
        unrecognizedLineCount += 1;
        currentSuspiciousContinuationLineCount = 0;
      } else if (lineIndex > 0 && TIMESTAMP_LIKE_CONTINUATION_REGEX.test(line)) {
        currentSuspiciousContinuationLineCount += 1;
        suspiciousContinuationLineCount = Math.max(
          suspiciousContinuationLineCount,
          currentSuspiciousContinuationLineCount
        );
      } else {
        currentSuspiciousContinuationLineCount = 0;
      }
    }
  }

  const unrecognizedRatio = totalLineCount === 0 ? 0 : unrecognizedLineCount / totalLineCount;
  const hasLowRecognition =
    totalLineCount >= LOW_RECOGNITION_MIN_LINE_COUNT &&
    unrecognizedRatio >= LOW_RECOGNITION_RATIO_THRESHOLD;
  const hasSuspiciousTimestampSwitch =
    suspiciousContinuationLineCount >= SUSPICIOUS_CONTINUATION_MIN_LINE_COUNT;
  const shouldWarn = hasLowRecognition || hasSuspiciousTimestampSwitch;

  return {
    totalLineCount,
    unrecognizedLineCount,
    suspiciousContinuationLineCount,
    unrecognizedRatio,
    hasSuspiciousTimestampSwitch,
    shouldWarn,
  };
}

/**
 * マージ済みエントリを由来ファイルごとに割り振り直し、ファイル単位で
 * {@link assessTimestampRecognition} を行う（issue #186）。マージ結果は
 * ファイル横断で時系列に並び替えられているため、そのまま評価すると
 * 「どのファイルの形式が未対応なのか」を言えない。
 *
 * 割り振りに `fileName` ではなく `fileIndex` を使うのは、別フォルダの同名
 * ファイルを1つにまとめないため（issue #137）。戻り値は
 * {@link mergeLogFiles} へ渡した入力配列と同じ並びで、1行も寄与しなかった
 * ファイルには空のエントリ列の評価（＝警告なし）が入る。
 *
 * 並べ替えで元ファイル内の順序が変わっていても結果は変わらない——未認識行の
 * 数はエントリ単位で決まり、形式切替の兆候（連続する日時らしい継続行）も
 * 1エントリの中で完結して数えるため。
 */
export function assessTimestampRecognitionByFile(
  mergedEntries: readonly MergedEntry[],
  fileCount: number
): TimestampRecognitionAssessment[] {
  const entriesByFileIndex: LogEntry[][] = Array.from({ length: fileCount }, () => []);
  for (const merged of mergedEntries) {
    entriesByFileIndex[merged.fileIndex]?.push(merged.entry);
  }
  return entriesByFileIndex.map((entries) => assessTimestampRecognition(entries));
}
