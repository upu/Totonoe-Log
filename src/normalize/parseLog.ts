import { escapeForRegExp } from "./escapeForRegExp";
import { parseJsonLogLine, type JsonLogLine } from "./jsonLogLine";
import { normalizeSeverity } from "./severityNames";
import { getDefaultTimestampFormats } from "./timestampFormats";
import type { LogEntry, TimestampFormat, TimestampParseContext } from "./types";

/**
 * 認識済みのセベリティ / レベルトークン（重大度の低い順）。
 * マッチは大文字・小文字を区別しない。
 *
 * 素の 8 トークンに加えて、syslog / RFC 5424 の重大度名（`EMERG` `ALERT`
 * `CRIT` `ERR` `NOTICE`）、java.util.logging の `SEVERE`、Android logcat の
 * `VERBOSE`、Go の zerolog / logrus が出す `PANIC` を含む（issue #302）。
 * 認識できないとセベリティ絞り込みという中核の入口がその形式で使えなくなる。
 */
const SEVERITY_TOKENS = [
  "TRACE",
  "VERBOSE",
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARNING",
  "WARN",
  "ERROR",
  "ERR",
  "SEVERE",
  "CRITICAL",
  "CRIT",
  "ALERT",
  "EMERG",
  "FATAL",
  "PANIC",
];

/**
 * セベリティを読み取る正規表現を組み立てる。
 *
 * \b を付けることで "ERRORCODE" のような単語の前置部分に誤マッチするのを防ぐ。
 * log4j/logback の定番レイアウト `%d [%t] %-5p`（タイムスタンプの次にスレッド名、
 * その次にレベル）に対応するため、`[main]` のような角括弧トークンを最大2個まで
 * 読み飛ばすことを許容する。読み飛ばし対象を角括弧トークンに限定し、かつ2個までに
 * 制限することで、メッセージ本文中の偶然の一致（例: 本文に "INFO" という単語が
 * 含まれる）を誤ってセベリティと認識するリスクを抑える。
 *
 * 長いトークンから順に並べるのは、選択肢が先勝ちのため——`ERR` が `ERROR` より
 * 先にあると `ERROR` の行が `ERR` として認識され、`OR` が message の先頭に
 * 残ってしまう。追加トークンも同じ並びに混ぜるので、`NOTICE2` を足しても
 * 組み込みの `NOTICE` を食い合わない。
 */
function buildSeverityRegex(additionalTokens: readonly string[]): RegExp {
  const tokens = [...SEVERITY_TOKENS, ...additionalTokens]
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegExp);
  return new RegExp(
    `^[\\s\\-:|]*(?:\\[[^\\]\\r\\n]*\\][\\s\\-:|]*){0,2}\\[?(${tokens.join("|")})\\b\\]?[\\s\\-:|]*`,
    "i"
  );
}

/** 追加トークンなしの既定。行ごとではなくパースごとに使い回す。 */
const DEFAULT_SEVERITY_REGEX = buildSeverityRegex([]);

/** JSON Lines として読めたエントリの `timestampFormat`（issue #300）。 */
const JSON_LINES_FORMAT_NAME = "json-lines";

export interface ParseLogOptions {
  /**
   * 各物理行に試みるタイムスタンプフォーマットの一覧（試行順）。
   * 省略時は {@link getDefaultTimestampFormats} を使う。カスタムリストを渡すことで、
   * このモジュールを変更せずに追加フォーマットを対応できる（プラガブル設計）。
   */
  readonly timestampFormats?: readonly TimestampFormat[];

  /**
   * タイムゾーン表記を持たないタイムスタンプに仮定する UTC オフセット（分）。
   * 省略時は UTC（0）。明示的なオフセットや `Z` を持つタイムスタンプ、
   * エポック形式には影響しない（issue #13）。
   */
  readonly sourceUtcOffsetMinutes?: number;

  /**
   * 組み込みのセベリティ語彙に**追加**で認識させるトークン（issue #302）。
   * 置き換えではなく追加なのは、設定の書き方を誤って組み込みの認識を丸ごと
   * 失う事故を防ぐため。空文字・空白のみの項目は無視する。
   */
  readonly severityTokens?: readonly string[];
}

interface MutableEntry {
  timestampMs: number | undefined;
  rawTimestamp: string | undefined;
  timestampFormat: string | undefined;
  severity: string | undefined;
  firstLineMessage: string | undefined;
  startLine: number;
  lines: string[];
  matched: boolean;
}

