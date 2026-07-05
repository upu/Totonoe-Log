# 変更履歴

「Totonoe Log」拡張機能の注目すべき変更はすべてこのファイルに記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/spec/v2.0.0.html)
に準拠します。

## [Unreleased]

- ログ正規化エンジン（`src/normalize`）を追加：生ログのテキストを共通の
  `LogEntry` 構造（タイムスタンプ / セベリティ / 本文 / 元の生テキスト）に
  分解し、スタックトレースなど複数行にまたがるログをひとつのエントリとして
  まとめる。タイムスタンプの正規表現ベースのパーサをプラガブルにし、ISO
  8601、log4j 形式の角括弧付きタイムスタンプ、syslog 形式のタイムスタンプに
  対応。パースできない行も「不明な行」として保持し、落とさない。まだ UI と
  は接続しておらず、絞り込み・マージ・折りたたみ・比較機能の土台となる。
- 「Totonoe Log: Show Normalized View」コマンド（`totonoeLog.showNormalizedView`）
  を追加。アクティブなエディタのログを正規化し、読み取り専用の仮想ドキュメント
  として開く。認識できたタイムスタンプは ISO 8601 に統一され、各行の先頭には
  元のログでの行番号を付けるため、正規化後の表示から元のログへ対応関係を
  たどれる。

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.0.1...HEAD
