import type { LogEntry } from "./types";

/** セベリティが認識できなかったエントリの見出しに表示するプレースホルダー。 */
export const SEVERITY_PLACEHOLDER = "-";

/**
 * 見出し行のセベリティ欄を、表示中で最も長い表記の幅に揃えるための桁数を返す
 * （issue #174）。
 *
 * ガターとタイムスタンプは元から固定幅なので、メッセージの開始桁がずれる原因は
 * セベリティの文字数だけ（`ERROR` / `INFO` / `-` / カスタム形式の任意文字列）。
 * ここを揃えればメッセージが縦に並ぶ。
 *
 * 固定幅（例: `ERROR` の5桁）にしないのは、`INFO` しか出ないログにまで余白を
 * 足してしまうため。逆に長いセベリティを使うログでは5桁では足りない。表示する
 * 顔ぶれから決めるのが、どちらにも無駄が出ない。
 *
 * タイムスタンプを認識できなかったエントリは見出しにセベリティ欄自体を持たない
 * ため、幅の計算から外す。
 */
export function computeSeverityWidth(entries: readonly LogEntry[]): number {
  let width = 0;
  for (const entry of entries) {
    if (!entry.matched || entry.timestampMs === undefined) {
      continue;
    }
    width = Math.max(width, (entry.severity ?? SEVERITY_PLACEHOLDER).length);
  }
  return width;
}

/** セベリティ（未認識ならプレースホルダー）を、指定桁まで右側に空白を詰めて返す。 */
export function formatSeverity(severity: string | undefined, width: number): string {
  return (severity ?? SEVERITY_PLACEHOLDER).padEnd(width);
}

/**
 * 継続行（スタックトレース等、直前のエントリに畳まれた行）を、見出し行の
 * メッセージ開始桁まで下げるための字下げを返す（issue #256）。見出しは
 * 「タイムスタンプ + 空白 + セベリティ + 空白」の後ろからメッセージが始まる。
 *
 * タイムスタンプ幅は表示タイムゾーン（UTC は24桁、`+09:00` は29桁）とマスク
 * （`<TIMESTAMP>` は11桁）で変わるため、固定値ではなく実際に組み立てた文字列
 * から求める。
 *
 * 呼び出すのは見出しにタイムスタンプ欄を持つエントリだけ。認識できなかった
 * エントリは見出し自体がガター直後から始まるので、継続行を下げると自分の
 * 見出しより右にずれてしまう。
 */
export function messageColumnIndent(timestampText: string, severityWidth: number): string {
  return " ".repeat(timestampText.length + 1 + severityWidth + 1);
}
