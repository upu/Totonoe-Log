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
- 日付やホストが異なる2つのログを、それらの違いを diff ノイズとして出さずに比較
  （`Totonoe Log: Compare Logs`）
- タイムスタンプ/ホスト情報をマスクしたテキストをコピーし、外部の diff
  ツールに貼り付けやすくする（`Totonoe Log: Copy Masked Text`）
- 繰り返しパターンの折りたたみ（例: 「×5」）
  （`Totonoe Log: Show Collapsed View`）
- 複数のログファイルを日時ベースでマージし、ファイルを横断した調査を可能に。
  ファイル名・ファイル「種類」列付き（例: `message_20240101.log` → 種類
  `message`）（`Totonoe Log: Show Merged View`）

## 実装予定の機能

- 特定のノイズとなるログ行を非表示（無視）

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
