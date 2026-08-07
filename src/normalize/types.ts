/**
 * Totonoe Log の全機能（絞り込み・マージ・折りたたみ・比較）が共有する
 * 正規化モデル。多様なログ形式をこの構造に変換することで、下流の処理が
 * 元のフォーマットを意識しなくて済むようにする。
 */

/**
 * 正規化後のログエントリ1件。
 *
 * 1件の「エントリ」は複数の物理行にまたがる場合がある
 *（例: ログ行 + Java スタックトレース）。`raw` にはエントリを構成する
 * 全行の元テキストをそのまま保持し、情報を決して失わないようにする。
 */
export interface LogEntry {
  /** エポックミリ秒で表したタイムスタンプ。認識・解析できない場合は undefined。 */
  readonly timestampMs: number | undefined;
  /** タイムスタンプとして認識された部分文字列。認識できない場合は undefined。 */
  readonly rawTimestamp: string | undefined;
  /** このエントリのタイムスタンプにマッチした TimestampFormat の名前。認識できない場合は undefined。 */
  readonly timestampFormat: string | undefined;
  /** セベリティ / レベル（例: "ERROR", "WARN"）。大文字に正規化済み。認識できない場合は undefined。 */
  readonly severity: string | undefined;
  /**
   * エントリの本文テキスト：先頭行からタイムスタンプ / セベリティを除いた部分と、
   * それに続く継続行を結合したもの。
   */
  readonly message: string;
  /**
   * このエントリの先頭行の、元のログファイルにおける行番号（1始まり）。
   * 絞り込み等でエントリの一部だけを表示する場合でも、元ファイルとの
   * 対応関係を保つために使う。
   */
  readonly startLine: number;
  /** このエントリを構成する、変更前の全物理行。 */
  readonly lines: readonly string[];
  /** `lines.join("\n")` — エントリの完全な元テキスト。 */
  readonly raw: string;
  /**
   * 先頭行をどのタイムスタンプフォーマットも認識できなかった場合は false。
   * そのようなエントリも「不明な行」として保持し、決して破棄しない。
   */
  readonly matched: boolean;
}

/**
 * {@link TimestampFormat.parse} に渡す解釈コンテキスト。
 */
export interface TimestampParseContext {
  /**
   * タイムスタンプ自体がタイムゾーン表記を持たない場合に仮定する UTC
   * オフセット（分）。省略時は UTC（0）。明示的なオフセットや `Z` を持つ
   * タイムスタンプには適用しないこと（書かれている情報を常に優先する）。
   */
  readonly fallbackUtcOffsetMinutes?: number;
}

/**
 * タイムスタンプ形式1種類に対応する、正規表現ベースのプラガブルパーサ。
 *
 * 実装側は `regex` を行頭（`^`）にアンカーすること。アクセスログのように
 * タイムスタンプの前に別のフィールドが置かれる形式（issue #301）は、`parseLog`
 * が既知の前置きを読み飛ばした位置から改めて適用するため、形式ごとに
 * アンカーを外す必要はない。
 */
export interface TimestampFormat {
  /** 一意の人間可読な名前（例: "iso8601", "syslog"）。 */
  readonly name: string;
  /** 適用位置の先頭にあるタイムスタンプにマッチする、アンカー付き正規表現。 */
  readonly regex: RegExp;
  /**
   * `regex` のマッチ結果をエポックミリ秒に変換する。
   * マッチしたテキストが有効な日時でない場合（例: "Feb 30"）は
   * `undefined` を返し、その行を未マッチとして扱わせる。
   *
   * `context` はタイムゾーン表記を持たない形式向けの補助情報。エポック形式の
   * ように絶対時刻を表す形式は無視してよい（省略可能な引数のため、既存の
   * 実装は変更なしで互換）。
   */
  parse(match: RegExpExecArray, context?: TimestampParseContext): number | undefined;
}
