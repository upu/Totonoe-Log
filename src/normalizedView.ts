import * as vscode from "vscode";
import {
  formatNormalizedLog,
  filterEntriesBySeverity,
  filterEntriesByDateRange,
  filterEntriesByIgnorePattern,
  filterEntriesByCriteria,
  collapseRepeatedEntries,
  formatCollapsedLog,
  applyClockSkew,
  DEFAULT_COLLAPSE_THRESHOLD,
  type FilterCriteria,
  type LogEntry,
} from "./normalize";
import {
  VirtualDocumentContentProvider,
  NORMALIZED_VIEW_SCHEME,
  guardAgainstVirtualDocumentSource,
} from "./virtualDocumentContentProvider";
import {
  promptSeveritySelection,
  promptDateBoundary,
  promptIgnorePattern,
  promptFilterKinds,
  countLines,
} from "./filterPrompts";
import { parseLogWithConfiguredFormats } from "./timestampFormatSettings";
import { createSourceOffsetResolver, readDisplayTimezone } from "./timezoneSettings";
import { createClockSkewResolver } from "./clockSkewSettings";
import { warnIfLowTimestampRecognition } from "./timestampRecognitionWarning";
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
 * 時間ギャップ設定・表示タイムゾーン設定込みで正規化ログ本文を組み立てる。
 * 折りたたみビュー以外の全コマンドがこのオプション組み立てを共有するため
 * 一箇所にまとめる。
 */
function formatNormalizedWithGap(entries: readonly LogEntry[]): string {
  return formatNormalizedLog(entries, {
    gapThresholdMs: readGapThresholdMs(),
    displayTimezone: readDisplayTimezone(),
  });
}

/**
 * アクティブなエディタ上のログファイルを取得する。エディタが無い場合、または
 * 対象が Totonoe Log 自身の仮想ドキュメントである場合（`guardAgainstVirtualDocumentSource`
 * が判定）は警告を表示し、呼び出し側に処理を中断させるため `undefined` を返す。
 * 正規化・フィルタ系・折りたたみの全コマンドが冒頭で行う同一の手順を集約した。
 *
 * `actionLabel` は「正規化する」「絞り込む」「折りたたむ」等、警告文の
 * 「〜ログファイルが開かれていません。」に前置する動詞句。
 */
function getSourceDocumentOrWarn(actionLabel: string): vscode.TextDocument | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showWarningMessage(
      `Totonoe Log: ${actionLabel}ログファイルが開かれていません。`
    );
    return undefined;
  }

  const sourceDocument = activeEditor.document;
  if (guardAgainstVirtualDocumentSource(sourceDocument)) {
    return undefined;
  }

  return sourceDocument;
}

/**
 * 元ドキュメントを設定反映済みのフォーマット一覧・ソースオフセット
 * （issue #13）でパースし、クロックスキュー補正（issue #15）と、タイム
 * スタンプ認識率が低い場合の警告通知（issue #101）まで済ませる。正規化
 * ビュー系の全コマンドがパース直後に同じ判定を必要とするため一箇所に
 * まとめる。
 */
function parseSourceLog(sourceDocument: vscode.TextDocument): LogEntry[] {
  const fileName = sourceDocument.uri.path.split("/").pop() ?? "";
  const sourceUtcOffsetMinutes = createSourceOffsetResolver()(fileName);
  const parsedEntries = parseLogWithConfiguredFormats(
    sourceDocument.getText(),
    sourceUtcOffsetMinutes
  );
  const entries = applyClockSkew(parsedEntries, createClockSkewResolver()(fileName));
  warnIfLowTimestampRecognition(sourceDocument.uri, entries);
  return entries;
}

/**
 * 正規化ビュー系コマンドが共有する、仮想ドキュメントの発行・登録・表示処理。
 * 同じ元ファイルに対して繰り返しコマンドを実行しても、連番付きの新しい URI
 * を発行して既存タブと衝突しないようにする。
 */
async function openVirtualNormalizedDocument(
  provider: NormalizedViewContentProvider,
  sourceDocument: vscode.TextDocument,
  content: string,
  fileTag: string
): Promise<void> {
  const sourceBaseName = sourceDocument.uri.path.split("/").pop() ?? "log";
  // 先頭のドット（`.env` などのドットファイル）は拡張子とみなさず、
  // 直前に別の文字がある最後の拡張子だけを除去する。
  const sourceNameWithoutExtension = sourceBaseName.replace(/(?<=[^.])\.[^./]+$/, "");
  const uri = vscode.Uri.from({
    scheme: NORMALIZED_VIEW_SCHEME,
    path: `/${sourceNameWithoutExtension}.${fileTag}-${nextViewCounter(fileTag)}.log`,
  });

  provider.register(uri, content);

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
    const content = formatNormalizedWithGap(entries);

    await openVirtualNormalizedDocument(provider, sourceDocument, content, "normalized");
  };
}

/**
 * アクティブなエディタの内容を正規化し、ユーザーがチェックボックス的に選択した
 * セベリティのエントリだけを読み取り専用の仮想ドキュメントとして開くコマンド。
 */
export function createShowNormalizedViewFilteredBySeverityCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedViewFilteredBySeverity(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("絞り込む");
    if (!sourceDocument) {
      return;
    }

    const entries = parseSourceLog(sourceDocument);

    const selectedSeverities = await promptSeveritySelection(entries);
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedSeverities === undefined) {
      return;
    }

    const filteredEntries = filterEntriesBySeverity(entries, selectedSeverities);
    const content = formatNormalizedWithGap(filteredEntries);

    await openVirtualNormalizedDocument(provider, sourceDocument, content, "severity-filtered");
  };
}

