# Totonoe Log

バラバラなログを、調査しやすい時系列に整える VSCode 拡張機能。

Normalize, merge, filter, collapse, and compare messy logs.

[English README is here](./README.md)

## コンセプト

実際のトラブル調査では、フォーマットもタイムスタンプもバラバラで、ノイズだらけの
複数のログファイルとにらめっこすることになりがちです。Totonoe Log は、そんな
散らかったログを一貫した読みやすいタイムラインに整え、フォーマットとの戦いでは
なく本来の調査に集中できるようにします。

## ステータス

🚧 骨組みを作った段階です。機能は GitHub の issue / PR を1つずつ進める形で、
順次実装していきます。現在のロードマップは
[issue 一覧](https://github.com/upu/Totonoe-Log/issues) を参照してください。

## 実装済みの機能

- 多様なログ形式を共通の構造に正規化
  （`Totonoe Log: Show Normalized View`）
- 日付/時刻範囲での絞り込み
  （`Totonoe Log: Show Normalized View Filtered by Date Range`）
- セベリティ（error / warn / info など）での絞り込み
  （`Totonoe Log: Show Normalized View Filtered by Severity`）
- 日付/時刻範囲とセベリティを組み合わせた絞り込み
  （`Totonoe Log: Show Normalized View Filtered by Date Range and Severity`）
- セベリティ・日付/時刻範囲・無視パターンを1つのフローで自由に組み合わせて
  絞り込み。複数選択可能な QuickPick でどの条件を使うか選び、選んだ条件に
  ついてだけプロンプトが順に表示される（`Totonoe Log: Show Normalized View
  Filtered`）
- 日付やホストが異なる2つのログを、それらの違いを diff ノイズとして出さずに比較
  （`Totonoe Log: Compare Logs`）
- タイムスタンプ/ホスト情報をマスクしたテキストをコピーし、外部の diff
  ツールに貼り付けやすくする（`Totonoe Log: Copy Masked Text`）
- 繰り返しパターンの折りたたみ（例: 「×5」）
  （`Totonoe Log: Show Collapsed View`）
- 複数のログファイルを日時ベースでマージし、ファイルを横断した調査を可能に。
  ファイル名・ファイル「種類」列付き（例: `message_20240101.log` → 種類
  `message`）（`Totonoe Log: Show Merged View`）。エクスプローラで2つ以上の
  ファイルを選択し、右クリックのコンテキストメニューから直接マージすることも
  できる（`Totonoe Log: Merge Selected Files`）
- マージビューも絞り込み可能。マージ対象のファイルを選んでから、
  `Show Normalized View Filtered` と同じ複数選択フローでセベリティ・
  日付/時刻範囲・無視パターンを組み合わせて絞り込める
  （`Totonoe Log: Show Merged View Filtered`）
- パターン（常に正規表現として解釈される。メタ文字を含まない文字列は
  部分一致の検索として動作）にマッチするエントリを非表示にし、ノイズと
  なる行を調査の邪魔にならないようにする
  （`Totonoe Log: Show Normalized View Filtered by Ignore Pattern`）
- 連続するエントリのタイムスタンプ差が大きく開いた箇所に「XX秒の空白」の
  区切り行を挿入し、障害調査での「沈黙時間」を見つけやすくする。
  `Show Normalized View` とその絞り込み系バリエーションに適用され、しきい値は
  `totonoeLog.gap.thresholdSeconds` で調整可能（既定30秒、0で無効化）
- 一般的なタイムスタンプ形式を追加設定なしで認識: ISO 8601（通常/角括弧
  付き）、従来型 syslog、スラッシュ区切り日付（`2024/01/02 03:04:05`）、
  Apache/Nginx アクセスログ形式（`[02/Jan/2024:03:04:05 +0900]`）、行頭の
  エポック秒/ミリ秒。組み込みでカバーしきれない形式は
  `totonoeLog.timestampFormats` 設定で追加できる（下記参照）
- タイムゾーンの正規化: タイムゾーン表記を持たないタイムスタンプに仮定する
  UTC オフセットを、全体（`totonoeLog.timezone.sourceOffset`）または
  ファイル名パターンごと（`totonoeLog.timezone.fileOffsets`）に指定でき、
  タイムゾーンが異なるサーバのログも正しい時系列にマージできる。各ビューの
  表示タイムゾーンも選べる（`totonoeLog.timezone.display`: `UTC` / `local` /
  `+09:00` のような固定オフセット）（下記参照）

## タイムゾーンの正規化

オフセットなしのローカル時刻で書かれたログ（例: `2024-01-02 03:04:05`）は、
既定では UTC として解釈されます。タイムゾーンが異なるサーバのログが混ざると、
マージ後の時系列がずれてしまいます。次の3つの設定でこれを補正できます。

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

タイムゾーンの自動検出は実装していません。オフセットのないタイムスタンプ
にはタイムゾーンを判別できる確かな手がかりがなく、推測で決めると時系列を
静かに壊してしまうためです。

## カスタムタイムスタンプ形式

組み込みで認識されないタイムスタンプ形式のログには、
`totonoeLog.timestampFormats` 設定で形式を追加できます。各項目は正規表現で、
名前付きキャプチャグループによってマッチ結果の解釈方法を指定します。
カスタム形式は組み込み形式より先に試行されるため、組み込みの解釈を上書き
することもできます。パターンは自動的に行頭へアンカーされます。

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

## シリーズ構想

Totonoe Log は「Totonoe シリーズ」という、何かを「整える」というコンセプトの
小さな VSCode 拡張機能群の第一弾として位置づけています。

## 開発

```bash
npm install
npm run compile   # 型チェック
npm test          # 拡張機能のテストを実行
npm run build     # esbuild でバンドル
```

## ライセンス

MIT
