import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import {
  assessTimestampRecognition,
  assessTimestampRecognitionByFile,
  buildInteractivePayload,
  buildInteractiveMergedPayload,
  buildInteractiveExportText,
  buildInteractiveMergedExportText,
  buildKeyMaskPattern,
  highlightDisplayLines,
  limitInteractiveDisplay,
  mergeLogFiles,
  PatternWorkerSession,
  DEFAULT_COLLAPSE_THRESHOLD,
  type BuildInteractivePayloadOptions,
  type BuildInteractiveExportTextOptions,
  type DisplayMaskOptions,
  type FilterCriteria,
  type FormattedLogWithLineSources,
  type InteractivePayloadResult,
  type LimitedInteractiveDisplay,
  type LineSource,
  type LogEntry,
  type MergedEntry,
} from "./normalize";
import {
  getSourceDocumentOrWarn,
  parseLogFileEntries,
  buildLogFileInputFromDocument,
} from "./logSourceDocument";
import { buildLowTimestampRecognitionWarnings } from "./timestampRecognitionWarning";
import {
  filterOutFolders,
  loadLogFiles,
  reresolveLogFileOffsets,
  resolveExplorerSelectionUris,
  type LoadedLogFile,
} from "./logFileReading";
import { buildInteractiveViewHtml } from "./interactiveViewHtml";
import { buildInteractiveViewLabels } from "./interactiveViewLabels";
import { classifyInteractiveViewConfigChange } from "./interactiveViewConfigWatch";
import { RefreshRevisionGate } from "./interactiveViewRefresh";
import {
  normalizeFileVisibility,
  removeFileVisibilityAt,
  selectNewFileUris,
  toVisibleFileIndices,
} from "./interactiveViewFiles";
import { readDisplayTimezone } from "./timezoneSettings";
import { readGapThresholdMs } from "./gapThresholdSetting";
import { readMaxDisplayLines } from "./interactiveViewSettings";
import { readConfiguredSeverityTokens } from "./severityTokenSettings";
import { readConfiguredTimestampFormats } from "./timestampFormatSettings";
import { readMaskOptions } from "./copyMasked";
import {
  readHighlightRuleRows,
  readHighlightRules,
  writeHighlightRuleRows,
} from "./highlightRuleSettings";
import {
  addNewlyAppearedSeverities,
  buildIgnoredInputWarning,
  compileMaskPattern,
  getLoadedDistinctSeverities,
  resolveIncomingCriteria,
  toFilterCriteria,
  type CompileMaskPatternResult,
} from "./interactiveViewCriteria";
import { revealSourceLine } from "./revealSourceLine";
import { parseWebviewLineSource } from "./interactiveViewContext";
import { NormalizedViewContentProvider, openVirtualNormalizedDocument } from "./normalizedView";
import { MergedViewContentProvider } from "./mergedView";
import type {
  ExtensionToWebviewMessage,
  LineHighlights,
  SerializedFilterCriteria,
  WebviewToExtensionMessage,
} from "./webview/interactiveView/protocol";

/** Webviewパネルのビュー種別ID（`createWebviewPanel` 第1引数）。コマンドIDとは別の識別子。 */
const INTERACTIVE_VIEW_TYPE = "totonoeLog.interactiveView";

/** Webview側スクリプトのバンドル出力（`scripts/esbuild.js` の第2エントリ）を探すための相対パス。 */
const WEBVIEW_SCRIPT_RELATIVE_PATH = ["out", "webview", "interactiveView", "main.js"];

/** 折りたたみのしきい値を読み込むVSCode設定のセクション名。 */
const COLLAPSE_CONFIG_SECTION = "totonoeLog.collapse";

