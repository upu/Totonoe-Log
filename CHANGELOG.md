# Changelog

All notable changes to the "Totonoe Log" extension will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- In a multi-root workspace, editing highlight rules in the Interactive View
  panel saved them to your user settings even when the rules were defined in a
  folder's `.vscode/settings.json`. Folder settings win over user settings, so
  the edit had no visible effect. The panel now reads and writes the rules
  scoped to the first loaded log file, so they go back to the folder they came
  from (issue #240).

## [0.9.0] - 2026-07-31

### Removed

- **Breaking:** `Totonoe Log: Show Collapsed View`
  (`totonoeLog.showCollapsedView`) was removed. `Totonoe Log: Show Interactive
  View` covers everything it did and more: collapsing is on by default there,
  so opening the panel already shows the folded result, and "Export as Virtual
  Document" writes it out as the same kind of read-only document the old
  command produced. Since #158 it also works on the merged display, which the
  command never did. If you had a keybinding for it, point that at
  `totonoeLog.showInteractiveView`. The `totonoeLog.collapse.threshold` setting
  stays — the Interactive View reads it (issue #233).

### Added

- `Totonoe Log: Show Interactive View` now reports a low timestamp recognition
  rate for every loaded file, including the ones added later with
  **+ Add Files...** — previously only the file the panel was opened with was
  checked, so adding a log in a format the built-ins don't recognize gave you
  no hint that it had been folded into one huge entry. The report appears in
  the panel's warning line rather than as a modal notification, so it stays
  visible while the file is loaded and disappears once you add a matching
  `totonoeLog.timestampFormats` entry or drop the file (issue #186).

- `Totonoe Log: Show Interactive View` now collapses repeated entries in the
  merged display too, not just while a single file is loaded — the case where
  it helps most, since merging several servers multiplies a repeated heartbeat
  by the number of files. Repeats are folded together regardless of which file
  they came from: after merging, the servers' lines alternate in time order, so
  grouping per file would find almost nothing consecutive to fold. A group
  header spanning several files names the first one with a "他" and lists them
  all on hover. "Export as Virtual Document" carries the collapsed state over,
  and `Go to Source Line` from a collapsed group still lands in the right file
  (issue #158).

- A **ハイライト ▾** panel in `Totonoe Log: Show Interactive View` for editing
  the highlight rules without hand-writing JSON: add a row, type a pattern,
  pick a color from a dropdown, reorder with ▲▼ (the order is the overlap
  precedence), delete with ✕. There is no save step — every edit is written
  back to `totonoeLog.highlightRules`, to wherever the rules are already
  defined (workspace settings if that is where they live, user settings
  otherwise). A rule the extension cannot use, such as one with a broken
  regular expression, is still listed in the panel so it can be repaired
  (issue #238).
- Highlight rules. Register keywords or patterns in the new
  `totonoeLog.highlightRules` setting and `Totonoe Log: Show Interactive View`
  colors every match, leaving the lines themselves in place — the counterpart
  to filtering, for when the lines around a hit are what explain it. Each rule
  takes a case-insensitive regular expression and one of six colors (`red`,
  `orange`, `yellow`, `green`, `blue`, `purple`) that stay readable in light
  and dark themes alike. Where two rules overlap the one listed first wins,
  and a rule with an invalid pattern or an unknown color is skipped with a
  warning naming it while the rest keep working (issue #18).

- `Totonoe Log: Show Interactive View` now takes any number of match patterns
  and ignore patterns instead of one each. Add a row with **+ 追加**, remove
  one with **✕**, or untick a row to set that pattern aside without losing
  what you typed. Patterns within a field are OR'd and the two fields are
  AND'd, so entries matching any match pattern and none of the ignore
  patterns are kept — writing an alternation like `a|b` by hand is no longer
  necessary. An invalid pattern only drops its own row, and the warning says
  which row it was (issue #206).

### Fixed

- The Interactive View now folds repeated lines that only look identical
  because of the mask. Masking host names or process IDs used to apply at
  formatting time only, so adjacent lines rendered as exactly the same
  `sshd[<PID>]:` text stayed unfolded — while the mask panel's "キー" and
  "任意パターン" fields, which rewrite the entries themselves, did fold them.
  Both now feed the same comparison. Collapsing with the mask off is
  unchanged, and the export follows the display as before (issue #245).

- `Totonoe Log: Show Normalized View Filtered` and `Totonoe Log: Merge
  Selected Files (Filtered)` no longer hide entries whose timestamp could not
  be recognized when you pick the date range condition but leave both
  boundaries empty. An empty range still counted as a date condition, and
  applying any date range drops entries with no recognized timestamp — so
  lines disappeared even though no date filtering was actually happening.
  Entering just one boundary still applies that side on its own, and a
  boundary that cannot be interpreted still aborts the command
  (issue #231).

## [0.8.1] - 2026-07-29

### Fixed

- Custom epoch timestamp formats in `totonoeLog.timestampFormats` no longer
  accept values that cannot be represented as a date. An `epochMs` capture
  outside the range JavaScript dates can express (or an `epochSec` with a
  non-numeric `ms` capture) used to be treated as a recognized timestamp and
  then crashed formatting with `Invalid time value`, breaking the whole view.
  Such lines are now kept as ordinary unrecognized lines (issue #219).
- `Totonoe Log: Show Interactive View` no longer hides entries whose
  timestamp could not be recognized when a date/time boundary cannot be
  interpreted. Entering something like `not-a-date` warned but still left a
  date condition in place, and applying any date range drops entries with no
  recognized timestamp — so lines disappeared even though no date filtering
  was actually happening. A boundary that does parse is still applied on its
  own (issue #220).
- `Totonoe Log: Show Interactive View` now shows the result of the filter
  you asked for last. Pattern evaluation runs in a worker thread and can
  take seconds, so a slow earlier condition could finish after a quick
  later one and overwrite the newer view — and because the form state was
  read at send time rather than at compute time, the panel could pair the
  condition you see with a body computed from a different one. Both made
  an out-of-date result look like a match (issue #218).
- `Totonoe Log: Show Interactive View`'s "Export as Virtual Document" now
  applies whatever is in the form at the moment the button is pressed.
  Text fields are debounced by 300 ms, so exporting right after typing used
  to write out the previous state — most importantly, a mask key or pattern
  entered just before exporting was not applied, leaving information the
  user meant to hide in a document about to be shared (issue #217).
  Input that cannot be interpreted is now reported when exporting, too —
  until now such a warning only appeared in the panel, which never showed
  it for a value typed and exported within that window.

## [0.8.0] - 2026-07-28

### Added

- New `Totonoe Log: Show Interactive View` command:
  opens the normalized log in a Webview panel where severity, date-range,
  and ignore-pattern filters can be toggled live, without round-tripping
  through Quick Pick dialogs (issue #166). The existing read-only
  virtual-document views are unaffected and remain available.
- `Totonoe Log: Show Interactive View` can now load additional log
  files via a "+ Add Files..." button in the panel. Once two or more files
  are loaded, the view switches to a merged, filename/kind-columned display
  (issue #168, the next step in #165), while a single loaded file
  keeps the original normalized display.
- `Totonoe Log: Show Interactive View` now collapses repeated
  entries by default while a single file is loaded, with a checkbox to
  turn collapsing off. Clicking a collapsed group's header expands or
  restores it entirely inside the Webview, with no extension round-trip
  (issue #172, the next step in #165). Collapsing is not yet
  available once two or more files are merged.
- `Totonoe Log: Show Interactive View` now has an "Export as Virtual
  Document" button that opens the current filter/merge/collapse state as a
  regular read-only virtual document, reusing the existing normalized/merged
  view infrastructure (search, copy, `Go to Source Line`, and `Compare Logs`
  all work on it as-is; issue #175, the next step in #165).
- `Totonoe Log: Show Interactive View` can now jump from a log line to
  that line in the original file: double-click the line, or right-click it and
  pick "Totonoe Log: Go to Source Line". Hovering a line shows the source
  file's full path and line number (issues #179 and #191, the next step
  in #165). This reuses the same jump behavior as `Go to Source Line`. A single
  click never jumps, so selecting text stays safe. Generated lines such as gap
  markers have no original line and are not jump targets, and a collapsed
  group's header line keeps its expand/restore click.
- `Totonoe Log: Show Interactive View` now caps how many lines it
  renders at once (`totonoeLog.interactiveView.maxDisplayLines`, default
  `20000`, `0` disables the cap). Beyond the cap it renders only the leading
  lines and shows a notice pointing at narrowing the filters or opening the
  whole thing with "Export as Virtual Document", instead of bogging the panel
  down with a huge DOM (issue #178).
- `Totonoe Log: Show Interactive View` can now mask the log it displays,
  ready to paste into an issue or chat: the mask button ("🔓 Mask" / "🔒 Mask")
  replaces timestamps and host names / IP addresses with placeholders in place,
  and the
  "▾" beside it opens a panel for picking which of them to hide (issues #180
  and #194, the next step in #165). Masking is a display state rather than
  a one-shot copy action, so the panel's normal copy (Ctrl+C), search, and
  "Export as Virtual Document" all operate on the masked text, while filters,
  collapsed groups, and line numbers stay exactly as shown. It is off by
  default — Interactive View is a timeline view, so it must not hide timestamps
  until asked — and the initial target selection follows the existing
  `totonoeLog.copyMasked.maskTimestamp` / `totonoeLog.copyMasked.maskHost`
  settings shared with `Totonoe Log: Copy Masked Text`; no new settings were
  added.

- The mask panel of `Totonoe Log: Show Interactive View` gained two more
  targets: process IDs and anything matching a pattern you type (issue #195, the
  next step in #165). "プロセスID" replaces syslog-style `sshd[1234]:` tags
  and `pid=1234` / `pid: 1234` / `[pid 1234]` notations with `<PID>`, while
  leaving log4j thread names (`[main]`) and array indices (`retries[3]`) alone.
  "任意パターン" takes a regular expression and replaces every match with
  `<MASKED>`, for the in-house identifiers — user names, host naming
  conventions, tokens, contract IDs — that no general rule can recognize. An
  invalid or too-slow pattern disables only that one mask: a warning appears and
  every other mask keeps working, the same way the ignore pattern degrades. The
  pattern lives in the panel and is never written to settings. Process-ID
  masking is available to `Totonoe Log: Copy Masked Text` as well, via the new
  `totonoeLog.copyMasked.maskProcessId` setting (default `false`, so existing
  output is unchanged), which also seeds the panel's initial selection.

- The mask panel of `Totonoe Log: Show Interactive View` gained a "キー"
  field that hides values without writing a regular expression (issue #212).
  List the key names you want gone — `user, token` (commas or spaces) — and only
  their values are replaced: `user=hoge` becomes `user=<MASKED>`, keeping the key
  itself so the line stays readable. It handles `key=value`, `key: value`, and
  quoted values (`token="abc"` → `token="<MASKED>"`), matches keys
  case-insensitively, and treats them as literal text, so regex metacharacters
  and non-ASCII names (`契約ID`) work as typed. A key that merely appears inside
  a longer one is left alone (`superuser=x` is untouched when masking `user`), as
  is a spaced-out `user = hoge` — masking the word after an empty `key=` would be
  worse than missing it. The key field and the free-form pattern field combine,
  and the field is panel state that is never written to settings.

- `Totonoe Log: Show Interactive View` can now be opened straight from
  the Explorer: right-click a log file — or a selection of several — and pick it
  to open them in a single panel, merged when there are two or more (issues #181
  and #201, the next step in #165).
  Unlike the panel's "+ Add Files..." dialog, an Explorer selection can span
  folders (the same reasoning as issue #151). Running it from the command
  palette still targets the active editor's log, including unsaved changes.

- The loaded-file list in `Totonoe Log: Show Interactive View` is now
  interactive: each file has a checkbox that hides or shows just that file's
  lines, and a "✕" button that undoes loading it altogether (issue #170, the
  next step in #165). The per-file checkbox is a filter axis of its own,
  so it combines with the severity / date-range / ignore-pattern filters, and
  "Export as Virtual Document" writes out only the files that are shown.
  Hiding a file keeps its severities in the filter panel and keeps the "N / M
  lines" denominator intact, exactly like unchecking a severity does. The last
  remaining file cannot be removed (with none loaded, "+ Add Files..." would
  have nothing to add to) — uncheck it instead to hide it temporarily. The
  panel's tab title now also follows along as files are added or removed.
- `Totonoe Log: Show Interactive View` now has a "match pattern"
  input next to the existing "ignore pattern" one: entries whose message
  matches are the only ones kept, which is exactly the inverse of the
  ignore pattern (issue #182, the next step in #165). Since a Webview
  cannot use VS Code's Ctrl+F, this is offered as a filter that shows only
  matching lines rather than as a highlight-and-jump search. Both inputs are
  case-insensitive regular expressions, and the match pattern is tested
  against the entry's message only — timestamps and severities are already
  covered by the date-range and severity filters — so a multi-line entry
  such as a stack trace is kept whole when any of its lines match.
- `Totonoe Log: Show Interactive View` now redraws itself as soon as a
  relevant `totonoeLog.*` setting changes, instead of waiting until a filter is
  next touched (issue #183, the next step in #165). Settings that only
  affect formatting (`timezone.display`, `gap.thresholdSeconds`,
  `collapse.threshold`, `interactiveView.maxDisplayLines`) redraw the current
  entries, while settings that change how the log is parsed
  (`timestampFormats`, `timezone.sourceOffset`, `timezone.fileOffsets`,
  `clockSkew.fileOffsets`) re-parse the loaded files first. Because a
  re-parse can surface severities that were not present before, those are
  checked automatically so their lines are not silently hidden.

### Changed

- **Breaking:** the four per-criterion filter commands were removed, since
  Interactive View's live toggles (and the combined picker command that stays)
  now cover them (issue #184). If you had a keybinding on one of these, point it
  at `totonoeLog.showNormalizedViewFiltered` or
  `totonoeLog.showInteractiveView` instead:
  - `totonoeLog.showNormalizedViewFilteredBySeverity`
  - `totonoeLog.showNormalizedViewFilteredByDateRange`
  - `totonoeLog.showNormalizedViewFilteredByDateRangeAndSeverity`
  - `totonoeLog.showNormalizedViewFilteredByIgnorePattern`

  `Totonoe Log: Show Normalized View Filtered`, `Show Normalized View`,
  `Show Collapsed View`, and both merge commands are unchanged — the command
  list goes from 13 entries to 9.
- **Breaking:** Interactive View dropped its `(Alpha)` marker along with the
  alpha-era command id (issue #184). The command is now
  `totonoeLog.showInteractiveView` (was `totonoeLog.showInteractiveViewAlpha`)
  and is titled `Totonoe Log: Show Interactive View`; its panel title is
  `Totonoe Log: <file name>` (was `Totonoe Log (Alpha): <file name>`). Only
  keybindings on the old id are affected, and only for users who ran a
  pre-release build — the alpha id was never part of a published release.

## [0.7.0] - 2026-07-23

### Added

- The merged view now shows the full source path (including its folder) in
  a hover tooltip when you point at the file name column, making it
  possible to tell apart same-named files merged from different folders
  (issue #150).
- New `Totonoe Log: Merge Selected Files Filtered` command: select two or
  more files in the Explorer, right-click, and merge them with the same
  severity / date range / ignore pattern filter flow already available for
  the normalized view (issue #151).

### Changed

- `Totonoe Log: Show Merged View` and `Totonoe Log: Show Merged View
  Filtered`, which picked files via an OS file-selection dialog, have been
  removed. The OS dialog could only multi-select files within a single
  folder, so merging logs across folders required using `Merge Selected
  Files` anyway; merging now goes exclusively through the Explorer
  right-click context menu (`Totonoe Log: Merge Selected Files` /
  `Totonoe Log: Merge Selected Files Filtered`), which merges cleanly
  across folders (issue #151).

### Fixed

- `Totonoe Log: Go to Source Line` now shows a warning message instead of an
  unhandled error when the original log file has been deleted, moved, or
  renamed since the view was opened (issue #156).

## [0.6.0] - 2026-07-20

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

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.9.0
[0.8.1]: https://github.com/upu/Totonoe-Log/releases/tag/v0.8.1
[0.8.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.8.0
[0.7.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.7.0
[0.6.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.6.0
[0.5.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.5.0
[0.3.1]: https://github.com/upu/Totonoe-Log/releases/tag/v0.3.1
[0.3.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.3.0
[0.2.1]: https://github.com/upu/Totonoe-Log/releases/tag/v0.2.1
[0.2.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.2.0
[0.1.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.1.0
