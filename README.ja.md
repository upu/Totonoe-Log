<!--
  このファイルは VS Code Marketplace の拡張機能ページとして公開されます（利用者向け）。
  開発・ビルド・コントリビュートの手順は AGENTS.md に書き、
  ここには利用者向けの内容だけを置いてください（開発者向けの記述を追加しないこと）。
-->

🇬🇧 [English](README.md)

# Totonoe Log

> バラバラなログを、調査しやすい時系列に整える。

Totonoe Log はログ調査のための VS Code 拡張機能です。実際のトラブル調査では、フォーマットもタイムスタンプもバラバラで、ノイズだらけの複数のログファイルとにらめっこすることになりがちです。Totonoe Log は、そんな散らかったログを一貫した読みやすいタイムラインに整え、フォーマットとの戦いではなく本来の調査に集中できるようにします。

どのビューも通常の読み取り専用エディタタブとして開くので、VS Code 標準の検索・コピー・diff がそのまま使えます。各コマンドはコマンドパレット（`Ctrl+Shift+P`）から実行します。

## 1本のタイムラインに正規化する

`Totonoe Log: Show Normalized View` は、アクティブなエディタのログファイルをパースし、行ごとの形式の違いによらず、すべてのエントリを共通の構造で表示し直します。

長い「沈黙」も見逃しません。連続するエントリのタイムスタンプ差がしきい値を超えた箇所には「XX秒の空白」の区切り行が挿入され、障害調査で空白時間がひと目で分かります（正規化ビューとその絞り込み系バリエーションに適用。`totonoeLog.gap.thresholdSeconds` で調整可能）。

## ノイズを絞り込みで取り除く

`Totonoe Log: Show Normalized View Filtered` では、複数の絞り込み条件を1つのフローで自由に組み合わせられます。複数選択リストから使いたい条件を選ぶと、選んだ条件のプロンプトだけが順に表示されます。

- **セベリティ** — error / warn / info などだけを残す
- **日付/時刻範囲** — 見たい時間帯だけに絞る
- **無視パターン** — パターンにマッチするエントリを非表示に。パターンは常に正規表現として解釈されますが、メタ文字を含まない文字列はそのまま部分一致として動作します

各条件は単独のコマンドとしても使えます（`... Filtered by Severity` / `... Filtered by Date Range` / `... Filtered by Date Range and Severity` / `... Filtered by Ignore Pattern`）。

## 複数ファイルをマージする

`Totonoe Log: Show Merged View` は、複数のログファイルを日時ベースで1本のタイムラインにマージし、ファイルを横断した調査を可能にします。ファイル名と、ファイルの「種類」列付きです（例: `message_20240101.log` → 種類 `message`）。

エクスプローラで2つ以上のファイルを選択し、右クリックのコンテキストメニューから直接マージすることもできます（`Totonoe Log: Merge Selected Files`）。

マージビューも絞り込みできます。`Totonoe Log: Show Merged View Filtered` は、マージ対象のファイルを選んでから、上記と同じ複数選択の絞り込みフローを適用します。

## 繰り返しを折りたたむ

`Totonoe Log: Show Collapsed View` は、連続する繰り返しパターンを繰り返し回数付きの1行（例: 「×5」）に折りたたみ、繰り返しのノイズが肝心のエントリを埋もれさせないようにします（しきい値は `totonoeLog.collapse.threshold` で調整可能）。

## 2つのログを比較する

`Totonoe Log: Compare Logs` は、日付やホストが異なる2つのログを、それらの違いを diff のノイズとして出さずに比較し、本当の差分だけを浮かび上がらせます。

`Totonoe Log: Copy Masked Text` は、アクティブなエディタのログテキストをタイムスタンプとホスト情報をマスクした形でコピーし、外部の diff ツールに貼り付けやすくします（マスク対象は設定で調整可能）。

## インストール

[GitHub Releases ページ](https://github.com/upu/Totonoe-Log/releases) から `totonoe-log.vsix` をダウンロードしてインストールします:

```bash
code --install-extension totonoe-log.vsix
```

コマンドパレットの **Extensions: Install from VSIX...**（VSIX からのインストール）からもインストールできます。

## 設定

設定はすべて `totonoeLog` 名前空間にあります。

| 設定 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `totonoeLog.gap.thresholdSeconds` | number | `30` | `Show Normalized View`（とその絞り込み系コマンド）で、連続するエントリのタイムスタンプ差がこの秒数以上のときに「XX秒の空白」の区切り行を挿入する。`0` で無効化。 |
| `totonoeLog.collapse.threshold` | number | `3` | `Show Collapsed View` で、何回以上連続で繰り返されたら1行に折りたたむかのしきい値。 |
| `totonoeLog.copyMasked.maskTimestamp` | boolean | `true` | `Copy Masked Text` 実行時にタイムスタンプをマスクする。 |
| `totonoeLog.copyMasked.maskHost` | boolean | `true` | `Copy Masked Text` 実行時に IPv4/IPv6 アドレスと、syslog 形式として認識できた行のホスト名トークンをマスクする（任意の形式のホスト名全般ではない）。 |

## Totonoe シリーズ

Totonoe Log は「Totonoe シリーズ」— 何かを「整える」というコンセプトの小さな VS Code 拡張機能群 — の第一弾として位置づけています。

## ライセンス

MIT