interface PreparedInteractiveState {
  readonly criteria: FilterCriteria;
  readonly warnings: readonly string[];
  readonly collapsibleSupported: boolean;
  readonly formatOptions: BuildInteractivePayloadOptions;
}

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
    // 空配列で開き、Webview側が空の入力行を1つ描く（issue #206）。
    matchPatterns: [],
    ignorePatterns: [],
    collapseEnabled: true,
    mask: {
      enabled: false,
      maskTimestamp: configured.maskTimestamp ?? true,
      maskHost: configured.maskHost ?? true,
      maskProcessId: configured.maskProcessId ?? false,
      // キー指定（issue #212）と任意パターン（issue #195）は設定から読まない
      // （`SerializedMaskCriteria` 参照）。
      keys: "",
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
  outcome: "display" | "export"
): string[] {
  if (!failure) {
    return [];
  }
  if (outcome === "display") {
    return [
      failure === "timeout"
        ? vscode.l10n.t(
            "Mask pattern processing took too long, so the content is displayed without applying that mask."
          )
        : vscode.l10n.t(
            "An error occurred while evaluating the mask pattern, so the content is displayed without applying that mask."
          ),
    ];
  }
  return [
    failure === "timeout"
      ? vscode.l10n.t(
          "Mask pattern processing took too long, so the content was exported without applying that mask."
        )
      : vscode.l10n.t(
          "An error occurred while evaluating the mask pattern, so the content was exported without applying that mask."
        ),
  ];
}

/**
 * ハイライト（issue #18）の評価対象になる、実際に描画される行を集める。
 * 折りたたみ表示では見出し行と展開後の各行がどちらも描かれるため、両方を含める
 * ——Webview側は行のテキストで対応表を引くので、ここで拾い漏らした行だけ色が
 * 付かないことになる。重複は `highlightDisplayLines` 側でまとめられる。
 */
function collectDisplayLines(limited: LimitedInteractiveDisplay): string[] {
  if (!limited.items) {
    return limited.text === "" ? [] : limited.text.split("\n");
  }

  const lines: string[] = [];
  for (const item of limited.items) {
    if (item.kind === "line") {
      lines.push(item.text);
      continue;
    }
    lines.push(item.headerText, ...item.lines);
  }
  return lines;
}

