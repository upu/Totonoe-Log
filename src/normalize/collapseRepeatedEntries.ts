import type { LogEntry } from "./types";
import { maskHostAddresses } from "./maskForCompare";

/** 折りたたみ判定のしきい値の既定値。この回数以上連続で繰り返されたら折りたたむ。 */
export const DEFAULT_COLLAPSE_THRESHOLD = 3;

/** {@link collapseRepeatedEntries} の挙動を調整するオプション。 */
export interface CollapseOptions {
  /**
   * 何回以上連続で繰り返されたら折りたたむかのしきい値。省略時は
   * {@link DEFAULT_COLLAPSE_THRESHOLD}。1件では意味を成さないため2未満は
   * 2として扱う。
   */
  readonly threshold?: number;
}

/**
 * {@link collapseRepeatedEntries} が返す1件分の出力単位。
 * `single` は折りたたまれなかった1件のエントリ、`group` はしきい値以上
 * 連続で繰り返された（可変部分を除いて一致する）エントリ群を表す。
 */
export type CollapsedItem =
  | { readonly kind: "single"; readonly entry: LogEntry }
  | { readonly kind: "group"; readonly entries: readonly LogEntry[] };

/**
 * 繰り返し検出の一致判定に使うキーを作る。タイムスタンプは {@link LogEntry.message}
 * に含まれないため比較対象から自然に除外される。IPv4/IPv6アドレスはホストごとの
 * 差異を無視できるよう、比較前にマスクする（{@link maskHostAddresses}、
 * 日付・ホスト情報が異なる2つのログを比較する機能とマスクロジックを共有）。
 * JSON化することで、フィールド同士の意図しない結合（区切り文字の衝突）を
 * 避ける。
 */
function groupingKey(entry: LogEntry): string {
  return JSON.stringify([entry.matched, entry.severity ?? "", maskHostAddresses(entry.message)]);
}

/**
 * {@link parseLog} が返す {@link LogEntry} の配列から、連続して繰り返される
 * （可変部分を除いて一致する）エントリをグループ化する。しきい値未満の
 * 繰り返しはグループ化せず、そのまま個別のエントリとして扱う。
 */
export function collapseRepeatedEntries(
  entries: readonly LogEntry[],
  options: CollapseOptions = {}
): CollapsedItem[] {
  const threshold = Math.max(2, options.threshold ?? DEFAULT_COLLAPSE_THRESHOLD);
  const items: CollapsedItem[] = [];
  let run: LogEntry[] = [];

  function flushRun(): void {
    if (run.length === 0) {
      return;
    }
    if (run.length >= threshold) {
      items.push({ kind: "group", entries: run });
    } else {
      for (const entry of run) {
        items.push({ kind: "single", entry });
      }
    }
    run = [];
  }

  for (const entry of entries) {
    if (run.length > 0 && groupingKey(run[0]) === groupingKey(entry)) {
      run.push(entry);
    } else {
      flushRun();
      run = [entry];
    }
  }
  flushRun();

  return items;
}
