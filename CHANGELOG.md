# Changelog

All notable changes to the "Totonoe Log" extension will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.1.0
