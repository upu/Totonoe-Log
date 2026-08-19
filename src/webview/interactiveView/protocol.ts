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
      /**
       * グループに含まれる由来ファイルの {@link LineSource.fileIndex}
       * （重複を除いた出現順、issue #158）。見出しの列には代表1件しか出せない
       * ため、Webview 側が `sourceFilePaths` で解決してホバーに出す。別フォルダの
       * 同名ファイルを見分けられるよう、名前ではなくインデックスで受け取る。
       */
      readonly headerFileIndices?: readonly number[];
    };

/**
 * ハイライトの色名（`normalize` の `HighlightColor` と同じ）。{@link LineSource}
 * と同じ理由で再定義する。実際の色は Webview 側のCSS（`.highlight-<色名>`）が持つ。
 */
export type HighlightColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

/**
 * ハイライトルール編集パネル（issue #238）の1行。`totonoeLog.highlightRules`
 * 設定の1項目に対応するが、こちらは**編集中の状態**なので、設定として不正な値
 * （空のパターン・正規表現として壊れたパターン）も取りうる。
 *
 * 設定側で省略できる `name` と `color` も、フォームの状態としては常に値が
 * 決まっているため必須にする（`SerializedMaskCriteria` が設定より厳しい形に
 * なっているのと同じ理由）。
 */
export interface HighlightRuleRow {
  readonly name: string;
  readonly pattern: string;
  readonly color: HighlightColor;
}

/** 1行の中でハイライトする範囲（行内のUTF-16オフセット。`end` は含まない）。 */
export interface LineHighlight {
  readonly start: number;
  readonly end: number;
  readonly color: HighlightColor;
}

/**
 * ハイライト範囲を「行のテキスト → その行の範囲」の組で運ぶ（issue #18）。
 * `Map` はJSON化できないため、そのまま `new Map(...)` に渡せる組の配列で送る。
 *
 * 行番号ではなくテキストで引ける形にしているのは、ハイライトが行の内容だけで
 * 決まるため——プレーンテキストの1行・折りたたみの見出し・展開後の各行という
 * 3つの描画経路が、どれも同じ対応表を引くだけで済む。
 */
export type LineHighlights = readonly (readonly [string, readonly LineHighlight[]])[];

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
   * 値を伏せたいキー名の入力文字列（カンマまたは空白区切り、issue #212）。
   * 空文字列は「キー指定なし」。`user=hoge` の `hoge` だけを伏せる用途で、
   * 正規表現を書かずに済む入口として下の {@link pattern} と併用できる。
   */
  readonly keys: string;
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

/**
 * 一致パターン / 無視パターンの入力欄1行分（issue #206）。同じ欄に何行でも
 * 足せて、行ごとにON/OFFできる。
 *
 * 複数のパターンを `(?:p1)|(?:p2)` のような交替正規表現へ連結せず1件ずつ運ぶのは、
 * どのパターンが不正なのかの帰属が連結で失われるため（#182 でエラー文言に欄名を
 * 入れたばかりで後退になる）。破局的バックトラッキングのリスクが合成で増え、
 * タイムアウトの原因特定が難しくなるのも避けたい。
 */
