import type { LogEntry } from "./types";
import type { ParseLogOptions } from "./parseLog";
import { parseLog } from "./parseLog";
import { applyClockSkew } from "./clockSkew";

// 直前に別の文字がある最後の拡張子だけを除去する（`.env` 等のドット
// ファイルは拡張子とみなさない）。他の仮想ドキュメント名生成箇所と同じ規約。
const EXTENSION_REGEX = /(?<=[^.])\.[^./]+$/;

// ファイル名末尾の日付らしき部分（例: `_20240101`、`-2024-01-02`、
// `_20240101_1200`）を、直前の区切り文字ごと取り除く。
const DATE_LIKE_SUFFIX_REGEX =
  /[-_.]?\d{4}[-_]?\d{2}[-_]?\d{2}(?:[-_]?\d{2}[-_]?\d{2}(?:[-_]?\d{2})?)?[-_.]?$/;

// logrotate が付与する末尾の連番（`.1`、`.2` 等）を取り除く。区切り文字を
// 必須にして、`app2` のような偶然末尾が数字なだけの名前を巻き込まない
// ようにする。
const ROTATION_NUMBER_SUFFIX_REGEX = /[-_.]\d+$/;

/**
 * 末尾がローテーションマーカー（日付らしきサフィックス、または
 * logrotate 風の連番）である間、繰り返し取り除く。取り除くと空文字列に
 * なってしまう場合はその一回を行わずに打ち切る（例: ファイル名自体が
 * 日付そのものの場合）。
 */
function stripRotationMarkers(name: string): string {
  let current = name;
  for (;;) {
    const afterDate = current.replace(DATE_LIKE_SUFFIX_REGEX, "");
    if (afterDate !== current && afterDate.length > 0) {
      current = afterDate;
      continue;
    }
    const afterNumber = current.replace(ROTATION_NUMBER_SUFFIX_REGEX, "");
    if (afterNumber !== current && afterNumber.length > 0) {
      current = afterNumber;
      continue;
    }
    return current;
  }
}

/**
 * ファイル名から、ローテーションマーカーと拡張子を取り除いた「種類」を
 * 導く。例: `message_20240101.log` → `message`、`app.log.1` /
 * `app.log.2024-01-02` → `app`（`.1` や `.2024-01-02` は拡張子の後段に
 * 付くため、拡張子除去の前後どちらでもローテーションマーカーの除去を
 * 試みる。`app.log` のように拡張子しか無い名前を巻き込まないよう、
 * 拡張子自体（`.log` 等）はローテーションマーカーとして扱わない）。
 */
export function deriveLogKind(fileName: string): string {
  const preStripped = stripRotationMarkers(fileName);
  const withoutExtension = preStripped.replace(EXTENSION_REGEX, "");
  const base = withoutExtension.length > 0 ? withoutExtension : preStripped;
  const stripped = stripRotationMarkers(base);
  return stripped.length > 0 ? stripped : base;
}

/** {@link mergeLogFiles} に渡す、マージ対象のログファイル1件分。 */
export interface LogFileInput {
  readonly fileName: string;
  readonly text: string;
  /**
   * このファイル専用のソースオフセット（分）。指定すると `parseOptions` の
   * {@link ParseLogOptions.sourceUtcOffsetMinutes} より優先される。サーバごとに
   * タイムゾーンが異なるログを正しい時系列へマージするために使う（issue #13）。
   */
  readonly sourceUtcOffsetMinutes?: number;
  /**
   * このファイルに適用するクロックスキュー補正（ミリ秒、issue #15）。
   * 時計がずれているホストのログを正しい時系列へマージするために使う。
   * ソースオフセットと違い、パース後の全認識済みタイムスタンプへ一律に
   * 適用される（{@link applyClockSkew} 参照）。
   */
  readonly clockSkewMs?: number;
}

/**
 * {@link mergeLogFiles} が返す、マージ後のエントリ1件。元のエントリに、
 * どのファイル由来か（{@link fileName}）とその「種類」（{@link kind}、
 * {@link deriveLogKind} 参照）を付加する。
 */
export interface MergedEntry {
  readonly entry: LogEntry;
  readonly fileName: string;
  readonly kind: string;
}

/**
 * タイムスタンプ昇順の比較関数。未認識（`undefined`）のタイムスタンプは
 * 常に末尾へ回す。両方 `undefined` の場合は `0` を返す（同点の場合の順序は
 * 呼び出し側が明示的なタイブレークで決める）。`Infinity - Infinity` の
 * ような算術に頼ると `NaN` を返しうる（意図が読み取りづらい）ため、分岐で
 * 明示する。
 */
function compareByTimestamp(a: MergedEntry, b: MergedEntry): number {
  const aMs = a.entry.timestampMs;
  const bMs = b.entry.timestampMs;
  if (aMs === undefined && bMs === undefined) {
    return 0;
  }
  if (aMs === undefined) {
    return 1;
  }
  if (bMs === undefined) {
    return -1;
  }
  return aMs - bMs;
}

/**
 * 複数のログファイルを {@link parseLog} で正規化し、タイムスタンプを基準に
 * 時系列順へマージする。フォーマットが異なるファイル同士でも、共通の
 * {@link LogEntry.timestampMs} で比較するため正しく並ぶ（正規化エンジンに
 * 依存）。
 *
 * タイムスタンプを認識できなかったエントリは、末尾にまとめて配置する。
 * 同点（両方未認識、または同一タイムスタンプ）の場合は、投入順（ファイルの
 * 入力順・ファイル内の出現順）を明示的なタイブレークとして使う——
 * `Array.prototype.sort` の安定性のみに順序を委ねない。
 *
 * `parseOptions` は各ファイルの {@link parseLog} にそのまま渡す（省略時は
 * デフォルトのタイムスタンプフォーマットを使う）。テストで syslog の年推定の
 * 基準時刻を固定する場合などに使う。
 */
export function mergeLogFiles(
  files: readonly LogFileInput[],
  parseOptions: ParseLogOptions = {}
): MergedEntry[] {
  const merged: MergedEntry[] = [];

  for (const file of files) {
    const kind = deriveLogKind(file.fileName);
    const fileParseOptions =
      file.sourceUtcOffsetMinutes !== undefined
        ? { ...parseOptions, sourceUtcOffsetMinutes: file.sourceUtcOffsetMinutes }
        : parseOptions;
    const entries = applyClockSkew(parseLog(file.text, fileParseOptions), file.clockSkewMs ?? 0);
    for (const entry of entries) {
      merged.push({ entry, fileName: file.fileName, kind });
    }
  }

  return merged
    .map((item, insertionIndex) => ({ item, insertionIndex }))
    .sort((a, b) => compareByTimestamp(a.item, b.item) || a.insertionIndex - b.insertionIndex)
    .map(({ item }) => item);
}
