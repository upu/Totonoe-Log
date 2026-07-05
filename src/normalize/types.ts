/**
 * Common normalization model shared by every future Totonoe Log feature
 * (filtering, merging, collapsing, comparing). Diverse log formats are
 * parsed into this shape so downstream features never need to know about
 * the original, messy format.
 */

/**
 * A single log entry once normalized.
 *
 * A log "entry" may span multiple physical lines (e.g. a log line followed
 * by a Java stack trace). `raw` preserves the entry's full original text
 * (all of its lines, unmodified, joined with "\n") so nothing is ever lost.
 */
export interface LogEntry {
  /** Parsed timestamp in epoch milliseconds, or undefined if unrecognized/unparseable. */
  readonly timestampMs: number | undefined;
  /** The exact substring that was recognized as the timestamp, if any. */
  readonly rawTimestamp: string | undefined;
  /** Name of the TimestampFormat that matched this entry's timestamp, if any. */
  readonly timestampFormat: string | undefined;
  /** Severity/level (e.g. "ERROR", "WARN"), normalized to uppercase, if recognized. */
  readonly severity: string | undefined;
  /**
   * The entry's body text: the first line with the timestamp/severity
   * removed, plus any continuation lines appended below it.
   */
  readonly message: string;
  /** All original, unmodified physical lines that make up this entry. */
  readonly lines: readonly string[];
  /** `lines.join("\n")` — the entry's full original text. */
  readonly raw: string;
  /**
   * False when no timestamp format recognized the first line of this entry.
   * Such entries are still kept (never dropped) so information isn't lost;
   * they are simply treated as "unknown" lines/entries.
   */
  readonly matched: boolean;
}

/**
 * A pluggable, regex-based parser for one timestamp format.
 *
 * Implementations should anchor `regex` to the start of the line (`^`) so
 * that `parseLog` can reliably tell whether a physical line begins a new
 * entry or is a continuation line of the previous entry.
 */
export interface TimestampFormat {
  /** Unique, human-readable name (e.g. "iso8601", "syslog"). */
  readonly name: string;
  /** Anchored regular expression that matches a timestamp at the start of a line. */
  readonly regex: RegExp;
  /**
   * Converts a successful `regex` match into epoch milliseconds.
   * Return `undefined` if the matched text turns out not to be a valid
   * date/time (e.g. "Feb 30"), so the line can be treated as unmatched.
   */
  parse(match: RegExpExecArray): number | undefined;
}
