/**
 * 既に読み込み済みのURI文字列（`vscode.Uri#toString()`）集合から、候補
 * URI文字列のうち未読み込みのものだけを、初出順・重複なしで返す。
 *
 * Interactive View (Alpha) の「+ Add Files...」（issue #168）で、ダイアログで
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
