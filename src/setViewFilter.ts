import * as vscode from "vscode";
import { promptFilterKinds, promptFilterCriteriaForKinds, countLines } from "./filterPrompts";
import { readDisplayTimezone } from "./timezoneSettings";
import type { LogEntry } from "./normalize";
import type {
  FilterableViewSource,
  VirtualDocumentContentProvider,
} from "./virtualDocumentContentProvider";

/**
 * 開いている仮想ドキュメント（正規化ビュー / マージビュー）に対して、
 * 絞り込み条件を後から設定・変更・解除するコマンド（issue #248）。
 *
 * 以前は `Show Normalized View Filtered` / `Merge Selected Files Filtered` と
 * して「開く時点で条件を決め打ちする」形だった。入力経路 × 絞り込みの有無で
 * コマンドが倍に増える構造だったうえ、条件を緩めたくなったら元ファイルに
 * 戻ってコマンドを実行し直すしかなかった。絞り込みを「開き方」ではなく
 * 「開いた後に変えられる表示状態」として扱う——Interactive View のライブ
 * トグルと同じ操作モデル（issue #194）に揃える。
 */
export function createSetViewFilterCommand(
  providersByScheme: ReadonlyMap<string, VirtualDocumentContentProvider>
): () => Promise<void> {
  return async function setViewFilter(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    const provider = document ? providersByScheme.get(document.uri.scheme) : undefined;
    if (!document || !provider) {
      // Totonoe Log のビューですらない（元のログファイル、50MiB 超で通常の
      // ファイルタブとして開いたマージ結果、エディタ自体が無い場合）。
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Totonoe Log: No filterable view is open. Run Open in Virtual Document, then use this command on the resulting view."
        )
      );
      return;
    }

    const filterSource = provider.getFilterSource(document.uri);
    if (!filterSource) {
      // 比較ビュー・Interactive View からの書き出し（issue #175）、および
      // 内容が解放されたビュー（issue #92）。書き出しは折りたたみ・マスクを
      // 含むパネルの表示状態のスナップショットで、絞り込みはパネル側で行う。
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Totonoe Log: This view does not support filtering. Open the log with Open in Virtual Document, or filter it in the Interactive View."
        )
      );
      return;
    }

    await applyFilterToView(provider, document.uri, filterSource);
  };
}

/**
 * 条件を尋ねて絞り込みを掛け直し、開いているタブの内容を差し替える。
 *
 * 条件を1つも選ばずに確定した場合は、どの条件も持たない `FilterCriteria` が
 * できるため、結果として全行が戻る（＝解除）。ピッカーの Esc（キャンセル）と
 * は区別され、そちらは何もせずに戻る。
 */
async function applyFilterToView(
  provider: VirtualDocumentContentProvider,
  uri: vscode.Uri,
  filterSource: FilterableViewSource
): Promise<void> {
  const selectedKinds = await promptFilterKinds();
  if (selectedKinds === undefined) {
    return;
  }

  const criteria = await promptFilterCriteriaForKinds(
    selectedKinds,
    filterSource.allEntries,
    readDisplayTimezone()
  );
  // いずれかのプロンプトがキャンセル・不正入力で中断された場合は何もしない。
  if (criteria === undefined) {
    return;
  }

  const filtered = await filterSource.applyFilter(criteria);
  if (!filtered) {
    // 破局的バックトラッキング等でマッチング処理がタイムアウトした場合。
    // 絞り込みなしへフォールバックすると、いま見えている絞り込み結果まで
    // 巻き戻ってしまうため、表示は変えずに警告だけ出す。
    vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Totonoe Log: Pattern processing took too long and was stopped. Try a simpler pattern."
      )
    );
    return;
  }

  // `sourceUris` は絞り込みで変わらない（行が間引かれるだけで、どのファイル
  // から来たかの並びは同じ）ので、既存の対応表から引き継ぐ。
  const sourceUris = provider.getSourceLineMap(uri)?.sourceUris ?? [];
  provider.update(uri, filtered.text, { sourceUris, lineSources: filtered.lineSources });

  reportHiddenLineCount(filterSource.allEntries, filtered.visibleEntries);
}

/**
 * 絞り込みで非表示にした行数を通知として表示する。表示前後の行数をそれぞれ
 * 1回だけ数え、通知本文（非表示行数と「表示中/全体」の分母・分子）の算出で
 * 重複計算しないようにする。
 *
 * 1行も減らなかった場合は文面を分ける。条件を1つも選ばずに確定した解除操作
 * でも同じ経路を通るため、そのまま数えると「条件に合わない 0 行を非表示に
 * しました」という、解除したのに絞り込んだかのような通知になる。
 */
function reportHiddenLineCount(
  totalEntries: readonly LogEntry[],
  visibleEntries: readonly LogEntry[]
): void {
  const totalLineCount = countLines(totalEntries);
  const visibleLineCount = countLines(visibleEntries);
  const hiddenLineCount = totalLineCount - visibleLineCount;
  let message: string;
  if (hiddenLineCount === 0) {
    message =
      totalLineCount === 1
        ? vscode.l10n.t("Totonoe Log: No lines were hidden (showing the only line).")
        : vscode.l10n.t(
            "Totonoe Log: No lines were hidden (showing all {0} lines).",
            totalLineCount
          );
  } else {
    message =
      hiddenLineCount === 1
        ? vscode.l10n.t(
            "Totonoe Log: Hid 1 line that did not match (showing {0}/{1} lines).",
            visibleLineCount,
            totalLineCount
          )
        : vscode.l10n.t(
            "Totonoe Log: Hid {0} lines that did not match (showing {1}/{2} lines).",
            hiddenLineCount,
            visibleLineCount,
            totalLineCount
          );
  }
  vscode.window.showInformationMessage(message);
}
