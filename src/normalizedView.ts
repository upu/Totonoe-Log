import * as vscode from "vscode";
import {
  parseLog,
  formatNormalizedLog,
  filterEntriesBySeverity,
  filterEntriesByDateRange,
  filterEntriesByIgnorePattern,
  filterEntriesByCriteria,
  collapseRepeatedEntries,
  formatCollapsedLog,
  DEFAULT_COLLAPSE_THRESHOLD,
  DEFAULT_GAP_THRESHOLD_SECONDS,
  type FilterCriteria,
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

let normalizedViewCounter = 0;
let severityFilteredViewCounter = 0;
let dateRangeFilteredViewCounter = 0;
let dateRangeAndSeverityFilteredViewCounter = 0;
let ignorePatternFilteredViewCounter = 0;
let combinedFilteredViewCounter = 0;
let collapsedViewCounter = 0;

/** 時間ギャップ検出のしきい値（秒）を読み込むVSCode設定のセクション名。 */
const GAP_CONFIG_SECTION = "totonoeLog.gap";

/**
 * `totonoeLog.gap.thresholdSeconds` 設定を読み込み、{@link formatNormalizedLog}
 * が受け取るミリ秒単位のしきい値に変換する。0以下を指定した場合は無効化を
 * 意味するため、そのまま {@link formatNormalizedLog} 側の「0以下なら挿入
 * しない」判定に委ねる。
 */
function readGapThresholdMs(): number {
  const thresholdSeconds = vscode.workspace
    .getConfiguration(GAP_CONFIG_SECTION)
    .get<number>("thresholdSeconds", DEFAULT_GAP_THRESHOLD_SECONDS);
  return thresholdSeconds * 1000;
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
  fileTag: string,
  counter: number
): Promise<void> {
  const sourceBaseName = sourceDocument.uri.path.split("/").pop() ?? "log";
  // 先頭のドット（`.env` などのドットファイル）は拡張子とみなさず、
  // 直前に別の文字がある最後の拡張子だけを除去する。
  const sourceNameWithoutExtension = sourceBaseName.replace(/(?<=[^.])\.[^./]+$/, "");
  const uri = vscode.Uri.from({
    scheme: NORMALIZED_VIEW_SCHEME,
    path: `/${sourceNameWithoutExtension}.${fileTag}-${counter}.log`,
  });

  provider.register(uri, content);

  const normalizedDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(normalizedDocument, { preview: false });
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 正規化するログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    if (guardAgainstVirtualDocumentSource(sourceDocument)) {
      return;
    }

    const entries = parseLog(sourceDocument.getText());
    const content = formatNormalizedLog(entries, { gapThresholdMs: readGapThresholdMs() });

    normalizedViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "normalized",
      normalizedViewCounter
    );
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    if (guardAgainstVirtualDocumentSource(sourceDocument)) {
      return;
    }

    const entries = parseLog(sourceDocument.getText());

    const selectedSeverities = await promptSeveritySelection(entries);
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedSeverities === undefined) {
      return;
    }

    const filteredEntries = filterEntriesBySeverity(entries, selectedSeverities);
    const content = formatNormalizedLog(filteredEntries, { gapThresholdMs: readGapThresholdMs() });

    severityFilteredViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "severity-filtered",
      severityFilteredViewCounter
    );
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むログファイルが開かれていません。"
      );
      return;
    }
    if (guardAgainstVirtualDocumentSource(activeEditor.document)) {
      return;
    }

    const startMs = await promptDateBoundary("開始日時");
    // null はキャンセル、または不正な入力による中断を表す。
    if (startMs === null) {
      return;
    }

    const endMs = await promptDateBoundary("終了日時");
    if (endMs === null) {
      return;
    }

    const sourceDocument = activeEditor.document;
    const entries = parseLog(sourceDocument.getText());
    const filteredEntries = filterEntriesByDateRange(entries, { startMs, endMs });
    const content = formatNormalizedLog(filteredEntries, { gapThresholdMs: readGapThresholdMs() });

    dateRangeFilteredViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "date-range-filtered",
      dateRangeFilteredViewCounter
    );

    const hiddenLineCount = countLines(entries) - countLines(filteredEntries);
    vscode.window.showInformationMessage(
      `Totonoe Log: 指定範囲外の ${hiddenLineCount} 行を非表示にしました（${countLines(filteredEntries)}/${countLines(entries)} 行を表示）。`
    );
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    if (guardAgainstVirtualDocumentSource(sourceDocument)) {
      return;
    }

    const entries = parseLog(sourceDocument.getText());

    const selectedSeverities = await promptSeveritySelection(entries);
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedSeverities === undefined) {
      return;
    }

    const startMs = await promptDateBoundary("開始日時");
    // null はキャンセル、または不正な入力による中断を表す。
    if (startMs === null) {
      return;
    }

    const endMs = await promptDateBoundary("終了日時");
    if (endMs === null) {
      return;
    }

    // 独立した2つの絞り込み関数を順に適用するだけで、両条件の積（AND）が得られる。
    const filteredEntries = filterEntriesByDateRange(
      filterEntriesBySeverity(entries, selectedSeverities),
      { startMs, endMs }
    );
    const content = formatNormalizedLog(filteredEntries, { gapThresholdMs: readGapThresholdMs() });

    dateRangeAndSeverityFilteredViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "date-range-severity-filtered",
      dateRangeAndSeverityFilteredViewCounter
    );

    const hiddenLineCount = countLines(entries) - countLines(filteredEntries);
    vscode.window.showInformationMessage(
      `Totonoe Log: 条件に合わない ${hiddenLineCount} 行を非表示にしました（${countLines(filteredEntries)}/${countLines(entries)} 行を表示）。`
    );
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むログファイルが開かれていません。"
      );
      return;
    }
    if (guardAgainstVirtualDocumentSource(activeEditor.document)) {
      return;
    }

    const pattern = await promptIgnorePattern();
    // ユーザーがキャンセルした場合、または不正な入力による中断の場合は何もしない。
    if (pattern === undefined) {
      return;
    }

    const sourceDocument = activeEditor.document;
    const entries = parseLog(sourceDocument.getText());
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
    const content = formatNormalizedLog(filteredEntries, { gapThresholdMs: readGapThresholdMs() });

    ignorePatternFilteredViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "ignore-pattern-filtered",
      ignorePatternFilteredViewCounter
    );

    const hiddenLineCount = countLines(entries) - countLines(filteredEntries);
    vscode.window.showInformationMessage(
      `Totonoe Log: パターンに一致したエントリの ${hiddenLineCount} 行を非表示にしました（${countLines(filteredEntries)}/${countLines(entries)} 行を表示）。`
    );
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    if (guardAgainstVirtualDocumentSource(sourceDocument)) {
      return;
    }

    const selectedKinds = await promptFilterKinds();
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedKinds === undefined) {
      return;
    }

    const entries = parseLog(sourceDocument.getText());

    let severities: Set<string> | undefined;
    if (selectedKinds.has("severity")) {
      severities = await promptSeveritySelection(entries);
      if (severities === undefined) {
        return;
      }
    }

    let dateRange: FilterCriteria["dateRange"];
    if (selectedKinds.has("dateRange")) {
      const startMs = await promptDateBoundary("開始日時");
      // null はキャンセル、または不正な入力による中断を表す。
      if (startMs === null) {
        return;
      }

      const endMs = await promptDateBoundary("終了日時");
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
    const content = formatNormalizedLog(filteredEntries, { gapThresholdMs: readGapThresholdMs() });

    combinedFilteredViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "filtered",
      combinedFilteredViewCounter
    );

    const hiddenLineCount = countLines(entries) - countLines(filteredEntries);
    vscode.window.showInformationMessage(
      `Totonoe Log: 条件に合わない ${hiddenLineCount} 行を非表示にしました（${countLines(filteredEntries)}/${countLines(entries)} 行を表示）。`
    );
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
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        "Totonoe Log: 折りたたむログファイルが開かれていません。"
      );
      return;
    }

    const sourceDocument = activeEditor.document;
    if (guardAgainstVirtualDocumentSource(sourceDocument)) {
      return;
    }

    const threshold = vscode.workspace
      .getConfiguration(COLLAPSE_CONFIG_SECTION)
      .get<number>("threshold", DEFAULT_COLLAPSE_THRESHOLD);

    const entries = parseLog(sourceDocument.getText());
    const items = collapseRepeatedEntries(entries, { threshold });
    const content = formatCollapsedLog(entries, items);

    collapsedViewCounter += 1;
    await openVirtualNormalizedDocument(
      provider,
      sourceDocument,
      content,
      "collapsed",
      collapsedViewCounter
    );
  };
}
