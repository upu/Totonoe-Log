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

## Planned features

- Normalize diverse log formats into a common structure
- Filter by date/time range
- Filter by severity (error / warn / info / ...)
- Hide (ignore) specific noisy log lines
- Merge multiple log files by timestamp for cross-file investigation
  - Add source file name / file "kind" columns when merging
    (e.g. `message_20240101.log` → kind `message`)
- Collapse repeated patterns (e.g. "×5")
- Compare two logs that differ in dates/hosts, without those differences
  showing up as noise in the diff
- Copy log text with dates/hosts masked or stripped, ready to paste into
  an external diff tool

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
