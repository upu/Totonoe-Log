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

Long silent stretches are marked, too: when the timestamp gap between consecutive entries exceeds a threshold, a "XX seconds of silence" separator line is inserted so the quiet periods stand out during an incident investigation (applies to the normalized view and its filtered variants; configure with `totonoeLog.gap.thresholdSeconds`).

## Filter out the noise

`Totonoe Log: Show Normalized View Filtered` lets you freely combine filters in a single flow: pick the conditions you want from a multi-select list, and answer only the prompts for the conditions you picked.

- **Severity** — keep only error / warn / info / ...
- **Date/time range** — narrow down to the time window you care about
- **Ignore pattern** — hide entries matching a pattern. Patterns are compiled as regular expressions; plain text without special regex characters simply works as a substring match

Each condition is also available as its own command (`... Filtered by Severity`, `... Filtered by Date Range`, `... Filtered by Date Range and Severity`, `... Filtered by Ignore Pattern`).

## Merge multiple files

`Totonoe Log: Show Merged View` merges multiple log files by timestamp into a single timeline for cross-file investigation, with source file name and file "kind" columns (e.g. `message_20240101.log` → kind `message`).

You can also select two or more files in the Explorer and merge them straight from the right-click context menu (`Totonoe Log: Merge Selected Files`).

The merged view can be filtered too: `Totonoe Log: Show Merged View Filtered` picks the files to merge, then applies the same multi-select filter flow described above.

## Collapse repeated lines

`Totonoe Log: Show Collapsed View` folds consecutive repeated patterns into a single line with a repeat count (e.g. "×5"), so repetitive noise stops burying the interesting entries (threshold configurable with `totonoeLog.collapse.threshold`).

## Compare two logs

`Totonoe Log: Compare Logs` diffs two logs that differ in dates or hosts — without those differences flooding the diff as noise, so the real differences stand out.

`Totonoe Log: Copy Masked Text` copies the active editor's log text with timestamps and hosts masked, ready to paste into an external diff tool (what gets masked is configurable).

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
| `totonoeLog.gap.thresholdSeconds` | number | `30` | Insert a "XX seconds of silence" separator line in `Show Normalized View` (and its filtered variants) when the timestamp gap between consecutive entries is at least this many seconds. `0` disables it. |
| `totonoeLog.collapse.threshold` | number | `3` | How many consecutive repeats it takes before `Show Collapsed View` folds them into one line. |
| `totonoeLog.copyMasked.maskTimestamp` | boolean | `true` | Mask timestamps when running `Copy Masked Text`. |
| `totonoeLog.copyMasked.maskHost` | boolean | `true` | Mask IPv4/IPv6 addresses — and the hostname token of lines recognized as syslog format (not arbitrary hostnames in general) — when running `Copy Masked Text`. |

## The Totonoe series

Totonoe Log is the first of a planned "Totonoe" series: small VS Code extensions, each built around tidying up (整える, *totonoeru*) some kind of messy input.

## License

MIT
