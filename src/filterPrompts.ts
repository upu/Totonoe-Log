import * as vscode from "vscode";
import {
  getDistinctSeverities,
  parseDateBoundary,
  UNRECOGNIZED_SEVERITY_KEY,
  type DateBoundaryKind,
  type DisplayTimezone,
  type FilterCriteria,
  type LogEntry,
} from "./normalize";

/**
 * セベリティ・日付範囲・無視パターンの各絞り込み条件を尋ねる QuickPick /
 * InputBox のプロンプト群。正規化ビュー（`normalizedView.ts`）とマージビュー
 * （`mergedView.ts`）の両方が同じ条件指定 UI を共有するため、VSCode API に
 * 依存するこの層に切り出している（issue #61 で正規化ビュー専用だったものを
 * マージビューでも再利用するために抽出した）。
 */

interface SeverityQuickPickItem extends vscode.QuickPickItem {
  readonly severityValue: string;
}

/**
 * エントリ群に登場するセベリティをチェックボックス的なピッカーで尋ね、
 * ユーザーが選んだセベリティ集合を返す。Esc 等でキャンセルした場合は、
 * 呼び出し側に処理を中断させるため `undefined` を返す。
 */
export async function promptSeveritySelection(
  entries: readonly LogEntry[]
): Promise<Set<string> | undefined> {
  const distinctSeverities = getDistinctSeverities(entries);

  const items: SeverityQuickPickItem[] = distinctSeverities.map((severity) => ({
    label: severity === UNRECOGNIZED_SEVERITY_KEY ? vscode.l10n.t("(no severity)") : severity,
    severityValue: severity,
    picked: true,
  }));

  const selectedItems = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: vscode.l10n.t("Select severities to display"),
  });

  if (selectedItems === undefined) {
    return undefined;
  }

  return new Set(selectedItems.map((item) => item.severityValue));
}

/**
 * 日付範囲の境界（開始・終了いずれか）を入力ボックスで尋ねる。
 * 入力を空のまま確定した場合は「境界なし」を表す `undefined` を返す。
 * Esc 等でのキャンセル、および日時を解釈できない不正な入力の場合は、
 * どちらも呼び出し側に処理を中断させるため `null` を返す。
 *
 * `boundaryKind` は省略された下位単位の補完先を決める（開始境界なら
 * その単位の始まり、終了境界なら書かれた最小単位の末尾。issue #93 / #296）。
 * プロンプトの説明文にもその補完先を明記し、ユーザーが挙動を予測できる
 * ようにする。
 */
export async function promptDateBoundary(
  boundaryKind: DateBoundaryKind,
  displayTimezone: DisplayTimezone
): Promise<number | undefined | null> {
  const timezoneHint =
    displayTimezone === "local"
      ? vscode.l10n.t("local (this machine's local time)")
      : displayTimezone === 0
        ? "UTC"
        : formatOffset(displayTimezone);
  const prompt =
    boundaryKind === "end"
      ? vscode.l10n.t(
          "Enter the end date and time (based on display timezone {0}; YYYY-MM-DD or YYYY-MM-DD HH:mm[:ss]; optional; inclusive through the end of the smallest unit given, so 2024-01-02 means 23:59:59.999 and 2024-01-02 10:30 means 10:30:59.999)",
          timezoneHint
        )
      : vscode.l10n.t(
          "Enter the start date and time (based on display timezone {0}; YYYY-MM-DD or YYYY-MM-DD HH:mm[:ss]; optional; a date without a time uses 00:00:00.000)",
          timezoneHint
        );
  const input = await vscode.window.showInputBox({
    prompt,
    placeHolder: vscode.l10n.t("Example: 2024-01-02 or 2024-01-02T03:04:05"),
  });

  if (input === undefined) {
    return null;
  }
  if (input.trim() === "") {
    return undefined;
  }

  const boundaryMs = parseDateBoundary(input, boundaryKind, displayTimezone);
  if (boundaryMs === undefined) {
    vscode.window.showWarningMessage(
      vscode.l10n.t('Totonoe Log: Could not parse the date and time: "{0}".', input)
    );
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
    prompt: vscode.l10n.t(
      "Enter a pattern for lines to hide (interpreted as a regular expression; case-insensitive)"
    ),
    placeHolder: vscode.l10n.t("Example: heartbeat or ^DEBUG"),
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
      vscode.l10n.t(
        'Totonoe Log: Could not parse "{0}" as a regular expression ({1})',
        trimmedInput,
        reason
      )
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
    { label: vscode.l10n.t("Severity"), filterKind: "severity" },
    { label: vscode.l10n.t("Date Range"), filterKind: "dateRange" },
    { label: vscode.l10n.t("Ignore Pattern"), filterKind: "ignorePattern" },
  ];

  const selectedItems = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: vscode.l10n.t("Select filter criteria (multiple selections allowed)"),
  });

  if (selectedItems === undefined) {
    return undefined;
  }

  return new Set(selectedItems.map((item) => item.filterKind));
}

