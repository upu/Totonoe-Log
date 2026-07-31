/**
 * 折りたたみグループの見出し行の末尾に付ける、繰り返し回数と終了時刻
 * （issue #99、#174）。
 *
 * 終了時刻は以前、開始時刻の直後に `開始 〜 終了` の形で置いていた。しかし
 * それだと見出し行だけタイムスタンプが2つ並び、セベリティとメッセージの桁が
 * 通常行と揃わない——折りたたみを入れた時点で「一番読みづらい行」になって
 * いた（#174 の発端）。通常行と同じ位置には開始時刻だけを置き、終了時刻は
 * 回数と一緒に末尾へ回す。
 *
 * 開始と同じ日付なら終了時刻は時刻部分だけにする。見出しを短く保っても
 * 「いつ終わったか」は失われないため。日をまたぐグループでは日付が無いと
 * 何日の時刻か分からなくなるので、そのときだけ全体を出す。
 *
 * `endText` が `startText` と同じになる場合（グループ内が同一タイムスタンプ、
 * またはマスクで両端とも `<TIMESTAMP>` になる場合）は、繰り返して表示しても
 * 情報が増えないので省く。
 */
export function formatGroupSuffix(
  count: number,
  startText: string | undefined,
  endText: string | undefined
): string {
  if (startText === undefined || endText === undefined || endText === startText) {
    return ` (×${count})`;
  }
  return ` (×${count}, 〜${shortenEndTimestamp(startText, endText)})`;
}

/** 開始と日付が同じなら、終了時刻から日付部分（`T` まで）を落とす。 */
function shortenEndTimestamp(startText: string, endText: string): string {
  const dateEnd = endText.indexOf("T");
  if (dateEnd === -1 || startText.slice(0, dateEnd) !== endText.slice(0, dateEnd)) {
    return endText;
  }
  return endText.slice(dateEnd + 1);
}
