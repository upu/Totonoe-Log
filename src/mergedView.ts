import * as vscode from "vscode";
import {
  mergeLogFiles,
  formatMergedLogWithLineSources,
  filterMergedEntriesByCriteria,
  type LogFileInput,
  type LogEntry,
  type MergedEntry,
  type FilterCriteria,
  type FormattedLogWithLineSources,
} from "./normalize";
import {
  VirtualDocumentContentProvider,
  MERGED_VIEW_SCHEME,
} from "./virtualDocumentContentProvider";
import {
  promptSeveritySelection,
  promptDateBoundary,
  promptIgnorePattern,
  promptFilterKinds,
  countLines,
} from "./filterPrompts";
import { readConfiguredTimestampFormats } from "./timestampFormatSettings";
import { createSourceOffsetResolver, readDisplayTimezone } from "./timezoneSettings";
import { createClockSkewResolver } from "./clockSkewSettings";
import { warnIfLowTimestampRecognition } from "./timestampRecognitionWarning";
import { readGapThresholdMs } from "./gapThresholdSetting";

// スキーム定義は virtualDocumentContentProvider.ts に集約している
// （既存の import 元を変えずに済むよう、ここから再エクスポートする）。
export { MERGED_VIEW_SCHEME };

/** マージビュー用の {@link vscode.TextDocumentContentProvider}。 */
export class MergedViewContentProvider extends VirtualDocumentContentProvider {
  private readonly largeResultStore: LargeMergedResultStore | undefined;

  constructor(globalStorageUri?: vscode.Uri) {
    super(MERGED_VIEW_SCHEME);
    this.largeResultStore =
      globalStorageUri === undefined ? undefined : new LargeMergedResultStore(globalStorageUri);
  }

  /**
   * マージ結果を開く。仮想ドキュメントで開く場合は、表示行→元行の対応表
   * （issue #137）を本文と一緒に登録する。`sourceUris` はマージ入力と同順の
   * 元ファイル URI 一覧（`LineSource.fileIndex` はこの配列のインデックスを
   * 指す）。同期上限を超える大容量結果は通常のファイルタブとして開くため
   * （issue #130）、仮想ドキュメント前提の行対応情報は登録しない。
   */
  async openDocument(
    formatted: FormattedLogWithLineSources,
    sourceUris: readonly vscode.Uri[],
    path: string
  ): Promise<void> {
    if (Buffer.byteLength(formatted.text, "utf8") >= MAX_VIRTUAL_MERGED_DOCUMENT_BYTES) {
      if (this.largeResultStore === undefined) {
        throw new Error("Large merged result storage is not configured.");
      }
      await this.largeResultStore.open(formatted.text, path);
      return;
    }

    const uri = vscode.Uri.from({ scheme: MERGED_VIEW_SCHEME, path });
    this.register(uri, formatted.text, {
      sourceUris,
      lineSources: formatted.lineSources,
    });

    const mergedDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(mergedDocument, { preview: false });
  }

  override dispose(): void {
    this.largeResultStore?.dispose();
    super.dispose();
  }
}

let mergedViewCounter = 0;
let mergedFilteredViewCounter = 0;

/**
 * VS Code が拡張機能へ同期できるドキュメントの上限は約50MiB。境界付近で
 * 仮想ドキュメントを試してから失敗するのではなく、このサイズ以上の整形済み
 * 結果は最初からディスク経由で開く。
 */
const MAX_VIRTUAL_MERGED_DOCUMENT_BYTES = 50 * 1024 * 1024;

/**
 * 大容量のマージ結果を拡張機能のグローバルストレージへ一時保存し、
 * `vscode.open` でUIへ直接開く。通常のファイルタブにすることで、拡張機能へ
 * TextDocument全体を同期する約50MiB制限を避けつつ、標準の検索・コピーを
 * 維持する。タブを閉じた結果と、前回セッションから残った未表示の結果は削除
 * して、ストレージが増え続けないようにする。
 */
