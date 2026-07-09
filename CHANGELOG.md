# Changelog

All notable changes to the "Totonoe Log" extension will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add the "Totonoe Log: Show Normalized View Filtered by Ignore Pattern"
  command (`totonoeLog.showNormalizedViewFilteredByIgnorePattern`), which
  prompts for a pattern — always compiled as a regular expression (plain text
  without special regex characters works as a literal substring search) —
  and opens a normalized view with every entry that matches it hidden —
  useful for cutting noisy, irrelevant lines (e.g. heartbeats) out of the way
  while investigating. Matching is checked against an entry's full raw text,
  so a match on any line of a multi-line entry (e.g. a stack trace) hides the
  whole entry. A notification reports how many lines were hidden. The
  pattern is entered fresh each time; saving patterns for reuse is tracked
  separately.
- Add the "Totonoe Log: Show Normalized View Filtered by Date Range and
  Severity" command
  (`totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity`), which
  combines the existing date-range and severity filters: it first asks which
  severities to show, then prompts for an optional start and end date/time,
  and opens a normalized view containing only the entries that match both
  conditions. A notification reports how many lines were hidden by the
  combined filter.
- Add the "Totonoe Log: Compare Logs" command (`totonoeLog.compareLogs`),
  which lets you pick two log files and opens them side by side in VS Code's
  standard diff editor. Before diffing, timestamps are replaced with a fixed
  placeholder and IPv4 addresses (as well as the hostname field of
  syslog-style entries) are masked, so that differences in when or which host
  produced a log line don't show up as diff noise, letting the meaningful
  differences stand out.
- Add the "Totonoe Log: Copy Masked Text" command (`totonoeLog.copyMaskedText`),
  which copies the active editor's selection (or the whole document when
  nothing is selected) to the clipboard with timestamps masked, along with
  IPv4 addresses and the hostname field of syslog-style entries, ready to
  paste into an external diff tool. Unlike the Compare Logs view, the
  original text formatting is preserved as-is aside from the masked spans.
  Which parts get masked can be toggled independently via the
  `totonoeLog.copyMasked.maskTimestamp` and `totonoeLog.copyMasked.maskHost`
  settings (both default to `true`).
- Add the "Totonoe Log: Show Collapsed View" command
  (`totonoeLog.showCollapsedView`), which normalizes the active editor's log
  and collapses runs of consecutive entries that repeat (ignoring timestamps,
  and IPv4 addresses within the message) into a single line annotated with
  the repeat count (e.g. `(×5)`) and the original line range. Runs shorter
  than the `totonoeLog.collapse.threshold` setting (default `3`) are left
  uncollapsed. To see every original line, open the regular Show Normalized
  View alongside it.
- Implement the "Totonoe Log: Show Merged View" command
  (`totonoeLog.showMergedView`), which lets you pick multiple log files and
  opens a single read-only view with their entries interleaved in
  chronological order, even when each file uses a different timestamp
  format. Each line is prefixed with the source file name and a "kind"
  column derived from the file name with its date portion stripped (e.g.
  `message_20240101.log` → `message`), so you can tell at a glance where a
  line came from while investigating across files.

## [0.1.0] - 2026-07-08

- Add the log normalization engine (`src/normalize`): parses raw log text
  into a common `LogEntry` structure (timestamp / severity / message / raw
  text), groups multi-line records (e.g. stack traces) together, supports
  pluggable regex-based timestamp formats (ISO 8601, log4j-style bracketed
  timestamps, syslog-style timestamps), and keeps unparseable lines as
  "unknown" entries instead of dropping them. This is not yet wired into the
  UI; it's the foundation for filtering, merging, collapsing, and comparing.
- Add the "Totonoe Log: Show Normalized View" command (`totonoeLog.showNormalizedView`),
  which normalizes the active editor's log text and opens it as a read-only
  virtual document. Recognized timestamps are unified to ISO 8601, and each
  line is prefixed with its original line number so you can trace the
  normalized view back to the source log.
- Add the "Totonoe Log: Show Normalized View Filtered by Severity" command
  (`totonoeLog.showNormalizedViewFilteredBySeverity`), which lets you pick
  which severities (ERROR / WARN / INFO / ... and entries with no recognized
  severity) to show via a checkbox-style picker, then opens a normalized view
  containing only the matching entries. Original line numbers are preserved
  even when entries are filtered out.
- Add the "Totonoe Log: Show Normalized View Filtered by Date Range" command
  (`totonoeLog.showNormalizedViewFilteredByDateRange`), which prompts for an
  optional start and end date/time (either bound can be left blank) and opens
  a normalized view containing only entries within that range. Entries
  without a recognized timestamp are treated as out of range. A notification
  reports how many lines were hidden by the filter.

### Fixed

- Fix the normalized view's virtual document name so it no longer duplicates
  the source file's extension (e.g. `app.normalized-1.log` instead of
  `app.log.normalized-1.log`).
- Release cached normalized view content when its editor tab is closed,
  instead of holding it in memory for the rest of the session.
- Fix the normalized view's virtual document name incorrectly stripping the
  entire base name for dotfiles with no other extension (e.g. `.env`),
  producing a path like `/.normalized-1.log`. Leading dots are now preserved.

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.1.0
