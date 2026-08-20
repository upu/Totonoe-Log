🌐 [English](timezone-normalization.md)

# タイムゾーンの正規化

タイムゾーン関連設定の完全な構文。なぜ必要になるか、自動検出を実装していない
理由は [タイムゾーンの正規化](../../README.ja.md#タイムゾーンの正規化)
（README）を参照してください。

- `totonoeLog.timezone.sourceOffset` — タイムゾーン表記を持たない
  タイムスタンプに仮定する UTC オフセット（既定は `UTC`）。オフセットや
  `Z` が明示されたタイムスタンプ、エポック形式には適用されない
  （ログに書かれている情報が常に優先される）
- `totonoeLog.timezone.fileOffsets` — ファイル名にマッチさせる
  パターンごとの上書き（最初にマッチした規則を使う）:

  ```jsonc
  "totonoeLog.timezone.fileOffsets": [
    { "filePattern": "tokyo-.*\\.log", "offset": "+09:00" },
    { "filePattern": "nyc-.*\\.log", "offset": "-05:00" }
  ]
  ```

- `totonoeLog.timezone.display` — 各ビューでタイムスタンプを表示する
  タイムゾーン。`UTC`（既定、`Z` サフィックス）、`local`（このマシンの
  タイムゾーン。DST 対応）、または `+09:00` のような固定オフセット
  （`2024-01-02T12:04:05.000+09:00` の形で表示される）
