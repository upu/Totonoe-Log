/**
 * 拡張機能本体とWebview間で交換するメッセージの型定義（issue #166）。
 *
 * 型のみのファイルで、DOM・Node・vscode いずれのAPIにも依存しない。拡張機能
 * 本体側（`src/interactiveView.ts`、node向けにesbuildされる）とWebview側
 * （`src/webview/interactiveView/main.ts`、browser向けにesbuildされる）の
 * 両方の型チェック対象・バンドル対象に含めても問題なく共有できる。
 *
 * 無視パターンの評価が `node:worker_threads` を使う都合で、絞り込み・整形は
 * 拡張機能本体側で行う（Webview側では実行できない）。そのため `RegExp` や
 * `Set` をそのまま送らず、JSON化できるプリミティブ・配列だけで表現する。
 */

/**
 * 折りたたみ表示1件分（`normalize` の `InteractiveDisplayItem` と同じ形）。
 * `normalize/buildInteractiveCollapsedLines.ts` からは `import type` でも
 * 型解決される（`collapseRepeatedEntries` → `maskForCompare` → `node:net` と
 * 依存が連なり、Node型を持たないWebview向け型チェック（`tsconfig.webview.json`）
 * が壊れるため、あえて再定義してこのファイルのNode非依存を保つ。
 */
export type InteractiveDisplayItem =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "group"; readonly headerText: string; readonly lines: readonly string[] };

/** Webview側フォームの状態をJSON化した表現。 */
export interface SerializedFilterCriteria {
  /** チェック済みのセベリティ（`normalize` の `UNRECOGNIZED_SEVERITY_KEY` を含みうる）。 */
  readonly severities: readonly string[];
  /** 日付範囲の開始境界の入力文字列。空文字列は「下限なし」。 */
  readonly dateRangeStart: string;
  /** 日付範囲の終了境界の入力文字列。空文字列は「上限なし」。 */
  readonly dateRangeEnd: string;
  /** 無視パターンの入力文字列（正規表現）。空文字列は「パターンなし」。 */
  readonly ignorePattern: string;
  /**
   * 繰り返しエントリの折りたたみを有効にするか（issue #172）。絞り込み条件
   * ではなく表示方法の切り替えのため `FilterCriteria` には変換しないが、
   * Webviewフォームの状態としては他の入力と同じく丸ごと送り返す。
   */
  readonly collapseEnabled: boolean;
}

/** Webview → 拡張機能本体 のメッセージ。 */
export type WebviewToExtensionMessage =
  | { readonly type: "ready" }
  | { readonly type: "filterChanged"; readonly criteria: SerializedFilterCriteria }
  | { readonly type: "addFiles" }
  | { readonly type: "exportVirtualDocument" };

/**
 * 拡張機能本体 → Webview のメッセージ。`criteria` は絞り込み条件の解析結果
 * （不正な入力は無視した後の状態）をエコーバックし、Webview側のフォームを
 * 常に拡張機能側の実際の適用状態と一致させる。
 */
export interface ExtensionToWebviewMessage {
  readonly type: "state";
  readonly criteria: SerializedFilterCriteria;
  readonly distinctSeverities: readonly string[];
  readonly text: string;
  readonly totalLineCount: number;
  readonly visibleLineCount: number;
  /** 現在読み込み済みのファイル名一覧（issue #168）。1件なら単一ファイル表示中。 */
  readonly loadedFileNames: readonly string[];
  /** 無視パターンのタイムアウト・構文エラー等、絞り込み条件の一部を無視した場合の警告文。 */
  readonly warning?: string;
  /**
   * 折りたたみトグルを表示できるか（issue #172）。単一ファイル表示中のみ
   * true。マージ表示（2ファイル以上）は #158 の設計課題が未解決のため
   * 対象外とし、false のときWebview側はトグルを無効化して `text` を描画する。
   */
  readonly collapsibleSupported: boolean;
  /**
   * 折りたたみ表示用の構造化データ。`collapsibleSupported && criteria.collapseEnabled`
   * のときだけ送る。Webview側はこれがあれば `items` を、無ければ `text` を
   * そのまま描画する。
   */
  readonly items?: readonly InteractiveDisplayItem[];
  /**
   * 表示行数の上限（issue #178）を超えたため `text` / `items` を先頭だけに
   * 切り詰めた場合の情報。上限内なら undefined。Webview側はこれがあるときに
   * 「全体は Export as Virtual Document で開ける」旨の案内を出す。
   */
  readonly displayLimit?: {
    /** 適用した上限（`totonoeLog.interactiveView.maxDisplayLines`）。 */
    readonly maxDisplayLines: number;
    /** 切り詰めた結果、実際に描画する行数。 */
    readonly displayedLineCount: number;
  };
}