/** `totonoeLog.collapse.threshold` 設定を読む。 */
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
  /**
   * 読み込み済みファイルのうち、タイムスタンプ認識率が低いものの警告文
   * （issue #186）。全行を走査する評価なので、絞り込みのたびの再描画では
   * なくファイル集合が変わる {@link recomputeEntries} でだけ作り直す。
   */
  private recognitionWarnings: readonly string[] = [];
  private criteria: SerializedFilterCriteria = createDefaultSerializedCriteria([], 0);
  /**
   * 再描画の世代管理（issue #218）。ファイルの差し替え・絞り込みの変更・設定変更は
   * いずれも最後に {@link postState} を呼ぶため、そこで世代を進めるだけで、
   * それらの経路すべてで古い結果の公開を止められる。
   */
  private readonly refreshGate = new RefreshRevisionGate();
  /** 表示言語は Extension Development Host の再起動まで変わらないため、文言辞書も1度だけ作る。 */
  private readonly labels = buildInteractiveViewLabels();
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
    // HTMLを設定するとWebview側のスクリプトがすぐ `ready` を送るため、受信準備と
    // パネルの保持を先に済ませる。順序が逆だと初回メッセージを失い、状態が届かない。
    this.panel = panel;
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
    panel.webview.html = this.renderHtml(panel.webview, nonce);
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
    const suffix = rest.length > 0 ? ` +${String(rest.length)}` : "";
    return `Totonoe Log: ${baseName(first.uri)}${suffix}`;
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
      await this.exportVirtualDocument(message.criteria);
      return;
    }
    if (message.type === "revealSourceLine") {
      await this.revealClickedSourceLine(message.lineSource);
      return;
    }
    if (message.type === "highlightRulesChanged") {
      // 書き戻しは設定変更イベントを起こし、#183 の redisplay 経路で表示へ
      // 反映されるため、ここで postState は呼ばない（二重描画を避ける）。
      await writeHighlightRuleRows(message.rules, this.highlightRulesResource());
      return;
    }
    this.criteria = resolveIncomingCriteria(message.criteria, this.loadedFiles.length);
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
    const loadedFiles: readonly (LoadedLogFile | undefined)[] = this.loadedFiles;
    const sourceUri = loadedFiles[lineSource.fileIndex]?.uri;
    if (!sourceUri) {
      // 送信後にファイル集合が変わった場合など、`fileIndex` が現在の読み込み
      // 済みファイルに対応しないとき（`Go to Source Line` と同じ案内にする）。
      vscode.window.showWarningMessage(
        vscode.l10n.t("Totonoe Log: Could not resolve the source log file.")
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
      title: vscode.l10n.t("Totonoe Log: Select log files to add"),
      openLabel: vscode.l10n.t("Add"),
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
    const loadedFiles: readonly (LoadedLogFile | undefined)[] = this.loadedFiles;
    const first = loadedFiles[0];
    if (!first) {
      return;
    }

    const rest = this.loadedFiles.slice(1);
    if (rest.length === 0) {
      this.singleEntries = parseLogFileEntries(first.input);
      this.mergedEntries = [];
      this.recognitionWarnings = buildLowTimestampRecognitionWarnings(
        [first.input.fileName],
        [assessTimestampRecognition(this.singleEntries)]
      );
      return;
    }

    this.mergedEntries = mergeLogFiles(
      this.loadedFiles.map((file) => file.input),
      {
        timestampFormats: readConfiguredTimestampFormats(),
        severityTokens: readConfiguredSeverityTokens(),
      }
    );
    this.singleEntries = [];
    this.recognitionWarnings = buildLowTimestampRecognitionWarnings(
      this.loadedFileNames(),
      assessTimestampRecognitionByFile(this.mergedEntries, this.loadedFiles.length)
    );
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
   * ハイライトルール設定を解決する基準リソース（issue #240）。マルチルート
   * ワークスペースでは、どのフォルダの `.vscode/settings.json` を読み書きするか
   * がリソース次第で変わるため、「いま開いているログ」を基準にする。
   *
   * 複数フォルダにまたがるログを開いている場合でも先頭のファイルで決める
   * ——書き込み先が読み込み順だけで決まり、パネルに表示しているルールと
   * 保存先が必ず一致するため。パネルにフォーカスがある間 `activeTextEditor`
   * は別のエディタか `undefined` なので、そちらは基準にできない。
   */
  private highlightRulesResource(): vscode.Uri | undefined {
    return this.loadedFiles[0]?.uri;
  }

  private prepareInteractiveState(
    criteriaSnapshot: SerializedFilterCriteria
  ): PreparedInteractiveState {
    const displayTimezone = readDisplayTimezone();
    const { criteria, errors } = toFilterCriteria(criteriaSnapshot, displayTimezone);
    const maskPatterns = this.compileEnabledMaskPatterns();
    // 認識率の警告（issue #186）は入力の不備と違い、読み込んだファイルの性質
    // として出続けるものなので先頭に置き、後から増える入力エラーで位置が
    // 動かないようにする。
    const warnings = [...this.recognitionWarnings, ...errors, ...maskPatterns.errors];
    // マージ表示（2ファイル以上）でも折りたたみが効く（issue #158）。
    const collapsibleSupported = true;
    return {
      criteria,
      warnings,
      collapsibleSupported,
      formatOptions: {
        gapThresholdMs: readGapThresholdMs(),
        displayTimezone,
        collapseThreshold: criteriaSnapshot.collapseEnabled
          ? readCollapseThreshold()
          : undefined,
        mask: toDisplayMaskOptions(criteriaSnapshot),
        maskPatterns: maskPatterns.patterns,
        visibleFileIndices: toVisibleFileIndices(criteriaSnapshot.visibleFiles),
      },
    };
  }

  private async postFallbackState(
    failedPayload: Extract<InteractivePayloadResult, { ok: false }>,
    prepared: PreparedInteractiveState,
    criteriaSnapshot: SerializedFilterCriteria,
    revision: number,
    session: PatternWorkerSession
  ): Promise<void> {
    // 失敗した結果はどちらのパターン段で起きたかを区別しないため、
    // フォールバックでは両方を落とす（issue #182）。片方だけ残して再実行すると、
    // 原因がそちらだった場合に同じ失敗を繰り返すだけになる。
    const fallbackCriteria: FilterCriteria = {
      ...prepared.criteria,
      matchPatterns: undefined,
      ignorePatterns: undefined,
    };
    const fallbackPayload = await this.computePayload(fallbackCriteria, {
      ...prepared.formatOptions,
      session,
    });
    if (!this.refreshGate.isCurrent(revision) || !fallbackPayload.ok) {
      return;
    }

    const reason =
      failedPayload.reason === "timeout"
        ? vscode.l10n.t(
            "Pattern processing took too long, so the content is displayed without applying match or ignore patterns. Try simpler patterns."
          )
        : vscode.l10n.t(
            "An error occurred while evaluating patterns, so the content is displayed without applying match or ignore patterns."
          );
    await this.sendState(
      fallbackPayload,
      [
        ...prepared.warnings,
        reason,
        ...maskPatternFailureWarnings(fallbackPayload.maskPatternFailure, "display"),
      ],
      prepared.collapsibleSupported,
      criteriaSnapshot,
      revision,
      session
    );
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

    const revision = this.refreshGate.begin();
    // 以降はこのスナップショットだけを見る。`this.criteria` は差し替えで更新される
    // （書き換えではない）ため参照を保持すれば足りる。送信時に読み直すと、
    // 計算中に届いた新しい条件と、この計算の結果とが1つのメッセージに混ざる。
    const criteriaSnapshot = this.criteria;
    const prepared = this.prepareInteractiveState(criteriaSnapshot);
    // この再描画で走るパターン処理（一致・無視・マスク・ハイライトと、失敗時の
    // 再計算）を1つのワーカーで順に処理する（issue #303）。再描画をまたいで
    // 共有しないのは、重なった再描画が互いを待たされないようにするため。
    const session = new PatternWorkerSession();
    try {
      const payload = await this.computePayload(prepared.criteria, {
        ...prepared.formatOptions,
        session,
      });
      if (!this.refreshGate.isCurrent(revision)) {
        return;
      }

      if (payload.ok) {
        await this.sendState(
          payload,
          [
            ...prepared.warnings,
            ...maskPatternFailureWarnings(payload.maskPatternFailure, "display"),
          ],
          prepared.collapsibleSupported,
          criteriaSnapshot,
          revision,
          session
        );
        return;
      }
      await this.postFallbackState(payload, prepared, criteriaSnapshot, revision, session);
    } finally {
      session.dispose();
    }
  }

  /**
   * マスクパネルのキー指定欄（issue #212）と任意パターン欄（issue #195）を
   * 正規表現に直す。マスクOFFの間はコンパイルもしない——効いていない欄の
   * 入力ミスで警告を出しても、ユーザーは何を直せばよいのか分からないため。
   *
   * キー指定を先に並べるのは、`user=(\w+)` のような任意パターンを併用した
   * ときに、キー指定の結果（`user=<MASKED>`）が先に確定するようにするため。
   */
  private compileEnabledMaskPatterns(): {
    readonly patterns: readonly RegExp[];
    readonly errors: readonly string[];
  } {
    if (!this.criteria.mask.enabled) {
      return { patterns: [], errors: [] };
    }

    const keyPattern = buildKeyMaskPattern(this.criteria.mask.keys);
    const custom: CompileMaskPatternResult = compileMaskPattern(this.criteria.mask.pattern);
    return {
      patterns: [keyPattern, custom.pattern].filter(
        (pattern): pattern is RegExp => pattern !== undefined
      ),
      errors: custom.errors,
    };
  }

  /**
   * `criteria` はユーザーがWebview上のフォームへ入力した生の文字列を
   * そのままエコーバックする。無視パターンが不正で適用されなかった場合も、
   * ユーザーが入力欄を修正できるよう入力内容を消さずに `warning` だけで通知する。
   *
   * 送信時点の `this.criteria` ではなく、この結果を計算した条件そのもの
   * （`criteria`）を返す（issue #218）。計算中に新しい条件が届いていると、
   * フォーム上の条件と本文が食い違ったまま1つのメッセージになり、
   * 「条件に一致しているように見えて実際は古い結果」という誤認につながる。
   */
  private async sendState(
    payload: Extract<InteractivePayloadResult, { ok: true }>,
    warnings: readonly string[],
    collapsibleSupported: boolean,
    criteria: SerializedFilterCriteria,
    revision: number,
    session: PatternWorkerSession
  ): Promise<void> {
    // パネルが閉じられた後、および後から始まった再描画に追い越された後は送らない。
    const panel = this.panel;
    if (!panel || !this.refreshGate.isCurrent(revision)) {
      return;
    }

    // 描画は上限行数までに縮退させる（issue #178）。Webviewは1メッセージで
    // 全文を受け取って一括描画するため、切り詰めはここ（送る直前）で行う。
    const maxDisplayLines = readMaxDisplayLines();
    const limited = limitInteractiveDisplay(
      { text: payload.text, lineSources: payload.lineSources, items: payload.items },
      maxDisplayLines
    );

    // ハイライトは整形・マスク・表示上限まで済んだ「実際に描く行」に対して
    // 求める（issue #18）。範囲は描画される文字列のオフセットなので、この段階
    // より前では計算できない。ワーカーを1回挟むぶん待ちが増えるため、追い越し
    // 判定はこの後にもう一度行う。
    const highlights = await this.computeHighlights(limited, session);
    if (this.panel !== panel || !this.refreshGate.isCurrent(revision)) {
      return;
    }

    const message: ExtensionToWebviewMessage = {
      type: "state",
      labels: this.labels,
      criteria,
      distinctSeverities: payload.distinctSeverities,
      text: limited.text,
      totalLineCount: payload.totalLineCount,
      visibleLineCount: payload.visibleLineCount,
      loadedFileNames: this.loadedFileNames(),
      // ホバー表示用のフルパス（issue #179）。`fileIndex` はこの並びを指す。
      sourceFilePaths: this.loadedFiles.map((file) => file.uri.fsPath),
      lineSources: limited.lineSources,
      warning: warnings.length > 0 ? warnings.join(" / ") : undefined,
      highlights,
      highlightRules: readHighlightRuleRows(this.highlightRulesResource()),
      collapsibleSupported,
      items: limited.items,
      displayLimit:
        limited.displayedLineCount !== undefined
          ? { maxDisplayLines, displayedLineCount: limited.displayedLineCount }
          : undefined,
    };
    await panel.webview.postMessage(message);
  }

  /**
   * 実際に描画する行に対してハイライトルール（issue #18）を当て、Webviewへ
   * 送る対応表を作る。ルールが未設定なら何もしない（ワーカーも起動しない）。
   *
   * 評価に失敗した場合は色を付けずに続行する——絞り込みの失敗は表示件数が
   * 変わるので警告して条件を落とすが、ハイライトは付かなくても本文の表示は
   * そのまま成立するため（マスクの任意パターンと同じ扱い、issue #195）。
   * ただし黙って落とすと「設定したのに色が付かない」理由が分からないので、
   * 警告だけは出す。
   */
  private async computeHighlights(
    limited: LimitedInteractiveDisplay,
    session: PatternWorkerSession
  ): Promise<LineHighlights | undefined> {
    const rules = readHighlightRules(this.highlightRulesResource());
    if (rules.length === 0) {
      return undefined;
    }

    const result = await highlightDisplayLines(collectDisplayLines(limited), rules, { session });
    if (!result.ok) {
      const message =
        result.reason === "timeout"
          ? vscode.l10n.t(
              "Totonoe Log: Highlight rule processing took too long, so the content is displayed without colors."
            )
          : vscode.l10n.t(
              "Totonoe Log: An error occurred while evaluating highlight rules, so the content is displayed without colors."
            );
      vscode.window.showWarningMessage(message);
      return undefined;
    }
    return result.highlights;
  }

  /**
   * 現在の絞り込み/マージ/折りたたみ状態を、既存の仮想ドキュメント方式
   * （正規化ビュー・マージビューと同じ `TextDocumentContentProvider`）で
   * 新規タブとして開く（issue #175）。検索・コピー・`Go to Source Line`・
   * `Compare Logs` は、書き出し後は仮想ドキュメント側の既存導線をそのまま
   * 使う想定で、Webview側には作り込まない。
   *
   * `requestedCriteria` は Export を押した時点のフォーム内容（issue #217）。
   * 最後に受け取った条件ではなくこちらを採用したうえで、そのまま
   * `this.criteria` にも反映する——書き出し内容と、この後パネルが描き直された
   * ときの表示内容を食い違わせないため。デバウンス待ちのメッセージが後から
   * 届いても表示は巻き戻らない（Webview側は発火時点のフォームを読み直すので、
   * 遅れて届く内容がこのスナップショットより古くなることはない）。ここで
   * 再描画まではしない——直後にそのメッセージが届いて描き直されるため、
   * 重いパターンの評価を二度走らせないようにする。
   */
  private async exportVirtualDocument(
    requestedCriteria: SerializedFilterCriteria
  ): Promise<void> {
    const loadedFiles: readonly (LoadedLogFile | undefined)[] = this.loadedFiles;
    const firstFile = loadedFiles[0];
    if (!firstFile) {
      return;
    }

    this.criteria = resolveIncomingCriteria(requestedCriteria, this.loadedFiles.length);

    const displayTimezone = readDisplayTimezone();
    const { criteria, errors } = toFilterCriteria(this.criteria, displayTimezone);
    const maskPatterns = this.compileEnabledMaskPatterns();
    // 押した時点の入力をそのまま使う以上、その入力がまだ描画されておらず
    // パネル内の警告行を一度も見ていないことがある。表示側と同じく該当条件だけを
    // 落として書き出すが、落としたことは通知で伝える（issue #217）。
    const ignoredInputWarning = buildIgnoredInputWarning([...errors, ...maskPatterns.errors]);
    if (ignoredInputWarning !== undefined) {
      vscode.window.showWarningMessage(vscode.l10n.t("Totonoe Log: {0}", ignoredInputWarning));
    }
    // 表示側と同じく、マージ表示でも折りたたみが効く（issue #158）。
    const options: BuildInteractiveExportTextOptions = {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
      collapseThreshold: this.criteria.collapseEnabled ? readCollapseThreshold() : undefined,
      // 書き出しは表示の状態を引き継ぐ（issue #194、絞り込み・折りたたみと同じ扱い）。
      mask: toDisplayMaskOptions(this.criteria),
      maskPatterns: maskPatterns.patterns,
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
      `/interactive-export-merged-${String(this.exportMergedCounter)}.log`
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
      matchPatterns: undefined,
      ignorePatterns: undefined,
    };
    const fallbackResult =
      this.isSingleFile()
        ? await buildInteractiveExportText(this.singleEntries, fallbackCriteria, options)
        : await buildInteractiveMergedExportText(this.mergedEntries, fallbackCriteria, options);
    if (!fallbackResult.ok) {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Totonoe Log: Export failed. Review the match and ignore patterns, then try again."
        )
      );
      return undefined;
    }

    const message =
      result.reason === "timeout"
        ? vscode.l10n.t(
            "Totonoe Log: Pattern processing took too long, so the content was exported without applying match or ignore patterns."
          )
        : vscode.l10n.t(
            "Totonoe Log: An error occurred while evaluating patterns, so the content was exported without applying match or ignore patterns."
          );
    vscode.window.showWarningMessage(message);
    this.warnAboutMaskPatternFailure(fallbackResult.maskPatternFailure);
    return fallbackResult.formatted;
  }

  /**
   * 書き出しでも、表示側（{@link postState}）と同じ理由で任意パターンのマスクの
   * 失敗を伝える。書き出したテキストにマスクが掛かっていないことに気づかず
   * そのまま共有してしまわないようにするため。
   */
  private warnAboutMaskPatternFailure(failure: "timeout" | "error" | undefined): void {
    for (const message of maskPatternFailureWarnings(failure, "export")) {
      vscode.window.showWarningMessage(vscode.l10n.t("Totonoe Log: {0}", message));
    }
  }

  private renderHtml(webview: vscode.Webview, nonce: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_SCRIPT_RELATIVE_PATH)
    );

    return buildInteractiveViewHtml({
      nonce,
      scriptUrl: scriptUri.toString(),
      language: vscode.env.language,
    });
  }
}

/**
 * `Totonoe Log: Show Interactive View` コマンドのハンドラを作る。
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
export function createShowInteractiveViewCommand(
  controller: InteractiveViewPanelController
): (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => Promise<void> {
  return async function showInteractiveView(
    clickedUri?: vscode.Uri,
    selectedUris?: vscode.Uri[]
  ): Promise<void> {
    const explorerUris = await resolveExplorerSelectionUris(clickedUri, selectedUris);
    if (explorerUris.length > 0) {
      await controller.showOrReveal(await loadLogFiles(explorerUris));
      return;
    }

    const sourceDocument = getSourceDocumentOrWarn("showInteractiveView");
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
