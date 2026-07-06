import type { LogEntry } from "./types";

/**
 * 日付範囲の境界（開始・終了いずれか一方）として使う入力文字列を解析する。
 *
 * `YYYY-MM-DD` または `YYYY-MM-DD HH:mm[:ss]`（`T` 区切りも可）を受け付ける。
 * タイムゾーン表記は持たず、他のタイムスタンプ形式（{@link ISO_8601_FORMAT} 等）
 * と同様に常に UTC として解釈する。時刻を省略した場合は `00:00:00` を補う。
 * 形式に一致しない、または存在しない日付（例: 2024-02-30）の場合は
 * `undefined` を返す。
 */
export function parseDateBoundary(input: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    input.trim()
  );
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");

  // Date.UTC は時刻の範囲外値（24:00 や 03:60 等）も繰り上げてしまうため、
  // 日付だけでなく時刻の各要素も事前に範囲チェックし、不正な入力を
  // サイレントに受け入れないようにする。
  if (hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }

  const epochMs = Date.UTC(year, month, day, hour, minute, second);

  // Date.UTC は範囲外の値を繰り上げ処理するため（例: 2024-02-30 → 2024-03-01）、
  // 逆算して比較することで不正な日付をサイレントに受け入れないようにする。
  const check = new Date(epochMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }

  return epochMs;
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