interface TimestampMatch {
  readonly format: TimestampFormat;
  readonly match: RegExpExecArray;
  readonly timestampMs: number;
  /** タイムスタンプの前にあった前置きフィールドの長さ（issue #301）。行頭なら 0。 */
  readonly prefixLength: number;
}

function finalizeEntry(entry: MutableEntry): LogEntry {
  const continuationLines = entry.lines.slice(1);
  const message = [entry.firstLineMessage ?? entry.lines[0], ...continuationLines].join("\n");
  return {
    timestampMs: entry.timestampMs,
    rawTimestamp: entry.rawTimestamp,
    timestampFormat: entry.timestampFormat,
    severity: entry.severity,
    message,
    startLine: entry.startLine,
    lines: entry.lines,
    raw: entry.lines.join("\n"),
    matched: entry.matched,
  };
}

/**
 * タイムスタンプより前に置かれる「前置きフィールド」1個分のパターン（issue #301）。
 *
 * 走査幅を決めて総当たりで探すのではなく、前置きの**形**を列挙して1個ずつ
 * 読み飛ばす。任意の位置を許すと、本文中の日時表記（`see 2024-01-02T03:04:05Z
 * for details` のような継続行）を新しいエントリの開始と誤認し、スタックトレースが
 * 割れてしまう。ここに並ぶ3つの形自体が誤検知の抑制装置なので、`\S+\s+` のような
 * 何にでも当たる形は入れないこと。
 */
const LEADING_FIELD_PATTERNS: readonly RegExp[] = [
  // Common / Combined Log Format のクライアント3フィールド（`10.0.0.1 - - `）。
  // 直後が `[` であることまで見て、普通の英文3語に当たらないようにする。
  /^\S+ \S+ \S+ (?=\[)/,
  // 角括弧のレベル・スレッド・ワーカー名（`[INFO] ` `[worker-3] `）。
  /^\[[^\]\r\n]{0,64}\]\s*/,
  // logfmt 風の key=value（`pid=1204 ` `host=web01 `）。
  /^[\w.-]+=\S+\s+/,
];

/** 読み飛ばす前置きの個数と総文字数の上限。深追いして本文へ踏み込まないための歯止め。 */
const MAX_LEADING_FIELDS = 3;
const MAX_LEADING_FIELD_LENGTH = 64;

function matchTimestampAt(
  line: string,
  offset: number,
  timestampFormats: readonly TimestampFormat[],
  parseContext: TimestampParseContext
): TimestampMatch | undefined {
  const text = offset === 0 ? line : line.slice(offset);
  for (const format of timestampFormats) {
    // g / y フラグ付きの正規表現は lastIndex が状態を持つため、
    // 毎回リセットして次の行で誤動作しないようにする。
    format.regex.lastIndex = 0;
    const match = format.regex.exec(text);
    if (match && match.index === 0) {
      const timestampMs = format.parse(match, parseContext);
      if (timestampMs !== undefined) {
        return { format, match, timestampMs, prefixLength: offset };
      }
    }
  }
  return undefined;
}

/** `offset` から始まる前置きフィールド1個分の長さ。どの形にも当たらなければ 0。 */
function leadingFieldLength(line: string, offset: number): number {
  const rest = line.slice(offset);
  for (const pattern of LEADING_FIELD_PATTERNS) {
    const match = pattern.exec(rest);
    if (match && match[0].length > 0) {
      return match[0].length;
    }
  }
  return 0;
}

/**
 * 行の先頭、または既知の前置きフィールドを読み飛ばした位置にあるタイムスタンプを探す。
 *
 * 前置きは1個読み飛ばすたびに全形式を試し直す。まとめて貪欲に食わせると
 * `[worker-3] [2024-01-02 03:04:05] msg` で角括弧を2つとも前置きとみなし、
 * タイムスタンプごと飲み込んでしまう。
 */
function findTimestampMatch(
  line: string,
  timestampFormats: readonly TimestampFormat[],
  parseContext: TimestampParseContext
): TimestampMatch | undefined {
  let offset = 0;
  for (let step = 0; step <= MAX_LEADING_FIELDS; step++) {
    const found = matchTimestampAt(line, offset, timestampFormats, parseContext);
    if (found) {
      return found;
    }
    const advance = leadingFieldLength(line, offset);
    if (advance === 0) {
      return undefined;
    }
    offset += advance;
    if (offset > MAX_LEADING_FIELD_LENGTH) {
      return undefined;
    }
  }
  return undefined;
}