class LargeMergedResultStore implements vscode.Disposable {
  private readonly directoryUri: vscode.Uri;
  private readonly trackedUris = new Set<string>();
  private readonly ready: Promise<void>;
  private readonly closeListener: vscode.Disposable;
  private initializationError: Error | undefined;
  private nextId = 0;

  constructor(globalStorageUri: vscode.Uri) {
    this.directoryUri = vscode.Uri.joinPath(globalStorageUri, "large-merged-results");
    this.ready = this.initialize().catch((error: unknown) => {
      this.initializationError =
        error instanceof Error ? error : new Error(String(error));
    });
    this.closeListener = vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.closed) {
        if (tab.input instanceof vscode.TabInputText) {
          void this.deleteTrackedResult(tab.input.uri);
        }
      }
    });
  }

  async open(content: string, path: string): Promise<void> {
    await this.ready;
    if (this.initializationError !== undefined) {
      throw this.initializationError;
    }

    this.nextId += 1;
    const baseName = path.split("/").pop() ?? `merged-${this.nextId}.log`;
    const uri = vscode.Uri.joinPath(
      this.directoryUri,
      `${Date.now()}-${process.pid}-${this.nextId}-${baseName}`
    );
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    this.trackedUris.add(uri.toString());

    try {
      await vscode.commands.executeCommand<void>("vscode.open", uri, { preview: false });
    } catch (error: unknown) {
      await this.deleteTrackedResult(uri);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  dispose(): void {
    this.closeListener.dispose();
  }

  private async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.directoryUri);
    const entries = await vscode.workspace.fs.readDirectory(this.directoryUri);
    const openUris = this.getOpenTextTabUris();

    await Promise.all(
      entries.map(async ([name, type]) => {
        if ((type & vscode.FileType.File) === 0) {
          return;
        }
        const uri = vscode.Uri.joinPath(this.directoryUri, name);
        const key = uri.toString();
        if (openUris.has(key)) {
          this.trackedUris.add(key);
          return;
        }
        await vscode.workspace.fs.delete(uri);
      })
    );
  }

  private getOpenTextTabUris(): Set<string> {
    const uris = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          uris.add(tab.input.uri.toString());
        }
      }
    }
    return uris;
  }

  private async deleteTrackedResult(uri: vscode.Uri): Promise<void> {
    await this.ready;
    const key = uri.toString();
    if (!this.trackedUris.delete(key)) {
      return;
    }
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // ユーザー操作や外部クリーンアップで既に消えていれば、追加対応は不要。
    }
  }
}

/**
 * VS Code の `files.encoding` が使う識別子と、WHATWG `TextDecoder` の
 * ラベルが異なるものを対応付ける。TextDecoder が対応しないコードページは
 * あえて含めず、黙って文字化けさせずに警告＋UTF-8フォールバックへ回す。
 */
const FILE_ENCODING_DECODER_LABELS: Readonly<Record<string, string>> = {
  utf8: "utf-8",
  utf8bom: "utf-8",
  utf16le: "utf-16le",
  utf16be: "utf-16be",
  windows1252: "windows-1252",
  iso88591: "iso-8859-1",
  iso88593: "iso-8859-3",
  iso885915: "iso-8859-15",
  macroman: "macintosh",
  windows1256: "windows-1256",
  iso88596: "iso-8859-6",
  windows1257: "windows-1257",
  iso88594: "iso-8859-4",
  iso885914: "iso-8859-14",
  windows1250: "windows-1250",
  iso88592: "iso-8859-2",
  windows1251: "windows-1251",
  cp866: "ibm866",
  iso88595: "iso-8859-5",
  koi8r: "koi8-r",
  koi8u: "koi8-u",
  iso885913: "iso-8859-13",
  windows1253: "windows-1253",
  iso88597: "iso-8859-7",
  windows1255: "windows-1255",
  iso88598: "iso-8859-8",
  windows1254: "windows-1254",
  iso88599: "iso-8859-9",
  windows1258: "windows-1258",
  gbk: "gbk",
  gb18030: "gb18030",
  cp950: "big5",
  big5hkscs: "big5",
  shiftjis: "shift_jis",
  eucjp: "euc-jp",
  iso2022jp: "iso-2022-jp",
  euckr: "euc-kr",
  windows874: "windows-874",
  iso885910: "iso-8859-10",
  iso885916: "iso-8859-16",
};

