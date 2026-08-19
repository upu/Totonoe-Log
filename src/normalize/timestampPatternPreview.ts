import { compileCustomTimestampFormats } from "./customTimestampFormats";
import type { SettingsValidationError } from "./settingsErrors";
import type { LogEntry, TimestampParseContext } from "./types";

/**
 * 1行に対するプレビュー結果。
 *
 * `matchedText` / `capturedGroups` は正規表現としてマッチしていれば入る一方、
 * `matched` は `timestampMs` が求まった（＝ `parseLog` が実際に認識できる）
 * ときだけ true にする。両者を分けるのは、「マッチはしたが日時として不正
 * （例: 2月30日）」を「そもそもマッチしない」と区別してユーザーに見せるため。
 */
export interface TimestampPatternPreviewMatch {
  readonly line: string;
  readonly matched: boolean;
  readonly matchedText: string | undefined;
  readonly capturedGroups: Readonly<Record<string, string | undefined>> | undefined;
  readonly timestampMs: number | undefined;
}

export interface TimestampPatternPreviewResult {
  readonly errors: readonly SettingsValidationError[];
  /** `errors` が空でないときは検証できていないため常に空配列。 */
  readonly matches: readonly TimestampPatternPreviewMatch[];
}

/**
 * 保存前のパターンを検証し、サンプル行に対するマッチ結果をまとめて返す。
 *
 * 検証は `compileCustomTimestampFormats` をそのまま通すことで、保存時
 * （`writeTimestampFormatRows`）と同じ判定・同じエラーコード体系を保つ
 * ——プレビューだけ通って保存で弾かれる（またはその逆）を起こさないため。
 */
export function previewTimestampFormat(
  name: string,
  pattern: string,
  sampleLines: readonly string[],
  context?: TimestampParseContext
): TimestampPatternPreviewResult {
  const { formats, errors } = compileCustomTimestampFormats([{ name, pattern }]);
  if (errors.length > 0 || formats.length === 0) {
    return { errors, matches: [] };
  }

  const [format] = formats;
  const matches = sampleLines.map((line): TimestampPatternPreviewMatch => {
    // 行頭アンカー付きの正規表現なので lastIndex は使わないが、g/y フラグを
    // 持つ他の形式と足並みを揃えて念のためリセットする。
    format.regex.lastIndex = 0;
    const match = format.regex.exec(line);
    if (!match) {
      return {
        line,
        matched: false,
        matchedText: undefined,
        capturedGroups: undefined,
        timestampMs: undefined,
      };
    }
    const timestampMs = format.parse(match, context);
    return {
      line,
      matched: timestampMs !== undefined,
      matchedText: match[0],
      capturedGroups: match.groups,
      timestampMs,
    };
  });

  return { errors, matches };
}

/**
 * `parseLog` の結果からタイムスタンプを認識できなかった行を抽出する。
 * パネルに並べる「未認識行の一覧」の元データになる。
 *
 * `matched: false` のエントリは「最初に認識できたタイムスタンプより前に
 * 現れた行」（`timestampCoverage.ts` 参照）に限られ、ファイル中で高々1件
 * しか存在しない。そのエントリが複数行（`unrecognized-format.log` のように
 * ファイル全体が未認識の場合を含む）にまたがるため、`entry.lines` を1件ずつ
 * 展開する。空行は形式未対応の手がかりにならず選択のしようもないため、
 * `assessTimestampRecognition` と同じく分母・分子どちらからも除外する。
 */
export function collectUnrecognizedLines(
  entries: readonly LogEntry[],
  limit: number
): readonly string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.matched) {
      continue;
    }
    for (const line of entry.lines) {
      if (line.trim().length === 0) {
        continue;
      }
      lines.push(line);
      if (lines.length >= limit) {
        return lines;
      }
    }
  }
  return lines;
}
