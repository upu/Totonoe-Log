import type { LogEntry } from "./types";
import { type DisplayTimezone } from "./timezone";
import { formatMaskableTimestamp, type DisplayMaskOptions } from "./displayMask";
import { formatSeverity, messageColumnIndent } from "./severityColumn";

/**
 * 見出し行のタイムスタンプ欄に出す文字列。タイムスタンプを認識できなかった
 * エントリは見出しに欄自体を持たないため `undefined` を返す
 * （{@link composeEntryHeader} がセベリティ欄と継続行の字下げも一緒に落とす）。
 */
export function displayTimestampText(
  entry: Pick<LogEntry, "matched" | "timestampMs">,
  displayTimezone: DisplayTimezone,
  mask: DisplayMaskOptions | undefined
): string | undefined {
  return entry.matched && entry.timestampMs !== undefined
    ? formatMaskableTimestamp(entry.timestampMs, displayTimezone, mask)
    : undefined;
}

/** {@link composeEntryHeader} の結果。見出し行の本体と、継続行の字下げ。 */
export interface EntryHeader {
  /** ガター・ファイル名欄といった前置より後ろの、見出し行の本体。 */
  readonly headerText: string;
  /** 継続行をメッセージ開始桁まで下げる字下げ。タイムスタンプ欄が無い場合は空文字。 */
  readonly continuationIndent: string;
}

/**
 * 「タイムスタンプ + セベリティ + メッセージ1行目」という見出しの並びと、
 * それに対応する継続行の字下げを組み立てる。
 *
 * 正規化・マージ・折りたたみの3つの整形が同じ規則を使っており、以前は3箇所に
 * 同じ三項演算子の対が書かれていた。片方だけ直すと見出しと継続行の桁がずれる
 * 性質の対なので、1箇所に置く（issue #341）。前置（ガター / ファイル名欄）と
 * 行番号の付け方は整形ごとに違うため、呼び出し側に残す。
 */
export function composeEntryHeader(
  timestampText: string | undefined,
  severity: string | undefined,
  severityWidth: number,
  firstMessageLine: string
): EntryHeader {
  if (timestampText === undefined) {
    return { headerText: firstMessageLine, continuationIndent: "" };
  }

  return {
    headerText: `${timestampText} ${formatSeverity(severity, severityWidth)} ${firstMessageLine}`,
    continuationIndent: messageColumnIndent(timestampText, severityWidth),
  };
}
