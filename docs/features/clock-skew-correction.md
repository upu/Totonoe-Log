🌐 [日本語](clock-skew-correction.ja.md)

# Clock skew correction

The full syntax and scope of the `totonoeLog.clockSkew.fileOffsets` setting.
For why you'd need this, see
[Clock skew correction](../../README.md#clock-skew-correction) in the README.

```jsonc
"totonoeLog.clockSkew.fileOffsets": [
  { "filePattern": "app-server\\.log", "offsetSeconds": -40 },
  { "filePattern": "db-.*\\.log", "offsetSeconds": 2.5 }
]
```

Rules are matched against the file name; the first matching rule wins.
Unlike `totonoeLog.timezone.sourceOffset`, the correction applies to every
recognized timestamp — including ones with an explicit offset, `Z`, or epoch
form — because the clock that produced them was itself off. Merged and
normalized/filtered/collapsed views sort, display, and date-filter by the
corrected times. The raw log text is never rewritten, and the compare view is
unaffected (it masks timestamps entirely). Invalid entries are skipped with a
warning; the remaining rules keep working.
