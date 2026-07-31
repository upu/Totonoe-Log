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

The **ハイライト ▾** button in the Interactive View opens a small editor for these rules — add a row, type a pattern, pick a color from the dropdown, reorder with ▲▼, delete with ✕. There is no separate save step: every edit is written straight back to the `totonoeLog.highlightRules` setting, so the panel and the settings file are always two views of the same thing.

The setting is a plain array, so you can also write it by hand — and commit it to `.vscode/settings.json` to share your project's patterns with the team:

```json
"totonoeLog.highlightRules": [
  { "name": "OOM", "pattern": "OutOfMemory", "color": "red" },
  { "name": "timeout", "pattern": "timed? ?out", "color": "orange" }
]
```

`pattern` is a case-insensitive regular expression, and every match on a line is colored, not just the first. `color` is one of `red`, `orange`, `yellow`, `green`, `blue`, `purple` — a fixed set rather than free-form color codes, so that a readable value can be used for light and dark themes alike; it defaults to `yellow`. `name` is only there to tell your own rules apart and to name the rule in warnings, and defaults to `highlight-<n>`.

When two rules match overlapping text the rule listed first wins, so put the more specific ones higher — that is what ▲▼ are for. A rule with an invalid regular expression or an unknown color is skipped with a warning naming it, while the remaining rules keep working; it still shows up in the panel so you can repair it. Editing the setting by hand recolors an open panel right away, and the panel writes back to wherever the rules are already defined (workspace settings if that is where they live, your user settings otherwise).

### Masking your own identifiers

No general rule can recognize in-house identifiers — user names, tokens, contract IDs — so the mask panel has two fields for them.

**"キー"** is the one to reach for first: list the key names whose values should go (`user, token`, separated by commas or spaces) and only the values are replaced, so `user=hoge` becomes `user=<MASKED>` with the key still readable. It covers `key=value`, `key: value`, and quoted values (`token="abc"` → `token="<MASKED>"`), matches keys case-insensitively, and takes them literally, so regex metacharacters and non-ASCII names (`契約ID`) work as typed; a key that only appears inside a longer one (`superuser=x` when masking `user`) is left alone.

**"任意パターン"** takes a regular expression and replaces every match with `<MASKED>`, for anything the key field cannot express. An invalid or too-slow pattern disables only that one mask, with a warning, while every other mask keeps working. Both fields apply together, and both are panel state that is never saved to settings.

Process-ID masking, available here and in `Copy Masked Text`, covers syslog-style `sshd[1234]:` tags and `pid=1234` / `pid: 1234` / `[pid 1234]` notations (replaced with `<PID>`), while leaving log4j thread names such as `[main]` and array indices such as `retries[3]` alone.

## Normalize into one timeline

`Totonoe Log: Open in Virtual Document` parses the log files you pick and re-renders every entry in a common structure, regardless of the format each line was originally written in. It uses the Explorer selection when there is one and the active editor otherwise (two or more files switch to the merged display below).

