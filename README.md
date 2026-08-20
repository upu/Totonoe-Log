<!--
  This file is published as the extension's page on the VS Code Marketplace (user-facing).
  Build/debug/contribution instructions belong in AGENTS.md —
  keep this file limited to user-facing content only.
-->

🌐 [日本語](README.ja.md)

# Totonoe Log

> Normalize, merge, filter, collapse, and compare messy logs.

Totonoe Log is a VS Code extension for log investigation. Real-world troubleshooting means staring at multiple log files with inconsistent formats, timestamps, and noise. Totonoe Log normalizes those messy logs into a consistent, readable timeline so you can actually investigate the issue instead of fighting the format.

Start with **Interactive View**, where every filter is a live toggle. Everything it shows can also be written out as a regular read-only editor tab, and each step is available as its own command too — so VS Code's built-in search, copy, and diff keep working exactly as you expect. Run the commands from the Command Palette (`Ctrl+Shift+P`).

For a lookup-style list of every command — command IDs, where each one can be run from, and what it produces — see the [command reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/commands.md).

- **[Normalize](#normalize-into-one-timeline)** — parse mixed log formats into one consistent, common structure
- **[Merge](#merge-multiple-files)** — combine multiple files into a single chronological timeline
- **[Filter](#filter-out-the-noise)** — narrow down by severity, time range, or pattern
- **[Collapse](#collapse-repeated-lines)** — fold repeated noise into one line
- **[Compare](#compare-two-logs)** — diff two logs without dates or hosts flooding the result
- **[Mask](#masking-your-own-identifiers)** — hide timestamps, hosts, and your own identifiers before sharing

## Interactive View

`Totonoe Log: Show Interactive View` opens the log in a Webview panel where the whole investigation happens in one place, with no round-tripping through Quick Pick dialogs. Run it from the Command Palette against the active editor's log (unsaved changes included), or right-click a log file — or a multi-file selection — in the Explorer.

- **Filters that toggle live.** Severity checkboxes, a date/time range, ignore patterns, and match patterns, all applied as you change them. The match pattern is the exact inverse of the ignore pattern — only entries whose message matches are kept. Each of the two pattern fields takes as many patterns as you like: add rows with **+ 追加**, drop one with **✕**, or untick a row to set it aside without losing what you typed. Patterns within a field are OR'd and the two fields are AND'd, so you never have to hand-write an alternation like `a|b`. Because a Webview cannot use VS Code's `Ctrl+F`, matching is offered as a filter that shows just the matching lines rather than as a highlight-and-jump search. Both patterns are case-insensitive regular expressions (a string without metacharacters simply works as a substring match), and the match pattern is tested against the entry's message only, since timestamps and severities are already covered by the filters beside it; a multi-line entry such as a stack trace is kept whole when any of its lines match.
- **Several files in one panel.** "+ Add Files..." loads more logs into the same panel; once two or more are loaded, the view switches to a merged, filename/kind-columned display. (An Explorer selection can span folders, while the "+ Add Files..." dialog cannot.) Every loaded file is listed with a checkbox that hides or shows just that file's lines — a filter axis of its own, so it combines with the filters above — and a "✕" button that undoes loading it. Hiding a file leaves its severities in the filter panel and the "N / M lines" denominator untouched, exactly like unchecking a severity; the last remaining file cannot be removed, so uncheck it to hide it temporarily.
- **Collapse repeated entries.** Consecutive repeats are folded into one line with a repeat count, and a checkbox turns that off. Clicking a collapsed group's header expands or restores it right there in the panel. This works in the merged display too, which is where it earns the most: when several servers each emit the same heartbeat, merging multiplies that noise by the number of files. Repeats are folded together regardless of which file they came from — after merging, the servers' lines alternate in time order, so grouping per file would find almost nothing consecutive to fold. The header names the first file with a "他" when the group spans several, and hovering it lists every source file without expanding.
- **Jump to the original line.** Double-click a log line — or right-click it and pick "Totonoe Log: Go to Source Line" — to open that line in the source file; hovering shows the source file's full path and line number. A single click never jumps, so selecting text stays safe. Generated lines such as gap markers have no original line, and a collapsed group's header keeps its expand/restore click.
- **Mask before sharing.** The mask button ("🔓 Mask" / "🔒 Mask") replaces the selected kinds of information with placeholders so the log is ready to paste into an issue or chat, and the "▾" beside it picks what to hide: timestamps, host names / IP addresses, process IDs, and identifiers you name yourself. Masking is a display state, not a one-shot copy — the panel's normal copy (`Ctrl+C`), search, and "Export as Virtual Document" all operate on the masked text, while filters, collapsed groups, and line numbers stay exactly as shown. It is off by default (a timeline view must not hide timestamps until asked), and the initial selection follows the same `totonoeLog.copyMasked.*` settings as `Totonoe Log: Copy Masked Text`. See [Masking your own identifiers](#masking-your-own-identifiers) for the "キー" and "任意パターン" fields.
- **Export as Virtual Document.** Writes the current filter / merge / collapse / mask state out as a regular read-only virtual document — the bridge to everything a Webview cannot do: `Ctrl+F` search, `Compare Logs` (see [Compare two logs](#compare-two-logs)), `Go to Source Line`, and opening a result larger than the display cap in full.

Very large results are rendered only up to `totonoeLog.interactiveView.maxDisplayLines` lines, with a notice pointing at narrowing the filters or opening the whole thing with "Export as Virtual Document". Changing any of the `totonoeLog.*` settings below updates an open panel right away: settings that change how the log is parsed (`timestampFormats`, `timezone.sourceOffset`, `timezone.fileOffsets`, `clockSkew.fileOffsets`) re-parse the loaded files first, and the rest just redraw them.

### Highlight rules

Filtering removes what does not match; highlighting leaves everything in place and colors what you are looking for. When you are still working out what went wrong, the lines around a hit are usually what explain it, so the two are separate features.

The **ハイライト ▾** button in the Interactive View opens a small editor for these rules — add a row, type a pattern, pick a color from the dropdown, reorder with ▲▼, delete with ✕. There is no separate save step: every edit is written straight back to the `totonoeLog.highlightRules` setting, so the panel and the settings file are always two views of the same thing. See the [highlight rules reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/highlight-rules.md) for the setting's JSON shape and how overlapping rules are resolved.

### Timestamp format helper

Writing the named-group regular expression in [Custom timestamp formats](#custom-timestamp-formats) by hand is the part that needs regex experience. The **タイムスタンプ ▾** button opens a helper for it: select part of a line — either from the panel's own list of unrecognized lines, or directly in the log body — and click "Suggest from selection" to get a proposed name and pattern. Review it, click "+ タイムスタンプ形式に追加" to add the row, and it saves the same way highlight rules do: no separate save step, and the row shows either a validation error or how many of the unrecognized lines it now matches, right there. When the day/month order in the selection is ambiguous (`02.03.2024` could be either), two buttons let you pick before adding it. Rows can also be added or edited directly with a hand-written pattern — the same validation and match-count feedback applies either way, which covers the "visualize whether an existing pattern's groups are complete" half of the job.

### Masking your own identifiers

No general rule can recognize in-house identifiers — user names, tokens, contract IDs — so the mask panel has two fields for them: **"キー"** replaces just the values of key names you list (`user, token`), keeping the keys themselves readable, and **"任意パターン"** replaces every match of a regular expression, for anything the key field cannot express. See the [masking reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/masking-identifiers.md) for the exact matching rules and process-ID masking.

## Normalize into one timeline

`Totonoe Log: Open in Virtual Document` parses the log files you pick and re-renders every entry in a common structure, regardless of the format each line was originally written in. It uses the Explorer selection when there is one and the active editor otherwise (two or more files switch to the merged display below).

Common timestamp formats are recognized out of the box: ISO 8601 (plain and bracketed), classic syslog, slash-separated dates (`2024/01/02 03:04:05`), Apache/Nginx access-log timestamps (`[02/Jan/2024:03:04:05 +0900]`), and leading epoch seconds/milliseconds. Formats not covered by the built-ins can be added via the `totonoeLog.timestampFormats` setting (see [Custom timestamp formats](#custom-timestamp-formats)).

### JSON Lines

JSON Lines (NDJSON) logs — what zap, pino, bunyan, Serilog, structlog and Docker's `json-file` driver write — are read as structured records rather than as opaque text:

```
{"ts":"2024-01-02T03:04:05.678Z","level":"info","msg":"request completed","dur_ms":250}
```

The timestamp, level and message are taken from the first field present out of `ts` / `time` / `timestamp` / `@timestamp` / `t`, `level` / `severity` / `lvl`, and `msg` / `message`. The timestamp value may be an ISO 8601 string or an epoch number (seconds, milliseconds, or fractional seconds) — it is interpreted with exactly the same rules as a plain-text timestamp, including `totonoeLog.timezone.sourceOffset`. Numeric levels are read as the bunyan/pino scale (`30` is `INFO`); a level outside that scale is kept as written.

The remaining fields are appended to the message as `key=value`, so `host=db-01` and `dur_ms=250` can be filtered, masked and highlighted like any other text. The untouched JSON line is still what `Copy Masked Text` and `Compare Logs` work from. A line that isn't valid JSON, or a JSON object with no usable timestamp field, is kept exactly as before rather than dropped — so a file that mixes JSON records with a plain startup banner works.

### Timestamps that are not at the start of the line

The timestamp doesn't have to be the first thing on the line. A few field shapes that are commonly written in front of it are stepped over, so real Common/Combined Log Format access logs work as they are:

```
10.0.0.1 - - [02/Jan/2024:03:04:05 +0900] "GET /health HTTP/1.1" 200 1234
[worker-3] [2024-01-02 03:04:05] job finished
pid=1204 host=web01 2024-01-02T03:04:05Z INFO started
```

The shapes recognized are the access-log client fields (`10.0.0.1 - - ` followed by a bracketed timestamp), bracketed fields such as `[INFO] ` or `[worker-3] `, and `key=value` fields — up to three of them, within the first 64 characters. Whatever comes before the timestamp is kept at the start of the message, so nothing is lost. Deliberately narrow shapes are used rather than "any text": a continuation line like `see 2024-01-02T03:04:05Z for details` must not be mistaken for the start of a new entry, or stack traces would be split apart. The severity is read from the token *after* the timestamp only, so a leading `[INFO] ` stays in the message rather than becoming the entry's severity.

### Severity levels

The severity is read from the token that follows the timestamp. The built-in vocabulary covers the common level names plus the syslog severities: `TRACE`, `VERBOSE`, `DEBUG`, `INFO`, `NOTICE`, `WARNING`, `WARN`, `ERROR`, `ERR`, `SEVERE`, `CRITICAL`, `CRIT`, `ALERT`, `EMERG`, `FATAL`, and `PANIC` (matched case-insensitively).

Only names that are two spellings of the same level are folded together: `WARNING` is reported as `WARN`, `ERR` as `ERROR`, and `CRIT` as `CRITICAL`. Everything else keeps the spelling written in the log, so a `NOTICE` line stays `NOTICE` rather than being reported as `INFO` — what you see in a view is always a word that is actually in the file, which keeps views comparable with a plain `grep`.

If your logs use a level name that isn't in that list, add it with the `totonoeLog.severityTokens` setting. Entries are plain names rather than regular expressions, and they are *added* to the built-in vocabulary, so listing your own level cannot switch the built-in ones off:

```jsonc
"totonoeLog.severityTokens": ["NOTICE2", "AUDIT"]
```

A name has to end in a letter, digit or underscore to be recognized, because the
match is anchored to a word boundary so that `INFORMATION` is not read as `INFO`.
A name ending in punctuation, such as `LEVEL!`, is never matched.

Long silent stretches are marked, too: when the timestamp gap between consecutive entries exceeds a threshold, a `XXs gap` separator line is inserted so the quiet periods stand out during an incident investigation (applies to the normalized view and the merged view, and is recalculated after filtering; configure with `totonoeLog.gap.thresholdSeconds`). Text generated into the log body stays English regardless of your display language, so the same log always produces the same output to paste into a ticket or diff.

## Filter out the noise

Filtering is a display state of an open view, not a way of opening one. Open a view with `Open in Virtual Document`, then run `Totonoe Log: Set Filter` against that tab (it is in the editor context menu too) to freely combine filters in a single flow: pick the conditions you want from a multi-select list, and answer only the prompts for the conditions you picked.

- **Severity** — keep only error / warn / info / ...
- **Date/time range** — narrow down to the time window you care about
- **Ignore pattern** — hide entries matching a pattern. Patterns are compiled as regular expressions; plain text without special regex characters simply works as a substring match

Date/time boundaries use the timezone selected by `totonoeLog.timezone.display`.
You can therefore copy the wall-clock part of a timestamp shown in a view
(for example, enter `2024-01-02 12:04:05` when the view shows
`2024-01-02T12:04:05.000+09:00`). Date-only input covers that whole day in
the selected timezone. With `local`, ordinary times use the machine's local
timezone; a nonexistent time during a daylight-saving transition is rejected,
and a repeated time selects its earlier occurrence.

Each run **replaces** the filter rather than narrowing the previous result: the
starting point is always the unfiltered log, so loosening a condition brings
hidden lines back. Confirm the picker without selecting any condition and the
filter is cleared entirely. The result rewrites the tab you already have open,
so changing conditions never piles up new tabs.

## Merge multiple files

Select two or more log files in the Explorer, then right-click and choose `Totonoe Log: Open in Virtual Document` to merge them by timestamp into a single timeline for cross-file investigation, with source file name and file "kind" columns (e.g. `message_20240101.log` → kind `message`). Selecting just one gives you the normalized view above, so you never have to pick a command based on how many files you selected. Hovering over the file name column shows the full source path, so same-named files merged from different folders can still be told apart.

Each selected file is decoded with VS Code's resource-scoped `files.encoding`
setting. Normal VS Code configuration precedence applies, so a workspace-folder
value overrides the workspace and user values for files under that folder.
Unsupported encoding values show a warning and explicitly fall back to UTF-8.
The merge path still reads bytes directly, including for files above VS Code's
document synchronization size limit.

Formatted results below 50 MiB remain read-only virtual documents. Larger
results are materialized in extension-managed temporary storage and opened as
regular text tabs, bypassing the same synchronization limit while preserving
VS Code's standard search and copy features. Editing that temporary copy never
changes the source logs, and the stored result is removed after its tab closes.

The merged view can be filtered too: run `Totonoe Log: Set Filter` against the open merged view and you get exactly the same flow as the normalized view (see [Filter out the noise](#filter-out-the-noise)). The fileName/kind columns and the `Go to Source Line` mapping survive filtering. Results above 50 MiB that opened as an ordinary tab are the exception — as with the source mapping, the information filtering needs can only be attached to a virtual document. Use the Interactive View for those.

The same `XXs gap` detection described above applies here too, spotting silent stretches across all merged source files (see [Normalize into one timeline](#normalize-into-one-timeline)).

Logs from servers in different timezones, or from a host whose clock is off, can be corrected per file so they still merge into the true chronological order (see [Timezone normalization](#timezone-normalization) and [Clock skew correction](#clock-skew-correction)).

## Collapse repeated lines

The Interactive View folds consecutive repeated patterns into a single line with a repeat count (e.g. `(x5)`), so repetitive noise stops burying the interesting entries (threshold configurable with `totonoeLog.collapse.threshold`). A group whose start and end differ also carries its end time as `(x5, ~03:04:09.000Z)`, so you can tell a burst that happened in seconds from one spread over hours without expanding the group (a group crossing midnight shows the date too; one that starts and ends on the same instant omits it, since repeating the timestamp adds nothing). It is on by default — untick "繰り返しを折りたたむ" to see every line — and it applies to the merged display too, which is where it earns the most. Click a group's header to expand it in place, or use "Export as Virtual Document" to get the folded result as a read-only document you can search and diff.

Masking feeds into what counts as a repeat: lines that become identical once masked are folded together. IP addresses are always ignored for this comparison, and everything the mask panel hides while it is on — host names, process IDs, and the values you name in the "キー" / "任意パターン" fields — counts too. So a heartbeat that carries a per-server identifier (`heartbeat ok (node=a-01)`) stops collapsing on its own, but turning the mask on and listing `node` in the "キー" field folds every server's copy into one group.

## Compare two logs

`Totonoe Log: Compare Logs` diffs two logs that differ in dates or hosts — without those differences flooding the diff as noise, so the real differences stand out.

To compare what you have narrowed down in Interactive View, press its "Export as Virtual Document" button first and run `Compare Logs` on the resulting tabs. Comparison stays outside the panel on purpose: a diff is VS Code's own editor, and sending the panel's state to it beats rebuilding a diff view inside a Webview.

`Totonoe Log: Copy Masked Text` copies the active editor's log text with timestamps and hosts masked, ready to paste into an external diff tool (what gets masked is configurable).

## Timezone normalization

Logs written in local time without an offset (e.g. `2024-01-02 03:04:05`)
are interpreted as UTC by default. When servers in different timezones are
involved, that skews the merged timeline. Three settings fix this —
`totonoeLog.timezone.sourceOffset`, `totonoeLog.timezone.fileOffsets` for
per-file overrides, and `totonoeLog.timezone.display` for how views render
timestamps. Timezone auto-detection is not implemented: a timestamp without
an offset carries no reliable signal to detect one from, so guessing would
silently corrupt the timeline instead of tidying it. See the
[timezone normalization reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/timezone-normalization.md)
for the full settings syntax.

## Clock skew correction

Timezone settings can't help when a host's clock itself is wrong — say,
a server drifting 40 seconds ahead because NTP is broken. The
`totonoeLog.clockSkew.fileOffsets` setting corrects such logs by ±N
seconds, per file-name pattern. See the
[clock skew correction reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/clock-skew-correction.md)
for the settings syntax and exactly which views and timestamp forms it
applies to.

## Custom timestamp formats

If your logs use a timestamp format the built-ins don't recognize, add it
with the `totonoeLog.timestampFormats` setting. Each entry is a regular
expression whose named capture groups tell Totonoe Log how to interpret the
match, tried before the built-in formats. The Interactive View's
[Timestamp format helper](#timestamp-format-helper) can propose a pattern
from a selection instead of writing the regular expression by hand. See the
[custom timestamp formats reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/custom-timestamp-formats.md)
for the full syntax and supported capture groups.

When most lines of a log are left without a timestamp, Totonoe Log says so
instead of quietly folding them into one huge entry: the virtual-document
commands notify you once per file, and the Interactive View shows it in its
warning line for every loaded file — including the ones added later with
**+ Add Files...**. Both places offer an "Open Timestamp Format Helper"
button that jumps straight to the [Timestamp format helper](#timestamp-format-helper),
already expanded, for the file the warning is about.

## Installation

Download `totonoe-log.vsix` from the [GitHub Releases page](https://github.com/upu/Totonoe-Log/releases) and install it:

```bash
code --install-extension totonoe-log.vsix
```

or run **Extensions: Install from VSIX...** from the Command Palette.

## Settings

All settings live under the `totonoeLog` namespace: `gap.thresholdSeconds`,
`collapse.threshold`, `interactiveView.maxDisplayLines`,
`copyMasked.maskTimestamp`, `copyMasked.maskHost`, `copyMasked.maskProcessId`,
`timezone.sourceOffset`, `timezone.fileOffsets`, `timezone.display`,
`clockSkew.fileOffsets`, `timestampFormats`, `severityTokens`, and
`highlightRules`. For the type, default, and full description of each, see the
[settings reference](https://github.com/upu/Totonoe-Log/blob/main/docs/features/settings.md).

## The Totonoe series

Totonoe Log is the first of a planned "Totonoe" series: small VS Code extensions, each built around tidying up (整える, *totonoeru*) some kind of messy input.

## License

MIT
