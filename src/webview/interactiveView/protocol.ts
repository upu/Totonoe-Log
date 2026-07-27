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
 * 表示行1行分の元ログ上の位置（`normalize` の `LineSource` と同じ形）。
 * {@link InteractiveDisplayItem} と同じ理由で再定義する。
 */
export interface LineSource {
  /** {@link ExtensionToWebviewMessage.sourceFilePaths} と同じ並びの、元ファイルのインデックス。 */
  readonly fileIndex: number;
  /** 元ファイルの物理行番号（1始まり）。 */
  readonly line: number;
}

/**
 * 折りたたみ表示1件分（`normalize` の `InteractiveDisplayItem` と同じ形）。
 * `normalize/buildInteractiveCollapsedLines.ts` からは `import type` でも
 * 型解決される（`collapseRepeatedEntries` → `maskForCompare` → `node:net` と
 * 依存が連なり、Node型を持たないWebview向け型チェック（`tsconfig.webview.json`）
 * が壊れるため、あえて再定義してこのファイルのNode非依存を保つ。
 */
export type InteractiveDisplayItem =
  | { readonly kind: "line"; readonly text: string; readonly lineSource?: LineSource }
  | {
      readonly kind: "group";
      readonly headerText: string;
      readonly lines: readonly string[];
      readonly lineSources?: readonly LineSource[];
    };

/**
 * マスクパネル（issue #194）のチェックボックスの状態。`normalize` の
 * `DisplayMaskOptions` と同じフィールド名にして、拡張機能本体側で整形
 * オプションへそのまま渡せるようにする（あちらは省略可、こちらはUIの状態
 * として常に真偽値が決まっているため必須）。
 */
export interface SerializedMaskCriteria {
  /**
   * マスクそのもののON/OFF（マスクボタンの押下状態）。既定はOFF——
   * Interactive View は時系列を追うためのビューであり、開いた時点で
   * タイムスタンプが伏せられていては用を成さないため。OFFの間も下の
   * 対象選択は保たれるので、ボタン1つでマスクを出し入れできる。
   */
  readonly enabled: boolean;
  readonly maskTimestamp: boolean;
  readonly maskHost: boolean;
  readonly maskProcessId: boolean;
  /**
   * 任意パターンの入力文字列（正規表現、issue #195）。空文字列は「パターン
   * なし」。社内固有の識別子など汎用ルールで拾えないものを伏せるための欄で、
   * 一致箇所は `<MASKED>` に置き換わる。
   *
   * 一致パターン・無視パターンと違い、この欄は設定に保存しない——伏せたい
   * 文字列はログやその時の共有相手によって変わるうえ、設定ファイルに残ると
   * それ自体が「隠したかった語」の記録になってしまうため。
   */
  readonly pattern: string;
}

/** Webview側フォームの状態をJSON化した表現。 */
export interface SerializedFilterCriteria {
  /** チェック済みのセベリティ（`normalize` の `UNRECOGNIZED_SEVERITY_KEY` を含みうる）。 */
  readonly severities: readonly string[];
  /** 日付範囲の開始境界の入力文字列。空文字列は「下限なし」。 */
  readonly dateRangeStart: string;
  /** 日付範囲の終了境界の入力文字列。空文字列は「上限なし」。 */
  readonly dateRangeEnd: string;
  /**
   * 一致パターンの入力文字列（正規表現）。空文字列は「パターンなし」。
   * 指定するとマッチしたエントリ**だけ**が残る、無視パターンの逆の絞り込み
   * （issue #182）。Webview では Ctrl+F が使えないため、ハイライト型の検索では
   * なく「一致行のみ表示する」フィルタとして提供する。
   */
  readonly matchPattern: string;
  /** 無視パターンの入力文字列（正規表現）。空文字列は「パターンなし」。 */
  readonly ignorePattern: string;
  /**
   * 繰り返しエントリの折りたたみを有効にするか（issue #172）。絞り込み条件
   * ではなく表示方法の切り替えのため `FilterCriteria` には変換しないが、
   * Webviewフォームの状態としては他の入力と同じく丸ごと送り返す。
   */
  readonly collapseEnabled: boolean;
  /**
   * マスクパネルの状態（issue #194）。`collapseEnabled` と同じく絞り込み条件では
   * なく表示方法の切り替えだが、Webviewフォームの状態としてまとめて送り返す。
   */
  readonly mask: SerializedMaskCriteria;
  /**
   * 読み込み済みファイルの表示ON/OFF（issue #170）。
   * {@link ExtensionToWebviewMessage.loadedFileNames} と同じ並びで、`false` の
   * ファイル由来の行だけが表示から外れる。セベリティ等と同じ絞り込みの一軸
   * （組み合わせて効く）だが、対象がエントリの中身ではなくファイルなので
   * `FilterCriteria` ではなく整形時のファイル選択として扱う。
   *
   * ファイルの追加・取り消しでこの並びは変わるため、拡張機能本体側は受け取った
   * 配列を必ず現在のファイル数へ整えてから使う（`normalizeFileVisibility`）。
   */
  readonly visibleFiles: readonly boolean[];
}

/** Webview → 拡張機能本体 のメッセージ。 */
export type WebviewToExtensionMessage =
  | { readonly type: "ready" }
  | { readonly type: "filterChanged"; readonly criteria: SerializedFilterCriteria }
  | { readonly type: "addFiles" }
  /** 読み込み済みファイル1件を取り消す要求（issue #170）。`fileIndex` は `loadedFileNames` の位置。 */
  | { readonly type: "removeFile"; readonly fileIndex: number }
  | { readonly type: "exportVirtualDocument" }
  /** 行のダブルクリックで、対応する元ログファイルの行を開く要求（issue #179、#191）。 */
  | { readonly type: "revealSourceLine"; readonly lineSource: LineSource };

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
  /**
   * `LineSource.fileIndex` の並びに対応する、元ログファイルのフルパス
   * （issue #179）。Webview側は行のホバー表示（`title` 属性）にだけ使い、
   * ジャンプ先の解決は `fileIndex` を送り返して拡張機能本体側に任せる。
   */
  readonly sourceFilePaths: readonly string[];
  /**
   * `text` の各行（0始まり）に対応する元ログ上の位置（issue #179）。
   * ギャップマーカー等の生成行は `undefined`（ジャンプ対象外・ホバーなし）。
   * `items` を描画する場合は各 `InteractiveDisplayItem` 側が持つ。
   */
  readonly lineSources?: readonly (LineSource | undefined)[];
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
