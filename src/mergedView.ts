import * as vscode from "vscode";
import {
  mergeLogFiles,
  formatMergedLogWithLineSources,
  filterMergedEntriesByCriteria,
  type LogEntry,
  type MergedEntry,
  type FormattedLogWithLineSources,
} from "./normalize";
import {
  VirtualDocumentContentProvider,
  MERGED_VIEW_SCHEME,
  type FilterableViewSource,
  type SourceLineMap,
} from "./virtualDocumentContentProvider";
import { readConfiguredTimestampFormats } from "./timestampFormatSettings";
import { readDisplayTimezone } from "./timezoneSettings";
import { warnIfLowTimestampRecognition } from "./timestampRecognitionWarning";
import { readGapThresholdMs } from "./gapThresholdSetting";
import { readLogFiles, resolveExplorerSelectionUris } from "./logFileReading";

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
    path: string,
    filterSource?: FilterableViewSource
  ): Promise<void> {
    if (Buffer.byteLength(formatted.text, "utf8") >= MAX_VIRTUAL_MERGED_DOCUMENT_BYTES) {
      if (this.largeResultStore === undefined) {
        throw new Error("Large merged result storage is not configured.");
      }
      // 通常のファイルタブには絞り込み材料を紐づけられない（issue #248）。
      // 行対応情報を登録しないのと同じ理由で、`Set Filter` の対象外になる。
      await this.largeResultStore.open(formatted.text, path);
      return;
    }

    const uri = vscode.Uri.from({ scheme: MERGED_VIEW_SCHEME, path });
    this.register(uri, formatted.text, {
      sourceUris,
      lineSources: formatted.lineSources,
    });
    if (filterSource) {
      this.registerFilterSource(uri, filterSource);
    }

    const mergedDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(mergedDocument, { preview: false });
  }

  override dispose(): void {
    this.largeResultStore?.dispose();
    super.dispose();
  }
}

let mergedViewCounter = 0;

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
  await provider.openDocument(
    formatted,
    fileUris,
    `/merged-${mergedViewCounter}.log`,
    createMergedFilterSource(mergedEntries)
  );
}

/**
 * マージビューを後から絞り込めるようにする材料（issue #248）。
 *
 * 絞り込みは `MergedEntry` の `fileIndex` を保持したまま行を間引くだけなので、
 * 行対応表の `fileIndex` は絞り込み前と同じ `fileUris` の並びで解決できる
 * ——`sourceUris` は登録し直さなくてよい。
 */
export function createMergedFilterSource(
  mergedEntries: readonly MergedEntry[]
): FilterableViewSource {
  return {
    allEntries: mergedEntries.map((merged) => merged.entry),
    async applyFilter(criteria) {
      const filterResult = await filterMergedEntriesByCriteria(mergedEntries, criteria);
      if (!filterResult.ok) {
        return undefined;
      }
      const formatted = formatMergedLogWithLineSources(filterResult.entries, {
        displayTimezone: readDisplayTimezone(),
        gapThresholdMs: readGapThresholdMs(),
      });
      return {
        text: formatted.text,
        lineSources: formatted.lineSources,
        visibleEntries: filterResult.entries.map((merged) => merged.entry),
      };
    },
  };
}

/**
 * エクスプローラのコンテキストメニューコマンドが渡す `(クリックされた項目,
 * 選択項目全体の配列)` から、フォルダを除いた対象ファイルのURI一覧を解決する。
 * `selectedUris` を優先して使い、単一クリック時のフォールバックとして
 * `clickedUri` を使う。選択が2つ未満（フォルダを除いた後）の場合は警告を
 * 表示して `undefined` を返す。`mergeSelectedFiles` / `mergeSelectedFilesFiltered`
 * の両方が共有する（issue #151）。
 */
async function resolveSelectedLogFileUris(
  clickedUri: vscode.Uri,
  selectedUris: vscode.Uri[] | undefined
): Promise<vscode.Uri[] | undefined> {
  const fileUris = await resolveExplorerSelectionUris(clickedUri, selectedUris);

  if (fileUris.length < 2) {
    await vscode.window.showWarningMessage(
      "マージするには2つ以上のログファイルを選択してください。"
    );
    return undefined;
  }

  return fileUris;
}

/**
 * エクスプローラで複数選択したログファイルを、ファイル選択ダイアログを
 * 経由せずに直接マージするコマンドの本体。
 */
export function createMergeSelectedFilesCommand(
  provider: MergedViewContentProvider
): (clickedUri: vscode.Uri, selectedUris?: vscode.Uri[]) => Promise<void> {
  return async function mergeSelectedFiles(
    clickedUri: vscode.Uri,
    selectedUris?: vscode.Uri[]
  ): Promise<void> {
    const fileUris = await resolveSelectedLogFileUris(clickedUri, selectedUris);
    if (!fileUris) {
      return;
    }

    await openMergedView(provider, fileUris);
  };
}

/**
 * マージビューの行から、そのファイル名列の区切り（`" | "`）より前の文字数を
 * 返す。`formatMergedLogWithLineSources` が `fileName.padEnd(fileNameWidth)`
 * の直後に固定で `" | "` を置く実装（`src/normalize/formatMergedLog.ts`）に
 * 依存しており、行ごとに実際の区切り位置を探すことで、別ロジックで
 * 列幅を再計算せずに済む。区切りが無ければ `undefined`（マージビュー以外の
 * 行、または内容が壊れている場合）。
 */
function findFileNameColumnEnd(lineText: string): number | undefined {
  const separatorIndex = lineText.indexOf(" | ");
  return separatorIndex === -1 ? undefined : separatorIndex;
}

/**
 * マージビューでファイル名列にカーソルを合わせると、対応する元ログファイルの
 * フルパス（フォルダ含む）をホバー表示するプロバイダの本体（issue #150）。
 * 異なるフォルダに同名ファイルが存在する場合、ファイル名列だけでは見分けが
 * つかないため、`Go to Source Line`（issue #137）と同じ表示行→元URIの対応表
 * （{@link SourceLineMap}）を再利用する。継続行・区切り行はファイル名列が
 * 空白で埋められているだけで対応表自体は引けるため（区切り行は対応情報が
 * 無く自然に対象外になる）、列の範囲判定だけで十分。
 */
export function createMergedViewFilenameHoverProvider(
  provider: MergedViewContentProvider
): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const sourceLineMap: SourceLineMap | undefined = provider.getSourceLineMap(document.uri);
      if (!sourceLineMap) {
        return undefined;
      }

      const lineText = document.lineAt(position.line).text;
      const columnEnd = findFileNameColumnEnd(lineText);
      if (columnEnd === undefined || position.character > columnEnd) {
        return undefined;
      }

      const lineSource = sourceLineMap.lineSources[position.line];
      if (!lineSource) {
        return undefined;
      }

      const sourceUri = sourceLineMap.sourceUris[lineSource.fileIndex];
      if (!sourceUri) {
        return undefined;
      }

      return new vscode.Hover(
        sourceUri.fsPath,
        new vscode.Range(position.line, 0, position.line, columnEnd)
      );
    },
  };
}
