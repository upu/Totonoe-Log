import {
  parseDateBoundary,
  type DateRange,
  type DisplayTimezone,
  type FilterCriteria,
} from "./normalize";
import type { SerializedFilterCriteria } from "./webview/interactiveView/protocol";

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
  const ignorePattern = compileIgnorePattern(serialized.ignorePattern, errors);

  return { criteria: { severities, dateRange, ignorePattern }, errors };
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

function compileIgnorePattern(input: string, errors: string[]): RegExp | undefined {
  const trimmedInput = input.trim();
  if (trimmedInput === "") {
    return undefined;
  }

  try {
    return new RegExp(trimmedInput, "im");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`正規表現として解釈できませんでした: "${trimmedInput}"（${reason}）`);
    return undefined;
  }
}