export interface SerializedFilterPattern {
  /** 入力文字列（正規表現）。空文字列は「まだ入力していない行」で、条件からは外れる。 */
  readonly source: string;
  /**
   * この行を条件に含めるか。OFFの行は条件から外れるが、フォームからは消えない
   * ——調査中に一時的に外して戻す用途があるため、削除（✕）とは別の操作にする。
   */
  readonly enabled: boolean;
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
   * 一致パターンの入力欄（issue #182、#206）。有効な行が1つでもあると、その
   * どれかにマッチしたエントリ**だけ**が残る、無視パターンの逆の絞り込み。
   * Webview では Ctrl+F が使えないため、ハイライト型の検索ではなく
   * 「一致行のみ表示する」フィルタとして提供する。
   *
   * 同じ欄の中は OR、欄同士は AND（＝一致パターンのどれかに当たり、かつ無視
   * パターンのどれにも当たらないエントリが残る）。
   */
  readonly matchPatterns: readonly SerializedFilterPattern[];
  /** 無視パターンの入力欄（issue #206）。有効な行のどれかにマッチしたエントリを除外する。 */
  readonly ignorePatterns: readonly SerializedFilterPattern[];
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

/**
 * カスタムタイムスタンプ形式編集パネル（issue #316）の1行。ハイライトルール行
 * （{@link HighlightRuleRow}）と同じく、設定として不正な値（空パターン等）も
 * 編集中の状態として取りうる。
 */
export interface TimestampFormatRow {
  readonly name: string;
  readonly pattern: string;
}

/**
 * {@link TimestampFormatRow} に、保存時の検証結果を添えたもの。issue #316 の
 * 「保存時に compileCustomTimestampFormats と同じ検証をその場でフィードバック
 * する」の実体で、拡張機能本体側が `previewTimestampFormat`（issue #320）を
 * 通してから毎回の `state` で送る。
 */
export interface TimestampFormatRowPreview extends TimestampFormatRow {
  /** `compileCustomTimestampFormats` と同じエラーコードから組み立てた文言。無ければ有効。 */
  readonly errorMessage?: string;
  /** {@link ExtensionToWebviewMessage.unrecognizedSampleLines} のうち、このパターンで認識できた件数。 */
  readonly matchedSampleCount: number;
  /** 評価対象にしたサンプル件数（`unrecognizedSampleLines.length` と同じ）。 */
  readonly totalSampleCount: number;
}

/**
 * ログ本文で選んだ範囲からパターンを推論する要求（issue #316、#320）。
 * `line` は選択元の1行分の生テキスト、`selectionStart`/`selectionEnd` はその
 * 中の文字インデックス。
 */
export interface TimestampPatternInferenceRequest {
  readonly line: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  /** 日/月の並びが曖昧なときの解決方法。省略時は年の位置から既定を決める。 */
  readonly dayMonthOrder?: "dmy" | "mdy";
}

/**
 * パターン推論の結果。失敗理由（`inferTimestampPattern` の
 * `TimestampPatternInferenceFailureReason`）は拡張機能本体側で翻訳済みの
 * 文言にしてから送る——Webview側は理由コードの一覧を持たない。
 */
export type TimestampPatternInferenceResponse =
  | {
      readonly ok: true;
      readonly pattern: string;
      readonly suggestedName: string;
      /** true のとき、Webview側は日/月の並びを選び直すボタンを出す。 */
      readonly ambiguousDayMonthOrder: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** カスタムタイムスタンプ形式が実際に保存されているスコープ（issue #316）。 */
export type TimestampFormatsScope = "workspace" | "user";

/** Webview → 拡張機能本体 のメッセージ。 */
export type WebviewToExtensionMessage =
  | { readonly type: "ready" }
  | { readonly type: "filterChanged"; readonly criteria: SerializedFilterCriteria }
  | { readonly type: "addFiles" }
  /** 読み込み済みファイル1件を取り消す要求（issue #170）。`fileIndex` は `loadedFileNames` の位置。 */
  | { readonly type: "removeFile"; readonly fileIndex: number }
  /**
   * 現在の表示状態を仮想ドキュメントへ書き出す要求（issue #175）。押した時点の
   * フォーム内容を `criteria` に同送する（issue #217）——テキスト欄の
   * `filterChanged` は300msデバウンスされるため、入力直後に押された場合、
   * 拡張機能本体が最後に受け取っている条件では直前の入力が欠けている。
   * 特にマスク欄でそれが起きると、伏せたつもりの情報が書き出しに残る。
   */
  | {
      readonly type: "exportVirtualDocument";
      readonly criteria: SerializedFilterCriteria;
    }
  /** 行のダブルクリックで、対応する元ログファイルの行を開く要求（issue #179、#191）。 */
  | { readonly type: "revealSourceLine"; readonly lineSource: LineSource }
  /**
   * ハイライトルール編集パネル（issue #238）の内容を設定へ書き戻す要求。
   * 絞り込みと違い、こちらの状態の置き場は Webview ではなく
   * `totonoeLog.highlightRules` 設定そのもの——書き戻した結果は設定変更として
   * 戻ってきて（#183）、表示に反映される。
   */
  | { readonly type: "highlightRulesChanged"; readonly rules: readonly HighlightRuleRow[] }
  /**
   * カスタムタイムスタンプ形式編集パネル（issue #316）の内容を設定へ書き戻す
   * 要求。ハイライトルールと同じく、状態の置き場は Webview ではなく
   * `totonoeLog.timestampFormats` 設定そのもの——書き戻した結果は設定変更として
   * 戻ってきて（#183）、パネルと実際のパース結果の両方に反映される。
   */
  | { readonly type: "timestampFormatsChanged"; readonly rows: readonly TimestampFormatRow[] }
  /** ログ本文で選んだ範囲からパターンを推論する要求（issue #316、#320）。 */
  | { readonly type: "timestampPatternRequested"; readonly request: TimestampPatternInferenceRequest };

/** Webview側で動的に作る要素へ使う、翻訳済みのUI文言。 */
export interface InteractiveViewLabels {
  readonly unrecognizedSeverity: string;
  readonly patternToggleTitle: string;
  readonly patternEnabledAriaLabel: string;
  readonly regularExpressionPlaceholder: string;
  readonly patternAriaLabel: string;
  readonly removePatternTitle: string;
  readonly removePatternAriaLabel: string;
  readonly maskEnabledLabel: string;
  readonly maskDisabledLabel: string;
  readonly highlightExpandedLabel: string;
  readonly highlightCollapsedLabel: string;
  readonly highlightColorAriaLabel: string;
  readonly highlightColorRed: string;
  readonly highlightColorOrange: string;
  readonly highlightColorYellow: string;
  readonly highlightColorGreen: string;
  readonly highlightColorBlue: string;
  readonly highlightColorPurple: string;
  readonly moveRuleUpTitle: string;
  readonly moveRuleDownTitle: string;
  readonly moveRuleUpAriaLabel: string;
  readonly moveRuleDownAriaLabel: string;
  readonly removeRuleTitle: string;
  readonly removeRuleAriaLabel: string;
  readonly ruleNamePlaceholder: string;
  readonly ruleNameAriaLabel: string;
  readonly highlightPatternAriaLabel: string;
  readonly hideFileWithPathTitle: string;
  readonly hideFileTitle: string;
  readonly cannotRemoveLastFileLabel: string;
  readonly removeFileLabel: string;
  readonly sourceFilesTitle: string;
  readonly displayLimitMessage: string;
  readonly statusMessage: string;
  readonly timestampFormatNameAriaLabel: string;
  readonly timestampFormatPatternAriaLabel: string;
  readonly removeTimestampFormatTitle: string;
  readonly removeTimestampFormatAriaLabel: string;
  readonly suggestFromSelectionLabel: string;
  readonly noSelectionMessage: string;
  readonly addProposalLabel: string;
  readonly ambiguousDayMonthOrderHint: string;
  readonly dayMonthOrderDmyLabel: string;
  readonly dayMonthOrderMdyLabel: string;
  readonly matchSummaryMessage: string;
  readonly savedToWorkspaceLabel: string;
  readonly savedToUserLabel: string;
  readonly unrecognizedLinesEmptyMessage: string;
}

/**
 * 拡張機能本体 → Webview のメッセージ。`criteria` は絞り込み条件の解析結果
 * （不正な入力は無視した後の状態）をエコーバックし、Webview側のフォームを
 * 常に拡張機能側の実際の適用状態と一致させる。
 *
 * `state` 以外の型を持つのはパターン推論の結果（issue #316）だけ——設定への
 * 保存を経ないため、他の状態と違って `state` の再送信に乗せる理由がない。
 */
export type ExtensionToWebviewMessage =
  | InteractiveViewStateMessage
  | {
      readonly type: "timestampPatternResult";
      readonly response: TimestampPatternInferenceResponse;
    };

export interface InteractiveViewStateMessage {
  readonly type: "state";
  readonly labels: InteractiveViewLabels;
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
  /**
   * パネル内の警告行に出す文。無視パターンのタイムアウト・構文エラー等で
   * 絞り込み条件の一部を無視した場合のほか、読み込み済みファイルのタイム
   * スタンプ認識率が低い場合（issue #186）もここに載せる。複数あるときは
   * 拡張機能本体側で1つの文字列に連結してから送る。
   */
  readonly warning?: string;
  /**
   * ハイライトルール（issue #18）に一致した箇所。ルールが未設定、または評価が
   * 失敗したときは省略し、Webview側は色を付けずに描画する（本文の表示自体は
   * ハイライトの成否に依らず成立させる）。
   */
  readonly highlights?: LineHighlights;
  /**
   * ハイライトルール編集パネル（issue #238）に表示する行。`totonoeLog.highlightRules`
   * 設定そのものを写したもので、絞り込み条件と違い Webview 側では保持しない
   * ——設定が唯一の置き場なので、設定を直接編集した場合もこの経路で反映される。
   */
  readonly highlightRules: readonly HighlightRuleRow[];
  /** #158 以降は、単一ファイルとマージ表示のどちらも折りたたみに対応する。 */
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
  /**
   * カスタムタイムスタンプ形式編集パネル（issue #316）に表示する行。
   * `totonoeLog.timestampFormats` 設定そのものを写したもの
   * （{@link ExtensionToWebviewMessage.highlightRules} と同じ関係）。
   */
  readonly timestampFormatRows: readonly TimestampFormatRowPreview[];
  /**
   * 上の設定が実際に定義されているスコープ。`readConfiguredTimestampFormats`
   * がリソース無しで読む都合上、書き戻し先はワークスペース/ユーザーの2段しか
   * 無い（{@link resolveTimestampFormatsTarget} 参照）。パネルにこれを出すのは、
   * 「保存したのに次に開いたら効かない」を起こさないため——マルチルートで
   * 別フォルダの設定に定義があるといった食い違いをその場で気づけるようにする。
   */
  readonly timestampFormatsScope: TimestampFormatsScope;
  /**
   * タイムスタンプを認識できなかった行のサンプル（issue #316、上限あり）。
   * パネルの「未認識行から選ぶ」導線の元データで、`timestampFormatRows` の
   * 検証プレビューが対象にするサンプルとも一致する。
   */
  readonly unrecognizedSampleLines: readonly string[];
}
