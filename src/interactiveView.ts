import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import {
  buildInteractivePayload,
  buildInteractiveMergedPayload,
  buildInteractiveExportText,
  buildInteractiveMergedExportText,
  getDistinctSeverities,
  limitInteractiveDisplay,
  mergeLogFiles,
  DEFAULT_COLLAPSE_THRESHOLD,
  type BuildInteractivePayloadOptions,
  type BuildInteractiveExportTextOptions,
  type FilterCriteria,
  type FormattedLogWithLineSources,
  type InteractivePayloadResult,
  type LineSource,
  type LogEntry,
  type LogFileInput,
  type MergedEntry,
} from "./normalize";
import {
  getSourceDocumentOrWarn,
  parseSourceLog,
  buildLogFileInputFromDocument,
} from "./logSourceDocument";
import { readLogFiles, filterOutFolders } from "./logFileReading";
import { selectNewFileUris } from "./interactiveViewFiles";
import { readDisplayTimezone } from "./timezoneSettings";
import { readGapThresholdMs } from "./gapThresholdSetting";
import { readMaxDisplayLines } from "./interactiveViewSettings";
import { readConfiguredTimestampFormats } from "./timestampFormatSettings";
import { toFilterCriteria } from "./interactiveViewCriteria";
import { revealSourceLine } from "./revealSourceLine";
import { NormalizedViewContentProvider, openVirtualNormalizedDocument } from "./normalizedView";
import { MergedViewContentProvider } from "./mergedView";
import type {
  ExtensionToWebviewMessage,
  SerializedFilterCriteria,
  WebviewToExtensionMessage,
} from "./webview/interactiveView/protocol";

/** Webviewパネルのビュー種別ID（`createWebviewPanel` 第1引数）。コマンドIDとは別の識別子。 */
const INTERACTIVE_VIEW_TYPE = "totonoeLog.interactiveViewAlpha";

/** Webview側スクリプトのバンドル出力（`scripts/esbuild.js` の第2エントリ）を探すための相対パス。 */
const WEBVIEW_SCRIPT_RELATIVE_PATH = ["out", "webview", "interactiveView", "main.js"];

/** 折りたたみのしきい値を読み込むVSCode設定のセクション名（`normalizedView.ts` の `Show Collapsed View` と共有）。 */
const COLLAPSE_CONFIG_SECTION = "totonoeLog.collapse";

/** チェック済みセベリティ・空の日付範囲・空の無視パターン・折りたたみONという初期状態を作る（issue #172、デフォルトON）。 */
function createDefaultSerializedCriteria(entries: readonly LogEntry[]): SerializedFilterCriteria {
  return {
    severities: getDistinctSeverities(entries),
    dateRangeStart: "",
    dateRangeEnd: "",
    ignorePattern: "",
    collapseEnabled: true,
  };
}

/** `totonoeLog.collapse.threshold` 設定を読む（`normalizedView.ts` の `Show Collapsed View` と同じ読み取り方）。 */
function readCollapseThreshold(): number {
  return vscode.workspace.getConfiguration(COLLAPSE_CONFIG_SECTION).get<number>("threshold", DEFAULT_COLLAPSE_THRESHOLD);
}

/**
 * インラインスクリプト/スタイルだけを許可するnonceを、Webviewの読み込みごとに
 * 発行する。固定値にすると別ドキュメントを開いた際に使い回されてしまうため、
 * `showOrReveal` でパネルを新規作成するたびに呼ぶ。
 */
function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

/** URIの最後のパス要素（ファイル名）を取り出す。取得できない場合は空文字列。 */
function baseName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() ?? "";
}

/**
 * Webviewベースのインタラクティブビュー（issue #166）のパネルを1つだけ保持し、
 * 生成・再表示・破棄とメッセージ配線を行う。
 *
 * 絞り込み・整形は `node:worker_threads` を使う無視パターン評価の都合上、
 * Webview（ブラウザコンテキスト）では実行できないため、このコントローラ
 * （拡張機能本体側、Node実行）が一手に引き受ける。Webview側は届いた結果を
 * 描画するだけの薄いレンダラーにとどめる。
 *
 * パネルはシングルトン。ファイルは「+ Add Files...」（issue #168）で追加
 * でき、1ファイルの間は正規化ビュー相当の表示、2ファイル以上になった時点で
 * マージビュー相当（ファイル名/種別列付き）の表示に切り替わる（デュアルパス）。
 * 別のログファイルに対してコマンドを再実行すると、既存パネルの表示内容が
 * そのファイル1つにリセットされる。
 */
