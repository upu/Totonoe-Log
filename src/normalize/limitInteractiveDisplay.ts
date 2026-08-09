import type { InteractiveDisplayItem } from "./buildInteractiveCollapsedLines";
import type { LineSource } from "./lineSources";

/**
 * Interactive View が一度に描画する行数の既定の上限（issue #178）。
 * 折りたたみ表示では行ごとに `<span>` を作るため、DOMノード数がこの値に
 * 比例して増える。大きなログを開いても描画が破綻しない程度に抑えつつ、
 * 通常の調査で切り詰めが起きない程度には大きい値として選んだ。
 */
export const DEFAULT_MAX_DISPLAY_LINES = 20000;

/** {@link limitInteractiveDisplay} が切り詰める対象（`buildInteractivePayload` の結果のうち描画に使う部分）。 */
export interface InteractiveDisplayContent {
  readonly text: string;
  /**
   * `text` の各行（0始まり）に対応する元ログ上の位置（issue #179）。行クリック
   * でのジャンプに使うため、`text` を切り詰めたら必ず同じ位置で切り詰める。
   */
  readonly lineSources?: readonly (LineSource | undefined)[];
  readonly items?: readonly InteractiveDisplayItem[];
}

export interface LimitedInteractiveDisplay extends InteractiveDisplayContent {
  /** 上限を超えて切り詰めた場合のみ、実際に残した行数。上限内なら undefined。 */
  readonly displayedLineCount?: number;
}

/**
 * 折りたたみグループが占める行数は、見出し行を足した `lines.length + 1` で
 * 数える（issue #299）。折りたたみ中は見出しの1行しか見えないが、Webview側は
 * 折りたたみ時の見出し行と展開後の行の両方を最初からDOMに載せて
 * 表示/非表示を切り替えるだけ（`main.ts` の `appendGroupItem`）なので、
 * DOMの重さは見出し行と展開後の行数の合計で決まる。
 */
function countItemLines(item: InteractiveDisplayItem): number {
  return item.kind === "line" ? 1 : item.lines.length + 1;
}

/**
 * 上限に収まるところまで表示単位を詰める。グループ1件だけで上限を超える
 * 場合は、そのグループの `lines` を上限まで切り詰めて1件だけ残す——
 * 何も表示されない画面を返さないため。ただし見出し行のぶんを引くと残せる
 * `lines` が1行も無くなる場合（上限が1行のとき）だけは、展開しても何も
 * 出ないグループになるので載せない。
 */
function limitItems(
  items: readonly InteractiveDisplayItem[],
  maxDisplayLines: number
): { readonly items: readonly InteractiveDisplayItem[]; readonly lineCount: number } {
  const limited: InteractiveDisplayItem[] = [];
  let lineCount = 0;

  for (const item of items) {
    const remaining = maxDisplayLines - lineCount;
    if (remaining <= 0) {
      break;
    }
    const itemLines = countItemLines(item);
    if (itemLines <= remaining) {
      limited.push(item);
      lineCount += itemLines;
      continue;
    }
    // 見出し行のぶんを引いた残りが `lines` に割ける行数。
    const remainingGroupLines = remaining - 1;
    if (limited.length === 0 && item.kind === "group" && remainingGroupLines > 0) {
      const lines = item.lines.slice(0, remainingGroupLines);
      limited.push(
        item.lineSources
          ? { ...item, lines, lineSources: item.lineSources.slice(0, remainingGroupLines) }
          : { ...item, lines }
      );
      lineCount += remaining;
    }
    break;
  }

  return { items: limited, lineCount };
}

/**
 * Interactive View に送る表示内容を、指定した行数の上限まで切り詰める
 * （issue #178）。上限を超えてもエラーにせず先頭のみを返し、絞り込みで
 * 行数を減らせば通常表示に戻る、という縮退の仕方は `mergedView.ts` の
 * 50MiBフォールバックと同じ考え方。全体を扱いたい場合はWebviewの
 * 「Export as Virtual Document」（仮想ドキュメント）側へ誘導する。
 *
 * `text` と `items` は排他的に使われる（Webview側は `items` があればそれを、
 * 無ければ `text` を描画する）が、`postMessage` で送るデータ量自体を抑える
 * ため両方切り詰める。
 *
 * `maxDisplayLines` が0以下なら上限なしとして扱う（`totonoeLog.gap.thresholdSeconds`
 * と同じく、0を「無効化」の意味で使えるようにするため）。
 */
export function limitInteractiveDisplay(
  content: InteractiveDisplayContent,
  maxDisplayLines: number
): LimitedInteractiveDisplay {
  if (maxDisplayLines <= 0) {
    return content;
  }

  const textLines = content.text === "" ? [] : content.text.split("\n");
  const items = content.items;
  const limitedItems = items ? limitItems(items, maxDisplayLines) : undefined;

  const textTruncated = textLines.length > maxDisplayLines;
  // グループを部分的に切り詰めた場合は件数が変わらないため、行数で比べる。
  const itemsTruncated =
    items !== undefined &&
    limitedItems !== undefined &&
    limitedItems.lineCount < items.reduce((total, item) => total + countItemLines(item), 0);
  if (!textTruncated && !itemsTruncated) {
    return content;
  }

  return {
    text: textTruncated ? textLines.slice(0, maxDisplayLines).join("\n") : content.text,
    lineSources: textTruncated
      ? content.lineSources?.slice(0, maxDisplayLines)
      : content.lineSources,
    items: limitedItems?.items,
    // 表示中の行数は、実際に描画される方（`items` があればそちら）で数える。
    displayedLineCount: limitedItems
      ? limitedItems.lineCount
      : Math.min(textLines.length, maxDisplayLines),
  };
}
