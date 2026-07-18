# Changelog

All notable changes to the "Totonoe Log" extension will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New `Totonoe Log: Go to Source Line` command jumps from the current line
  of a normalized, filtered, collapsed, or merged view to the corresponding
  physical line of the original log file. In merged views it resolves the
  correct file even when same-named files live in different folders. A
  collapsed group header jumps to the first line of its range; generated
  lines such as gap markers show an explanatory message instead (issue #137).
- `Totonoe Log: Go to Source Line` is now also available from the editor
  right-click menu on normalized and merged views (issue #149).

### Fixed

- Date/time range boundaries now use the timezone selected by
  `totonoeLog.timezone.display`, so entering a timestamp as shown in a
  normalized or merged view no longer silently filters out the matching
  entry. Date-only bounds also cover the selected timezone's whole day
  (issue #134).
- Out-of-range time components and UTC offsets in built-in and custom
  calendar timestamp formats are no longer normalized into a different
  valid instant (issue #135).
- Logs that switch from a recognized timestamp format to many unsupported
  timestamp-like lines now show the custom-format warning instead of silently
  absorbing those lines into one large entry. Indented continuations, blank
  lines, and ordinary stack traces remain excluded from the warning
  (issue #136).
- Merged views now decode each source file with its resource-scoped VS Code
  `files.encoding` setting, so supported non-UTF-8 logs such as Shift_JIS keep
  their text intact. Unsupported encoding values warn and fall back to UTF-8,
  while the direct byte-reading path for large files remains unchanged
  (issue #133).
- Formatted merged results at or above 50 MiB are now materialized in
  extension-managed temporary storage and opened as regular text tabs, so the
  complete result remains searchable and copyable instead of failing at VS
  Code's extension-host document synchronization limit. Smaller results remain
  read-only virtual documents (issue #130).

## [0.5.0] - 2026-07-17

### Added

- The "XX seconds of silence" gap-detection separator line, previously only
  in `Show Normalized View` (and its filtered variants), now also applies
  to `Show Merged View` and `Show Merged View Filtered` (issue #102). It
  shares the same `totonoeLog.gap.thresholdSeconds` setting and the same
  detection logic, so gaps between chronologically adjacent entries —
  across source files, and after filtering — are found the same way in
  both views. The gap marker line spans the fileName/kind columns blank,
  the same way a continuation line does.
- New timezone normalization settings (issue #13):
  `totonoeLog.timezone.sourceOffset` sets the UTC offset assumed for
  timestamps without explicit timezone information (timestamps with an
  explicit offset or `Z`, and epoch timestamps, are never shifted), and
  `totonoeLog.timezone.fileOffsets` overrides it per file-name pattern so
  logs from servers in different timezones merge into the true
  chronological order. `totonoeLog.timezone.display` selects the timezone
  every view renders timestamps in (`UTC` by default, `local`, or a fixed
  offset like `+09:00`). Custom calendar-style timestamp formats can now
  also capture a literal `Z` with the new `tzz` group to mark explicit UTC.
- New `totonoeLog.clockSkew.fileOffsets` setting to correct logs from
  hosts whose clock is off by ±N seconds, per file-name pattern
  (issue #15). Unlike the timezone source offset, the correction applies
  to every recognized timestamp — including those with an explicit
  offset, `Z`, or epoch form — because the host clock itself is wrong.
  Merged and normalized/filtered/collapsed views sort, display, and
  filter by the corrected times; the raw log text is never rewritten.
- New built-in timestamp formats: slash-separated dates
  (`2024/01/02 03:04:05`, common in Japanese Windows/business-system
  logs), Apache/Nginx access-log timestamps
  (`[02/Jan/2024:03:04:05 +0900]`), and leading epoch
  seconds/milliseconds. Lines in these formats used to be silently
  absorbed as continuation lines of the preceding entry.
- New `totonoeLog.timestampFormats` setting to add custom timestamp
  formats as regular expressions with named capture groups (calendar
  groups `y` `mo` `d` `h` `mi` `s` with optional `ms`/timezone groups, or
  epoch groups `epochMs`/`epochSec`). Custom formats are tried before the
  built-in ones; invalid entries are skipped with a warning.
- Normalized/collapsed/filtered and merged views now show a warning
  notification when a log's timestamp format is largely unrecognized
  (half or more of the non-blank lines appear before any recognized
  timestamp, in files of 10+ non-blank lines), with guidance to the
  `totonoeLog.timestampFormats` setting. The warning is shown at most
  once per file per session.
- The collapsed view now shows the timestamp span (start and end) of
  each collapsed group instead of only the representative entry's
  timestamp, so a burst that happened in seconds can be told apart from
  one spread over hours without expanding the group (issue #99). The
  end timestamp is omitted when every entry in the group shares the
  same timestamp.

### Changed

- The collapsed view's repeat-detection now computes each entry's
  grouping key once instead of recomputing it for every comparison
  within a run, speeding up collapsing on large log files without
  changing which entries get grouped (issue #97).

### Fixed

- Normalized/merged/compare views no longer silently render blank when
  VSCode internally releases the underlying virtual document (which can
  happen while a tab sits in the background, even without the user closing
  it). Instead of a silent empty document, a visible placeholder message
  now explains that the view's content was lost and that the command
  should be re-run.
- Entering a date-only value (e.g. `2024-01-02`) as the end boundary of a
  date range filter no longer excludes almost all of that day's entries.
  It now completes to the last instant of that day (`23:59:59.999`)
  instead of midnight; the start boundary's `00:00:00` completion is
  unchanged.
- Severity is now recognized in the common log4j/logback layout
  `%d [%t] %-5p` (e.g. `2024-01-02 03:04:05 [main] INFO ...`), where a
  bracketed thread name sits between the timestamp and the log level.
  Such lines used to fall into "(no severity)" and were missed by
  severity filters.
- ISO 8601 timestamps with 7+ digit fractional seconds (.NET's 7-digit
  format, Go's RFC3339Nano 9-digit format) no longer silently drop their
  timezone offset. The offset used to be left unmatched and treated as
  UTC, shifting timestamps by hours, and the unmatched leftover digits
  leaked into the start of the log message.
- The merged view's "kind" grouping now recognizes logrotate-style
  rotated file names (issue #96): `app.log`, `app.log.1`, and
  `app.log.2024-01-02` all derive the same `app` kind, instead of the
  numeric/date rotation suffix being treated as part of the kind.
- The merged view now reads files via `vscode.workspace.fs.readFile`
  instead of `vscode.workspace.openTextDocument` (issue #98), so log
  files larger than VSCode's ~50MB extension-host document sync limit no
  longer fail to load into the merge.

## [0.3.1] - 2026-07-13

- No user-facing changes. Technical republish to retry a Marketplace
  publish that previously failed with a "suspicious content" error.

## [0.3.0] - 2026-07-12

### Added

- Add a `Totonoe Log: Merge Selected Files` command to the Explorer's
  right-click context menu, shown when two or more files are selected. It
  merges the selected files directly, reusing the same chronological-merge
  logic as `Show Merged View`, without going through the file-picker dialog.
  Folders included in the selection are ignored.
- Insert a "XX seconds of silence" marker line wherever the timestamp gap
  between two consecutive entries is large, making it easy to spot "silent"
  stretches of a log during an incident investigation. Applies to `Show
  Normalized View` and all of its filtered variants (severity, date range,
  date range + severity, ignore pattern), so gaps between the entries that
  remain after filtering are detected too. The threshold is configurable via
  `totonoeLog.gap.thresholdSeconds` (default: 30 seconds; 0 disables it).
- Add a `Totonoe Log: Show Normalized View Filtered` command that lets you
  freely combine severity, date/time range, and ignore pattern filters in a
  single flow: pick which conditions to apply from a multi-select QuickPick,
  then answer only the prompts for the conditions you picked. This avoids
  needing a separate command for every combination of filters. The existing
  single-purpose filter commands (severity only, date range only, date range
  + severity, ignore pattern only) remain available unchanged.
- Add a `Totonoe Log: Show Merged View Filtered` command that lets you pick
  the files to merge and then filter the merged result by severity, date/time
  range, and/or ignore pattern in one flow, reusing the same multi-select
  QuickPick UX as `Show Normalized View Filtered`. The file name/kind columns
  and line-number gutter are preserved after filtering, and the number of
  hidden lines is reported the same way the normalized view's filters do.

### Fixed

- Fix `Compare Logs` and `Copy Masked Text` not masking IPv6 addresses (only
  IPv4 was masked before). Common IPv6 notations — full form, `::`
  compression, and zone IDs (`%eth0`) — are now replaced with `<HOST>` like
  IPv4 addresses already were, so container/Kubernetes logs no longer leak
  host info or add diff noise. Time-like tokens (e.g. `03:04:05`) are still
  left untouched.
- Fix normalize/filter/copy commands (Show Normalized View and its filtered
  variants, Show Collapsed View, Copy Masked Text) silently producing wrong
  results when run against a Totonoe Log view that is already open and
  active (e.g. running "Filtered by Severity" right after "Show Normalized
  View", with the resulting view still focused). Those commands now detect
  when the active editor is one of Totonoe Log's own virtual documents
  (normalized/collapsed, merged, or compare view) and show a warning instead
  of parsing the view's own gutter-prefixed text as if it were a raw log.
- Fix year-less syslog timestamps (`MMM d HH:mm:ss`) being interpreted with
  the wrong year when a log crosses a year boundary. Instead of always
  assuming the current year, the parser now rolls the assumed year back by
  one when that interpretation would land more than 24 hours in the future
  (e.g. a "Dec 31" entry opened in January 2026 is now read as 2025), the
  same heuristic used by common syslog implementations. This corrects the
  timestamps shown in the normalized view, date-range filtering, and the
  chronological order of the merged view for year-crossing logs. Explicitly
  passing `assumedYear` still forces that year, as before.

### Security

- Fix "Show Normalized View Filtered by Ignore Pattern" being able to freeze
  the entire extension host when the entered pattern triggers catastrophic
  regex backtracking (e.g. `(a+)+b` against a long non-matching input). The
  match is now run in a worker thread with a 2-second timeout; if it doesn't
  finish in time, the worker is terminated and a warning is shown instead of
  opening the view, so a runaway pattern can no longer block VS Code.

### Added

- Add an icon for the extension, shown in the Marketplace and VS Code's
  Extensions view.

## [0.2.0] - 2026-07-10

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

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.5.0
[0.3.1]: https://github.com/upu/Totonoe-Log/releases/tag/v0.3.1
[0.3.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.3.0
[0.2.1]: https://github.com/upu/Totonoe-Log/releases/tag/v0.2.1
[0.2.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.2.0
[0.1.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.1.0
