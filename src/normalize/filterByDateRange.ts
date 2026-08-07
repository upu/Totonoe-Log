import type { LogEntry } from "./types";
import type { DisplayTimezone } from "./timezone";

/**
 * 日付範囲の境界を開始境界として使うか終了境界として使うかの区別。
 * 入力で省略された下位の時刻単位を補完する際、開始境界ならすべて 0
 * （その単位の始まり）、終了境界なら最大値（その単位の終わり）に
 * 補完する（issue #93 / #296）。
 */
export type DateBoundaryKind = "start" | "end";

interface DateBoundaryParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

function isValidBoundaryTime(parts: DateBoundaryParts): boolean {
  return parts.hour <= 23 && parts.minute <= 59 && parts.second <= 59;
}

function parseDateBoundaryParts(
  input: string,
  boundaryKind: DateBoundaryKind
): DateBoundaryParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    input.trim()
  );
  if (!match) {
    return undefined;
  }

  const captures: readonly (string | undefined)[] = match;
  // 終了境界は、書かれていない下位単位を最大値で埋めて「書かれた最小単位の
  // 末尾まで」を含める。ミリ秒は入力の文法上そもそも書けないため、終了境界
  // では常に 999 になる。
  const fillsToUnitEnd = boundaryKind === "end";
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
    hour: captures[4] === undefined ? (fillsToUnitEnd ? 23 : 0) : Number(captures[4]),
    minute: captures[5] === undefined ? (fillsToUnitEnd ? 59 : 0) : Number(captures[5]),
    second: captures[6] === undefined ? (fillsToUnitEnd ? 59 : 0) : Number(captures[6]),
    millisecond: fillsToUnitEnd ? 999 : 0,
  };
  if (!isValidBoundaryTime(parts)) {
    return undefined;
  }
  return parts;
}

function isSameLocalBoundary(check: Date, parts: DateBoundaryParts): boolean {
  return (
    check.getFullYear() === parts.year &&
    check.getMonth() === parts.month &&
    check.getDate() === parts.day &&
    check.getHours() === parts.hour &&
    check.getMinutes() === parts.minute &&
    check.getSeconds() === parts.second &&
    check.getMilliseconds() === parts.millisecond
  );
}

function localBoundaryToEpochMs(parts: DateBoundaryParts): number | undefined {
  const epochMs = new Date(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  ).getTime();
  return isSameLocalBoundary(new Date(epochMs), parts) ? epochMs : undefined;
}

function isSameUtcDate(check: Date, parts: DateBoundaryParts): boolean {
  return (
    check.getUTCFullYear() === parts.year &&
    check.getUTCMonth() === parts.month &&
    check.getUTCDate() === parts.day
  );
}

function fixedOffsetBoundaryToEpochMs(
  parts: DateBoundaryParts,
  displayTimezone: number
): number | undefined {
  const wallClockMs = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  // Date.UTC は範囲外の日付を繰り上げるため、オフセット適用前に拒否する。
  if (!isSameUtcDate(new Date(wallClockMs), parts)) {
    return undefined;
  }
  return wallClockMs - displayTimezone * 60 * 1000;
}

/**
 * 日付範囲の境界（開始・終了いずれか一方）として使う入力文字列を解析する。
 *
 * `YYYY-MM-DD` または `YYYY-MM-DD HH:mm[:ss]`（`T` 区切りも可）を受け付ける。
 * タイムゾーン表記は持たず、`displayTimezone` の壁時計時刻として解釈する。
 * 省略された下位単位は `boundaryKind` に応じて補い、開始境界はすべて 0、
 * 終了境界は書かれた最小単位の末尾（`2024-01-02` なら `23:59:59.999`、
 * `2024-01-02 10:30` なら `10:30:59.999`）とする。終了境界に開始境界と
 * 同じ下位単位 0 を補うと、その単位のエントリが `timestampMs > endMs` の
 * 判定でほぼ除外されてしまうため（issue #93 / #296）。
 *
 * `"local"` の DST 境界では、存在しない壁時計時刻は `undefined` を返す。
 * 2回現れる壁時計時刻は JavaScript `Date` の互換動作に合わせ、早い側の
 * インスタントを選ぶ。UTC表示時は既定値 `0` により従来の解釈を維持する。
 * 形式に一致しない、または存在しない日付（例: 2024-02-30）の場合は
 * `undefined` を返す。
 */
export function parseDateBoundary(
  input: string,
  boundaryKind: DateBoundaryKind,
  displayTimezone: DisplayTimezone = 0
): number | undefined {
  const parts = parseDateBoundaryParts(input, boundaryKind);
  if (parts === undefined) {
    return undefined;
  }
  if (displayTimezone === "local") {
    return localBoundaryToEpochMs(parts);
  }
  return fixedOffsetBoundaryToEpochMs(parts, displayTimezone);
}

/** {@link filterEntriesByDateRange} の絞り込み範囲。両端とも省略可能（片側のみの指定を許す）。 */
export interface DateRange {
  /** この時刻（含む）以降のエントリだけを残す。省略時は下限なし。 */
  readonly startMs?: number;
  /** この時刻（含む）以前のエントリだけを残す。省略時は上限なし。 */
  readonly endMs?: number;
}

/**
 * 指定した日付範囲に含まれるエントリだけを残す。
 *
 * タイムスタンプを認識できなかったエントリ（`timestampMs === undefined`）は
 * 範囲に含まれるかどうか判定できないため、常に範囲外（非表示）として扱う。
 */
export function filterEntriesByDateRange(
  entries: readonly LogEntry[],
  range: DateRange
): LogEntry[] {
  return entries.filter((entry) => {
    if (entry.timestampMs === undefined) {
      return false;
    }
    if (range.startMs !== undefined && entry.timestampMs < range.startMs) {
      return false;
    }
    if (range.endMs !== undefined && entry.timestampMs > range.endMs) {
      return false;
    }
    return true;
  });
}
