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
}

/** Webview → 拡張機能本体 のメッセージ。 */
export type WebviewToExtensionMessage =
  | { readonly type: "ready" }
  | { readonly type: "filterChanged"; readonly criteria: SerializedFilterCriteria };

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
  /** 無視パターンのタイムアウト・構文エラー等、絞り込み条件の一部を無視した場合の警告文。 */
  readonly warning?: string;
}
