/**
 * 仮想ドキュメントの表示行から元ログファイルの物理行へ戻るための対応情報
 * （issue #137）。各フォーマッタが本文と同時に組み立て、VSCode 層が
 * 仮想ドキュメント登録時に保持して `Go to Source Line` コマンドで解決する。
 */

/** 表示行1行分の、元ログファイル上の位置。 */
export interface LineSource {
  /**
   * 元ファイルを指す、入力ファイル配列上のインデックス。マージビューでは
   * 同名ファイルが異なるフォルダに存在しうるため、ファイル名ではなく
   * 入力順の位置で元ファイルを一意に識別する。単一ファイル由来のビュー
   * （正規化・絞り込み・折りたたみ）では常に 0。
   */
  readonly fileIndex: number;
  /** 元ファイルの物理行番号（1始まり）。 */
  readonly line: number;
}

/** フォーマッタが返す、表示テキストと行対応表のペア。 */
export interface FormattedLogWithLineSources {
  readonly text: string;
  /**
   * 表示行（0始まり）ごとの元位置。ギャップマーカーなど元ログに対応する
   * 行を持たない生成行は `undefined`。
   */
  readonly lineSources: readonly (LineSource | undefined)[];
}