/**
 * URIスコープの `files.encoding` でログをデコードする。VS Code が認識しても
 * TextDecoder が扱えないコードページや、不正な手動設定では、ファイル名と
 * 設定値を警告してUTF-8へ明示的にフォールバックする。
 */
function decodeLogFile(bytes: Uint8Array, fileUri: vscode.Uri): string {
  const configuredEncoding = vscode.workspace
    .getConfiguration("files", fileUri)
    .get<string>("encoding", "utf8");
  const decoderLabel = FILE_ENCODING_DECODER_LABELS[configuredEncoding.toLowerCase()];

  if (decoderLabel !== undefined) {
    try {
      return new TextDecoder(decoderLabel).decode(bytes);
    } catch {
      // 実行環境のICU構成によって特定ラベルを扱えない場合も、下の共通警告へ進む。
    }
  }

  const fileName = fileUri.path.split("/").pop() ?? fileUri.toString();
  vscode.window.showWarningMessage(
    `Totonoe Log: ${fileName} の files.encoding「${configuredEncoding}」はマージ時のデコードに対応していないため、UTF-8として読み込みます。`
  );
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * 選択されたファイル群を読み込み、{@link mergeLogFiles} に渡す入力へ変換する。
 * ファイルごとのソースオフセット（`totonoeLog.timezone.fileOffsets`、issue #13）
 * とクロックスキュー補正（`totonoeLog.clockSkew.fileOffsets`、issue #15）も
 * ここで解決して添付する。
 *
 * `vscode.workspace.openTextDocument` はエディタのドキュメント管理を経由する
 * ため、VSCodeが拡張機能へ同期しない大容量ファイル（目安約50MB超）で
 * 「Files above 50MB cannot be synchronized with extensions.」というエラーに
 * なる（issue #98）。マージ対象になりやすい本番ログはこのサイズ帯に達し
 * やすいため、`vscode.workspace.fs.readFile` でバイト列として直接読み、
 * URIスコープの `files.encoding` に対応する `TextDecoder` で文字列化する
 * 方式に切り替えてこの制限を回避する。副次効果として、マージのためだけに
 * 全対象ファイルがエディタ管理下に開かれるコストも消える。
 */
async function readLogFiles(fileUris: readonly vscode.Uri[]): Promise<LogFileInput[]> {
  const resolveSourceOffsetMinutes = createSourceOffsetResolver();
  const resolveClockSkewMs = createClockSkewResolver();
  return Promise.all(
    fileUris.map(async (fileUri) => {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const fileName = fileUri.path.split("/").pop() ?? "log";
      return {
        fileName,
        text: decodeLogFile(bytes, fileUri),
        sourceUtcOffsetMinutes: resolveSourceOffsetMinutes(fileName),
        clockSkewMs: resolveClockSkewMs(fileName),
      };
    })
  );
}

/**
 * マージ対象の各ファイルについて、タイムスタンプ認識率が低い場合の警告を
 * ファイル単位で表示する（issue #101）。マージ結果はファイル横断で時系列に
 * 並び替えられているため、`MergedEntry.fileName` でエントリを元ファイルごとに
 * グループし直してから判定する。異なるフォルダの同名ファイルが混在する場合は
 * 1グループにまとまるが、通知の目的（形式未対応への気づき）には支障がない
 * ため許容する。
 */
function warnLowTimestampRecognitionPerFile(
  fileUris: readonly vscode.Uri[],
  mergedEntries: readonly MergedEntry[]
): void {
  const entriesByFileName = new Map<string, LogEntry[]>();
  for (const merged of mergedEntries) {
    const entries = entriesByFileName.get(merged.fileName);
    if (entries) {
      entries.push(merged.entry);
    } else {
      entriesByFileName.set(merged.fileName, [merged.entry]);
    }
  }

  for (const fileUri of fileUris) {
    const fileName = fileUri.path.split("/").pop() ?? "log";
    warnIfLowTimestampRecognition(fileUri, entriesByFileName.get(fileName) ?? []);
  }
}

/**
 * 指定されたファイル群を時系列順にマージして開く。通常は読み取り専用の仮想
 * ドキュメントを使い、同期上限を超える結果だけ一時ストレージへ切り替える。
 * ファイル選択ダイアログ経由・エクスプローラのコンテキストメニュー経由の
 * どちらのコマンドからも共通で使う本体処理。ファイルごとの日時フォーマットが
 * 違っても、正規化エンジンが共通のタイムスタンプに変換するため正しく時系列に並ぶ。
 */
async function openMergedView(
  provider: MergedViewContentProvider,
  fileUris: readonly vscode.Uri[]
): Promise<void> {
  const files = await readLogFiles(fileUris);
  const mergedEntries = mergeLogFiles(files, {
    timestampFormats: readConfiguredTimestampFormats(),
  });
  warnLowTimestampRecognitionPerFile(fileUris, mergedEntries);
  const formatted = formatMergedLogWithLineSources(mergedEntries, {
    displayTimezone: readDisplayTimezone(),
    gapThresholdMs: readGapThresholdMs(),
  });

  mergedViewCounter += 1;
  await provider.openDocument(formatted, fileUris, `/merged-${mergedViewCounter}.log`);
}

/**
 * ファイル選択ダイアログで、マージ対象のログファイルを複数選ばせ、時系列
 * 順にマージした結果を開くコマンドの本体。
 */
export function createShowMergedViewCommand(
  provider: MergedViewContentProvider
): () => Promise<void> {
  return async function showMergedView(): Promise<void> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: "選択",
      title: "マージするログファイルを選択してください（複数選択可）",
    });
    if (!fileUris || fileUris.length === 0) {
      return;
    }

    await openMergedView(provider, fileUris);
  };
}

