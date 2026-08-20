🌐 [日本語](settings.ja.md)

# Settings reference

Every setting Totonoe Log contributes, with its type, default, and effect. This
page is for looking things up — what each setting is *for* is explained in the
[README](../../README.md), and each entry links back to the relevant section
there.

All settings live under the `totonoeLog` namespace.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `totonoeLog.gap.thresholdSeconds` | number | `30` | Insert a `XXs gap` separator line in the views `Open in Virtual Document` produces when the timestamp gap between consecutive entries is at least this many seconds. It also applies to the ordering left after `Set Filter`. `0` disables it. |
| `totonoeLog.collapse.threshold` | number | `3` | How many consecutive repeats it takes before the Interactive View folds them into one line. |
| `totonoeLog.interactiveView.maxDisplayLines` | number | `20000` | Maximum number of lines `Show Interactive View` renders at once. Beyond this, only the leading lines are rendered and a notice suggests narrowing the filters or opening the whole log with "Export as Virtual Document". `0` disables the cap. |
| `totonoeLog.copyMasked.maskTimestamp` | boolean | `true` | Mask timestamps when running `Copy Masked Text`. |
| `totonoeLog.copyMasked.maskHost` | boolean | `true` | Mask IPv4/IPv6 addresses — and the hostname token of lines recognized as syslog format (not arbitrary hostnames in general) — when running `Copy Masked Text`. |
| `totonoeLog.copyMasked.maskProcessId` | boolean | `false` | Mask process IDs — syslog-style `sshd[1234]:` tags and notations that spell out `pid`, such as `pid=1234` — when running `Copy Masked Text`. Also the initial selection of the Interactive View mask panel. |
| `totonoeLog.timezone.sourceOffset` | string | `"UTC"` | UTC offset (e.g. `+09:00`) to assume for timestamps without explicit timezone information. Does not affect timestamps with an explicit offset or `Z`, or epoch formats. See [Timezone normalization](timezone-normalization.md). |
| `totonoeLog.timezone.fileOffsets` | array | `[]` | Per-file-name-pattern overrides of `totonoeLog.timezone.sourceOffset`, for correcting per-server timezone differences when merging. Rules are evaluated top to bottom; the first match wins. |
| `totonoeLog.timezone.display` | string | `"UTC"` | The timezone every view renders timestamps in: `UTC`, `local` (this machine's timezone), or a UTC offset like `+09:00` (rendered as `2024-01-02T12:04:05.000+09:00`). |
| `totonoeLog.clockSkew.fileOffsets` | array | `[]` | Shift the timestamps of logs from hosts with skewed clocks by ±N seconds, per file-name pattern. Applies to all recognized timestamps regardless of timezone notation; merged and normalized views use the corrected times. The first matching rule wins. See [Clock skew correction](clock-skew-correction.md). |
| `totonoeLog.timestampFormats` | array | `[]` | Add timestamp formats the built-ins don't recognize, as regular expressions with named capture groups. Tried before the built-in formats. See [Custom timestamp formats](custom-timestamp-formats.md). |
| `totonoeLog.severityTokens` | array | `[]` | Add severity/level names the built-ins don't recognize, as plain names. Added to the built-in vocabulary rather than replacing it. See [Severity levels](../../README.md#severity-levels). |
| `totonoeLog.highlightRules` | array | `[]` | Color the keywords/patterns you are looking for in `Show Interactive View`. Only the matched text is colored — no lines are removed. See [Highlight rules](highlight-rules.md). |
