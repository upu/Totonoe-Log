import type { LogEntry } from "./types";

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

/** {@link assessTimestampRecognition} が返す、タイムスタンプ認識率の評価結果。 */
export interface TimestampRecognitionAssessment {
  /** 空行を除いた全行数。 */
  readonly totalLineCount: number;
  /** タイムスタンプ未認識と判定した行数（空行を除く）。 */
  readonly unrecognizedLineCount: number;
  /** `unrecognizedLineCount / totalLineCount`。全行が空行の場合は 0。 */
  readonly unrecognizedRatio: number;
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
 * 含めない（継続行の多いログでの誤検知を避ける）。空行は形式未対応の証拠に
 * ならないため、分母・分子のどちらからも除外する。
 */
export function assessTimestampRecognition(
  entries: readonly LogEntry[]
): TimestampRecognitionAssessment {
  let totalLineCount = 0;
  let unrecognizedLineCount = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.trim().length === 0) {
        continue;
      }
      totalLineCount += 1;
      if (!entry.matched) {
        unrecognizedLineCount += 1;
      }
    }
  }

  const unrecognizedRatio = totalLineCount === 0 ? 0 : unrecognizedLineCount / totalLineCount;
  const shouldWarn =
    totalLineCount >= LOW_RECOGNITION_MIN_LINE_COUNT &&
    unrecognizedRatio >= LOW_RECOGNITION_RATIO_THRESHOLD;

  return { totalLineCount, unrecognizedLineCount, unrecognizedRatio, shouldWarn };
}
