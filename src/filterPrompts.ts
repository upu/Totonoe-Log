import * as vscode from "vscode";
import {
  getDistinctSeverities,
  parseDateBoundary,
  UNRECOGNIZED_SEVERITY_KEY,
  type DateBoundaryKind,
  type DisplayTimezone,
  type LogEntry,
} from "./normalize";

/**
 * セベリティ・日付範囲・無視パターンの各絞り込み条件を尋ねる QuickPick /
 * InputBox のプロンプト群。正規化ビュー（`normalizedView.ts`）とマージビュー
 * （`mergedView.ts`）の両方が同じ条件指定 UI を共有するため、VSCode API に
 * 依存するこの層に切り出している（issue #61 で正規化ビュー専用だったものを
 * マージビューでも再利用するために抽出した）。
 */

/** セベリティ選択ピッカーで、セベリティ未認識のエントリを表す選択肢のラベル。 */
const UNRECOGNIZED_SEVERITY_LABEL = "(no severity)";

/**
 * エントリ群に登場するセベリティをチェックボックス的なピッカーで尋ね、
 * ユーザーが選んだセベリティ集合を返す。Esc 等でキャンセルした場合は、
 * 呼び出し側に処理を中断させるため `undefined` を返す。
 */
export async function promptSeveritySelection(
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
 * 日付範囲の境界（開始・終了いずれか）を入力ボックスで尋ねる。
 * 入力を空のまま確定した場合は「境界なし」を表す `undefined` を返す。
 * Esc 等でのキャンセル、および日時を解釈できない不正な入力の場合は、
 * どちらも呼び出し側に処理を中断させるため `null` を返す。
 *
 * `boundaryKind` は時刻を省略した日付のみの入力の補完先を決める
 * （開始境界なら当日の始まり、終了境界なら当日の終わり。issue #93）。
 * プロンプトの説明文にもその補完先を明記し、ユーザーが挙動を予測できる
 * ようにする。
 */
export async function promptDateBoundary(
  promptLabel: string,
  boundaryKind: DateBoundaryKind,
  displayTimezone: DisplayTimezone
): Promise<number | undefined | null> {
  const timeHint = boundaryKind === "end" ? "終了 → 23:59:59.999" : "開始 → 00:00:00.000";
  const timezoneHint =
    displayTimezone === "local"
      ? "local（このマシンのローカル時刻）"
      : displayTimezone === 0
        ? "UTC"
        : formatOffset(displayTimezone);
  const input = await vscode.window.showInputBox({
    prompt: `${promptLabel}（表示タイムゾーン ${timezoneHint} 基準。YYYY-MM-DD、または YYYY-MM-DD HH:mm[:ss]。省略可。時刻省略時は${timeHint}に補完）`,
    placeHolder: "例: 2024-01-02 or 2024-01-02T03:04:05",
  });

  if (input === undefined) {
    return null;
  }
  if (input.trim() === "") {
    return undefined;
  }

  const boundaryMs = parseDateBoundary(input, boundaryKind, displayTimezone);
  if (boundaryMs === undefined) {
    vscode.window.showWarningMessage(`Totonoe Log: 日時を解釈できませんでした: "${input}"`);
    return null;
  }

  return boundaryMs;
}

/** 分単位の UTC オフセットを、設定と同じ `+09:00` 形式へ整形する。 */
function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

/**
 * 非表示にする行のパターンを入力ボックスで尋ね、コンパイル済みの正規表現を
 * 返す。入力は常に正規表現として解釈され、フラグは "im" 固定。`.` `*` `(`
 * 等のメタ文字を含まない入力は、結果として部分一致の検索と同じ挙動になる
 * が、メタ文字を含む文字列をそのまま検索したい場合は呼び出し側でエスケープ
 * する必要がある。Esc 等でのキャンセル、入力が空、および正規表現として
 * 解釈できない不正な入力の場合は、どれも呼び出し側に処理を中断させるため
 * `undefined` を返す。
 */
export async function promptIgnorePattern(): Promise<RegExp | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: "非表示にする行のパターン（正規表現として解釈されます。大文字小文字は区別しません）",
    placeHolder: "例: heartbeat または ^DEBUG",
  });

  const trimmedInput = input?.trim();
  if (!trimmedInput) {
    return undefined;
  }

  try {
    return new RegExp(trimmedInput, "im");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(
      `Totonoe Log: 正規表現として解釈できませんでした: "${trimmedInput}"（${reason}）`
    );
    return undefined;
  }
}

/**
 * 統合絞り込みコマンドで選べる条件の種類。
 * QuickPick の選択肢の順序（=表示順）としても使う。
 */
export type FilterKind = "severity" | "dateRange" | "ignorePattern";

/**
 * 条件選択 QuickPick の1項目。選ばれた {@link FilterKind} を保持する。
 * `vscode.QuickPickItem` には（セパレータ表示用の）`kind` プロパティが
 * 既に存在するため、名前を衝突させないよう `filterKind` にする。
 */
interface FilterKindQuickPickItem extends vscode.QuickPickItem {
  readonly filterKind: FilterKind;
}

/**
 * 絞り込みに使う条件（セベリティ / 日付範囲 / 無視パターン）を複数選択
 * ピッカーで尋ね、選ばれた種類の集合を返す。Esc 等でキャンセルした場合は、
 * 呼び出し側に処理を中断させるため `undefined` を返す。何も選ばずに確定した
 * 場合（キャンセルではない）は空集合を返し、呼び出し側はどの条件も適用せず
 * 絞り込みなしのビューを開く。
 */
export async function promptFilterKinds(): Promise<Set<FilterKind> | undefined> {
  const items: FilterKindQuickPickItem[] = [
    { label: "セベリティ", filterKind: "severity" },
    { label: "日付範囲", filterKind: "dateRange" },
    { label: "無視パターン", filterKind: "ignorePattern" },
  ];

  const selectedItems = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: "絞り込みに使う条件を選択してください（複数選択可）",
  });

  if (selectedItems === undefined) {
    return undefined;
  }

  return new Set(selectedItems.map((item) => item.filterKind));
}

/**
 * エントリ群が構成する物理行の総数を数える。1エントリは複数の物理行
 *（スタックトレース等の継続行）にまたがりうるため、単純な `entries.length`
 * ではなく `lines.length` の合計を使う必要がある。
 */
export function countLines(entries: readonly LogEntry[]): number {
  return entries.reduce((total, entry) => total + entry.lines.length, 0);
}
