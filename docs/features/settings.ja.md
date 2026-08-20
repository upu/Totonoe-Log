🌐 [English](settings.md)

# 設定リファレンス

Totonoe Log が提供する全設定を、型・既定値・効果とあわせてまとめたリファレンス。
「引く」ためのページなので、各設定が何のためにあるかは
[README](../../README.ja.md) 側で説明しており、各項目からその節へリンクしている。

設定はすべて `totonoeLog` 名前空間にあります。

| 設定 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `totonoeLog.gap.thresholdSeconds` | number | `30` | `Open in Virtual Document` が開くビューで、連続するエントリのタイムスタンプ差がこの秒数以上のときに `XXs gap` の区切り行を挿入する。`Set Filter` で絞り込んだ後の並びにも適用される。`0` で無効化。 |
| `totonoeLog.collapse.threshold` | number | `3` | Interactive View で、何回以上連続で繰り返されたら1行に折りたたむかのしきい値。 |
| `totonoeLog.interactiveView.maxDisplayLines` | number | `20000` | `Show Interactive View` が一度に描画する行数の上限。超えた場合は先頭のみを描画し、絞り込むか「Export as Virtual Document」で全体を開くよう案内する。`0` で無効化。 |
| `totonoeLog.copyMasked.maskTimestamp` | boolean | `true` | `Copy Masked Text` 実行時にタイムスタンプをマスクする。 |
| `totonoeLog.copyMasked.maskHost` | boolean | `true` | `Copy Masked Text` 実行時に IPv4/IPv6 アドレスと、syslog 形式として認識できた行のホスト名トークンをマスクする（任意の形式のホスト名全般ではない）。 |
| `totonoeLog.copyMasked.maskProcessId` | boolean | `false` | `Copy Masked Text` 実行時にプロセスIDをマスクする（syslog 形式の `sshd[1234]:` と、`pid=1234` のように pid と明記された表記）。Interactive View のマスクパネルの初期選択にもなる。 |
| `totonoeLog.timezone.sourceOffset` | string | `"UTC"` | タイムゾーン表記を持たないタイムスタンプに仮定する UTC オフセット（例: `+09:00`）。オフセットや `Z` が明示されたタイムスタンプ、エポック形式には影響しない。[タイムゾーンの正規化](timezone-normalization.ja.md) を参照。 |
| `totonoeLog.timezone.fileOffsets` | array | `[]` | ファイル名パターンごとに `totonoeLog.timezone.sourceOffset` を上書きする。マージ時にサーバごとのタイムゾーン違いを補正する用途。上から順に評価し、最初にマッチした規則を使う。 |
| `totonoeLog.timezone.display` | string | `"UTC"` | 各ビューでタイムスタンプを表示するタイムゾーン。`UTC`、`local`（このマシンのタイムゾーン）、または `+09:00` のような UTC オフセット（`2024-01-02T12:04:05.000+09:00` の形で表示される）。 |
| `totonoeLog.clockSkew.fileOffsets` | array | `[]` | 時計がずれているホストのログの時刻を、ファイル名パターンごとに±N秒補正する。タイムゾーン表記の有無にかかわらず全認識済みタイムスタンプに適用され、マージ・正規化ビューは補正後の時刻を使う。最初にマッチした規則を使う。[クロックスキューの補正](clock-skew-correction.ja.md) を参照。 |
| `totonoeLog.timestampFormats` | array | `[]` | 組み込みで認識されないタイムスタンプ形式を、正規表現＋名前付きキャプチャグループで追加する。組み込み形式より先に試行される。[カスタムタイムスタンプ形式](custom-timestamp-formats.ja.md) を参照。 |
| `totonoeLog.severityTokens` | array | `[]` | 組み込みで認識されないセベリティ/レベル名を、素の名前で追加する。組み込みの語彙を置き換えるのではなく追加する。[セベリティのレベル名](../../README.ja.md#セベリティのレベル名) を参照。 |
| `totonoeLog.highlightRules` | array | `[]` | `Show Interactive View` で探しているキーワード/パターンに色を付ける。色が付くのは一致した箇所だけで、行は消えない。[ハイライトルール](highlight-rules.ja.md) を参照。 |
