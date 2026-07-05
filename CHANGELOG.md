# Changelog

All notable changes to the "Totonoe Log" extension will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.0.1...HEAD
