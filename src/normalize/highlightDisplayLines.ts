import { Worker } from "node:worker_threads";
import type { HighlightColor, HighlightRule } from "./highlightRules";

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

export interface HighlightDisplayLinesOptions {
  /** 既定のタイムアウトを上書きしたい場合に指定する（主にテスト用）。 */
  readonly timeoutMs?: number;
}

/**
 * ワーカースレッド側で実行するマッチング処理本体。`filterByIgnorePattern` と
 * 同じ理由で素の JS の文字列として複製している（ワーカーが呼び出し元の
 * モジュールを `require` できないため）。
 *
 * 重なった範囲は**先に書かれたルールを優先**して落とす。重なりをそのまま返すと
 * 描画時にどちらの色を出すか決められないうえ、後勝ちにすると一覧の上に足した
 * ルールが効かなくなって驚くため。
 *
 * 幅0のマッチ（`x*` 等）は `lastIndex` が進まず無限ループになるので、必ず1つ
 * 進める。範囲としても残さない——色を付けても何も見えないため。
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { rules, lines } = workerData;
const matchers = rules.map(({ source, flags }) => new RegExp(source, flags));

const highlights = lines.map((line) => {
  const found = [];
  matchers.forEach((matcher, ruleIndex) => {
    matcher.lastIndex = 0;
    let match;
    while ((match = matcher.exec(line)) !== null) {
      if (match[0].length === 0) {
        matcher.lastIndex += 1;
        continue;
      }
      found.push({ start: match.index, end: match.index + match[0].length, ruleIndex });
    }
  });

  found.sort((a, b) => a.start - b.start || a.ruleIndex - b.ruleIndex);

  const accepted = [];
  let lastEnd = 0;
  for (const range of found) {
    if (range.start < lastEnd) {
      continue;
    }
    accepted.push({ start: range.start, end: range.end, color: rules[range.ruleIndex].color });
    lastEnd = range.end;
  }
  return accepted;
});

parentPort.postMessage(highlights);
`;

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
 */
export function highlightDisplayLines(
  lines: readonly string[],
  rules: readonly HighlightRule[],
  options: HighlightDisplayLinesOptions = {}
): Promise<HighlightDisplayLinesResult> {
  if (rules.length === 0 || lines.length === 0) {
    return Promise.resolve({ ok: true, highlights: [] });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const distinctLines = [...new Set(lines)];

  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        rules: rules.map((rule) => ({
          source: rule.regex.source,
          flags: rule.regex.flags,
          color: rule.color,
        })),
        lines: distinctLines,
      },
    });

    let settled = false;
    const finish = (result: HighlightDisplayLinesResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, reason: "timeout" });
    }, timeoutMs);

    worker.once("message", (matched: LineHighlight[][]) => {
      const highlights: [string, LineHighlight[]][] = [];
      distinctLines.forEach((line, index) => {
        const ranges = matched[index];
        // 一致が無かった行は組そのものを作らない（Webview 側は引けなければ
        // 従来どおりのプレーンな1行として描く）。
        if (ranges && ranges.length > 0) {
          highlights.push([line, ranges]);
        }
      });
      finish({ ok: true, highlights });
    });

    // ルールは呼び出し側で `new RegExp` によりコンパイル済みのため通常は
    // 到達しないが、ワーカー内での予期しない例外に備えたフェイルセーフ。
    worker.once("error", () => {
      finish({ ok: false, reason: "error" });
    });
  });
}