export class InteractiveViewPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private sourceDocument: vscode.TextDocument | undefined;
  /** 2ファイル目以降に追加されたファイル。1ファイル目（`sourceDocument`）はここに含めない。 */
  private additionalFiles: LogFileInput[] = [];
  /** 重複読み込み防止用。先頭は `sourceDocument` のURI文字列。 */
  private loadedUriStrings: string[] = [];
  /** `additionalFiles.length === 0` の間だけ使う、単一ファイルパスのキャッシュ。 */
  private singleEntries: readonly LogEntry[] = [];
  /** `additionalFiles.length > 0` の間だけ使う、マージ済みエントリのキャッシュ。 */
  private mergedEntries: readonly MergedEntry[] = [];
  /** `loadedUriStrings` と同順の実URI一覧。書き出し（issue #175）でマージ表示の行対応情報を組み立てる際に使う。 */
  private loadedUris: vscode.Uri[] = [];
  private criteria: SerializedFilterCriteria = createDefaultSerializedCriteria([]);
  /** 「仮想ドキュメントとして書き出す」操作（issue #175）で発行するマージ用URIの連番。 */
  private exportMergedCounter = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly normalizedViewProvider: NormalizedViewContentProvider,
    private readonly mergedViewProvider: MergedViewContentProvider
  ) {}

  async showOrReveal(sourceDocument: vscode.TextDocument): Promise<void> {
    this.sourceDocument = sourceDocument;
    this.additionalFiles = [];
    this.loadedUriStrings = [sourceDocument.uri.toString()];
    this.loadedUris = [sourceDocument.uri];
    this.recomputeEntries();
    this.criteria = createDefaultSerializedCriteria(this.singleEntries);

    if (this.panel) {
      this.panel.title = this.buildTitle(sourceDocument);
      this.panel.reveal();
      await this.postState();
      return;
    }

    const nonce = generateNonce();
    const panel = vscode.window.createWebviewPanel(
      INTERACTIVE_VIEW_TYPE,
      this.buildTitle(sourceDocument),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "out", "webview", "interactiveView"),
        ],
      }
    );
    panel.webview.html = this.renderHtml(panel.webview, nonce);
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.handleMessage(message);
    });
    this.panel = panel;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private buildTitle(sourceDocument: vscode.TextDocument): string {
    return `Totonoe Log (Alpha): ${baseName(sourceDocument.uri)}`;
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (message.type === "ready") {
      await this.postState();
      return;
    }
    if (message.type === "addFiles") {
      await this.addFiles();
      return;
    }
    if (message.type === "exportVirtualDocument") {
      await this.exportVirtualDocument();
      return;
    }
    if (message.type === "revealSourceLine") {
      await this.revealClickedSourceLine(message.lineSource);
      return;
    }
    this.criteria = message.criteria;
    await this.postState();
  }

  /**
   * Webviewでクリックされた行から、対応する元ログファイルの行へジャンプする
   * （issue #179）。`fileIndex` は `loadedUris`（読み込み順）の位置なので、
   * ここでURIに解決してから `Go to Source Line` と共通のジャンプ処理へ渡す。
   */
  private async revealClickedSourceLine(lineSource: LineSource): Promise<void> {
    const sourceUri = this.loadedUris[lineSource.fileIndex];
    if (!sourceUri) {
      // 送信後にファイル集合が変わった場合など、`fileIndex` が現在の読み込み
      // 済みファイルに対応しないとき（`Go to Source Line` と同じ案内にする）。
      vscode.window.showWarningMessage(
        "Totonoe Log: 元ログファイルの情報を解決できませんでした。"
      );
      return;
    }
    await revealSourceLine(sourceUri, lineSource.line);
  }

  /**
   * ファイル選択ダイアログで1つ以上のログファイルを追加読み込みする。
   * 既に読み込み済みのファイル（`loadedUriStrings`）は `selectNewFileUris` で
   * 除外し、二重読み込みしない。フォルダ選択や、追加分が全て既読み込み
   * だった場合は無言で何もしない（キャンセル時と同じ扱い）。
   *
   * ダイアログは複数フォルダをまたいだ複数選択ができない制限がある
   * （issue #151 の教訓）が、これは「既に開いているセッションに追加する」
   * という操作の性質上ダイアログ方式を選んだ結果として許容する
   * （フォルダをまたぐ場合は複数回に分けて追加すればよい）。
   */
  private async addFiles(): Promise<void> {
    if (!this.sourceDocument) {
      return;
    }

    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      title: "Totonoe Log: 追加するログファイルを選択",
      openLabel: "追加",
    });
    if (!picked) {
      return;
    }

    const candidates = await filterOutFolders(picked);
    const newUriStrings = selectNewFileUris(
      this.loadedUriStrings,
      candidates.map((uri) => uri.toString())
    );
    if (newUriStrings.length === 0) {
      return;
    }

    const newUriStringSet = new Set(newUriStrings);
    const newUris = candidates.filter((uri) => newUriStringSet.has(uri.toString()));
    const newFiles = await readLogFiles(newUris);

    this.additionalFiles.push(...newFiles);
    this.loadedUriStrings.push(...newUriStrings);
    this.loadedUris.push(...newUris);
    this.recomputeEntries();
    await this.postState();
  }

  /**
   * ファイル集合（`sourceDocument` + `additionalFiles`）が変わった時だけ
   * 呼ぶ、パース/マージのやり直し。絞り込み条件が変わるだけの再描画
   * （`postState`）では呼ばない — `mergeLogFiles` は差分追加ができず毎回
   * 全件処理になるため、無駄な再マージを避ける。
   */
  private recomputeEntries(): void {
    if (!this.sourceDocument) {
      return;
    }

    if (this.additionalFiles.length === 0) {
      this.singleEntries = parseSourceLog(this.sourceDocument);
      this.mergedEntries = [];
      return;
    }

    const files: LogFileInput[] = [
      buildLogFileInputFromDocument(this.sourceDocument),
      ...this.additionalFiles,
    ];
    this.mergedEntries = mergeLogFiles(files, {
      timestampFormats: readConfiguredTimestampFormats(),
    });
    this.singleEntries = [];
  }

  /** 現在のファイル集合に応じて、単一ファイル用/マージ用いずれかの合成処理を呼ぶ。 */
  private async computePayload(
    criteria: FilterCriteria,
    options: BuildInteractivePayloadOptions
  ): Promise<InteractivePayloadResult> {
    if (this.additionalFiles.length === 0) {
      return buildInteractivePayload(this.singleEntries, criteria, options);
    }
    return buildInteractiveMergedPayload(this.mergedEntries, criteria, options);
  }

  private loadedFileNames(): string[] {
    if (!this.sourceDocument) {
      return [];
    }
    return [baseName(this.sourceDocument.uri), ...this.additionalFiles.map((file) => file.fileName)];
  }

  /**
   * 現在の `this.criteria` を実際に適用して結果を送り返す。無視パターンの
   * 評価がタイムアウト/エラーになった場合は、そのパターンだけを外して
   * 再計算し、警告文とともに送る（QuickPickの警告ダイアログで処理を
   * 中断する既存コマンドと異なり、Webviewはその場で再描画され続けるため
   * 必ず何らかの状態を返す）。
   */
  private async postState(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const displayTimezone = readDisplayTimezone();
    const { criteria, errors } = toFilterCriteria(this.criteria, displayTimezone);
    // マージ表示（2ファイル以上）は折りたたみ非対応（issue #172、#158の未解決課題を踏まえた判断）。
    const collapsibleSupported = this.additionalFiles.length === 0;
    const formatOptions: BuildInteractivePayloadOptions = {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
      collapseThreshold:
        collapsibleSupported && this.criteria.collapseEnabled ? readCollapseThreshold() : undefined,
    };

    const payload = await this.computePayload(criteria, formatOptions);

    if (payload.ok) {
      await this.sendState(payload, errors, collapsibleSupported);
      return;
    }

    const fallbackCriteria: FilterCriteria = { ...criteria, ignorePattern: undefined };
    const fallbackPayload = await this.computePayload(fallbackCriteria, formatOptions);
    if (fallbackPayload.ok) {
      const reason =
        payload.reason === "timeout"
          ? "入力されたパターンの処理に時間がかかりすぎたため、無視パターンを適用せずに表示しています。より単純なパターンをお試しください。"
          : "無視パターンの評価中にエラーが発生したため、無視パターンを適用せずに表示しています。";
      await this.sendState(fallbackPayload, [...errors, reason], collapsibleSupported);
    }
  }

  /**
   * `criteria` はユーザーがWebview上のフォームへ入力した生の文字列
   * （`this.criteria`）をそのままエコーバックする。無視パターンが不正で
   * 適用されなかった場合も、ユーザーが入力欄を修正できるよう入力内容を
   * 消さずに `warning` だけで通知する。
   */
  private async sendState(
    payload: Extract<InteractivePayloadResult, { ok: true }>,
    errors: readonly string[],
    collapsibleSupported: boolean
  ): Promise<void> {
    if (!this.panel) {
      return;
    }

    // 描画は上限行数までに縮退させる（issue #178）。Webviewは1メッセージで
    // 全文を受け取って一括描画するため、切り詰めはここ（送る直前）で行う。
    const maxDisplayLines = readMaxDisplayLines();
    const limited = limitInteractiveDisplay(
      { text: payload.text, lineSources: payload.lineSources, items: payload.items },
      maxDisplayLines
    );

    const message: ExtensionToWebviewMessage = {
      type: "state",
      criteria: this.criteria,
      distinctSeverities: payload.distinctSeverities,
      text: limited.text,
      totalLineCount: payload.totalLineCount,
      visibleLineCount: payload.visibleLineCount,
      loadedFileNames: this.loadedFileNames(),
      // ホバー表示用のフルパス（issue #179）。`fileIndex` はこの並びを指す。
      sourceFilePaths: this.loadedUris.map((uri) => uri.fsPath),
      lineSources: limited.lineSources,
      warning: errors.length > 0 ? errors.join(" / ") : undefined,
      collapsibleSupported,
      items: limited.items,
      displayLimit:
        limited.displayedLineCount !== undefined
          ? { maxDisplayLines, displayedLineCount: limited.displayedLineCount }
          : undefined,
    };
    await this.panel.webview.postMessage(message);
  }

  /**
   * 現在の絞り込み/マージ/折りたたみ状態を、既存の仮想ドキュメント方式
   * （正規化ビュー・マージビューと同じ `TextDocumentContentProvider`）で
   * 新規タブとして開く（issue #175）。検索・コピー・`Go to Source Line`・
   * `Compare Logs` は、書き出し後は仮想ドキュメント側の既存導線をそのまま
   * 使う想定で、Webview側には作り込まない。
   */
  private async exportVirtualDocument(): Promise<void> {
    if (!this.sourceDocument) {
      return;
    }

    const displayTimezone = readDisplayTimezone();
    const { criteria } = toFilterCriteria(this.criteria, displayTimezone);
    // マージ表示（2ファイル以上）は折りたたみ非対応（issue #172と同じ判断）。
    const collapsibleSupported = this.additionalFiles.length === 0;
    const options: BuildInteractiveExportTextOptions = {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
      collapseThreshold:
        collapsibleSupported && this.criteria.collapseEnabled ? readCollapseThreshold() : undefined,
    };

    const formatted = await this.computeExportFormatted(criteria, options);
    if (!formatted) {
      return;
    }

    if (this.additionalFiles.length === 0) {
      await openVirtualNormalizedDocument(
        this.normalizedViewProvider,
        this.sourceDocument,
        formatted,
        "interactive-export"
      );
      return;
    }

    this.exportMergedCounter += 1;
    await this.mergedViewProvider.openDocument(
      formatted,
      this.loadedUris,
      `/interactive-export-merged-${this.exportMergedCounter}.log`
    );
  }

  /**
   * 単一ファイル用/マージ用いずれかの書き出しテキストを組み立てる。無視
   * パターンの評価がタイムアウト/エラーになった場合は、`postState` と同じく
   * そのパターンだけを外して再計算し、警告を表示した上で書き出す（絞り込み
   * その場トグルの表示と書き出し結果がなるべく一致するようにするため）。
   */
  private async computeExportFormatted(
    criteria: FilterCriteria,
    options: BuildInteractiveExportTextOptions
  ): Promise<FormattedLogWithLineSources | undefined> {
    const result =
      this.additionalFiles.length === 0
        ? await buildInteractiveExportText(this.singleEntries, criteria, options)
        : await buildInteractiveMergedExportText(this.mergedEntries, criteria, options);
    if (result.ok) {
      return result.formatted;
    }

    const fallbackCriteria: FilterCriteria = { ...criteria, ignorePattern: undefined };
    const fallbackResult =
      this.additionalFiles.length === 0
        ? await buildInteractiveExportText(this.singleEntries, fallbackCriteria, options)
        : await buildInteractiveMergedExportText(this.mergedEntries, fallbackCriteria, options);
    if (!fallbackResult.ok) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 書き出しに失敗しました。無視パターンを見直してから再度お試しください。"
      );
      return undefined;
    }

    const reason =
      result.reason === "timeout"
        ? "入力されたパターンの処理に時間がかかりすぎたため、無視パターンを適用せずに書き出しました。"
        : "無視パターンの評価中にエラーが発生したため、無視パターンを適用せずに書き出しました。";
    vscode.window.showWarningMessage(`Totonoe Log: ${reason}`);
    return fallbackResult.formatted;
  }

  private renderHtml(webview: vscode.Webview, nonce: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_SCRIPT_RELATIVE_PATH)
    );

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background-color: var(--vscode-editor-background);
    padding: 8px 12px;
  }
  #files-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 8px;
  }
  button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
  }
  button:hover {
    background-color: var(--vscode-button-hoverBackground);
  }
  #loaded-files {
    font-size: 0.9em;
    opacity: 0.8;
  }
  #filter-panel {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 8px;
  }
  #severities {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  #severities label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  input[type="text"] {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 2px 4px;
  }
  #status {
    font-size: 0.9em;
    opacity: 0.8;
    margin-bottom: 4px;
  }
  #warning {
    color: var(--vscode-errorForeground);
    margin-bottom: 4px;
  }
  #display-limit {
    color: var(--vscode-editorWarning-foreground, var(--vscode-errorForeground));
    margin-bottom: 4px;
  }
  #log-output {
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre;
    overflow-x: auto;
  }
  .collapse-group-header {
    cursor: pointer;
  }
  .collapse-group-header:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
  .source-line {
    cursor: pointer;
  }
  .source-line:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
