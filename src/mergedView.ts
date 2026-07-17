import * as vscode from "vscode";
import {
  mergeLogFiles,
  formatMergedLog,
  filterMergedEntriesByCriteria,
  type LogFileInput,
  type LogEntry,
  type MergedEntry,
  type FilterCriteria,
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
  constructor() {
    super(MERGED_VIEW_SCHEME);
  }
}

let mergedViewCounter = 0;
let mergedFilteredViewCounter = 0;

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
 * `TextDecoder` で文字列化する方式に切り替えてこの制限を回避する。副次効果
 * として、マージのためだけに全対象ファイルがエディタ管理下に開かれるコストも
 * 消える。
 */
async function readLogFiles(fileUris: readonly vscode.Uri[]): Promise<LogFileInput[]> {
  const resolveSourceOffsetMinutes = createSourceOffsetResolver();
  const resolveClockSkewMs = createClockSkewResolver();
  const decoder = new TextDecoder();
  return Promise.all(
    fileUris.map(async (fileUri) => {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const fileName = fileUri.path.split("/").pop() ?? "log";
      return {
        fileName,
        text: decoder.decode(bytes),
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
 * マージビュー系コマンドが共有する、仮想ドキュメントの発行・登録・表示処理。
 * `normalizedView.ts` の `openVirtualNormalizedDocument` と同じ役割。
 */
async function openVirtualMergedDocument(
  provider: MergedViewContentProvider,
  content: string,
  path: string
): Promise<void> {
  const uri = vscode.Uri.from({ scheme: MERGED_VIEW_SCHEME, path });

  provider.register(uri, content);

  const mergedDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(mergedDocument, { preview: false });
}

/**
 * 指定されたファイル群を時系列順にマージし、読み取り専用の仮想ドキュメントとして
 * 開く。ファイル選択ダイアログ経由・エクスプローラのコンテキストメニュー経由の
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
  const content = formatMergedLog(mergedEntries, {
    displayTimezone: readDisplayTimezone(),
    gapThresholdMs: readGapThresholdMs(),
  });

  mergedViewCounter += 1;
  await openVirtualMergedDocument(provider, content, `/merged-${mergedViewCounter}.log`);
}

/**
 * ファイル選択ダイアログで、マージ対象のログファイルを複数選ばせ、時系列
 * 順にマージした読み取り専用の仮想ドキュメントとして開くコマンドの本体。
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
 * パターンのうち任意の組み合わせ）で絞り込んだ読み取り専用の仮想ドキュメント
 * として開くコマンドの本体（issue #61）。
 *
 * 「マージビューを開いた後にそのビューへ絞り込みコマンドを実行する」形（正規化
 * ビューの絞り込み系コマンドと同じ、アクティブエディタを起点とする方式）ではなく、
 * 「マージしてから絞り込む」を1コマンドにまとめる方式を採った。マージビューは
 * `formatMergedLog` でファイル名/種類列・行番号ガター付きのテキストに整形済みの
 * 仮想ドキュメントとして表示されるため、後者を選ぶとその仮想ドキュメントの
 * テキストから `MergedEntry[]` を再パースする専用ロジックが要り、フォーマットの
 * 変更に弱くなる（`guardAgainstVirtualDocumentSource` が仮想ドキュメントに対する
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

    let severities: Set<string> | undefined;
    if (selectedKinds.has("severity")) {
      severities = await promptSeveritySelection(entries);
      if (severities === undefined) {
        return;
      }
    }

    let dateRange: FilterCriteria["dateRange"];
    if (selectedKinds.has("dateRange")) {
      const startMs = await promptDateBoundary("開始日時", "start");
      // null はキャンセル、または不正な入力による中断を表す。
      if (startMs === null) {
        return;
      }

      const endMs = await promptDateBoundary("終了日時", "end");
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
    const content = formatMergedLog(filteredMergedEntries, {
      displayTimezone: readDisplayTimezone(),
      gapThresholdMs: readGapThresholdMs(),
    });

    mergedFilteredViewCounter += 1;
    await openVirtualMergedDocument(
      provider,
      content,
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
