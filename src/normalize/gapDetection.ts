/**
 * ギャップ区切り行のガター欄に表示するラベル。特定の行番号に対応しないことを表す。
 * {@link formatNormalizedLog}・{@link formatMergedLog} が共有する（issue #102）。
 */
export const GAP_MARKER_LABEL = "...";

/** 時間ギャップ検出しきい値の既定値（秒）。この秒数以上間が空いたら区切り行を挿入する。 */
export const DEFAULT_GAP_THRESHOLD_SECONDS = 30;

/**
 * 隣り合う2エントリのタイムスタンプ差がしきい値以上のとき、区切り行に表示する
 * ギャップの長さ（ミリ秒）を返す。しきい値が未指定・0以下の場合、または
 * どちらか一方のタイムスタンプが未認識の場合は `undefined`（区切り行を挿入
 * しない）。{@link formatNormalizedLog} が元々持っていた判定ロジックを、
 * {@link formatMergedLog} からも同じ挙動で呼び出せるよう切り出したもの
 * （issue #102）。
 */
export function computeGapMs(
  previousTimestampMs: number | undefined,
  currentTimestampMs: number | undefined,
  gapThresholdMs: number | undefined
): number | undefined {
  if (gapThresholdMs === undefined || gapThresholdMs <= 0) {
    return undefined;
  }
  if (previousTimestampMs === undefined || currentTimestampMs === undefined) {
    return undefined;
  }

  const gapMs = currentTimestampMs - previousTimestampMs;
  return gapMs >= gapThresholdMs ? gapMs : undefined;
}

/**
 * ギャップの長さ（ミリ秒）を `XXs gap` の区切り行テキストへ変換する。
 * 秒数は小数第1位までに丸め、整数秒であれば小数点以下を表示しない。
 *
 * 表示言語に追従させず英語で固定する（issue #279）。整形結果は仮想ドキュメント
 * の本文として選択・コピーされ、チケットや issue に貼られるうえ、Compare Logs
 * の比較対象にもなる。ここが環境の表示言語で変わると、同じログから作った出力が
 * 人によって違う文字列になり、貼り付け先での再現性と差分比較が壊れる。
 */
export function formatGapMarkerText(gapMs: number): string {
  const rounded = Math.round(gapMs / 100) / 10;
  const secondsText = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${secondsText}s gap`;
}