</style>
</head>
<body>
  <div id="files-panel">
    <button id="add-files-button" type="button">+ Add Files...</button>
    <button id="export-button" type="button">Export as Virtual Document</button>
    <span id="loaded-files"></span>
  </div>
  <div id="filter-panel">
    <div id="severities"></div>
    <label>開始日時 <input type="text" id="date-start" placeholder="YYYY-MM-DD"></label>
    <label>終了日時 <input type="text" id="date-end" placeholder="YYYY-MM-DD"></label>
    <label>無視パターン <input type="text" id="ignore-pattern" placeholder="正規表現"></label>
    <label><input type="checkbox" id="collapse-toggle" checked>繰り返しを折りたたむ</label>
  </div>
  <div id="status"></div>
  <div id="warning"></div>
  <div id="display-limit"></div>
  <pre id="log-output"></pre>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

/**
 * `Totonoe Log: Show Interactive View (Alpha)` コマンドのハンドラを作る。
 * 正規化ビュー系コマンドと同じ手順（{@link getSourceDocumentOrWarn}）で
 * アクティブなログファイルを取得し、コントローラにパネルの表示を委譲する。
 */
export function createShowInteractiveViewAlphaCommand(
  controller: InteractiveViewPanelController
): () => Promise<void> {
  return async function showInteractiveViewAlpha(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("表示する");
    if (!sourceDocument) {
      return;
    }
    await controller.showOrReveal(sourceDocument);
  };
}
