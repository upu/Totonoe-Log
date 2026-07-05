import type { TimestampFormat } from "./types";

/** syslog 形式のタイムスタンプで使う月の3文字略称。 */
const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * 以下の ISO 8601 系フォーマットが共有する名前付きキャプチャグループを
 * エポックミリ秒に変換する。範囲外の値（月が 13 など）は `undefined` を返し、
 * 不正な日付をサイレントに受け入れないようにする。
 *
 * タイムゾーンオフセットがない場合は UTC として扱う。これにより、ホスト
 * マシンのローカルタイムゾーンに関わらず解析結果が一定になる（テスト時や
 * 異なるマシンで収集したログを比較する際に重要）。
 */
function isoLikeGroupsToEpochMs(groups: Record<string, string | undefined>): number | undefined {
  const year = Number(groups.y);
  const month = Number(groups.mo) - 1;
  const day = Number(groups.d);
  const hour = Number(groups.h);
  const minute = Number(groups.mi);
  const second = Number(groups.s);
  const ms = groups.ms ? Number(groups.ms.padEnd(3, "0").slice(0, 3)) : 0;

  const epochMs = Date.UTC(year, month, day, hour, minute, second, ms);

  // Date.UTC は範囲外の値を繰り上げ処理するため（月12 → 翌年など）、
  // 逆算して比較することで "2024-02-30" のような不正日付を検出する。
  // タイムゾーンオフセット適用前に比較すること。
  const check = new Date(epochMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }

  if (groups.tzs) {
    const tzSign = groups.tzs === "-" ? -1 : 1;
    const tzHours = Number(groups.tzh);
    const tzMinutes = Number(groups.tzm ?? "0");
    return epochMs - tzSign * (tzHours * 60 + tzMinutes) * 60 * 1000;
  }

  return epochMs;
}

/**
 * ISO 8601 / RFC 3339 形式のタイムスタンプ。例:
 * - `2024-01-02T03:04:05.678Z`
 * - `2024-01-02 03:04:05,678`（log4j 形式、カンマミリ秒、タイムゾーンなし）
 * - `2024-01-02T03:04:05+09:00`
 */
export const ISO_8601_FORMAT: TimestampFormat = {
  name: "iso8601",
  regex:
    /^(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})[T ](?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,6}))?(?:Z|(?<tzs>[+-])(?<tzh>\d{2}):?(?<tzm>\d{2}))?/,
  parse(match) {
    return isoLikeGroupsToEpochMs(match.groups ?? {});
  },
};

/**
 * 角括弧で囲まれた ISO 8601 系タイムスタンプ。例: `[2024-01-02 03:04:05,678]`。
 * log4j / logback 系ログでよく見られる形式。
 */
export const BRACKETED_ISO_8601_FORMAT: TimestampFormat = {
  name: "bracketed-iso8601",
  regex:
    /^\[(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})[T ](?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,6}))?(?:Z|(?<tzs>[+-])(?<tzh>\d{2}):?(?<tzm>\d{2}))?\]/,
  parse(match) {
    return isoLikeGroupsToEpochMs(match.groups ?? {});
  },
};

/**
 * {@link createSyslogFormat} のオプション。
 */
export interface SyslogFormatOptions {
  /**
   * 年を省略している従来の syslog タイムスタンプ（`MMM d HH:mm:ss`）に
   * 補完する暦年。省略時は現在の年を使う。
   */
  readonly assumedYear?: number;
}

/**
 * 年を含まない従来の syslog タイムスタンプ。例: `Jan  1 00:00:00`。
 * フォーマット自体に年がないため、呼び出し側が補完する必要がある
 *（省略時は現在の年）。
 */
export function createSyslogFormat(options: SyslogFormatOptions = {}): TimestampFormat {
  const assumedYear = options.assumedYear ?? new Date().getFullYear();
  return {
    name: "syslog",
    regex: /^(?<mon>[A-Za-z]{3})\s+(?<d>\d{1,2})\s(?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})/,
    parse(match) {
      const groups = match.groups ?? {};
      const month = MONTH_ABBREVIATIONS[(groups.mon ?? "").toLowerCase()];
      if (month === undefined) {
        return undefined;
      }
      return isoLikeGroupsToEpochMs({
        y: String(assumedYear),
        mo: String(month + 1).padStart(2, "0"),
        d: groups.d,
        h: groups.h,
        mi: groups.mi,
        s: groups.s,
      });
    },
  };
}

/**
 * デフォルトの組み込みタイムスタンプフォーマット一覧を返す（試行順）。
 * 追加 / カスタムフォーマットは `parseLog` に直接渡すことができる。
 */
export function getDefaultTimestampFormats(
  syslogOptions: SyslogFormatOptions = {}
): TimestampFormat[] {
  return [BRACKETED_ISO_8601_FORMAT, ISO_8601_FORMAT, createSyslogFormat(syslogOptions)];
}
