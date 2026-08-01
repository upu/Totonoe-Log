import { getDefaultTimestampFormats } from "./timestampFormats";
import type { LogEntry, TimestampFormat, TimestampParseContext } from "./types";

/**
 * 認識済みのセベリティ / レベルトークン（重大度の低い順）。
 * マッチは大文字・小文字を区別しない。"WARNING" は "WARN" に正規化する。
 */
const SEVERITY_TOKENS = ["TRACE", "DEBUG", "INFO", "WARNING", "WARN", "ERROR", "FATAL", "CRITICAL"];

// \b を付けることで "ERRORCODE" のような単語の前置部分に誤マッチするのを防ぐ。
// log4j/logback の定番レイアウト `%d [%t] %-5p`（タイムスタンプの次にスレッド名、
// その次にレベル）に対応するため、`[main]` のような角括弧トークンを最大2個まで
// 読み飛ばすことを許容する。読み飛ばし対象を角括弧トークンに限定し、かつ2個までに
// 制限することで、メッセージ本文中の偶然の一致（例: 本文に "INFO" という単語が
// 含まれる）を誤ってセベリティと認識するリスクを抑える。
const SEVERITY_REGEX = new RegExp(
  `^[\\s\\-:|]*(?:\\[[^\\]\\r\\n]*\\][\\s\\-:|]*){0,2}\\[?(${SEVERITY_TOKENS.join("|")})\\b\\]?[\\s\\-:|]*`,
  "i"
);

function normalizeSeverity(token: string): string {
  const upper = token.toUpperCase();
  return upper === "WARNING" ? "WARN" : upper;
}

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

function findTimestampMatch(
  line: string,
  timestampFormats: readonly TimestampFormat[],
  parseContext: TimestampParseContext
): TimestampMatch | undefined {
  for (const format of timestampFormats) {
    // g / y フラグ付きの正規表現は lastIndex が状態を持つため、
    // 毎回リセットして次の行で誤動作しないようにする。
    format.regex.lastIndex = 0;
    const match = format.regex.exec(line);
    if (match && match.index === 0) {
      const timestampMs = format.parse(match, parseContext);
      if (timestampMs !== undefined) {
        return { format, match, timestampMs };
      }
    }
  }
  return undefined;
}

function createMatchedEntry(
  line: string,
  lineNumber: number,
  timestampMatch: TimestampMatch
): MutableEntry {
  const remainderAfterTimestamp = line.slice(timestampMatch.match[0].length);
  const severityMatch = SEVERITY_REGEX.exec(remainderAfterTimestamp);
  const severity = severityMatch ? normalizeSeverity(severityMatch[1]) : undefined;
  const remainderAfterSeverity = severityMatch
    ? remainderAfterTimestamp.slice(severityMatch[0].length)
    : remainderAfterTimestamp.replace(/^[\s\-:|]+/, "");

  return {
    timestampMs: timestampMatch.timestampMs,
    rawTimestamp: timestampMatch.match[0],
    timestampFormat: timestampMatch.format.name,
    severity,
    firstLineMessage: remainderAfterSeverity,
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
  const lines = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);

  const entries: LogEntry[] = [];
  let current: MutableEntry | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    const timestampMatch = findTimestampMatch(line, timestampFormats, parseContext);

    if (timestampMatch) {
      if (current) {
        entries.push(finalizeEntry(current));
      }
      current = createMatchedEntry(line, lineNumber, timestampMatch);
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
