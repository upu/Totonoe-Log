import { getDefaultTimestampFormats } from "./timestampFormats";
import type { LogEntry, TimestampFormat } from "./types";

/**
 * Recognized severity/level tokens, ordered roughly by increasing severity.
 * Matching is case-insensitive; "WARNING" is normalized to "WARN".
 */
const SEVERITY_TOKENS = ["TRACE", "DEBUG", "INFO", "WARNING", "WARN", "ERROR", "FATAL", "CRITICAL"];

const SEVERITY_REGEX = new RegExp(
  `^[\\s\\-:|]*\\[?(${SEVERITY_TOKENS.join("|")})\\]?[\\s\\-:|]*`,
  "i"
);

function normalizeSeverity(token: string): string {
  const upper = token.toUpperCase();
  return upper === "WARNING" ? "WARN" : upper;
}

export interface ParseLogOptions {
  /**
   * Timestamp formats to try, in order, for each physical line. Defaults to
   * {@link getDefaultTimestampFormats}. Pass a custom list to support
   * additional formats without touching this module (the parser is
   * pluggable by design).
   */
  readonly timestampFormats?: readonly TimestampFormat[];
}

interface MutableEntry {
  timestampMs: number | undefined;
  rawTimestamp: string | undefined;
  timestampFormat: string | undefined;
  severity: string | undefined;
  firstLineMessage: string | undefined;
  lines: string[];
  matched: boolean;
}

function finalizeEntry(entry: MutableEntry): LogEntry {
  const continuationLines = entry.lines.slice(1);
  const message = [entry.firstLineMessage ?? entry.lines[0], ...continuationLines].join("\n");
  return {
    timestampMs: entry.timestampMs,
    rawTimestamp: entry.rawTimestamp,
    timestampFormat: entry.timestampFormat,
    severity: entry.severity,
    message,
    lines: entry.lines,
    raw: entry.lines.join("\n"),
    matched: entry.matched,
  };
}

/**
 * Splits raw, possibly messy log text into a common, normalized structure
 * (see {@link LogEntry}). This is the foundation every other Totonoe Log
 * feature (filtering, merging, collapsing, comparing) builds on top of.
 *
 * Lines that begin with a recognized timestamp start a new entry. Any other
 * line (e.g. a stack trace frame) is treated as a continuation of the
 * previous entry, so multi-line log records stay grouped together. Lines
 * that appear before any recognized timestamp — or an entire log with no
 * recognized timestamps at all — are still kept, grouped into "unknown"
 * entries with `matched: false`; nothing is ever silently dropped.
 */
export function parseLog(text: string, options: ParseLogOptions = {}): LogEntry[] {
  const timestampFormats = options.timestampFormats ?? getDefaultTimestampFormats();
  const lines = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);

  const entries: LogEntry[] = [];
  let current: MutableEntry | undefined;

  for (const line of lines) {
    let matchedFormat: TimestampFormat | undefined;
    let match: RegExpExecArray | undefined;
    let timestampMs: number | undefined;

    for (const format of timestampFormats) {
      const candidate = format.regex.exec(line);
      if (candidate && candidate.index === 0) {
        const epochMs = format.parse(candidate);
        if (epochMs !== undefined) {
          matchedFormat = format;
          match = candidate;
          timestampMs = epochMs;
          break;
        }
      }
    }

    if (matchedFormat && match) {
      if (current) {
        entries.push(finalizeEntry(current));
      }

      const remainderAfterTimestamp = line.slice(match[0].length);
      const severityMatch = SEVERITY_REGEX.exec(remainderAfterTimestamp);
      const severity = severityMatch ? normalizeSeverity(severityMatch[1]) : undefined;
      const remainderAfterSeverity = severityMatch
        ? remainderAfterTimestamp.slice(severityMatch[0].length)
        : remainderAfterTimestamp.replace(/^[\s\-:|]+/, "");

      current = {
        timestampMs,
        rawTimestamp: match[0],
        timestampFormat: matchedFormat.name,
        severity,
        firstLineMessage: remainderAfterSeverity,
        lines: [line],
        matched: true,
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = {
        timestampMs: undefined,
        rawTimestamp: undefined,
        timestampFormat: undefined,
        severity: undefined,
        firstLineMessage: undefined,
        lines: [line],
        matched: false,
      };
    }
  }

  if (current) {
    entries.push(finalizeEntry(current));
  }

  return entries;
}