/**
 * {@link promptFilterKinds} で選ばれた条件について、対応するプロンプトを
 * 決まった順（セベリティ → 日付範囲 → 無視パターン）で尋ね、
 * `filterEntriesByCriteria` にそのまま渡せる {@link FilterCriteria} を組み立てる。
 * どれか1つでもキャンセル・不正入力で中断した場合は、呼び出し側にコマンド全体を
 * 中断させるため `undefined` を返す（何も選ばれていない場合はキャンセルではなく、
 * どの条件も持たない criteria を返す）。
 *
 * 正規化ビュー（`normalizedView.ts`）とマージビュー（`mergedView.ts`）が同じ
 * 組み合わせ・同じ中断判定を各コマンドに複製していたため、条件の追加や中断方針の
 * 変更で片方だけ直すリスクがあった。それを一箇所へ寄せる（issue #221）。
 *
 * 条件選択（{@link promptFilterKinds}）自体を含めず選択済みの集合を受け取るのは、
 * 呼び出し側でピッカー確定後に初めてログをパースする現在の順序（正規化ビュー）を
 * 変えないため。エントリを引数で受け取る形にすると、パースとそれに伴う認識率警告
 * （issue #101）がピッカーより前に出てしまう。
 */
export async function promptFilterCriteriaForKinds(
  selectedKinds: ReadonlySet<FilterKind>,
  entries: readonly LogEntry[],
  displayTimezone: DisplayTimezone
): Promise<FilterCriteria | undefined> {
  let severities: Set<string> | undefined;
  if (selectedKinds.has("severity")) {
    severities = await promptSeveritySelection(entries);
    if (severities === undefined) {
      return undefined;
    }
  }

  let dateRange: FilterCriteria["dateRange"];
  if (selectedKinds.has("dateRange")) {
    const startMs = await promptDateBoundary("start", displayTimezone);
    // null はキャンセル、または不正な入力による中断を表す。
    if (startMs === null) {
      return undefined;
    }

    const endMs = await promptDateBoundary("end", displayTimezone);
    if (endMs === null) {
      return undefined;
    }

    // 境界が1つも入力されていないなら、日付条件そのものを付けない（issue #231）。
    // `filterEntriesByDateRange` は DateRange が指定されているだけでタイムスタンプ
    // 未認識のエントリを除外するため、両端とも `undefined` の範囲を渡すと、
    // 日付では何も絞り込めていないのに未認識行だけが黙って消える。
    // Interactive View 側（`interactiveViewCriteria.ts`）の #220 と同じ方針。
    if (startMs !== undefined || endMs !== undefined) {
      dateRange = { startMs, endMs };
    }
  }

  let ignorePattern: RegExp | undefined;
  if (selectedKinds.has("ignorePattern")) {
    ignorePattern = await promptIgnorePattern();
    // ユーザーがキャンセルした場合、または不正な入力による中断の場合は何もしない。
    if (ignorePattern === undefined) {
      return undefined;
    }
  }

  // QuickPick 経路は1欄1パターンのまま（複数指定は Interactive View 限定、
  // issue #206 のスコープ外）。`FilterCriteria` 側が配列になったので包むだけ。
  return {
    severities,
    dateRange,
    ignorePatterns: ignorePattern !== undefined ? [ignorePattern] : undefined,
  };
}

/**
 * エントリ群が構成する物理行の総数を数える。1エントリは複数の物理行
 *（スタックトレース等の継続行）にまたがりうるため、単純な `entries.length`
 * ではなく `lines.length` の合計を使う必要がある。
 */
export function countLines(entries: readonly LogEntry[]): number {
  return entries.reduce((total, entry) => total + entry.lines.length, 0);
}
