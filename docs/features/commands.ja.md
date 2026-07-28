🌐 [English](commands.md)

# コマンド一覧

Totonoe Log が提供する全コマンドを、コマンドID・起動導線・出力とあわせてまとめた
リファレンス。「引く」ためのページなので、各機能が何のためにあるかは
[README](../../README.ja.md) 側で説明しており、各項目からその節へリンクしている。

コマンドパレット（`Ctrl+Shift+P`）では、すべて `Totonoe Log:` の接頭辞が付く。

## 一覧

| コマンド | ID | 起動導線 | 対象 |
| --- | --- | --- | --- |
| Show Interactive View | `totonoeLog.showInteractiveView` | パレット、エクスプローラ右クリック | エクスプローラの選択、無ければアクティブエディタ |
| Show Normalized View | `totonoeLog.showNormalizedView` | パレット | アクティブエディタ |
| Show Normalized View Filtered | `totonoeLog.showNormalizedViewFiltered` | パレット | アクティブエディタ |
| Show Collapsed View | `totonoeLog.showCollapsedView` | パレット | アクティブエディタ |
| Merge Selected Files | `totonoeLog.mergeSelectedFiles` | エクスプローラ右クリック | 選択した2つ以上のファイル |
| Merge Selected Files Filtered | `totonoeLog.mergeSelectedFilesFiltered` | エクスプローラ右クリック | 選択した2つ以上のファイル |
| Compare Logs | `totonoeLog.compareLogs` | パレット | ダイアログで選ぶ2ファイル |
| Copy Masked Text | `totonoeLog.copyMaskedText` | パレット | アクティブエディタの選択範囲、無ければ全体 |
| Go to Source Line | `totonoeLog.goToSourceLine` | パレット、エディタ右クリック | 正規化ビュー／マージビューのカーソル行 |
| Go to Source Line | `totonoeLog.goToSourceLineFromInteractiveView` | Interactive View の右クリックのみ | パネル上で右クリックした行 |

**Go to Source Line** という同じタイトルのコマンドが2つあるのは、同じ操作を別の
場所で提供しているため。Interactive View 用のほうはコマンドパレットから隠して
あり（`when: false`）、パレットに出るのはもう一方だけ。

## どこに出るか

- **コマンドパレット** — `totonoeLog.goToSourceLineFromInteractiveView` 以外の
  すべて。ただし `Merge Selected Files` 系の2つはパレットにも並ぶが、そこには
  対象の選択が無いため警告が出るだけになる（各項目参照）
- **エクスプローラ右クリック** — 複数選択時（`listMultiSelection`）に
  `Merge Selected Files` と `Merge Selected Files Filtered`、フォルダ以外
  （`!explorerResourceIsFolder`）に `Show Interactive View`
- **エディタ右クリック** — `Go to Source Line`。Totonoe Log が生成する読み取り
  専用ビュー（`totonoe-log-normalized` / `totonoe-log-merged`）の上でのみ出る
- **Interactive View の右クリック** — パネル内のログ行に対する
  `Go to Source Line`

既定のキーバインドが割り当てられたコマンドは無い。割り当てるときは、上表の
コマンドIDを **基本設定: キーボードショートカットを開く (JSON)** で使う。

## アクティブエディタを読むコマンド

`Show Normalized View`・`Show Normalized View Filtered`・`Show Collapsed View`・
`Copy Masked Text`、およびエクスプローラの選択なしで実行した
`Show Interactive View` は、いずれもアクティブエディタのログを読む（未保存の
変更を含む）。Totonoe Log 自身の読み取り専用ビュー上では実行できず警告になる。
整形済みのビューを再度パースすると誤読するため。

---

### Show Interactive View

`totonoeLog.showInteractiveView`

- **起動導線** — コマンドパレット、またはフォルダ以外の項目（複数可）に対する
  エクスプローラ右クリック
- **入力** — エクスプローラで選択がある場合はその選択（フォルダは除外される）、
  無ければアクティブエディタ
- **出力** — Webview パネル。同時に存在するパネルは1つだけで、再実行しても2つ目
  は開かず、既存のパネルを前面に出して読み込み直す
- **補足** — 「+ Add Files...」で同じパネルにログを追加でき、2ファイル以上に
  なるとマージ表示へ切り替わる。「Export as Virtual Document」は現在の状態を
  読み取り専用タブへ書き出す操作で、`Ctrl+F`・`Compare Logs`・表示上限を超える
  結果全体には、この書き出し経由で到達する
