/**
 * 既に読み込み済みのURI文字列（`vscode.Uri#toString()`）集合から、候補
 * URI文字列のうち未読み込みのものだけを、初出順・重複なしで返す。
 *
 * Interactive View の「+ Add Files...」（issue #168）で、ダイアログで
 * 選び直した際に既存ファイルを再読み込みしないための重複排除。大文字小文字や
 * パス表記の正規化は行わず、文字列としての完全一致だけで判定する
 * （`vscode.Uri#toString()` は同一ファイルなら常に同じ文字列を返すため）。
 */
export function selectNewFileUris(
  existingUriStrings: readonly string[],
  candidateUriStrings: readonly string[]
): string[] {
  const seen = new Set(existingUriStrings);
  const newUriStrings: string[] = [];

  for (const candidate of candidateUriStrings) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      newUriStrings.push(candidate);
    }
  }

  return newUriStrings;
}

/**
 * Webviewから届いたファイル単位の表示ON/OFF（読み込み済みファイル一覧と同じ
 * 並びの真偽値配列、issue #170）を、拡張機能本体が持つ実際のファイル数に
 * 合わせて整える。足りない分は表示ONで埋め、余った分は捨てる。
 *
 * ファイルの追加・取り消しは拡張機能本体側で起きるため、その直前に送られた
 * 絞り込みメッセージが古い長さの配列を運んでくることがある。長さのずれを
 * ここで吸収しないと、追加したファイルが最初から非表示になったり、取り消し後に
 * 別のファイルの表示状態がずれたりする。埋める側を表示ONにするのは、初期状態が
 * 全ファイル表示であることと揃えるため。
 */
export function normalizeFileVisibility(
  visibleFiles: readonly boolean[],
  fileCount: number
): boolean[] {
  return Array.from({ length: fileCount }, (_, index) => visibleFiles[index] ?? true);
}

/**
 * 表示ONのファイルのインデックス集合を作る。`normalize` 側のファイル軸の
 * 絞り込み（`filterMergedEntriesByFileIndex`）へ渡す形。
 */
export function toVisibleFileIndices(visibleFiles: readonly boolean[]): Set<number> {
  const visibleFileIndices = new Set<number>();
  visibleFiles.forEach((visible, index) => {
    if (visible) {
      visibleFileIndices.add(index);
    }
  });
  return visibleFileIndices;
}

/**
 * ファイルを1件取り消したあとの表示ON/OFF配列を作る（issue #170）。以降の
 * インデックスが1つずつ前へ詰まるため、読み込み済みファイル一覧と同じ操作を
 * この配列にも施して並びを対応させ続ける。
 */
export function removeFileVisibilityAt(
  visibleFiles: readonly boolean[],
  index: number
): boolean[] {
  return visibleFiles.filter((_, currentIndex) => currentIndex !== index);
}
