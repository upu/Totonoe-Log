import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import {
  buildInteractivePayload,
  buildInteractiveMergedPayload,
  buildInteractiveExportText,
  buildInteractiveMergedExportText,
  limitInteractiveDisplay,
  mergeLogFiles,
  DEFAULT_COLLAPSE_THRESHOLD,
  type BuildInteractivePayloadOptions,
  type BuildInteractiveExportTextOptions,
  type DisplayMaskOptions,
  type FilterCriteria,
  type FormattedLogWithLineSources,
  type InteractivePayloadResult,
  type LineSource,
  type LogEntry,
  type MergedEntry,
} from "./normalize";
import {
  getSourceDocumentOrWarn,
  parseLogFileInput,
  buildLogFileInputFromDocument,
} from "./logSourceDocument";
import {
  filterOutFolders,
  loadLogFiles,
  reresolveLogFileOffsets,
  resolveExplorerSelectionUris,
  type LoadedLogFile,
} from "./logFileReading";
import { classifyInteractiveViewConfigChange } from "./interactiveViewConfigWatch";
import {
  normalizeFileVisibility,
  removeFileVisibilityAt,
  selectNewFileUris,
  toVisibleFileIndices,
} from "./interactiveViewFiles";
import { readDisplayTimezone } from "./timezoneSettings";
import { readGapThresholdMs } from "./gapThresholdSetting";
import { readMaxDisplayLines } from "./interactiveViewSettings";
import { readConfiguredTimestampFormats } from "./timestampFormatSettings";
import { readMaskOptions } from "./copyMasked";
import {
  addNewlyAppearedSeverities,
  compileMaskPattern,
  getLoadedDistinctSeverities,
  toFilterCriteria,
  type CompileMaskPatternResult,
} from "./interactiveViewCriteria";
import { revealSourceLine } from "./revealSourceLine";
import { parseWebviewLineSource } from "./interactiveViewContext";
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

/**
 * チェック済みセベリティ・空の日付範囲・空の無視パターン・折りたたみONという
 * 初期状態を作る（issue #172、デフォルトON）。
 *
 * マスクの対象選択（issue #194）は `Copy Masked Text` と共有する
 * `totonoeLog.copyMasked.*` 設定から読む。マスク自体は既定でOFFなので、
 * この設定は「マスクをONにしたときに何を伏せるか」の初期選択として効く。
 */
function createDefaultSerializedCriteria(
  distinctSeverities: readonly string[],
  fileCount: number
): SerializedFilterCriteria {
  const configured = readMaskOptions();
  return {
    severities: [...distinctSeverities],
    dateRangeStart: "",
    dateRangeEnd: "",
    matchPattern: "",
    ignorePattern: "",
    collapseEnabled: true,
    mask: {
      enabled: false,
      maskTimestamp: configured.maskTimestamp ?? true,
      maskHost: configured.maskHost ?? true,
      maskProcessId: configured.maskProcessId ?? false,
      // 任意パターン（issue #195）だけは設定から読まない（`SerializedMaskCriteria` 参照）。
      pattern: "",
    },
    // 読み込んだファイルは全て表示から始める（issue #170）。
    visibleFiles: normalizeFileVisibility([], fileCount),
  };
}

/**
 * Webviewから届いたマスクの状態を、整形オプションへ渡す形に直す。マスクOFF、
 * または対象が1つも選ばれていない場合は `undefined` を返し、マスクを一切
 * 通さない整形（既存コマンドと同じ経路）にする。
 */
function toDisplayMaskOptions(criteria: SerializedFilterCriteria): DisplayMaskOptions | undefined {
  const { enabled, maskTimestamp, maskHost, maskProcessId } = criteria.mask;
  if (!enabled || (!maskTimestamp && !maskHost && !maskProcessId)) {
    return undefined;
  }
  return { maskTimestamp, maskHost, maskProcessId };
}

