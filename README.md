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
  `ms` (fractional seconds), and `tzs` `tzh` `tzm` (offset sign/hours/minutes).
  Without an offset the timestamp is interpreted as UTC
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
