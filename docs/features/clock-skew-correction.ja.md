🌐 [English](clock-skew-correction.md)

# クロックスキューの補正

`totonoeLog.clockSkew.fileOffsets` 設定の完全な構文と適用範囲。なぜ必要に
なるかは [クロックスキューの補正](../../README.ja.md#クロックスキューの補正)
（README）を参照してください。

```jsonc
"totonoeLog.clockSkew.fileOffsets": [
  { "filePattern": "app-server\\.log", "offsetSeconds": -40 },
  { "filePattern": "db-.*\\.log", "offsetSeconds": 2.5 }
]
```

規則はファイル名にマッチさせ、最初にマッチしたものを使います。
`totonoeLog.timezone.sourceOffset` と違い、この補正はオフセットや `Z` が
明示されたタイムスタンプ・エポック形式を含む、全認識済みタイムスタンプに
適用されます——時刻を刻んだ時計自体がずれていたためです。マージ・正規化・
絞り込み・折りたたみの各ビューは補正後の時刻で並び替え・表示・日付範囲の
絞り込みを行います。元のログテキストは決して書き換えられず、比較ビューは
影響を受けません（タイムスタンプ全体をマスクするため）。不正な設定項目は
警告を表示してスキップされ、残りの規則は機能し続けます。
