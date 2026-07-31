import * as vscode from "vscode";
import {
  formatNormalizedLogWithLineSources,
  filterEntriesByCriteria,
  type DisplayTimezone,
  type FormattedLogWithLineSources,
  type LogEntry,
} from "./normalize";
import {
  VirtualDocumentContentProvider,
  NORMALIZED_VIEW_SCHEME,
  type FilterableViewSource,
} from "./virtualDocumentContentProvider";
import { parseLogFileEntries, parseSourceLog } from "./logSourceDocument";
import { readDisplayTimezone } from "./timezoneSettings";
import { readGapThresholdMs } from "./gapThresholdSetting";
import { loadLogFiles } from "./logFileReading";
import { warnIfLowTimestampRecognition } from "./timestampRecognitionWarning";

// スキーム定義は virtualDocumentContentProvider.ts に集約している
// （既存の import 元を変えずに済むよう、ここから再エクスポートする）。
export { NORMALIZED_VIEW_SCHEME };

/**
 * 正規化ビュー用の {@link vscode.TextDocumentContentProvider}。
 *
 * 仮想ドキュメントの内容は開いた瞬間のスナップショットとして URI ごとに
 * 保持する。同じ元ファイルに対して再度コマンドを実行した場合も、新しい
 * URI（連番付き）を発行して既存のタブと衝突しないようにする。
 */
export class NormalizedViewContentProvider extends VirtualDocumentContentProvider {
  constructor() {
    super(NORMALIZED_VIEW_SCHEME);
  }
}

/**
 * 仮想ドキュメントURIの連番を fileTag（ビュー種別を表すタグ文字列）ごとに
 * 管理する。以前はビュー種別ごとに専用のモジュール変数（`normalizedViewCounter`
 * 等）を持っていたが、絞り込みビューを追加するたびにカウンタ変数を増やす
 * 必要が生じるため、fileTag をキーにした1つの Map に集約した（issue #77）。
 */
const viewCounters = new Map<string, number>();

/** 指定した fileTag の連番を1つ進めて返す。 */
function nextViewCounter(fileTag: string): number {
  const nextCounter = (viewCounters.get(fileTag) ?? 0) + 1;
  viewCounters.set(fileTag, nextCounter);
  return nextCounter;
}

/**
 * 時間ギャップ設定・表示タイムゾーン設定込みで、正規化ログ本文と表示行→
 * 元行の対応表（issue #137）を組み立てる。折りたたみビュー以外の全コマンドが
 * このオプション組み立てを共有するため一箇所にまとめる。
 */
function formatNormalizedWithGap(
  entries: readonly LogEntry[],
  displayTimezone: DisplayTimezone = readDisplayTimezone()
): FormattedLogWithLineSources {
  return formatNormalizedLogWithLineSources(entries, {
    gapThresholdMs: readGapThresholdMs(),
    displayTimezone,
  });
}

/**
 * 正規化ビュー系コマンドが共有する、仮想ドキュメントの発行・登録・表示処理。
 * 同じ元ファイルに対して繰り返しコマンドを実行しても、連番付きの新しい URI
 * を発行して既存タブと衝突しないようにする。Interactive View の
 * 「仮想ドキュメントとして書き出す」操作（issue #175）からも、単一ファイル
 * 表示中の書き出し先として同じ処理を再利用するためexportする。
 */
export async function openVirtualNormalizedDocument(
  provider: NormalizedViewContentProvider,
  sourceUri: vscode.Uri,
  formatted: FormattedLogWithLineSources,
  fileTag: string,
  filterSource?: FilterableViewSource
): Promise<void> {
  const sourceBaseName = sourceUri.path.split("/").pop() ?? "log";
  // 先頭のドット（`.env` などのドットファイル）は拡張子とみなさず、
  // 直前に別の文字がある最後の拡張子だけを除去する。
  const sourceNameWithoutExtension = sourceBaseName.replace(/(?<=[^.])\.[^./]+$/, "");
  const uri = vscode.Uri.from({
    scheme: NORMALIZED_VIEW_SCHEME,
    path: `/${sourceNameWithoutExtension}.${fileTag}-${nextViewCounter(fileTag)}.log`,
  });

  provider.register(uri, formatted.text, {
    sourceUris: [sourceUri],
    lineSources: formatted.lineSources,
  });
  if (filterSource) {
    provider.registerFilterSource(uri, filterSource);
  }

  const normalizedDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(normalizedDocument, { preview: false });
}

/**
 * 正規化ビューを後から絞り込めるようにする材料（issue #248）。表示タイム
 * ゾーンとギャップ設定は掛け直しのたびに読み直す——絞り込みの前後で表示の
 * 基準が変わらないよう、開いたときと同じ経路（{@link formatNormalizedWithGap}）
 * を通す。
 */
export function createNormalizedFilterSource(
  entries: readonly LogEntry[]
): FilterableViewSource {
  return {
    allEntries: entries,
    async applyFilter(criteria) {
      const filterResult = await filterEntriesByCriteria(entries, criteria);
      if (!filterResult.ok) {
        return undefined;
      }
      const formatted = formatNormalizedWithGap(filterResult.entries);
      return {
        text: formatted.text,
        lineSources: formatted.lineSources,
        visibleEntries: filterResult.entries,
      };
    },
  };
}

/**
 * アクティブなエディタの内容を正規化し、読み取り専用の仮想ドキュメントとして
 * 開く。VSCode 標準の検索・コピー・diff エディタがそのまま使える仮想
 * ドキュメント方式（`TextDocumentContentProvider`）を採用する。
 *
 * 絞り込みはここでは尋ねない。開いたビューに対する `Set Filter`
 * （`setViewFilter.ts`、issue #248）で後からいつでも設定・変更・解除する。
 */
export async function openNormalizedViewForDocument(
  provider: NormalizedViewContentProvider,
  sourceDocument: vscode.TextDocument
): Promise<void> {
  const entries = parseSourceLog(sourceDocument);
  const formatted = formatNormalizedWithGap(entries);

  await openVirtualNormalizedDocument(
    provider,
    sourceDocument.uri,
    formatted,
    "normalized",
    createNormalizedFilterSource(entries)
  );
}

/**
 * ディスク上のログファイル1件を正規化して開く（issue #249）。エクスプローラ
 * で選んだファイルはエディタで開かれているとは限らないため、`TextDocument`
 * ではなく URI を起点にする経路が要る。
 *
 * 認識率の警告（issue #101）は {@link parseLogFileEntries} が出さないので、
 * エディタ起点の経路（{@link parseSourceLog}）と揃うようここで出す。
 */
export async function openNormalizedViewForFile(
  provider: NormalizedViewContentProvider,
  fileUri: vscode.Uri
): Promise<void> {
  const [file] = await loadLogFiles([fileUri]);
  const entries = parseLogFileEntries(file.input);
  warnIfLowTimestampRecognition(fileUri, entries);
  const formatted = formatNormalizedWithGap(entries);

  await openVirtualNormalizedDocument(
    provider,
    fileUri,
    formatted,
    "normalized",
    createNormalizedFilterSource(entries)
  );
}
