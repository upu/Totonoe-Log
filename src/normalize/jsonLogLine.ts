/**
 * JSON Lines（NDJSON）1行を、他の形式と同じ正規化モデルへ読み替える（issue #300）。
 *
 * zap / pino / bunyan / Serilog / structlog / Docker の json-file ドライバなど、
 * 現代のバックエンドとコンテナ基盤の標準的な出力形式。行頭アンカーの正規表現と
 * いう `TimestampFormat` のプラガブル境界には収まらないため、`parseLog` の前段に
 * 置く別の経路として実装している。`TimestampFormat` 側へ押し込むと、消費した
 * 長さで本文を切り出す前提を JSON にも持ち込むことになり、両方が壊れる。
 */

import { normalizeSeverity } from "./severityNames";

/** {@link parseJsonLogLine} が返す、1行から読み取れた正規化済みの値。 */
export interface JsonLogLine {
  readonly timestampMs: number;
  readonly rawTimestamp: string;
  readonly severity: string | undefined;
  readonly message: string;
}

/**
 * タイムスタンプフィールドの値をエポックミリ秒へ解決する関数。
 *
 * 解決自体は呼び出し側（`parseLog`）が組み込み・カスタムのタイムスタンプ形式で
 * 行う。同じ形式一覧を通すことで、ISO 文字列もエポック数値も、プレーンテキストの
 * 行と完全に同じ規則で解釈される（ソースオフセットの扱いも含む）。
 */
export type ResolveTimestamp = (
  value: string
) => { readonly timestampMs: number; readonly rawTimestamp: string } | undefined;

/**
 * 時刻・レベル・本文として読むフィールド名の候補（優先順）。ライブラリごとに
 * 名前が違うため上から順に見て、最初に見つかったものを使う。使わなかった候補は
 * ただのデータとして `message` の key=value に残る。
 */
const TIMESTAMP_KEYS = ["ts", "time", "timestamp", "@timestamp", "t"];
const LEVEL_KEYS = ["level", "severity", "lvl"];
const MESSAGE_KEYS = ["msg", "message"];

/**
 * bunyan 系が数値で書くレベル。pino も既定でこの並びを使う。表に無い数値は
 * 独自レベルなので、捨てずに数値のまま `severity` にする。
 */
const NUMERIC_SEVERITIES: Record<number, string | undefined> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

function findKey(record: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  return candidates.find((key) => Object.prototype.hasOwnProperty.call(record, key));
}

/**
 * 値を key=value 形式の文字列にする。空白や引用符を含む文字列だけ JSON 表記へ
 * 逃がすのは、`host=db-01` のような大多数を素の字面のまま grep できるようにする
 * ため（logfmt と同じ考え方）。
 */
function renderFieldValue(value: unknown): string {
  if (typeof value === "string") {
    return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function resolveSeverity(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() === "" ? undefined : normalizeSeverity(value.trim());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return NUMERIC_SEVERITIES[value] ?? String(value);
  }
  return undefined;
}

/**
 * 時刻フィールドの値を、`resolveTimestamp` に渡せる文字列へ均す。数値は
 * そのまま文字列化すればエポック形式（10桁/13桁、小数秒つき）の規則に乗る。
 */
function toTimestampText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * 1行を JSON のオブジェクトとして読む。
 *
 * `{` で始まるかを先に見るのは、全行に `JSON.parse` を走らせないための門番。
 * JSON Lines のレコードは必ずオブジェクトなので、大半の行はこの1文字で外れる。
 */
function toLogRecord(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith("{")) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

interface ResolvedTimestampField {
  readonly key: string;
  readonly timestampMs: number;
  readonly rawTimestamp: string;
}

function resolveTimestampField(
  record: Record<string, unknown>,
  resolveTimestamp: ResolveTimestamp
): ResolvedTimestampField | undefined {
  const key = findKey(record, TIMESTAMP_KEYS);
  if (key === undefined) {
    return undefined;
  }
  const text = toTimestampText(record[key]);
  if (text === undefined) {
    return undefined;
  }
  const resolved = resolveTimestamp(text);
  return resolved === undefined ? undefined : { key, ...resolved };
}

/**
 * 本文フィールドに、使わなかったフィールドを `key=value` で足した message を作る。
 *
 * 本文以外も残すのは、構造化ログの調査価値がそこにあるため。message は
 * 一致/無視パターン・マスク・ハイライトの対象なので、ここに出ていないと
 * `host=db-01` で絞り込めない（元の JSON は `raw` に残るので、これは
 * 「見せる/絞り込める」ための整形であって保存のためではない）。
 */
function buildMessage(record: Record<string, unknown>, usedKeys: ReadonlySet<string>): string {
  const parts: string[] = [];
  const messageKey = findKey(record, MESSAGE_KEYS);
  const messageValue = messageKey === undefined ? undefined : record[messageKey];
  if (typeof messageValue === "string" && messageValue !== "") {
    parts.push(messageValue);
  }
  for (const [key, value] of Object.entries(record)) {
    if (!usedKeys.has(key)) {
      parts.push(`${key}=${renderFieldValue(value)}`);
    }
  }
  return parts.join(" ");
}

/**
 * 1行を JSON Lines のログレコードとして読む。JSON として解釈できない行、
 * オブジェクトでない行、使える時刻フィールドを持たない行は `undefined` を返し、
 * 呼び出し側に従来どおりの扱い（未認識行 / 継続行）を任せる。
 */
export function parseJsonLogLine(
  line: string,
  resolveTimestamp: ResolveTimestamp
): JsonLogLine | undefined {
  const record = toLogRecord(line);
  if (record === undefined) {
    return undefined;
  }
  const timestamp = resolveTimestampField(record, resolveTimestamp);
  if (timestamp === undefined) {
    return undefined;
  }

  const levelKey = findKey(record, LEVEL_KEYS);
  const usedKeys = new Set(
    [timestamp.key, levelKey, findKey(record, MESSAGE_KEYS)].filter((key) => key !== undefined)
  );

  return {
    timestampMs: timestamp.timestampMs,
    rawTimestamp: timestamp.rawTimestamp,
    severity: levelKey === undefined ? undefined : resolveSeverity(record[levelKey]),
    message: buildMessage(record, usedKeys),
  };
}
