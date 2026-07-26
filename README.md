<!--
  This file is published as the extension's page on the VS Code Marketplace (user-facing).
  Build/debug/contribution instructions belong in AGENTS.md —
  keep this file limited to user-facing content only.
-->

🇯🇵 [日本語](README.ja.md)

# Totonoe Log

> Normalize, merge, filter, collapse, and compare messy logs.

Totonoe Log is a VS Code extension for log investigation. Real-world troubleshooting means staring at multiple log files with inconsistent formats, timestamps, and noise. Totonoe Log normalizes those messy logs into a consistent, readable timeline so you can actually investigate the issue instead of fighting the format.

Every view opens as a regular read-only editor tab, so VS Code's built-in search, copy, and diff work exactly as you expect. Run the commands from the Command Palette (`Ctrl+Shift+P`).

## Normalize into one timeline

`Totonoe Log: Show Normalized View` parses the log file in the active editor and re-renders every entry in a common structure, regardless of the format each line was originally written in.

Common timestamp formats are recognized out of the box: ISO 8601 (plain and bracketed), classic syslog, slash-separated dates (`2024/01/02 03:04:05`), Apache/Nginx access-log timestamps (`[02/Jan/2024:03:04:05 +0900]`), and leading epoch seconds/milliseconds. Formats not covered by the built-ins can be added via the `totonoeLog.timestampFormats` setting (see [Custom timestamp formats](#custom-timestamp-formats)).

Long silent stretches are marked, too: when the timestamp gap between consecutive entries exceeds a threshold, a "XX seconds of silence" separator line is inserted so the quiet periods stand out during an incident investigation (applies to the normalized view and the merged view, and their filtered variants; configure with `totonoeLog.gap.thresholdSeconds`).

## Filter out the noise

`Totonoe Log: Show Normalized View Filtered` lets you freely combine filters in a single flow: pick the conditions you want from a multi-select list, and answer only the prompts for the conditions you picked.

- **Severity** — keep only error / warn / info / ...
- **Date/time range** — narrow down to the time window you care about
- **Ignore pattern** — hide entries matching a pattern. Patterns are compiled as regular expressions; plain text without special regex characters simply works as a substring match

Each condition is also available as its own command (`... Filtered by Severity`, `... Filtered by Date Range`, `... Filtered by Date Range and Severity`, `... Filtered by Ignore Pattern`).

Date/time boundaries use the timezone selected by `totonoeLog.timezone.display`.
You can therefore copy the wall-clock part of a timestamp shown in a view
(for example, enter `2024-01-02 12:04:05` when the view shows
`2024-01-02T12:04:05.000+09:00`). Date-only input covers that whole day in
the selected timezone. With `local`, ordinary times use the machine's local
timezone; a nonexistent time during a daylight-saving transition is rejected,
and a repeated time selects its earlier occurrence.

## Merge multiple files

Select two or more log files in the Explorer, then right-click and choose `Totonoe Log: Merge Selected Files` to merge them by timestamp into a single timeline for cross-file investigation, with source file name and file "kind" columns (e.g. `message_20240101.log` → kind `message`). Hovering over the file name column shows the full source path, so same-named files merged from different folders can still be told apart.

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

The merged view can be filtered too: select the files in the Explorer and choose `Totonoe Log: Merge Selected Files Filtered` instead, which applies the same multi-select filter flow described above right after merging.

The same "XX seconds of silence" gap detection described above applies here too, spotting silent stretches across all merged source files (see [Normalize into one timeline](#normalize-into-one-timeline)).

Logs from servers in different timezones, or from a host whose clock is off, can be corrected per file so they still merge into the true chronological order (see [Timezone normalization](#timezone-normalization) and [Clock skew correction](#clock-skew-correction)).

## Collapse repeated lines

`Totonoe Log: Show Collapsed View` folds consecutive repeated patterns into a single line with a repeat count (e.g. "×5"), so repetitive noise stops burying the interesting entries (threshold configurable with `totonoeLog.collapse.threshold`). Each collapsed line also shows the group's timestamp span (start 〜 end), so you can tell a burst that happened in seconds from one spread over hours without expanding the group.

## Interactive View (Alpha)

`Totonoe Log: Show Interactive View (Alpha)` opens the normalized log in a Webview panel where you can toggle severity, date-range, and ignore-pattern filters live, without round-tripping through Quick Pick dialogs. A "+ Add Files..." button lets you load more log files into the same panel; once two or more files are loaded, the view switches to a merged, filename/kind-columned display. Double-clicking a log line — or right-clicking it and picking "Totonoe Log: Go to Source Line" — jumps to that line in the original file, and hovering it shows the source file's full path and line number (a single click never jumps, so selecting text stays safe; generated lines such as gap markers have no original line, and a collapsed group's header line keeps its expand/restore click). Very large results are rendered only up to `totonoeLog.interactiveView.maxDisplayLines` lines, with a notice pointing at narrowing the filters or opening the whole thing with the panel's "Export as Virtual Document" button. This is an experimental first step toward a Webview-based interactive view (tracked in issue #165/#166/#168); its behavior may change, and the read-only virtual-document views above remain the primary, stable way to work with logs.

## Compare two logs

`Totonoe Log: Compare Logs` diffs two logs that differ in dates or hosts — without those differences flooding the diff as noise, so the real differences stand out.

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
| `totonoeLog.gap.thresholdSeconds` | number | `30` | Insert a "XX seconds of silence" separator line in `Show Normalized View` and the merged view (`Merge Selected Files` and their filtered variants) when the timestamp gap between consecutive entries is at least this many seconds. `0` disables it. |
| `totonoeLog.collapse.threshold` | number | `3` | How many consecutive repeats it takes before `Show Collapsed View` folds them into one line. |
| `totonoeLog.interactiveView.maxDisplayLines` | number | `20000` | Maximum number of lines `Show Interactive View (Alpha)` renders at once. Beyond this, only the leading lines are rendered and a notice suggests narrowing the filters or opening the whole log with "Export as Virtual Document". `0` disables the cap. |
| `totonoeLog.copyMasked.maskTimestamp` | boolean | `true` | Mask timestamps when running `Copy Masked Text`. |
| `totonoeLog.copyMasked.maskHost` | boolean | `true` | Mask IPv4/IPv6 addresses — and the hostname token of lines recognized as syslog format (not arbitrary hostnames in general) — when running `Copy Masked Text`. |
| `totonoeLog.timezone.sourceOffset` | string | `"UTC"` | UTC offset (e.g. `+09:00`) to assume for timestamps without explicit timezone information. Does not affect timestamps with an explicit offset or `Z`, or epoch formats. See [Timezone normalization](#timezone-normalization). |
| `totonoeLog.timezone.fileOffsets` | array | `[]` | Per-file-name-pattern overrides of `totonoeLog.timezone.sourceOffset`, for correcting per-server timezone differences when merging. Rules are evaluated top to bottom; the first match wins. |
| `totonoeLog.timezone.display` | string | `"UTC"` | The timezone every view renders timestamps in: `UTC`, `local` (this machine's timezone), or a UTC offset like `+09:00` (rendered as `2024-01-02T12:04:05.000+09:00`). |
| `totonoeLog.clockSkew.fileOffsets` | array | `[]` | Shift the timestamps of logs from hosts with skewed clocks by ±N seconds, per file-name pattern. Applies to all recognized timestamps regardless of timezone notation; merged and normalized views use the corrected times. The first matching rule wins. See [Clock skew correction](#clock-skew-correction). |
| `totonoeLog.timestampFormats` | array | `[]` | Add timestamp formats the built-ins don't recognize, as regular expressions with named capture groups. Tried before the built-in formats. See [Custom timestamp formats](#custom-timestamp-formats). |

## The Totonoe series

Totonoe Log is the first of a planned "Totonoe" series: small VS Code extensions, each built around tidying up (整える, *totonoeru*) some kind of messy input.

## License

MIT