/**
 * ファイル選択ダイアログで、マージ対象のログファイルを複数選ばせて時系列順に
 * マージしたうえで、ユーザーが選んだ条件（セベリティ / 日付範囲 / 無視
 * パターンのうち任意の組み合わせ）で絞り込んだ結果を開くコマンドの本体
 * （issue #61）。
 *
 * 「マージビューを開いた後にそのビューへ絞り込みコマンドを実行する」形（正規化
 * ビューの絞り込み系コマンドと同じ、アクティブエディタを起点とする方式）ではなく、
 * 「マージしてから絞り込む」を1コマンドにまとめる方式を採った。マージビューは
 * `formatMergedLog` でファイル名/種類列・行番号ガター付きのテキストに整形済みで
 * 表示されるため、後者を選ぶとその表示テキストから `MergedEntry[]` を再パース
 * する専用ロジックが要り、フォーマットの変更に弱くなる
 * （`guardAgainstVirtualDocumentSource` が仮想ドキュメントに対する
 * `parseLog` 実行を警告する形で防いでいるのと同種の問題、#57）。ファイル選択
 * ダイアログはファイルシステム上のファイルしか選べず仮想ドキュメントを選択肢に
 * 含められないため、`showMergedView` と同様にこのコマンドも自ビュー判定は不要
 * （アクティブエディタを一切参照しない）。
 */
