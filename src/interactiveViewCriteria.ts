import {
  getDistinctSeverities,
  parseDateBoundary,
  type DateRange,
  type DisplayTimezone,
  type FilterCriteria,
  type LogEntry,
  type MergedEntry,
} from "./normalize";
import type { SerializedFilterCriteria } from "./webview/interactiveView/protocol";

/**
 * 読み込み済みエントリのセベリティ一覧を返す。Interactive View は単一ファイル
 * 表示とマージ表示でエントリのキャッシュを持ち替えるため、「今使われている方」を
 * ここで吸収する（issue #200）——マージ表示中は単一ファイル側が空になるので、
 * そちらだけを見ていると全セベリティが未チェックのまま開いてしまい、ログが
 * 1行も表示されない。
 */
export function getLoadedDistinctSeverities(
  singleEntries: readonly LogEntry[],
  mergedEntries: readonly MergedEntry[]
): string[] {
  const entries =
    singleEntries.length > 0 ? singleEntries : mergedEntries.map((merged) => merged.entry);
  return getDistinctSeverities(entries);
}

/**
 * ファイル追加後のチェック済みセベリティを求める（issue #200）。追加によって
 * **新しく現れた**セベリティはチェック済みに足すが、追加前から存在していて
 * 外されているものは外したままにする——後者はユーザーが明示的に選んだ状態
 * なので尊重し、前者は「まだ選択の機会が無かった」ものとして既定のON側に寄せる
 * （初期状態が全ONであることと揃える）。
 */
export function addNewlyAppearedSeverities(
  checked: readonly string[],
  previousDistinct: readonly string[],
  nextDistinct: readonly string[]
): string[] {
  const known = new Set(previousDistinct);
  const alreadyChecked = new Set(checked);
  const newlyAppeared = nextDistinct.filter(
    (severity) => !known.has(severity) && !alreadyChecked.has(severity)
  );
  return [...checked, ...newlyAppeared];
}

/** {@link toFilterCriteria} の結果。 */
export interface ToFilterCriteriaResult {
  readonly criteria: FilterCriteria;
  /** 解釈できなかった入力があれば、その説明（日本語）を1件ずつ格納する。 */
  readonly errors: readonly string[];
}

/**
 * Webviewから届いたJSON化済みの絞り込み条件（{@link SerializedFilterCriteria}）を、
 * `filterEntriesByCriteria` にそのまま渡せる {@link FilterCriteria} へ変換する。
 *
 * QuickPick/InputBoxベースの既存プロンプト（`promptDateBoundary`・
 * `promptIgnorePattern`）と異なり、不正な入力があってもダイアログで
 * 中断させることはできない（Webviewはその場で再描画され続ける）。そのため
 * 不正な入力は該当条件だけを無視して `errors` に理由を積み、呼び出し側が
 * 警告として画面に表示する。
 *
 * 日付範囲は、開始・終了のどちらも空文字列の場合は絞り込み条件に含めない
 * （`dateRange` を `undefined` のままにする）。`filterEntriesByDateRange` は
 * `dateRange` が指定されているだけでタイムスタンプ未認識のエントリを除外する
 * ため、ユーザーが日付範囲を一切入力していない状態でそれらのエントリが
 * 消えてしまわないようにするため。
 */
export function toFilterCriteria(
  serialized: SerializedFilterCriteria,
  displayTimezone: DisplayTimezone
): ToFilterCriteriaResult {
  const errors: string[] = [];

  const severities = new Set(serialized.severities);

  const dateRange = parseDateRange(serialized, displayTimezone, errors);
  const matchPattern = compilePattern(serialized.matchPattern, "一致パターン", errors);
  const ignorePattern = compilePattern(serialized.ignorePattern, "無視パターン", errors);

  return { criteria: { severities, dateRange, matchPattern, ignorePattern }, errors };
}

function parseDateRange(
  serialized: SerializedFilterCriteria,
  displayTimezone: DisplayTimezone,
  errors: string[]
): DateRange | undefined {
  const startInput = serialized.dateRangeStart.trim();
  const endInput = serialized.dateRangeEnd.trim();
  if (startInput === "" && endInput === "") {
    return undefined;
  }

  let startMs: number | undefined;
  if (startInput !== "") {
    startMs = parseDateBoundary(startInput, "start", displayTimezone);
    if (startMs === undefined) {
      errors.push(`開始日時を解釈できませんでした: "${startInput}"`);
    }
  }

  let endMs: number | undefined;
  if (endInput !== "") {
    endMs = parseDateBoundary(endInput, "end", displayTimezone);
    if (endMs === undefined) {
      errors.push(`終了日時を解釈できませんでした: "${endInput}"`);
    }
  }

  return { startMs, endMs };
}

/**
 * パターン入力欄1つ分を `RegExp` にコンパイルする。一致パターンと無視パターンの
 * 2欄で解釈の規則を揃えるため（issue #182）、フラグも含めて共通の実装にする。
 * `"i"` で大文字小文字を無視し、`"m"` で `^` / `$` が複数行エントリの各行に
 * 当たるようにする。
 *
 * `label` はエラー文言に埋め込む欄の名前。入力欄が2つあるため、どちらの欄が
 * 不正なのかがユーザーに分かるようにする。
 */
function compilePattern(input: string, label: string, errors: string[]): RegExp | undefined {
  const trimmedInput = input.trim();
  if (trimmedInput === "") {
    return undefined;
  }

  try {
    return new RegExp(trimmedInput, "im");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`${label}を正規表現として解釈できませんでした: "${trimmedInput}"（${reason}）`);
    return undefined;
  }
}