function createMatchedEntry(
  line: string,
  lineNumber: number,
  timestampMatch: TimestampMatch,
  severityRegex: RegExp
): MutableEntry {
  const leadingFields = line.slice(0, timestampMatch.prefixLength);
  const remainderAfterTimestamp = line.slice(
    timestampMatch.prefixLength + timestampMatch.match[0].length
  );
  // セベリティはタイムスタンプの直後だけを見る（前置きの中は読まない）。判定の
  // 規則を1つに保つためで、`[INFO] 2024-... ` は message に `[INFO]` が残る。
  const severityMatch = severityRegex.exec(remainderAfterTimestamp);
  const severity = severityMatch ? normalizeSeverity(severityMatch[1]) : undefined;
  const remainderAfterSeverity = severityMatch
    ? remainderAfterTimestamp.slice(severityMatch[0].length)
    : remainderAfterTimestamp.replace(/^[\s\-:|]+/, "");

  return {
    timestampMs: timestampMatch.timestampMs,
    rawTimestamp: timestampMatch.match[0],
    timestampFormat: timestampMatch.format.name,
    severity,
    firstLineMessage: leadingFields + remainderAfterSeverity,
    startLine: lineNumber,
    lines: [line],
    matched: true,
  };
}

/** JSON Lines として読めた行のエントリ（issue #300）。本文の切り出しは JSON 側で済んでいる。 */
function createJsonEntry(line: string, lineNumber: number, parsed: JsonLogLine): MutableEntry {
  return {
    timestampMs: parsed.timestampMs,
    rawTimestamp: parsed.rawTimestamp,
    timestampFormat: JSON_LINES_FORMAT_NAME,
    severity: parsed.severity,
    firstLineMessage: parsed.message,
    startLine: lineNumber,
    lines: [line],
    matched: true,
  };
}

function createUnmatchedEntry(line: string, lineNumber: number): MutableEntry {
  return {
    timestampMs: undefined,
    rawTimestamp: undefined,
    timestampFormat: undefined,
    severity: undefined,
    firstLineMessage: undefined,
    startLine: lineNumber,
    lines: [line],
    matched: false,
  };
}

/**
 * 生のログテキストを共通の正規化構造（{@link LogEntry} 参照）に分割する。
 * これが Totonoe Log の他の全機能（絞り込み・マージ・折りたたみ・比較）の
 * 土台となる中核関数。
 *
 * 認識済みタイムスタンプで始まる行は新規エントリの開始として扱う。それ以外の
 * 行（スタックトレースのフレームなど）は直前のエントリへの継続行とみなし、
 * 複数行のログレコードをひとつにまとめる。認識済みタイムスタンプより前に
 * 現れた行、または全くタイムスタンプが認識されなかった場合も `matched: false`
 * の「不明」エントリとして保持し、情報を決してサイレントに破棄しない。
 */
export function parseLog(text: string, options: ParseLogOptions = {}): LogEntry[] {
  const timestampFormats = options.timestampFormats ?? getDefaultTimestampFormats();
  const parseContext: TimestampParseContext = {
    fallbackUtcOffsetMinutes: options.sourceUtcOffsetMinutes,
  };
  const severityRegex =
    options.severityTokens && options.severityTokens.length > 0
      ? buildSeverityRegex(options.severityTokens)
      : DEFAULT_SEVERITY_REGEX;
  const lines = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);

  const entries: LogEntry[] = [];
  let current: MutableEntry | undefined;

  // JSON Lines の時刻フィールドも、プレーンな行と同じ形式一覧で解釈する
  // （ISO 文字列・エポック数値・ソースオフセットの扱いを1つの規則に保つため）。
  const resolveTimestamp = (value: string): { timestampMs: number; rawTimestamp: string } | undefined => {
    const found = matchTimestampAt(value, 0, timestampFormats, parseContext);
    return found === undefined
      ? undefined
      : { timestampMs: found.timestampMs, rawTimestamp: found.match[0] };
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    const jsonLine = parseJsonLogLine(line, resolveTimestamp);
    const timestampMatch = jsonLine ? undefined : findTimestampMatch(line, timestampFormats, parseContext);

    if (jsonLine) {
      if (current) {
        entries.push(finalizeEntry(current));
      }
      current = createJsonEntry(line, lineNumber, jsonLine);
    } else if (timestampMatch) {
      if (current) {
        entries.push(finalizeEntry(current));
      }
      current = createMatchedEntry(line, lineNumber, timestampMatch, severityRegex);
    } else if (current) {
      current.lines.push(line);
    } else {
      current = createUnmatchedEntry(line, lineNumber);
    }
  }

  if (current) {
    entries.push(finalizeEntry(current));
  }

  return entries;
}
