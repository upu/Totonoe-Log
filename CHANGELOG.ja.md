# 変更履歴

「Totonoe Log」拡張機能の注目すべき変更はすべてこのファイルに記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/spec/v2.0.0.html)
に準拠します。

## [Unreleased]

- プロジェクトの初期骨組みを作成：拡張機能スケルトン、ビルド/テスト環境、CI。
- ログ正規化エンジン（`src/normalize`）を追加：生ログのテキストを共通の
  `LogEntry` 構造（タイムスタンプ / セベリティ / 本文 / 元の生テキスト）に
  分解し、スタックトレースなど複数行にまたがるログをひとつのエントリとして
  まとめる。タイムスタンプの正規表現ベースのパーサをプラガブルにし、ISO
  8601、log4j 形式の角括弧付きタイムスタンプ、syslog 形式のタイムスタンプに
  対応。パースできない行も「不明な行」として保持し、落とさない。まだ UI と
  は接続しておらず、絞り込み・マージ・折りたたみ・比較機能の土台となる。

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.0.1...HEAD