- **関連設定** — `interactiveView.maxDisplayLines`・`collapse.threshold`・
  `gap.thresholdSeconds`・`copyMasked.*`（マスクパネルの初期選択）、および
  [全コマンド共通の設定](#全コマンド共通の設定)。いずれも変更すると開いている
  パネルへ即座に反映される
- **詳細** — [Interactive View](../../README.ja.md#interactive-view)

### Show Normalized View

`totonoeLog.showNormalizedView`

- **起動導線** — コマンドパレット
- **入力** — アクティブエディタ
- **出力** — 読み取り専用の仮想ドキュメント（`totonoe-log-normalized` スキーム）。
  タブ名は `<元ファイル名>.normalized-N.log`。`N` は実行のたびに増えるため、
  同じファイルに対して繰り返し実行しても既存タブと衝突しない
- **関連設定** — `gap.thresholdSeconds`、および共通の解析・表示設定
- **詳細** — [1本のタイムラインに正規化する](../../README.ja.md#1本のタイムラインに正規化する)

### Show Normalized View Filtered

`totonoeLog.showNormalizedViewFiltered`

- **起動導線** — コマンドパレット
- **入力** — アクティブエディタ。続いて「どの条件で絞り込むか」（セベリティ／
  日時範囲／無視パターン）の複数選択ピッカーが出て、選んだ条件についてだけ
  順にプロンプトが出る。途中でキャンセルするか不正な入力をすると、何も開かずに
  中断する。条件を1つも選ばずに確定した場合は、絞り込みなしで開く
- **出力** — 上と同じ形式の読み取り専用の仮想ドキュメント。タブ名は
  `<元ファイル名>.filtered-N.log`。非表示にした行数が通知で出る
- **補足** — 日時の境界は `timezone.display` で選んだタイムゾーンで解釈されるので、
  ビューに表示されているタイムスタンプの時刻部分をそのまま貼り付けられる。
  パターンの評価に時間がかかりすぎた場合は、絞り込みなしにフォールバックせず、
  警告を出して何も開かない
- **関連設定** — `gap.thresholdSeconds`、および共通の解析・表示設定
- **詳細** — [ノイズを絞り込みで取り除く](../../README.ja.md#ノイズを絞り込みで取り除く)

### Show Collapsed View

`totonoeLog.showCollapsedView`

- **起動導線** — コマンドパレット
- **入力** — アクティブエディタ
- **出力** — 読み取り専用の仮想ドキュメント。タブ名は
  `<元ファイル名>.collapsed-N.log`。連続する繰り返しが、繰り返し回数と
  タイムスタンプの範囲を持つ1行にまとめられる
- **補足** — このビューにはギャップ行は挿入されない。元の全行を確認したい場合は
  `Show Normalized View` を別途開く
- **関連設定** — `collapse.threshold`、および共通の解析・表示設定
- **詳細** — [繰り返しを折りたたむ](../../README.ja.md#繰り返しを折りたたむ)

### Merge Selected Files

`totonoeLog.mergeSelectedFiles`

- **起動導線** — 複数選択に対するエクスプローラ右クリック。コマンドパレットにも
  並ぶが、そちらには対象の選択が無いため警告が出るだけになる
- **入力** — 選択したファイル（フォルダは除外）。フォルダを除いて2つ未満の場合は
  警告を出して終わる。選択はフォルダをまたいでよい。各ファイルはディスクから
  読み、VS Code のリソーススコープの `files.encoding` でデコードする
- **出力** — 読み取り専用の仮想ドキュメント（`totonoe-log-merged` スキーム）。
  タブ名は `merged-N.log`。元ファイル名と「種類」の列が付き、ファイル名列を
  ホバーすると元ファイルのフルパスが出る
- **補足** — 50 MiB 以上の結果は拡張機能の一時ストレージへ書き出し、通常のテキスト
  タブとして開く（VS Code のドキュメント同期上限を避けるため）。その一時コピーを
  編集しても元ログは変わらず、タブを閉じると削除される。この大容量結果では
  `Go to Source Line` は使えない。必要な行対応情報は仮想ドキュメントに対してのみ
  登録されるため
- **関連設定** — `gap.thresholdSeconds`、および共通の解析・表示設定。特に
  `timezone.fileOffsets` と `clockSkew.fileOffsets` はこのコマンドで効いてくる。
  サーバごとに異なるログを正しい時系列順でマージするための設定であるため
- **詳細** — [複数ファイルをマージする](../../README.ja.md#複数ファイルをマージする)

### Merge Selected Files Filtered

`totonoeLog.mergeSelectedFilesFiltered`

- **起動導線** — 複数選択に対するエクスプローラ右クリック。パレットについては
  `Merge Selected Files` と同じ
- **入力** — 選択の条件は上と同じ。そのあと `Show Normalized View Filtered` と
  同じ条件ピッカーとプロンプトが出る。絞り込みはマージの後に適用される
- **出力** — 読み取り専用の仮想ドキュメント。タブ名は `merged-filtered-N.log`
- **関連設定** — `Merge Selected Files` と同じ
- **詳細** — [複数ファイルをマージする](../../README.ja.md#複数ファイルをマージする)

### Compare Logs

`totonoeLog.compareLogs`

- **起動導線** — コマンドパレット
- **入力** — ファイル選択ダイアログが2回出て、1つずつ選ぶ。どちらかをキャンセル
  すると中断する
- **出力** — VS Code 標準の diff エディタ。中身は読み取り専用の仮想ドキュメント
  2つ（`totonoe-log-compare` スキーム）で、日付やホストの違いが差分を埋めない
  よう、タイムスタンプ等の可変部分はマスクされている
- **補足** — 比較ビューには行対応情報が無いため `Go to Source Line` は使えない。
  Interactive View で絞り込んだ結果を比較したい場合は、先に「Export as Virtual
  Document」で書き出してから、そのタブに対してこのコマンドを実行する。
  タイムスタンプは丸ごとマスクされるので、`timezone.*` と
  `clockSkew.fileOffsets` はここでは効かない
- **関連設定** — `timestampFormats`
- **詳細** — [2つのログを比較する](../../README.ja.md#2つのログを比較する)

### Copy Masked Text

`totonoeLog.copyMaskedText`

- **起動導線** — コマンドパレット
- **入力** — アクティブエディタの選択範囲。未選択の場合はドキュメント全体
- **出力** — マスク済みテキストをクリップボードへコピーする。元ログの書式は
  保ったまま、該当箇所だけを置き換える。ビューは開かない
- **関連設定** — `copyMasked.maskTimestamp`・`copyMasked.maskHost`・
  `copyMasked.maskProcessId`・`timestampFormats`。ビュー系のコマンドと違い、
  `timezone.sourceOffset` と `clockSkew.fileOffsets` は適用されない。タイム
  ラインを組み直すのではなく、元のテキストをその場で置き換える処理であるため
- **詳細** — [2つのログを比較する](../../README.ja.md#2つのログを比較する) と
  [設定](../../README.ja.md#設定)の表

### Go to Source Line

`totonoeLog.goToSourceLine`

- **起動導線** — コマンドパレット、およびエディタ右クリック。右クリックメニューに
  出るのは `totonoe-log-normalized` / `totonoe-log-merged` のドキュメント上のみ
- **入力** — それらのビュー上のカーソル行
- **出力** — 対応する元ログファイルの行を開く
- **補足** — ジャンプせずメッセージだけ出るケースが3つある。アクティブエディタが
  Totonoe Log のビューでない場合、ビューに行対応情報が無い場合（比較ビュー、
  または内容が解放されたビュー。後者は元のコマンドを再実行して開き直す）、
  そしてギャップ行のような生成行で元の行が存在しない場合
- **詳細** — [複数ファイルをマージする](../../README.ja.md#複数ファイルをマージする)

### Go to Source Line（Interactive View）

`totonoeLog.goToSourceLineFromInteractiveView`

- **起動導線** — Interactive View パネル内のログ行の右クリックのみ。クリックした
  行をコンテキストとして受け取る必要があり、それ無しでは対象が無いため、
  コマンドパレットからは意図的に隠してある
- **入力** — 右クリックした行
- **出力** — 対応する元ログファイルの行を開く
- **補足** — 行のダブルクリックでも同じことができる。シングルクリックでは
  ジャンプしないので、テキスト選択は安全に行える。ギャップ行のような生成行には
  元の行が無く、折りたたみグループの見出し行はクリックが展開／復元に使われる
- **詳細** — [Interactive View](../../README.ja.md#interactive-view)

---

## 全コマンド共通の設定

以下はログの解析・表示そのものに効くため、個別のコマンドではなくビュー系
コマンド全体に適用される（全体の表は[設定](../../README.ja.md#設定)を参照）。

| 設定 | 効果 |
| --- | --- |
| `totonoeLog.timestampFormats` | 組み込みが認識しないタイムスタンプ形式を追加する。組み込みより先に試されるため、組み込みの解釈を上書きもできる |
| `totonoeLog.timezone.sourceOffset` | タイムゾーン情報を持たないタイムスタンプに想定する UTC オフセット |
| `totonoeLog.timezone.fileOffsets` | 上をファイル名パターンごとに上書きする |
| `totonoeLog.timezone.display` | 各ビューがタイムスタンプを表示するタイムゾーン。日時プロンプトの入力もこの基準で解釈される |
| `totonoeLog.clockSkew.fileOffsets` | 時計がずれていたホストのログを ±N 秒補正する |

`Compare Logs` と `Copy Masked Text` は例外で、タイムラインを組み立てるのではなく
元テキストをマスク・書き換えする処理のため、効くのは `timestampFormats` だけ。
