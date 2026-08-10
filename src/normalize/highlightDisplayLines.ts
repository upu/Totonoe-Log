import type { HighlightColor, HighlightRule } from "./highlightRules";
import { runPatternJob, type PatternWorkerOptions } from "./patternWorkerSession";

/**
 * マッチング処理を打ち切るまでの既定タイムアウト（ミリ秒）。
 * 絞り込み・マスクの各パターン処理と同じ値にして、ユーザーが書いた正規表現で
 * 待たされる時間の上限を揃える。
 */
const DEFAULT_TIMEOUT_MS = 2000;

/** 1行の中でハイライトする範囲（行内のUTF-16オフセット。`end` は含まない）。 */
export interface LineHighlight {
  readonly start: number;
  readonly end: number;
  readonly color: HighlightColor;
}

/**
 * {@link highlightDisplayLines} の結果。
 *
 * 成功時の `highlights` は「行のテキスト → その行のハイライト範囲」の組。
 * 行番号ではなく**行のテキストで引ける形**にしているのは、ハイライトが行の
 * 内容だけで決まる純粋な関数だから——同じ行が何度も現れるログでは組の数が
 * 減り、Webview 側も本文（プレーンテキストの1行・折りたたみの見出し・展開後の
 * 各行）の描画時に引くだけで済み、描画経路ごとに別の対応表を持たずに済む。
 *
 * 失敗時に「ハイライト無しで表示する」フォールバックをここでしないのは
 * 絞り込み・マスクと同じ。呼び出し側の扱いはマスク寄りで、ハイライトが
 * 効かなくても本文の表示自体は成立するため、結果を捨てずに続行する。
 */
export type HighlightDisplayLinesResult =
  | { readonly ok: true; readonly highlights: [string, LineHighlight[]][] }
  | { readonly ok: false; readonly reason: "timeout" | "error" };

export type HighlightDisplayLinesOptions = PatternWorkerOptions;

/**
 * 表示する行のうち、ハイライトルールに一致した箇所の範囲を求める（issue #18）。
 *
 * 対象は整形・マスク・表示上限の適用が終わった**表示そのものの行**。範囲は
 * 描画される文字列に対するオフセットなので、整形前のエントリではなくこの段階で
 * 計算する必要がある。同じ行はまとめて1回だけ評価する。
 *
 * ユーザーが書いた正規表現を評価する以上、破局的バックトラッキングで拡張
 * ホストがフリーズしうる。別スレッドに逃がしてタイムアウトで強制終了する
 * 対処は絞り込み（`filterByIgnorePattern`）・マスク（`maskByPattern`）と同じで、
 * 詳しい背景はそちらのコメント参照。
 *
 * 重なった範囲の扱い（#298）と幅0のマッチの扱いを含むマッチング本体は、
 * 4種類のパターン処理で1つのワーカーを共有するため `patternWorkerSession` に
 * ある（issue #303）。
 */
export async function highlightDisplayLines(
  lines: readonly string[],
  rules: readonly HighlightRule[],
  options: HighlightDisplayLinesOptions = {}
): Promise<HighlightDisplayLinesResult> {
  if (rules.length === 0 || lines.length === 0) {
    return { ok: true, highlights: [] };
  }

  const distinctLines = [...new Set(lines)];
  const matched = await runPatternJob<(LineHighlight[] | undefined)[]>(
    options.session,
    {
      kind: "highlight",
      rules: rules.map((rule) => ({
        source: rule.regex.source,
        flags: rule.regex.flags,
        color: rule.color,
      })),
      lines: distinctLines,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (!matched.ok) {
    return matched;
  }

  const highlights: [string, LineHighlight[]][] = [];
  distinctLines.forEach((line, index) => {
    const ranges = matched.value[index];
    // 一致が無かった行は組そのものを作らない（Webview 側は引けなければ
    // 従来どおりのプレーンな1行として描く）。
    if (ranges && ranges.length > 0) {
      highlights.push([line, ranges]);
    }
  });
  return { ok: true, highlights };
}
