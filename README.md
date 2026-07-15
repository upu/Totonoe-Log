# Totonoe Log

Normalize, merge, filter, collapse, and compare messy logs.

VSCode 拡張機能「Totonoe Log」— バラバラなログを、調査しやすい時系列に整える。

[日本語 README はこちら](./README.ja.md)

## Concept

Real-world troubleshooting means staring at multiple log files with
inconsistent formats, timestamps, and noise. Totonoe Log normalizes those
messy logs into a consistent, readable timeline so you can actually
investigate the issue instead of fighting the format.

## Status

🚧 Early scaffolding stage. Features are being built incrementally, one
GitHub issue / PR at a time. See the [issue tracker](https://github.com/upu/Totonoe-Log/issues)
for the current roadmap.

## Available now

- Normalize diverse log formats into a common structure
  (`Totonoe Log: Show Normalized View`)
- Filter by date/time range
  (`Totonoe Log: Show Normalized View Filtered by Date Range`)
- Filter by severity (error / warn / info / ...)
  (`Totonoe Log: Show Normalized View Filtered by Severity`)
- Filter by date/time range and severity together
  (`Totonoe Log: Show Normalized View Filtered by Date Range and Severity`)
- Freely combine severity, date/time range, and ignore pattern filters in a
  single flow: pick which conditions to apply from a multi-select QuickPick,
  then answer only the prompts for the conditions you picked
  (`Totonoe Log: Show Normalized View Filtered`)
- Compare two logs that differ in dates/hosts, without those differences
  showing up as noise in the diff (`Totonoe Log: Compare Logs`)
- Copy log text with timestamps/hosts masked, ready to paste into an
  external diff tool (`Totonoe Log: Copy Masked Text`)
- Collapse repeated patterns (e.g. "×5")
  (`Totonoe Log: Show Collapsed View`)
- Merge multiple log files by timestamp for cross-file investigation, with
  source file name / file "kind" columns (e.g. `message_20240101.log` →
  kind `message`) (`Totonoe Log: Show Merged View`). You can also select two
  or more files in the Explorer and merge them directly from the right-click
  context menu (`Totonoe Log: Merge Selected Files`)
- Filter the merged view too: pick the files to merge, then combine severity,
  date/time range, and/or ignore pattern filters in the same multi-select
  flow as `Show Normalized View Filtered`
  (`Totonoe Log: Show Merged View Filtered`)
- Hide entries matching a pattern, always compiled as a regular expression
  (plain text without special regex characters works as a literal substring
  search) to cut noisy lines out of the way
  (`Totonoe Log: Show Normalized View Filtered by Ignore Pattern`)
- Mark large time gaps between entries with a "XX seconds of silence" line,
  so "silent" stretches stand out during an incident investigation. Applies
  to `Show Normalized View` and its filtered variants; threshold configurable
  via `totonoeLog.gap.thresholdSeconds` (default 30s, 0 disables it)
- Recognize common timestamp formats out of the box: ISO 8601 (plain and
  bracketed), classic syslog, slash-separated dates (`2024/01/02 03:04:05`),
  Apache/Nginx access-log timestamps (`[02/Jan/2024:03:04:05 +0900]`), and
  leading epoch seconds/milliseconds. Formats not covered by the built-ins
  can be added via the `totonoeLog.timestampFormats` setting (see below)
- Normalize timezones: tell Totonoe Log which UTC offset to assume for
  timestamps that don't carry one — globally
  (`totonoeLog.timezone.sourceOffset`) or per file-name pattern
  (`totonoeLog.timezone.fileOffsets`), so logs from servers in different
  timezones merge into the true chronological order — and pick the timezone
  every view displays (`totonoeLog.timezone.display`: `UTC`, `local`, or a
  fixed offset like `+09:00`) (see below)
- Correct clock skew: shift the timestamps of logs from a host whose
  clock is off by ±N seconds, per file-name pattern
  (`totonoeLog.clockSkew.fileOffsets`), so its entries line up with the
  other logs in merged and normalized views (see below)

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

## Series

Totonoe Log is planned to be the first of a "Totonoe" series of small
VSCode extensions, each built around the concept of "tidying up"
(整える, *totonoeru*) some kind of messy input.

## Development

```bash
npm install
npm run compile   # type-check
npm test          # run the extension test suite
npm run build     # bundle with esbuild
```

## License

MIT
