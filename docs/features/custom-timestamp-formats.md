🌐 [日本語](custom-timestamp-formats.ja.md)

# Custom timestamp formats

The full syntax for the `totonoeLog.timestampFormats` setting — what a custom
timestamp format looks like and its available capture groups. For why you'd
want one and how the Interactive View can propose one for you, see
[Custom timestamp formats](../../README.md#custom-timestamp-formats) in the
README.

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
