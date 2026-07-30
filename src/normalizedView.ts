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
} from "./virtualDocumentContentProvider";
import { promptFilterKinds, promptFilterCriteriaForKinds, countLines } from "./filterPrompts";
import { getSourceDocumentOrWarn, parseSourceLog } from "./logSourceDocument";
import { readDisplayTimezone } from "./timezoneSettings";
import { readGapThresholdMs } from "./gapThresholdSetting";

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
  fileTag: string
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

  const normalizedDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(normalizedDocument, { preview: false });
}

/**
 * 絞り込みで非表示にした行数を通知として表示する。表示前後の行数をそれぞれ
 * 1回だけ数え、通知本文（非表示行数と「表示中/全体」の分母・分子）の算出で
 * 重複計算しないようにする。
 *
 * `reasonPhrase` は「指定範囲外の」「条件に合わない」等、通知文の
 * 「〜 N 行を非表示にしました」に前置する語句。
 */
function reportHiddenLineCount(
  reasonPhrase: string,
  totalEntries: readonly LogEntry[],
  visibleEntries: readonly LogEntry[]
): void {
  const totalLineCount = countLines(totalEntries);
  const visibleLineCount = countLines(visibleEntries);
  const hiddenLineCount = totalLineCount - visibleLineCount;
  vscode.window.showInformationMessage(
    `Totonoe Log: ${reasonPhrase} ${hiddenLineCount} 行を非表示にしました（${visibleLineCount}/${totalLineCount} 行を表示）。`
  );
}

/**
 * アクティブなエディタの内容を正規化し、読み取り専用の仮想ドキュメントとして
 * 開くコマンドの本体。VSCode 標準の検索・コピー・diff エディタがそのまま
 * 使える仮想ドキュメント方式（`TextDocumentContentProvider`）を採用する。
 */
export function createShowNormalizedViewCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedView(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("正規化する");
    if (!sourceDocument) {
      return;
    }

    const entries = parseSourceLog(sourceDocument);
    const formatted = formatNormalizedWithGap(entries);

    await openVirtualNormalizedDocument(provider, sourceDocument.uri, formatted, "normalized");
  };
}

/**
 * アクティブなエディタの内容を正規化し、ユーザーが選んだ条件（セベリティ /
 * 日付範囲 / 無視パターンのうち任意の組み合わせ）だけを順に尋ねて絞り込んだ
 * 読み取り専用の仮想ドキュメントとして開くコマンド。個別の組み合わせごとに
 * コマンドを増やす代わりに、まず「どの条件で絞り込むか」を複数選択ピッカーで
 * 尋ね、選ばれた条件についてだけ既存のプロンプト（{@link promptSeveritySelection}
 * 等）を順に呼ぶ（issue #60 の推奨案1）。非表示にした行数は、開いた直後に
 * 通知として表示する。
 *
 * 条件ごとに分かれていた絞り込みコマンドは、Interactive View のライブトグルと
 * このコマンドで代替できるため廃止した（issue #184）。
 */
export function createShowNormalizedViewFilteredCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedViewFiltered(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("絞り込む");
    if (!sourceDocument) {
      return;
    }

    const selectedKinds = await promptFilterKinds();
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedKinds === undefined) {
      return;
    }

    const entries = parseSourceLog(sourceDocument);
    const displayTimezone = readDisplayTimezone();

    const criteria = await promptFilterCriteriaForKinds(selectedKinds, entries, displayTimezone);
    // いずれかのプロンプトがキャンセル・不正入力で中断された場合は何もしない。
    if (criteria === undefined) {
      return;
    }

    const filterResult = await filterEntriesByCriteria(entries, criteria);
    if (!filterResult.ok) {
      // 破局的バックトラッキング等でマッチング処理がタイムアウトした場合。
      // ignorePatternフィルタ単体のコマンドと同じ理由で、フォールバックせず
      // 警告のみ出す。
      vscode.window.showWarningMessage(
        "Totonoe Log: 入力されたパターンの処理に時間がかかりすぎたため中断しました。より単純なパターンをお試しください。"
      );
      return;
    }
    const filteredEntries = filterResult.entries;
    const formatted = formatNormalizedWithGap(filteredEntries, displayTimezone);

    await openVirtualNormalizedDocument(provider, sourceDocument.uri, formatted, "filtered");

    reportHiddenLineCount("条件に合わない", entries, filteredEntries);
  };
}
