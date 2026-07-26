import type { InteractiveDisplayItem } from "./buildInteractiveCollapsedLines";

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
  readonly items?: readonly InteractiveDisplayItem[];
}

export interface LimitedInteractiveDisplay extends InteractiveDisplayContent {
  /** 上限を超えて切り詰めた場合のみ、実際に残した行数。上限内なら undefined。 */
  readonly displayedLineCount?: number;
}

/**
 * 折りたたみグループが占める行数は、展開後の行数（`lines.length`）で数える。
 * 折りたたみ中は1行しか見えないが、Webview側は展開後の行も含めて最初から
 * DOMに載せる（`main.ts` の `appendGroupItem`）ため、DOMの重さは展開後の
 * 行数で決まる。
 */
function countItemLines(item: InteractiveDisplayItem): number {
  return item.kind === "line" ? 1 : item.lines.length;
}

/**
 * 上限に収まるところまで表示単位を詰める。グループ1件だけで上限を超える
 * 場合は、そのグループの `lines` を上限まで切り詰めて必ず1件は残す——
 * 何も表示されない画面を返さないため。
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
    if (limited.length === 0 && item.kind === "group") {
      limited.push({ ...item, lines: item.lines.slice(0, remaining) });
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
    items: limitedItems?.items,
    // 表示中の行数は、実際に描画される方（`items` があればそちら）で数える。
    displayedLineCount: limitedItems
      ? limitedItems.lineCount
      : Math.min(textLines.length, maxDisplayLines),
  };
}
