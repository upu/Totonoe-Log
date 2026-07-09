import type { LogEntry } from "./types";
import { parseLog } from "./parseLog";

// 直前に別の文字がある最後の拡張子だけを除去する（`.env` 等のドット
// ファイルは拡張子とみなさない）。他の仮想ドキュメント名生成箇所と同じ規約。
const EXTENSION_REGEX = /(?<=[^.])\.[^./]+$/;

// ファイル名末尾の日付らしき部分（例: `_20240101`、`-2024-01-02`、
// `_20240101_1200`）を、直前の区切り文字ごと取り除く。
const DATE_LIKE_SUFFIX_REGEX =
  /[-_.]?\d{4}[-_]?\d{2}[-_]?\d{2}(?:[-_]?\d{2}[-_]?\d{2}(?:[-_]?\d{2})?)?[-_.]?$/;

/**
 * ファイル名から、日付部分を取り除いた「種類」を導く。例:
 * `message_20240101.log` → `message`。日付を取り除くと空になってしまう
 * 場合（ファイル名自体が日付そのものの場合）は、拡張子だけ除いた名前を
 * そのまま返す。
 */
export function deriveLogKind(fileName: string): string {
  const withoutExtension = fileName.replace(EXTENSION_REGEX, "");
  const stripped = withoutExtension.replace(DATE_LIKE_SUFFIX_REGEX, "");
  return stripped.length > 0 ? stripped : withoutExtension;
}

/** {@link mergeLogFiles} に渡す、マージ対象のログファイル1件分。 */
export interface LogFileInput {
  readonly fileName: string;
  readonly text: string;
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
 * 常に末尾へ回す。両方 `undefined` の場合は `0` を返し、`Array.prototype.sort`
 * の安定性に順序を委ねる（`Infinity - Infinity` のような算術に頼ると `NaN`
 * を返しうり意図が読み取りづらいため、分岐で明示する）。
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
 * タイムスタンプを認識できなかったエントリは、末尾にまとめて配置する
 * （安定ソートのため、複数ファイルにまたがる場合もファイルの入力順・
 * ファイル内の出現順は保たれる）。
 */
export function mergeLogFiles(files: readonly LogFileInput[]): MergedEntry[] {
  const merged: MergedEntry[] = [];

  for (const file of files) {
    const kind = deriveLogKind(file.fileName);
    for (const entry of parseLog(file.text)) {
      merged.push({ entry, fileName: file.fileName, kind });
    }
  }

  merged.sort(compareByTimestamp);

  return merged;
}
