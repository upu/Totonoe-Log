import { getDefaultTimestampFormats } from "./timestampFormats";
import type { LogEntry, TimestampFormat } from "./types";

/**
 * 認識済みのセベリティ / レベルトークン（重大度の低い順）。
 * マッチは大文字・小文字を区別しない。"WARNING" は "WARN" に正規化する。
 */
const SEVERITY_TOKENS = ["TRACE", "DEBUG", "INFO", "WARNING", "WARN", "ERROR", "FATAL", "CRITICAL"];

// \b を付けることで "ERRORCODE" のような単語の前置部分に誤マッチするのを防ぐ。
const SEVERITY_REGEX = new RegExp(
  `^[\\s\\-:|]*\\[?(${SEVERITY_TOKENS.join("|")})\\b\\]?[\\s\\-:|]*`,
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
}

interface MutableEntry {
  timestampMs: number | undefined;
  rawTimestamp: string | undefined;
  timestampFormat: string | undefined;
  severity: string | undefined;
  firstLineMessage: string | undefined;
  lines: string[];
  matched: boolean;
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
    lines: entry.lines,
    raw: entry.lines.join("\n"),
    matched: entry.matched,
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
  const lines = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);

  const entries: LogEntry[] = [];
  let current: MutableEntry | undefined;

  for (const line of lines) {
    let matchedFormat: TimestampFormat | undefined;
    let match: RegExpExecArray | undefined;
    let timestampMs: number | undefined;

    for (const format of timestampFormats) {
      // g / y フラグ付きの正規表現は lastIndex が状態を持つため、
      // 毎回リセットして次の行で誤動作しないようにする。
      format.regex.lastIndex = 0;
      const candidate = format.regex.exec(line);
      if (candidate && candidate.index === 0) {
        const epochMs = format.parse(candidate);
        if (epochMs !== undefined) {
          matchedFormat = format;
          match = candidate;
          timestampMs = epochMs;
          break;
        }
      }
    }

    if (matchedFormat && match) {
      if (current) {
        entries.push(finalizeEntry(current));
      }

      const remainderAfterTimestamp = line.slice(match[0].length);
      const severityMatch = SEVERITY_REGEX.exec(remainderAfterTimestamp);
      const severity = severityMatch ? normalizeSeverity(severityMatch[1]) : undefined;
      const remainderAfterSeverity = severityMatch
        ? remainderAfterTimestamp.slice(severityMatch[0].length)
        : remainderAfterTimestamp.replace(/^[\s\-:|]+/, "");

      current = {
        timestampMs,
        rawTimestamp: match[0],
        timestampFormat: matchedFormat.name,
        severity,
        firstLineMessage: remainderAfterSeverity,
        lines: [line],
        matched: true,
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = {
        timestampMs: undefined,
        rawTimestamp: undefined,
        timestampFormat: undefined,
        severity: undefined,
        firstLineMessage: undefined,
        lines: [line],
        matched: false,
      };
    }
  }

  if (current) {
    entries.push(finalizeEntry(current));
  }

  return entries;
}