/**
 * アクティブなエディタの内容を正規化し、ユーザーが指定した開始・終了日時の
 * 範囲に含まれるエントリだけを読み取り専用の仮想ドキュメントとして開くコマンド。
 * 範囲外として非表示にした行数は、開いた直後に通知として表示する。
 */
export function createShowNormalizedViewFilteredByDateRangeCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedViewFilteredByDateRange(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("絞り込む");
    if (!sourceDocument) {
      return;
    }

    const startMs = await promptDateBoundary("開始日時", "start");
    // null はキャンセル、または不正な入力による中断を表す。
    if (startMs === null) {
      return;
    }

    const endMs = await promptDateBoundary("終了日時", "end");
    if (endMs === null) {
      return;
    }

    const entries = parseSourceLog(sourceDocument);
    const filteredEntries = filterEntriesByDateRange(entries, { startMs, endMs });
    const content = formatNormalizedWithGap(filteredEntries);

    await openVirtualNormalizedDocument(provider, sourceDocument, content, "date-range-filtered");

    reportHiddenLineCount("指定範囲外の", entries, filteredEntries);
  };
}

/**
 * アクティブなエディタの内容を正規化し、ユーザーが選択したセベリティと指定した
 * 日時範囲の両方の条件を満たすエントリだけを読み取り専用の仮想ドキュメントとして
 * 開くコマンド。セベリティ絞り込みと日付範囲絞り込みを個別に持つ既存コマンドを
 * 組み合わせて同時に適用したい場合に使う。範囲外・対象外として非表示にした行数は、
 * 開いた直後に通知として表示する。
 */
export function createShowNormalizedViewFilteredByDateRangeAndSeverityCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedViewFilteredByDateRangeAndSeverity(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("絞り込む");
    if (!sourceDocument) {
      return;
    }

    const entries = parseSourceLog(sourceDocument);

    const selectedSeverities = await promptSeveritySelection(entries);
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedSeverities === undefined) {
      return;
    }

    const startMs = await promptDateBoundary("開始日時", "start");
    // null はキャンセル、または不正な入力による中断を表す。
    if (startMs === null) {
      return;
    }

    const endMs = await promptDateBoundary("終了日時", "end");
    if (endMs === null) {
      return;
    }

    // 独立した2つの絞り込み関数を順に適用するだけで、両条件の積（AND）が得られる。
    const filteredEntries = filterEntriesByDateRange(
      filterEntriesBySeverity(entries, selectedSeverities),
      { startMs, endMs }
    );
    const content = formatNormalizedWithGap(filteredEntries);

    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "date-range-severity-filtered"
    );

    reportHiddenLineCount("条件に合わない", entries, filteredEntries);
  };
}

/**
 * アクティブなエディタの内容を正規化し、ユーザーが入力した正規表現パターンに
 * マッチするエントリを非表示にした読み取り専用の仮想ドキュメントとして開く
 * コマンド。非表示にした行数は、開いた直後に通知として表示する。
 */
export function createShowNormalizedViewFilteredByIgnorePatternCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showNormalizedViewFilteredByIgnorePattern(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("絞り込む");
    if (!sourceDocument) {
      return;
    }

    const pattern = await promptIgnorePattern();
    // ユーザーがキャンセルした場合、または不正な入力による中断の場合は何もしない。
    if (pattern === undefined) {
      return;
    }

    const entries = parseSourceLog(sourceDocument);
    const filterResult = await filterEntriesByIgnorePattern(entries, pattern);
    if (!filterResult.ok) {
      // 破局的バックトラッキング等でマッチング処理がタイムアウトした場合。
      // 「フィルタなしで全件表示」にフォールバックすると、ユーザーが意図
      // しない大量表示につながりうるため、何もせず警告のみ出す。
      vscode.window.showWarningMessage(
        "Totonoe Log: 入力されたパターンの処理に時間がかかりすぎたため中断しました。より単純なパターンをお試しください。"
      );
      return;
    }
    const filteredEntries = filterResult.entries;
    const content = formatNormalizedWithGap(filteredEntries);

    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "ignore-pattern-filtered"
    );

    reportHiddenLineCount("パターンに一致したエントリの", entries, filteredEntries);
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
    const content = formatNormalizedWithGap(filteredEntries);

    await openVirtualNormalizedDocument(provider, sourceDocument, content, "filtered");

    reportHiddenLineCount("条件に合わない", entries, filteredEntries);
  };
}

/** 折りたたみのしきい値を読み込むVSCode設定のセクション名。 */
const COLLAPSE_CONFIG_SECTION = "totonoeLog.collapse";

/**
 * アクティブなエディタの内容を正規化し、連続して繰り返される（可変部分を
 * 除いて一致する）エントリを「×N」付きの1行にまとめた、読み取り専用の
 * 仮想ドキュメントとして開くコマンド。折りたたみのしきい値は
 * `totonoeLog.collapse.threshold` 設定で調整できる。元の全行を確認したい
 * 場合は、折りたたまれていない通常の正規化ビュー（`showNormalizedView`）を
 * 別途開けばよい。
 */
export function createShowCollapsedViewCommand(
  provider: NormalizedViewContentProvider
): () => Promise<void> {
  return async function showCollapsedView(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("折りたたむ");
    if (!sourceDocument) {
      return;
    }

    const threshold = vscode.workspace
      .getConfiguration(COLLAPSE_CONFIG_SECTION)
      .get<number>("threshold", DEFAULT_COLLAPSE_THRESHOLD);

    const entries = parseSourceLog(sourceDocument);
    const items = collapseRepeatedEntries(entries, { threshold });
    const content = formatCollapsedLog(entries, items, {
      displayTimezone: readDisplayTimezone(),
    });

    await openVirtualNormalizedDocument(provider, sourceDocument, content, "collapsed");
  };
}