/**
 * 任意パターンのマスク（issue #195）が効かなかったことをユーザーに伝える文。
 * 他のマスク・絞り込みはそのまま効いているため、効かなかったのがどれなのかを
 * 明示する（無視パターンの警告が「一致パターンと無視パターンを適用せずに」と
 * 対象を名指しするのと同じ扱い）。
 */
function maskPatternFailureWarnings(
  failure: "timeout" | "error" | undefined,
  outcome: string
): string[] {
  if (!failure) {
    return [];
  }
  const reason =
    failure === "timeout"
      ? "マスクパターンの処理に時間がかかりすぎたため"
      : "マスクパターンの評価中にエラーが発生したため";
  return [`${reason}、そのマスクだけを適用せずに${outcome}。`];
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
 * パネルはシングルトン。最初に開く時点で1件（コマンドパレット経由）にも複数件
 * （エクスプローラの複数選択経由、issue #181）にもなり、さらに「+ Add Files...」
 * （issue #168）で追加できる。1ファイルの間は正規化ビュー相当の表示、2ファイル
 * 以上になった時点でマージビュー相当（ファイル名/種別列付き）の表示に切り替わる
 * （デュアルパス）。コマンドを再実行すると、既存パネルの表示内容がその実行で
 * 選ばれたファイルにリセットされる。
 */
export class InteractiveViewPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** パネルが開いている間だけ張る、設定変更の購読（issue #183）。 */
  private configWatcher: vscode.Disposable | undefined;
  /**
   * 読み込み済みファイルの一覧（読み込み順）。`LineSource.fileIndex` はこの
   * 配列のインデックスを指す。1ファイル目とそれ以降を別々の状態で持たず1本に
   * 揃えている（issue #181）——エクスプローラから複数ファイルを一度に開く場合に
   * 1ファイル目を特別扱いできず、ファイル単位の取り消し（#170）でも先頭だけ
   * 消せない構造は扱いにくいため。
   */
  private loadedFiles: LoadedLogFile[] = [];
  /** `loadedFiles.length === 1` の間だけ使う、単一ファイルパスのキャッシュ。 */
  private singleEntries: readonly LogEntry[] = [];
  /** `loadedFiles.length > 1` の間だけ使う、マージ済みエントリのキャッシュ。 */
  private mergedEntries: readonly MergedEntry[] = [];
  private criteria: SerializedFilterCriteria = createDefaultSerializedCriteria([], 0);
  /** 「仮想ドキュメントとして書き出す」操作（issue #175）で発行するマージ用URIの連番。 */
  private exportMergedCounter = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly normalizedViewProvider: NormalizedViewContentProvider,
    private readonly mergedViewProvider: MergedViewContentProvider
  ) {}

  /**
   * 読み込み済みファイルを丸ごと差し替えてパネルを表示する。1件なら正規化
   * ビュー相当、2件以上ならマージビュー相当の表示になる（issue #181 で
   * エクスプローラの複数選択から複数件で開かれるようになった）。
   */
  async showOrReveal(files: readonly LoadedLogFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    this.loadedFiles = [...files];
    this.recomputeEntries();
    this.criteria = createDefaultSerializedCriteria(
      this.distinctSeverities(),
      this.loadedFiles.length
    );

    if (this.panel) {
      this.panel.title = this.buildTitle();
      this.panel.reveal();
      await this.postState();
      return;
    }

    const nonce = generateNonce();
    const panel = vscode.window.createWebviewPanel(
      INTERACTIVE_VIEW_TYPE,
      this.buildTitle(),
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
      this.disposeConfigWatcher();
    });
    panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.handleMessage(message);
    });
    // 購読はパネルが開いている間だけ持つ（issue #183）。閉じている間の設定変更は
    // 次に開くときの初期読み込みで拾えるため、購読を残す意味が無い。
    this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
      void this.applyConfigurationChange(event);
    });
    this.panel = panel;
  }

  dispose(): void {
    this.disposeConfigWatcher();
    this.panel?.dispose();
    this.panel = undefined;
  }

  private disposeConfigWatcher(): void {
    this.configWatcher?.dispose();
    this.configWatcher = undefined;
  }

  /**
   * 開いたままのパネルへ `totonoeLog.*` の設定変更を反映する（issue #183）。
   * 仮想ドキュメント方式のコマンドは実行のたびに設定を読み直すので問題に
   * ならないが、開きっぱなしで使う Interactive View では、ユーザーが絞り込みを
   * 触るまで古い表示のままになってしまう。
   *
   * 再パースが必要な場合は、追加読み込み（{@link addFiles}）と同じ理由で
   * セベリティのチェック状態も追従させる——タイムスタンプ形式が変わると
   * エントリの区切りも変わり、新しいセベリティが現れうるため。それを
   * 未チェックのままにすると、行が黙って隠れてしまう（issue #200 と同じ）。
   */
  private async applyConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!this.panel) {
      return;
    }

    const effect = classifyInteractiveViewConfigChange((section) =>
      event.affectsConfiguration(section)
    );
    if (effect === "none") {
      return;
    }

    if (effect === "reparse") {
      const previousDistinct = this.distinctSeverities();
      this.loadedFiles = reresolveLogFileOffsets(this.loadedFiles);
      this.recomputeEntries();
      this.criteria = {
        ...this.criteria,
        severities: addNewlyAppearedSeverities(
          this.criteria.severities,
          previousDistinct,
          this.distinctSeverities()
        ),
      };
    }

    await this.postState();
  }

  /** 2件以上のときは先頭のファイル名に残り件数を添える（タブ幅に全部は収まらないため）。 */
  private buildTitle(): string {
    const [first, ...rest] = this.loadedFiles;
    const suffix = rest.length > 0 ? ` +${rest.length}` : "";
    return `Totonoe Log (Alpha): ${baseName(first.uri)}${suffix}`;
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
    if (message.type === "removeFile") {
      await this.removeFile(message.fileIndex);
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
    // ファイルの追加・取り消しと絞り込みのメッセージが前後しても表示状態が
    // ずれないよう、ファイル選択だけは現在のファイル数に合わせ直して受け取る。
    this.criteria = {
      ...message.criteria,
      visibleFiles: normalizeFileVisibility(message.criteria.visibleFiles, this.loadedFiles.length),
    };
    await this.postState();
  }

  /**
   * 行の右クリックメニュー（issue #191）から呼ばれる。`webview/context` の
   * コマンドには `data-vscode-context` の内容がそのまま渡るため、非信頼な値
   * として検証してからジャンプする。
   */
  async revealSourceLineFromContext(context: unknown): Promise<void> {
    const lineSource = parseWebviewLineSource(context);
    if (!lineSource) {
      return;
    }
    await this.revealClickedSourceLine(lineSource);
  }

  /**
   * Webviewで選ばれた行から、対応する元ログファイルの行へジャンプする
   * （issue #179）。`fileIndex` は `loadedFiles`（読み込み順）の位置なので、
   * ここでURIに解決してから `Go to Source Line` と共通のジャンプ処理へ渡す。
   */
  private async revealClickedSourceLine(lineSource: LineSource): Promise<void> {
    const sourceUri = this.loadedFiles[lineSource.fileIndex]?.uri;
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
    if (this.loadedFiles.length === 0) {
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
      this.loadedFiles.map((file) => file.uri.toString()),
      candidates.map((uri) => uri.toString())
    );
    if (newUriStrings.length === 0) {
      return;
    }

    const newUriStringSet = new Set(newUriStrings);
    const newUris = candidates.filter((uri) => newUriStringSet.has(uri.toString()));

    const previousDistinct = this.distinctSeverities();
    this.loadedFiles.push(...(await loadLogFiles(newUris)));
    this.recomputeEntries();
    // 追加したファイルにしか無いセベリティは、外されたままだと行が黙って
    // 隠れてしまうためチェック済みに足す（issue #200）。
    this.criteria = {
      ...this.criteria,
      severities: addNewlyAppearedSeverities(
        this.criteria.severities,
        previousDistinct,
        this.distinctSeverities()
      ),
      // 追加したファイルは表示ONで並びに足す（issue #170）。
      visibleFiles: normalizeFileVisibility(this.criteria.visibleFiles, this.loadedFiles.length),
    };
    this.refreshTitle();
    await this.postState();
  }

  /**
   * 「+ Add Files...」で追加したファイルを取り消す（issue #170）。ファイル単位の
   * 表示トグルと違い、読み込み自体を取り消すのでセベリティ一覧や行数の分母も
   * そのファイルを含まない状態に戻る。
   *
   * 最後の1件は取り消せない——ファイルが0件になるとタイトルも「+ Add Files...」
   * の起点（{@link addFiles} は0件で何もしない）も失われ、パネルを閉じる以外に
   * 復帰できなくなるため。「一時的に消したいだけ」はファイル単位の表示トグルで
   * 足りるので、Webview側でも最後の1件の取り消しボタンは無効化してある。
   */
  private async removeFile(fileIndex: number): Promise<void> {
    if (this.loadedFiles.length <= 1 || fileIndex < 0 || fileIndex >= this.loadedFiles.length) {
      return;
    }

    this.loadedFiles.splice(fileIndex, 1);
    this.recomputeEntries();
    this.criteria = {
      ...this.criteria,
      visibleFiles: removeFileVisibilityAt(this.criteria.visibleFiles, fileIndex),
    };
    this.refreshTitle();
    await this.postState();
  }

  /** 読み込み済みファイルが増減したときに、タブのタイトル（先頭ファイル名 +N）を追従させる。 */
  private refreshTitle(): void {
    if (this.panel) {
      this.panel.title = this.buildTitle();
    }
  }

  /**
   * ファイル集合（`loadedFiles`）が変わった時だけ呼ぶ、パース/マージのやり直し。
   * 絞り込み条件が変わるだけの再描画（`postState`）では呼ばない —
   * `mergeLogFiles` は差分追加ができず毎回全件処理になるため、無駄な再マージを
   * 避ける。
   *
   * 1ファイルのときにマージ経路を通さないのは、`mergeLogFiles` がタイムスタンプ
   * 順に並べ替えるため——時系列に並んでいないログを1ファイルだけ開いた場合に、
   * 元ファイルと行順が変わってしまう。
   */
  private recomputeEntries(): void {
    const [first, ...rest] = this.loadedFiles;
    if (!first) {
      return;
    }

    if (rest.length === 0) {
      this.singleEntries = parseLogFileInput(first.input, first.uri);
      this.mergedEntries = [];
      return;
    }

    this.mergedEntries = mergeLogFiles(
      this.loadedFiles.map((file) => file.input),
      { timestampFormats: readConfiguredTimestampFormats() }
    );
    this.singleEntries = [];
  }

  /** 単一ファイル表示中か（マージ表示は折りたたみ非対応で、整形経路も別）。 */
  private isSingleFile(): boolean {
    return this.loadedFiles.length === 1;
  }

  /** 現在読み込まれているエントリのセベリティ一覧（単一ファイル/マージのどちらでも同じ結果になる）。 */
  private distinctSeverities(): string[] {
    return getLoadedDistinctSeverities(this.singleEntries, this.mergedEntries);
  }

  /** 現在のファイル集合に応じて、単一ファイル用/マージ用いずれかの合成処理を呼ぶ。 */
  private async computePayload(
    criteria: FilterCriteria,
    options: BuildInteractivePayloadOptions
  ): Promise<InteractivePayloadResult> {
    if (this.isSingleFile()) {
      return buildInteractivePayload(this.singleEntries, criteria, options);
    }
    return buildInteractiveMergedPayload(this.mergedEntries, criteria, options);
  }

  private loadedFileNames(): string[] {
    return this.loadedFiles.map((file) => file.input.fileName);
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
    const maskPattern = this.compileEnabledMaskPattern();
    const warnings = [...errors, ...maskPattern.errors];
    // マージ表示（2ファイル以上）は折りたたみ非対応（issue #172、#158の未解決課題を踏まえた判断）。
    const collapsibleSupported = this.isSingleFile();
    const formatOptions: BuildInteractivePayloadOptions = {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
      collapseThreshold:
        collapsibleSupported && this.criteria.collapseEnabled ? readCollapseThreshold() : undefined,
      mask: toDisplayMaskOptions(this.criteria),
      maskPattern: maskPattern.pattern,
      visibleFileIndices: toVisibleFileIndices(this.criteria.visibleFiles),
    };

    const payload = await this.computePayload(criteria, formatOptions);

    if (payload.ok) {
      await this.sendState(
        payload,
        [...warnings, ...maskPatternFailureWarnings(payload.maskPatternFailure, "表示しています")],
        collapsibleSupported
      );
      return;
    }

    // 失敗した結果はどちらのパターン段で起きたかを区別しないため、
    // フォールバックでは両方を落とす（issue #182）。片方だけ残して再実行すると、
    // 原因がそちらだった場合に同じ失敗を繰り返すだけになる。
    const fallbackCriteria: FilterCriteria = {
      ...criteria,
      matchPattern: undefined,
      ignorePattern: undefined,
    };
    const fallbackPayload = await this.computePayload(fallbackCriteria, formatOptions);
    if (fallbackPayload.ok) {
      const reason =
        payload.reason === "timeout"
          ? "入力されたパターンの処理に時間がかかりすぎたため、一致パターンと無視パターンを適用せずに表示しています。より単純なパターンをお試しください。"
          : "パターンの評価中にエラーが発生したため、一致パターンと無視パターンを適用せずに表示しています。";
      await this.sendState(
        fallbackPayload,
        [
          ...warnings,
          reason,
          ...maskPatternFailureWarnings(fallbackPayload.maskPatternFailure, "表示しています"),
        ],
        collapsibleSupported
      );
    }
  }

  /**
   * マスクパネルの任意パターン（issue #195）をコンパイルする。マスクOFFの間は
   * コンパイルもしない——効いていない欄の入力ミスで警告を出しても、ユーザーは
   * 何を直せばよいのか分からないため。
   */
  private compileEnabledMaskPattern(): CompileMaskPatternResult {
    if (!this.criteria.mask.enabled) {
      return { errors: [] };
    }
    return compileMaskPattern(this.criteria.mask.pattern);
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
      sourceFilePaths: this.loadedFiles.map((file) => file.uri.fsPath),
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
    const [firstFile] = this.loadedFiles;
    if (!firstFile) {
      return;
    }

    const displayTimezone = readDisplayTimezone();
    const { criteria } = toFilterCriteria(this.criteria, displayTimezone);
    // マージ表示（2ファイル以上）は折りたたみ非対応（issue #172と同じ判断）。
    const collapsibleSupported = this.isSingleFile();
    const options: BuildInteractiveExportTextOptions = {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
      collapseThreshold:
        collapsibleSupported && this.criteria.collapseEnabled ? readCollapseThreshold() : undefined,
      // 書き出しは表示の状態を引き継ぐ（issue #194、絞り込み・折りたたみと同じ扱い）。
      mask: toDisplayMaskOptions(this.criteria),
      maskPattern: this.compileEnabledMaskPattern().pattern,
      visibleFileIndices: toVisibleFileIndices(this.criteria.visibleFiles),
    };

    const formatted = await this.computeExportFormatted(criteria, options);
    if (!formatted) {
      return;
    }

    if (this.isSingleFile()) {
      await openVirtualNormalizedDocument(
        this.normalizedViewProvider,
        firstFile.uri,
        formatted,
        "interactive-export"
      );
      return;
    }

    this.exportMergedCounter += 1;
    await this.mergedViewProvider.openDocument(
      formatted,
      this.loadedFiles.map((file) => file.uri),
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
      this.isSingleFile()
        ? await buildInteractiveExportText(this.singleEntries, criteria, options)
        : await buildInteractiveMergedExportText(this.mergedEntries, criteria, options);
    if (result.ok) {
      this.warnAboutMaskPatternFailure(result.maskPatternFailure);
      return result.formatted;
    }

    // 表示側（`refresh`）と同じ理由で、フォールバックでは両方のパターンを落とす。
    const fallbackCriteria: FilterCriteria = {
      ...criteria,
      matchPattern: undefined,
      ignorePattern: undefined,
    };
    const fallbackResult =
      this.isSingleFile()
        ? await buildInteractiveExportText(this.singleEntries, fallbackCriteria, options)
        : await buildInteractiveMergedExportText(this.mergedEntries, fallbackCriteria, options);
    if (!fallbackResult.ok) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 書き出しに失敗しました。一致パターン・無視パターンを見直してから再度お試しください。"
      );
      return undefined;
    }

    const reason =
      result.reason === "timeout"
        ? "入力されたパターンの処理に時間がかかりすぎたため、一致パターンと無視パターンを適用せずに書き出しました。"
        : "パターンの評価中にエラーが発生したため、一致パターンと無視パターンを適用せずに書き出しました。";
    vscode.window.showWarningMessage(`Totonoe Log: ${reason}`);
    this.warnAboutMaskPatternFailure(fallbackResult.maskPatternFailure);
    return fallbackResult.formatted;
  }

  /**
   * 書き出しでも、表示側（{@link postState}）と同じ理由で任意パターンのマスクの
   * 失敗を伝える。書き出したテキストにマスクが掛かっていないことに気づかず
   * そのまま共有してしまわないようにするため。
   */
  private warnAboutMaskPatternFailure(failure: "timeout" | "error" | undefined): void {
    for (const message of maskPatternFailureWarnings(failure, "書き出しました")) {
      vscode.window.showWarningMessage(`Totonoe Log: ${message}`);
    }
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
    flex-wrap: wrap;
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
  /* 読み込み済みファイルは、表示ON/OFFのチェックボックスと取り消しボタンを
     持つ「チップ」として1件ずつ並べる（issue #170）。 */
  #loaded-files {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
  }
  #loaded-files-label {
    font-size: 0.9em;
    opacity: 0.8;
  }
  .loaded-file {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .loaded-file label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  /* 取り消しはファイル名の隣に添える小さな操作なので、上部の主要ボタン
     （追加・書き出し・マスク）と同じ塗りにはせず、地の色に溶かしておく。 */
  .remove-file {
    background-color: transparent;
    color: inherit;
    padding: 0 4px;
    opacity: 0.7;
  }
  .remove-file:hover:enabled {
    background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    opacity: 1;
  }
  /* 最後の1件は取り消せない（読み込み0件になると復帰できないため）。 */
  .remove-file:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .remove-file:disabled:hover {
    background-color: transparent;
  }
  /* マスクパネルはボタンに重ねて開く（issue #194）。絞り込み列に対象を並べると
     #195 で対象が増えたときに横へ伸び続けるため、開閉するパネルに畳んでおく。 */
  #mask-container {
    position: relative;
    display: flex;
    gap: 1px;
  }
  /* マスクONの間の見た目は、VSCodeが検索ボックスのオプション（正規表現・
     大文字小文字）のトグルに使っている色に合わせる（issue #197）。ラベルに
     「: ON」「: OFF」と状態を書き込むのはVSCodeの作法から外れているため、
     状態は配色と施錠アイコン（🔓/🔒）の2つで示す（issue #195）。 */
  #mask-button.toggled-on {
    background-color: var(--vscode-inputOption-activeBackground, var(--vscode-button-hoverBackground));
    color: var(--vscode-inputOption-activeForeground, var(--vscode-button-foreground));
    /* 枠線は border ではなく outline で描く（border だとON/OFFでボタンの
       寸法が変わり、隣の「▾」がずれるため）。 */
    outline: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
    outline-offset: -1px;
  }
  #mask-panel {
    position: absolute;
    z-index: 1;
    top: 100%;
    left: 0;
    margin-top: 2px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    white-space: nowrap;
    background-color: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  }
  /* display を指定した要素では UA の [hidden] { display: none } が作者
     スタイルに負けるため、閉じた状態を明示する（issue #197）。
     このスタイルは template literal 内なのでバックティックは使えない。 */
  #mask-panel[hidden] {
    display: none;
  }
  #mask-panel label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* 任意パターンの入力欄（issue #195）。パネルの他の行はチェックボックスだけで
     短いため、幅を決めておかないとパネルが入力欄の既定幅まで広がってしまう。 */
  #mask-pattern {
    width: 12em;
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
  /* ジャンプはダブルクリック/右クリックメニュー（issue #191）なので、
     シングルクリックを促す cursor: pointer は付けず、行が対象であることは
     ホバーの背景色だけで示す。 */
  .source-line:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
