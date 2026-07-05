import type { TimestampFormat } from "./types";

/** Three-letter month abbreviations used by syslog-style timestamps. */
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
 * Converts the named capture groups shared by the ISO-8601-like formats
 * below into epoch milliseconds. Returns `undefined` for out-of-range
 * components (e.g. month 13) instead of silently producing a bogus date.
 *
 * When no timezone offset is present, the timestamp is treated as UTC.
 * This keeps parsing deterministic regardless of the host machine's local
 * timezone, which matters both for tests and for comparing logs collected
 * from different machines.
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

  // Date.UTC normalizes out-of-range fields (e.g. month 12 -> next year), so
  // round-trip and compare (before applying any timezone offset below) to
  // catch invalid dates like "2024-02-30" instead of silently accepting a
  // rolled-over one.
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
 * ISO 8601 / RFC 3339 style timestamps, e.g.:
 * - `2024-01-02T03:04:05.678Z`
 * - `2024-01-02 03:04:05,678` (log4j style, comma millis, no timezone)
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
 * ISO-8601-like timestamps wrapped in brackets, e.g. `[2024-01-02 03:04:05,678]`.
 * Common in log4j/logback-style logs.
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
 * Options for {@link createSyslogFormat}.
 */
export interface SyslogFormatOptions {
  /**
   * Calendar year to assume, since traditional syslog timestamps
   * (`MMM d HH:mm:ss`) don't include one. Defaults to the current year.
   */
  readonly assumedYear?: number;
}

/**
 * Traditional syslog timestamps without a year, e.g. `Jan  1 00:00:00`.
 * Since the year is missing from the format itself, it must be supplied
 * (defaults to the current year).
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
 * Returns the default set of built-in timestamp formats, tried in order.
 * Callers can pass additional/custom formats to `parseLog` alongside (or
 * instead of) these.
 */
export function getDefaultTimestampFormats(
  syslogOptions: SyslogFormatOptions = {}
): TimestampFormat[] {
  return [BRACKETED_ISO_8601_FORMAT, ISO_8601_FORMAT, createSyslogFormat(syslogOptions)];
}