export function createShowMergedViewFilteredCommand(
  provider: MergedViewContentProvider
): () => Promise<void> {
  return async function showMergedViewFiltered(): Promise<void> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: "選択",
      title: "マージするログファイルを選択してください（複数選択可）",
    });
    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const files = await readLogFiles(fileUris);
    const mergedEntries: MergedEntry[] = mergeLogFiles(files, {
      timestampFormats: readConfiguredTimestampFormats(),
    });
    warnLowTimestampRecognitionPerFile(fileUris, mergedEntries);

    const selectedKinds = await promptFilterKinds();
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedKinds === undefined) {
      return;
    }

    const entries = mergedEntries.map((merged) => merged.entry);
    const displayTimezone = readDisplayTimezone();

    let severities: Set<string> | undefined;
    if (selectedKinds.has("severity")) {
      severities = await promptSeveritySelection(entries);
      if (severities === undefined) {
        return;
      }
    }

    let dateRange: FilterCriteria["dateRange"];
    if (selectedKinds.has("dateRange")) {
      const startMs = await promptDateBoundary("開始日時", "start", displayTimezone);
      // null はキャンセル、または不正な入力による中断を表す。
      if (startMs === null) {
        return;
      }

      const endMs = await promptDateBoundary("終了日時", "end", displayTimezone);
      if (endMs === null) {
        return;
      }

      dateRange = { startMs, endMs };
    }

    let ignorePattern: RegExp | undefined;
    if (selectedKinds.has("ignorePattern")) {
      ignorePattern = await promptIgnorePattern();
      // ユーザーがキャンセルした場合、または不正な入力による中断の場合は何もしない。
      if (ignorePattern === undefined) {
        return;
      }
    }

    const criteria: FilterCriteria = { severities, dateRange, ignorePattern };

    const filterResult = await filterMergedEntriesByCriteria(mergedEntries, criteria);
    if (!filterResult.ok) {
      // 破局的バックトラッキング等でマッチング処理がタイムアウトした場合。
      // 正規化ビューの統合絞り込みコマンドと同じ理由で、フォールバックせず
      // 警告のみ出す。
      vscode.window.showWarningMessage(
        "Totonoe Log: 入力されたパターンの処理に時間がかかりすぎたため中断しました。より単純なパターンをお試しください。"
      );
      return;
    }
    const filteredMergedEntries = filterResult.entries;
    // 絞り込みは MergedEntry の fileIndex を保持したまま行を間引くだけなので、
    // 対応表の fileIndex は絞り込み前と同じ fileUris の並びで解決できる。
    const formatted = formatMergedLogWithLineSources(filteredMergedEntries, {
      displayTimezone,
      gapThresholdMs: readGapThresholdMs(),
    });

    mergedFilteredViewCounter += 1;
    await provider.openDocument(
      formatted,
      fileUris,
      `/merged-filtered-${mergedFilteredViewCounter}.log`
    );

    const filteredEntries = filteredMergedEntries.map((merged) => merged.entry);
    const hiddenLineCount = countLines(entries) - countLines(filteredEntries);
    vscode.window.showInformationMessage(
      `Totonoe Log: 条件に合わない ${hiddenLineCount} 行を非表示にしました（${countLines(filteredEntries)}/${countLines(entries)} 行を表示）。`
    );
  };
}

/** フォルダを除いたファイルの URI だけを残す。 */
async function filterOutFolders(uris: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (const uri of uris) {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) === 0) {
      files.push(uri);
    }
  }
  return files;
}

/**
 * エクスプローラで複数選択したログファイルを、ファイル選択ダイアログを
 * 経由せずに直接マージするコマンドの本体。VSCode はエクスプローラの
 * コンテキストメニューコマンドに `(クリックされた項目, 選択項目全体の配列)`
 * を渡すため、`selectedUris` を優先して使い、単一クリック時のフォールバックと
 * して `clickedUri` を使う。選択範囲にフォルダが混ざっていても無視して続行する。
 */
export function createMergeSelectedFilesCommand(
  provider: MergedViewContentProvider
): (clickedUri: vscode.Uri, selectedUris?: vscode.Uri[]) => Promise<void> {
  return async function mergeSelectedFiles(
    clickedUri: vscode.Uri,
    selectedUris?: vscode.Uri[]
  ): Promise<void> {
    const candidateUris =
      selectedUris && selectedUris.length > 0 ? selectedUris : clickedUri ? [clickedUri] : [];
    const fileUris = await filterOutFolders(candidateUris);

    if (fileUris.length < 2) {
      await vscode.window.showWarningMessage(
        "マージするには2つ以上のログファイルを選択してください。"
      );
      return;
    }

    await openMergedView(provider, fileUris);
  };
}