</style>
</head>
<body>
  <div id="files-panel">
    <button id="add-files-button" type="button">+ Add Files...</button>
    <button id="export-button" type="button">Export as Virtual Document</button>
    <div id="mask-container">
      <button id="mask-button" type="button" aria-pressed="false" title="選んだ対象を伏せて表示します（そのままコピーできます）">🔓 Mask</button>
      <button id="mask-options-button" type="button" aria-expanded="false" aria-controls="mask-panel" title="マスクする対象を選ぶ">▾</button>
      <div id="mask-panel" hidden>
        <label><input type="checkbox" id="mask-timestamp">タイムスタンプ</label>
        <label><input type="checkbox" id="mask-host">ホスト名 / IPアドレス</label>
        <label><input type="checkbox" id="mask-process-id">プロセスID</label>
        <!-- 任意パターンにチェックボックスを添えないのは、入力欄が空かどうかが
             そのままON/OFFになるため（絞り込みのパターン欄と同じ扱い）。 -->
        <label>任意パターン <input type="text" id="mask-pattern" placeholder="正規表現"></label>
      </div>
    </div>
    <span id="loaded-files-label">読み込み済み:</span>
    <div id="loaded-files"></div>
  </div>
  <div id="filter-panel">
    <div id="severities"></div>
    <label>開始日時 <input type="text" id="date-start" placeholder="YYYY-MM-DD"></label>
    <label>終了日時 <input type="text" id="date-end" placeholder="YYYY-MM-DD"></label>
    <label>一致パターン <input type="text" id="match-pattern" placeholder="正規表現"></label>
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
 * エクスプローラのコンテキストメニュー（複数選択、issue #181）とコマンド
 * パレットの両方から呼ばれる1つのコマンドで、引数の有無で入力経路を切り替える:
 *
 * - エクスプローラ経由 — VSCode が `(クリックされた項目, 選択項目全体)` を渡す。
 *   選ばれたファイルをディスクから読み込んで開く（複数フォルダにまたがる選択も
 *   問題なく扱える。ダイアログ方式の制限は #151 の教訓）
 * - コマンドパレット経由 — 引数が無いので、正規化ビュー系コマンドと同じ手順
 *   （{@link getSourceDocumentOrWarn}）でアクティブなログファイルを対象にする。
 *   エディタの内容をそのまま使うため、未保存の変更も反映される
 *
 * 用途ごとにコマンドを増やさず1つに寄せているのは、パレットに同じ機能の項目が
 * 並ぶのを避けるため。
 */
export function createShowInteractiveViewAlphaCommand(
  controller: InteractiveViewPanelController
): (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => Promise<void> {
  return async function showInteractiveViewAlpha(
    clickedUri?: vscode.Uri,
    selectedUris?: vscode.Uri[]
  ): Promise<void> {
    const explorerUris = await resolveExplorerSelectionUris(clickedUri, selectedUris);
    if (explorerUris.length > 0) {
      await controller.showOrReveal(await loadLogFiles(explorerUris));
      return;
    }

    const sourceDocument = getSourceDocumentOrWarn("表示する");
    if (!sourceDocument) {
      return;
    }
    await controller.showOrReveal([
      {
        uri: sourceDocument.uri,
        input: buildLogFileInputFromDocument(sourceDocument),
      },
    ]);
  };
}
