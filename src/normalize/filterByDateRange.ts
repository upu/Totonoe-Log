import type { LogEntry } from "./types";
import type { DisplayTimezone } from "./timezone";

/**
 * 日付範囲の境界を開始境界として使うか終了境界として使うかの区別。
 * 時刻を省略した日付のみの入力を補完する際、開始境界なら「その日の
 * 始まり」（`00:00:00.000`）、終了境界なら「その日の終わり」
 * （`23:59:59.999`）に補完する（issue #93）。時刻を明示した入力には
 * 影響しない。
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

  let hour = 0;
  let minute = 0;
  let second = 0;
  let millisecond = 0;
  if (match[4] === undefined) {
    if (boundaryKind === "end") {
      hour = 23;
      minute = 59;
      second = 59;
      millisecond = 999;
    }
  } else {
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = match[6] === undefined ? 0 : Number(match[6]);
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
    hour,
    minute,
    second,
    millisecond,
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
 * 時刻を省略した場合、`boundaryKind` に応じて開始境界なら
 * `00:00:00.000`、終了境界なら `23:59:59.999` を補う（終了境界に開始境界
 * と同じ `00:00:00` を補うと、その日のエントリが `timestampMs > endMs`
 * の判定でほぼ除外されてしまうため）。
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
