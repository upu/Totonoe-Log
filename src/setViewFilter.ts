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
      vscode.window.showWarningMessage(
        "Totonoe Log: 絞り込むビューがありません。Show Normalized View または Merge Selected Files で開いたビューに対して実行してください。"
      );
      return;
    }

    const filterSource = provider.getFilterSource(document.uri);
    if (!filterSource) {
      // 比較ビュー・Interactive View からの書き出し（issue #175）、および
      // 内容が解放されたビュー（issue #92）。書き出しは折りたたみ・マスクを
      // 含むパネルの表示状態のスナップショットで、絞り込みはパネル側で行う。
      vscode.window.showWarningMessage(
        "Totonoe Log: このビューは絞り込みに対応していません。元のコマンドで開き直すか、Interactive View で絞り込んでください。"
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
      "Totonoe Log: 入力されたパターンの処理に時間がかかりすぎたため中断しました。より単純なパターンをお試しください。"
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
 */
function reportHiddenLineCount(
  totalEntries: readonly LogEntry[],
  visibleEntries: readonly LogEntry[]
): void {
  const totalLineCount = countLines(totalEntries);
  const visibleLineCount = countLines(visibleEntries);
  const hiddenLineCount = totalLineCount - visibleLineCount;
  vscode.window.showInformationMessage(
    `Totonoe Log: 条件に合わない ${hiddenLineCount} 行を非表示にしました（${visibleLineCount}/${totalLineCount} 行を表示）。`
  );
}
