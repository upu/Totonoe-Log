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
- Hide entries matching a pattern, always compiled as a regular expression
  (plain text without special regex characters works as a literal substring
  search) to cut noisy lines out of the way
  (`Totonoe Log: Show Normalized View Filtered by Ignore Pattern`)
- Mark large time gaps between entries with a "XX seconds of silence" line,
  so "silent" stretches stand out during an incident investigation. Applies
  to `Show Normalized View` and its filtered variants; threshold configurable
  via `totonoeLog.gap.thresholdSeconds` (default 30s, 0 disables it)

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
