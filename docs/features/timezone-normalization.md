🌐 [日本語](timezone-normalization.ja.md)

# Timezone normalization

The full syntax for the timezone-related settings. For why you'd need this and
the auto-detection rationale, see
[Timezone normalization](../../README.md#timezone-normalization) in the
README.

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
