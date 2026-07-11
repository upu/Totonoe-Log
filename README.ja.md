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