Common timestamp formats are recognized out of the box: ISO 8601 (plain and bracketed), classic syslog, slash-separated dates (`2024/01/02 03:04:05`), Apache/Nginx access-log timestamps (`[02/Jan/2024:03:04:05 +0900]`), and leading epoch seconds/milliseconds. Formats not covered by the built-ins can be added via the `totonoeLog.timestampFormats` setting (see [Custom timestamp formats](#custom-timestamp-formats)).

Long silent stretches are marked, too: when the timestamp gap between consecutive entries exceeds a threshold, a "XX seconds of silence" separator line is inserted so the quiet periods stand out during an incident investigation (applies to the normalized view and the merged view, and is recalculated after filtering; configure with `totonoeLog.gap.thresholdSeconds`).

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

The same "XX seconds of silence" gap detection described above applies here too, spotting silent stretches across all merged source files (see [Normalize into one timeline](#normalize-into-one-timeline)).

Logs from servers in different timezones, or from a host whose clock is off, can be corrected per file so they still merge into the true chronological order (see [Timezone normalization](#timezone-normalization) and [Clock skew correction](#clock-skew-correction)).

## Collapse repeated lines

The Interactive View folds consecutive repeated patterns into a single line with a repeat count (e.g. "×5"), so repetitive noise stops burying the interesting entries (threshold configurable with `totonoeLog.collapse.threshold`). Each collapsed line also shows the group's timestamp span (start 〜 end), so you can tell a burst that happened in seconds from one spread over hours without expanding the group. It is on by default — untick "繰り返しを折りたたむ" to see every line — and it applies to the merged display too, which is where it earns the most. Click a group's header to expand it in place, or use "Export as Virtual Document" to get the folded result as a read-only document you can search and diff.

Masking feeds into what counts as a repeat: lines that become identical once masked are folded together. IP addresses are always ignored for this comparison, and everything the mask panel hides while it is on — host names, process IDs, and the values you name in the "キー" / "任意パターン" fields — counts too. So a heartbeat that carries a per-server identifier (`heartbeat ok (node=a-01)`) stops collapsing on its own, but turning the mask on and listing `node` in the "キー" field folds every server's copy into one group.

## Compare two logs

`Totonoe Log: Compare Logs` diffs two logs that differ in dates or hosts — without those differences flooding the diff as noise, so the real differences stand out.

To compare what you have narrowed down in Interactive View, press its "Export as Virtual Document" button first and run `Compare Logs` on the resulting tabs. Comparison stays outside the panel on purpose: a diff is VS Code's own editor, and sending the panel's state to it beats rebuilding a diff view inside a Webview.

`Totonoe Log: Copy Masked Text` copies the active editor's log text with timestamps and hosts masked, ready to paste into an external diff tool (what gets masked is configurable).

## Timezone normalization

Logs written in local time without an offset (e.g. `2024-01-02 03:04:05`)
are interpreted as UTC by default. When servers in different timezones are
involved, that skews the merged timeline. Three settings fix this:

- `totonoeLog.timezone.sourceOffset` — the UTC offset to assume for
  timestamps without explicit timezone information (default `UTC`).
  Timestamps that spell out an offset or `Z`, and epoch timestamps, are
  never shifted: what the log says always wins
- `totonoeLog.timezone.fileOffsets` — per-file overrides, matched against
  the file name (first matching rule wins):

  ```jsonc
  "totonoeLog.timezone.fileOffsets": [
    { "filePattern": "tokyo-.*\\.log", "offset": "+09:00" },
    { "filePattern": "nyc-.*\\.log", "offset": "-05:00" }
  ]
  ```

- `totonoeLog.timezone.display` — the timezone every view renders
  timestamps in: `UTC` (default, `Z` suffix), `local` (this machine's
  timezone, DST-aware), or a fixed offset such as `+09:00` (rendered as
  `2024-01-02T12:04:05.000+09:00`)

Timezone auto-detection is not implemented: a timestamp without an offset
carries no reliable signal to detect one from, so guessing would silently
corrupt the timeline instead of tidying it.

## Clock skew correction

Timezone settings can't help when a host's clock itself is wrong — say,
a server drifting 40 seconds ahead because NTP is broken. The
`totonoeLog.clockSkew.fileOffsets` setting corrects such logs by ±N
seconds, per file-name pattern (first matching rule wins):

```jsonc
"totonoeLog.clockSkew.fileOffsets": [
  { "filePattern": "app-server\\.log", "offsetSeconds": -40 },
  { "filePattern": "db-.*\\.log", "offsetSeconds": 2.5 }
]
```

Unlike `totonoeLog.timezone.sourceOffset`, the correction applies to
every recognized timestamp — including ones with an explicit offset,
`Z`, or epoch form — because the clock that produced them was itself
off. Merged and normalized/filtered/collapsed views sort, display, and
date-filter by the corrected times. The raw log text is never
rewritten, and the compare view is unaffected (it masks timestamps
entirely). Invalid entries are skipped with a warning; the remaining
rules keep working.

## Custom timestamp formats

If your logs use a timestamp format the built-ins don't recognize, add it
with the `totonoeLog.timestampFormats` setting. Each entry is a regular
expression whose named capture groups tell Totonoe Log how to interpret the
match. Custom formats are tried before the built-in ones, so they can also
override a built-in interpretation. Patterns are automatically anchored to
the start of the line.

When most lines of a log are left without a timestamp, Totonoe Log says so
instead of quietly folding them into one huge entry: the virtual-document
commands notify you once per file, and the Interactive View shows it in its
warning line for every loaded file — including the ones added later with
**+ Add Files...**.

```jsonc
"totonoeLog.timestampFormats": [
  {
    "name": "jp-date",
    "pattern": "(?<y>\\d{4})年(?<mo>\\d{1,2})月(?<d>\\d{1,2})日 (?<h>\\d{1,2}):(?<mi>\\d{2}):(?<s>\\d{2})"
  }
]
```

Supported capture groups:

- Calendar style: `y` `mo` `d` `h` `mi` `s` (all required), plus optional
  `ms` (fractional seconds), `tzs` `tzh` `tzm` (offset sign/hours/minutes),
  and `tzz` (a literal `Z` meaning explicit UTC). Without an offset the
  timestamp is interpreted as UTC, or as `totonoeLog.timezone.sourceOffset`
  when that setting is configured
- Epoch style: `epochMs` (epoch milliseconds) or `epochSec` (epoch seconds,
  with an optional `ms` group for the fractional part)

Invalid entries (bad regex, missing groups) are skipped with a warning;
the remaining formats keep working.

## Installation

Download `totonoe-log.vsix` from the [GitHub Releases page](https://github.com/upu/Totonoe-Log/releases) and install it:

```bash
code --install-extension totonoe-log.vsix
```

or run **Extensions: Install from VSIX...** from the Command Palette.

## Settings

All settings live under the `totonoeLog` namespace.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `totonoeLog.gap.thresholdSeconds` | number | `30` | Insert a "XX seconds of silence" separator line in the views `Open in Virtual Document` produces when the timestamp gap between consecutive entries is at least this many seconds. It also applies to the ordering left after `Set Filter`. `0` disables it. |
| `totonoeLog.collapse.threshold` | number | `3` | How many consecutive repeats it takes before the Interactive View folds them into one line. |
| `totonoeLog.interactiveView.maxDisplayLines` | number | `20000` | Maximum number of lines `Show Interactive View` renders at once. Beyond this, only the leading lines are rendered and a notice suggests narrowing the filters or opening the whole log with "Export as Virtual Document". `0` disables the cap. |
| `totonoeLog.copyMasked.maskTimestamp` | boolean | `true` | Mask timestamps when running `Copy Masked Text`. |
| `totonoeLog.copyMasked.maskHost` | boolean | `true` | Mask IPv4/IPv6 addresses — and the hostname token of lines recognized as syslog format (not arbitrary hostnames in general) — when running `Copy Masked Text`. |
| `totonoeLog.copyMasked.maskProcessId` | boolean | `false` | Mask process IDs — syslog-style `sshd[1234]:` tags and notations that spell out `pid`, such as `pid=1234` — when running `Copy Masked Text`. Also the initial selection of the Interactive View mask panel. |
| `totonoeLog.timezone.sourceOffset` | string | `"UTC"` | UTC offset (e.g. `+09:00`) to assume for timestamps without explicit timezone information. Does not affect timestamps with an explicit offset or `Z`, or epoch formats. See [Timezone normalization](#timezone-normalization). |
| `totonoeLog.timezone.fileOffsets` | array | `[]` | Per-file-name-pattern overrides of `totonoeLog.timezone.sourceOffset`, for correcting per-server timezone differences when merging. Rules are evaluated top to bottom; the first match wins. |
| `totonoeLog.timezone.display` | string | `"UTC"` | The timezone every view renders timestamps in: `UTC`, `local` (this machine's timezone), or a UTC offset like `+09:00` (rendered as `2024-01-02T12:04:05.000+09:00`). |
| `totonoeLog.clockSkew.fileOffsets` | array | `[]` | Shift the timestamps of logs from hosts with skewed clocks by ±N seconds, per file-name pattern. Applies to all recognized timestamps regardless of timezone notation; merged and normalized views use the corrected times. The first matching rule wins. See [Clock skew correction](#clock-skew-correction). |
| `totonoeLog.timestampFormats` | array | `[]` | Add timestamp formats the built-ins don't recognize, as regular expressions with named capture groups. Tried before the built-in formats. See [Custom timestamp formats](#custom-timestamp-formats). |
| `totonoeLog.highlightRules` | array | `[]` | Color the keywords/patterns you are looking for in `Show Interactive View`. Only the matched text is colored — no lines are removed. See [Highlight rules](#highlight-rules). |

## The Totonoe series

Totonoe Log is the first of a planned "Totonoe" series: small VS Code extensions, each built around tidying up (整える, *totonoeru*) some kind of messy input.

## License

MIT
