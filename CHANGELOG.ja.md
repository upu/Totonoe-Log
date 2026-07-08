# 変更履歴

「Totonoe Log」拡張機能の注目すべき変更はすべてこのファイルに記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/spec/v2.0.0.html)
に準拠します。

## [Unreleased]

## [0.1.0] - 2026-07-08

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
- 「Totonoe Log: Show Normalized View Filtered by Severity」コマンド
  （`totonoeLog.showNormalizedViewFilteredBySeverity`）を追加。表示したい
  セベリティ（ERROR / WARN / INFO / ... やセベリティ未認識のエントリ）を
  チェックボックス形式のピッカーで選択すると、該当するエントリだけを含む
  正規化ビューが開く。エントリを絞り込んだ場合でも、各行の元の行番号は
  正しく保たれる。
- 「Totonoe Log: Show Normalized View Filtered by Date Range」コマンド
  （`totonoeLog.showNormalizedViewFilteredByDateRange`）を追加。開始・終了
  日時（どちらも省略可）を入力すると、その範囲に含まれるエントリだけを
  含む正規化ビューが開く。タイムスタンプを認識できなかったエントリは範囲外
  として扱う。絞り込みで非表示にした行数は通知で表示する。

### Fixed

- 正規化ビューの仮想ドキュメント名で、元ファイルの拡張子が二重になっていた
  問題を修正（例: `app.log.normalized-1.log` ではなく `app.normalized-1.log`
  になるようにした）。
- 正規化ビューのタブを閉じたタイミングでキャッシュした内容を解放するように
  し、セッション中ずっとメモリに保持され続けないようにした。
- 正規化ビューの仮想ドキュメント名で、`.env` など他に拡張子を持たない
  ドットファイルの場合に名前全体が消えてしまい、`/.normalized-1.log`
  のようなパスになっていた問題を修正。先頭のドットは保持されるようにした。

[Unreleased]: https://github.com/upu/Totonoe-Log/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/upu/Totonoe-Log/releases/tag/v0.1.0
