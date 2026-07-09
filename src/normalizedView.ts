import * as vscode from "vscode";
import {
  parseLog,
  formatNormalizedLog,
  getDistinctSeverities,
  filterEntriesBySeverity,
  UNRECOGNIZED_SEVERITY_KEY,
  parseDateBoundary,
  filterEntriesByDateRange,
  filterEntriesByIgnorePattern,
  collapseRepeatedEntries,
  formatCollapsedLog,
  DEFAULT_COLLAPSE_THRESHOLD,
  type LogEntry,
} from "./normalize";
import { VirtualDocumentContentProvider } from "./virtualDocumentContentProvider";

/** 正規化ビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const NORMALIZED_VIEW_SCHEME = "totonoe-log-normalized";

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
let collapsedViewCounter = 0;

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
    const entries = parseLog(sourceDocument.getText());
    const content = formatNormalizedLog(entries);

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

/** セベリティ選択ピッカーで、セベリティ未認識のエントリを表す選択肢のラベル。 */
const UNRECOGNIZED_SEVERITY_LABEL = "(no severity)";

/**
 * エントリ群に登場するセベリティをチェックボックス的なピッカーで尋ね、
 * ユーザーが選んだセベリティ集合を返す。Esc 等でキャンセルした場合は、
 * 呼び出し側に処理を中断させるため `undefined` を返す。
 */
async function promptSeveritySelection(
  entries: readonly LogEntry[]
): Promise<Set<string> | undefined> {
  const distinctSeverities = getDistinctSeverities(entries);

  const items: vscode.QuickPickItem[] = distinctSeverities.map((severity) => ({
    label: severity === UNRECOGNIZED_SEVERITY_KEY ? UNRECOGNIZED_SEVERITY_LABEL : severity,
    picked: true,
  }));

  const selectedItems = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: "表示するセベリティを選択してください",
  });

  if (selectedItems === undefined) {
    return undefined;
  }

  return new Set(
    selectedItems.map((item) =>
      item.label === UNRECOGNIZED_SEVERITY_LABEL ? UNRECOGNIZED_SEVERITY_KEY : item.label
    )
  );
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
    const entries = parseLog(sourceDocument.getText());

    const selectedSeverities = await promptSeveritySelection(entries);
    // ユーザーがピッカーを Esc 等でキャンセルした場合は何もしない。
    if (selectedSeverities === undefined) {
      return;
    }

    const filteredEntries = filterEntriesBySeverity(entries, selectedSeverities);
    const content = formatNormalizedLog(filteredEntries);

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
 * 日付範囲の境界（開始・終了いずれか）を入力ボックスで尋ねる。
 * 入力を空のまま確定した場合は「境界なし」を表す `undefined` を返す。
 * Esc 等でのキャンセル、および日時を解釈できない不正な入力の場合は、
 * どちらも呼び出し側に処理を中断させるため `null` を返す。
 */
async function promptDateBoundary(
  promptLabel: string
): Promise<number | undefined | null> {
  const input = await vscode.window.showInputBox({
    prompt: `${promptLabel}（YYYY-MM-DD、または YYYY-MM-DD HH:mm[:ss]。省略可）`,
    placeHolder: "例: 2024-01-02 or 2024-01-02T03:04:05",
  });

  if (input === undefined) {
    return null;
  }
  if (input.trim() === "") {
    return undefined;
  }

  const boundaryMs = parseDateBoundary(input);
  if (boundaryMs === undefined) {
    vscode.window.showWarningMessage(
      `Totonoe Log: 日時を解釈できませんでした: "${input}"`
    );
    return null;
  }

  return boundaryMs;
}

/**
 * エントリ群が構成する物理行の総数を数える。1エントリは複数の物理行
 *（スタックトレース等の継続行）にまたがりうるため、単純な `entries.length`
 * ではなく `lines.length` の合計を使う必要がある。
 */
function countLines(entries: readonly LogEntry[]): number {
  return entries.reduce((total, entry) => total + entry.lines.length, 0);
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
    const content = formatNormalizedLog(filteredEntries);

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
    const content = formatNormalizedLog(filteredEntries);

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
 * 非表示にする行のパターンを入力ボックスで尋ね、コンパイル済みの正規表現を
 * 返す。入力は常に正規表現として解釈する（`.` や `*` 等のメタ文字を含まない
 * プレーンな文字列は、結果として部分一致の検索になる）ため、メタ文字を
 * 含む文字列をそのまま検索したい場合は呼び出し側でエスケープする必要が
 * ある。Esc 等でのキャンセル、入力が空、および正規表現として解釈できない
 * 不正な入力の場合は、どれも呼び出し側に処理を中断させるため `undefined`
 * を返す。
 */
async function promptIgnorePattern(): Promise<RegExp | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: "非表示にする行のパターン（文字列または正規表現）",
    placeHolder: "例: heartbeat または ^DEBUG",
  });

  if (input === undefined || input.trim() === "") {
    return undefined;
  }

  try {
    return new RegExp(input, "im");
  } catch {
    vscode.window.showWarningMessage(
      `Totonoe Log: 正規表現として解釈できませんでした: "${input}"`
    );
    return undefined;
  }
}

/**
 * アクティブなエディタの内容を正規化し、ユーザーが入力したパターン
 * （文字列または正規表現）にマッチするエントリを非表示にした読み取り専用の
 * 仮想ドキュメントとして開くコマンド。非表示にした行数は、開いた直後に
 * 通知として表示する。
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

    const pattern = await promptIgnorePattern();
    // ユーザーがキャンセルした場合、または不正な入力による中断の場合は何もしない。
    if (pattern === undefined) {
      return;
    }

    const sourceDocument = activeEditor.document;
    const entries = parseLog(sourceDocument.getText());
    const filteredEntries = filterEntriesByIgnorePattern(entries, pattern);
    const content = formatNormalizedLog(filteredEntries);

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
      `Totonoe Log: パターンに一致する ${hiddenLineCount} 行を非表示にしました（${countLines(filteredEntries)}/${countLines(entries)} 行を表示）。`
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

    const threshold = vscode.workspace
      .getConfiguration(COLLAPSE_CONFIG_SECTION)
      .get<number>("threshold", DEFAULT_COLLAPSE_THRESHOLD);

    const sourceDocument = activeEditor.document;
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
