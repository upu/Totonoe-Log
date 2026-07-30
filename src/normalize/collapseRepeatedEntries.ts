import type { LogEntry } from "./types";
import { maskHostAddresses } from "./maskForCompare";
import {
  maskDisplayMessageLines,
  masksMessageText,
  type DisplayMaskOptions,
} from "./displayMask";

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

  /**
   * 一致判定の前に掛ける表示マスク（issue #245）。Interactive View のマスク
   * パネル（issue #194）の状態がそのまま渡ってくる。
   *
   * マスクを一致判定にも通すのは、「画面上まったく同じに見える隣接行が
   * 折りたたまれない」状態を避けるため。キー指定欄・任意パターン欄
   * （issue #212・#195）はエントリ本文自体を置換してから折りたたみへ渡る
   * （`buildInteractivePayload`）ので元から一致判定に効いており、整形時にしか
   * 効かないチェックボックス側だけが取り残されていた。
   *
   * 省略時は何もマスクしない——マスクトグルを持たない仮想ドキュメント方式の
   * コマンドの出力を変えないため（{@link DisplayMaskOptions} と同じ既定）。
   */
  readonly mask?: DisplayMaskOptions;
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
 *
 * 表示マスク（issue #245）が指定されている場合は、整形時とまったく同じ
 * {@link maskDisplayMessageLines} を通してからキーを作る——別実装で近似すると、
 * 画面上は同じに見えるのに畳まれない（またはその逆の）ズレが再び生まれるため。
 * IPアドレスのマスクはその後も無条件に掛ける（マスクOFFでも畳めるという
 * 従来の挙動を保つ。プレースホルダーへの再適用は何も起きない）。
 */
function groupingKey(entry: LogEntry, mask: DisplayMaskOptions | undefined): string {
  // 本文に効くマスクが無いとき（既定のマスクOFF、タイムスタンプだけのマスク）は
  // 分割・結合ごと省いて元の本文を使う——この関数は全エントリに対して再描画の
  // たびに走るため。
  const message = masksMessageText(mask)
    ? maskDisplayMessageLines(entry.message.split("\n"), entry.timestampFormat, mask).join("\n")
    : entry.message;
  return JSON.stringify([entry.matched, entry.severity ?? "", maskHostAddresses(message)]);
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
  // 現在のラン先頭のキー。ラン内の全エントリと比較する代表値として使い回し、
  // ラン先頭のキーがランの長さ分だけ再計算されるのを避ける。
  let runKey: string | undefined;

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
    // 各エントリのキーはここで1回だけ計算し、ラン継続判定と次ランの代表値
    // 更新の両方に使い回す。
    const key = groupingKey(entry, options.mask);
    if (run.length > 0 && key === runKey) {
      run.push(entry);
    } else {
      flushRun();
      run = [entry];
      runKey = key;
    }
  }
  flushRun();

  return items;
}
