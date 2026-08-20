🌐 [English](custom-timestamp-formats.md)

# カスタムタイムスタンプ形式

`totonoeLog.timestampFormats` 設定の完全な構文——カスタムタイムスタンプ形式の
書き方と、使用できるキャプチャグループ一覧。なぜ必要になるか、Interactive
View がどう提案してくれるかは
[カスタムタイムスタンプ形式](../../README.ja.md#カスタムタイムスタンプ形式)
（README）を参照してください。

```jsonc
"totonoeLog.timestampFormats": [
  {
    "name": "jp-date",
    "pattern": "(?<y>\\d{4})年(?<mo>\\d{1,2})月(?<d>\\d{1,2})日 (?<h>\\d{1,2}):(?<mi>\\d{2}):(?<s>\\d{2})"
  }
]
```

使用できるキャプチャグループ:

- カレンダー形式: `y` `mo` `d` `h` `mi` `s`（すべて必須）に加え、任意で
  `ms`（小数秒）、`tzs` `tzh` `tzm`（オフセットの符号/時/分）、`tzz`
  （UTC の明示を表すリテラル `Z`）。オフセットがない場合は UTC、
  `totonoeLog.timezone.sourceOffset` を設定している場合はそのオフセット
  として解釈される
- エポック形式: `epochMs`（エポックミリ秒）または `epochSec`（エポック秒。
  任意の `ms` グループで小数部を指定可能）

不正な項目（正規表現の誤り・グループ不足）は警告を表示してスキップされ、
残りの形式はそのまま機能します。
