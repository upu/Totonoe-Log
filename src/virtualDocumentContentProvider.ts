import * as vscode from "vscode";
import type { FilterCriteria, LineSource, LogEntry } from "./normalize";

/** 正規化ビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const NORMALIZED_VIEW_SCHEME = "totonoe-log-normalized";
/** マージビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const MERGED_VIEW_SCHEME = "totonoe-log-merged";
/** 比較ビュー用の仮想ドキュメントに割り当てる URI スキーム。 */
export const COMPARE_VIEW_SCHEME = "totonoe-log-compare";

/**
 * Totonoe Log 自身が発行する仮想ドキュメントのスキーム一覧。
 * 各コマンドの冒頭で共通ガードとして使うため、判定ロジックをここに集約する
 * （個々のコマンド実装がスキーム文字列を重複して知る必要をなくす）。
 */
const TOTONOE_LOG_VIEW_SCHEMES: ReadonlySet<string> = new Set([
  NORMALIZED_VIEW_SCHEME,
  MERGED_VIEW_SCHEME,
  COMPARE_VIEW_SCHEME,
]);

/**
 * 指定したドキュメントが、Totonoe Log 自身が発行した仮想ドキュメント
 *（正規化・マージ・比較ビュー。折りたたみビューも正規化ビューと同じ
 * スキームを使う）かどうかを判定する。
 */
export function isTotonoeLogVirtualDocument(document: vscode.TextDocument): boolean {
  return TOTONOE_LOG_VIEW_SCHEMES.has(document.uri.scheme);
}

/**
 * 対象のドキュメントが Totonoe Log 自身の仮想ドキュメントである場合、警告を
 * 表示して呼び出し側に処理を中断させる共通ガード。正規化・フィルタ系・
 * コピー系の各コマンドは、アクティブエディタ取得直後にこれを呼び出す。
 *
 * 仮想ドキュメントは行番号ガター（`"1 | "`）やマージビューの列
 *（`"app.log | app | "`）が行頭に付いた独自フォーマットのテキストであり、
 * `parseLog` はタイムスタンプ形式を行頭アンカーで判定するためどの行にも
 * マッチせず、全エントリが無言で未認識扱いになってしまう（issue #57）。
 * それを静かに返す代わりに、ここで検出して警告を出す。
 *
 * @returns 処理を中断すべきなら `true`（呼び出し側は早期リターンする）。
 */
export function guardAgainstVirtualDocumentSource(
  sourceDocument: vscode.TextDocument
): boolean {
  if (!isTotonoeLogVirtualDocument(sourceDocument)) {
    return false;
  }

  vscode.window.showWarningMessage(
    "Totonoe Log: このビューに対しては実行できません。元のログファイルに対して実行してください。"
  );
  return true;
}

/**
 * 保持内容が見つからない URI に対して provideTextDocumentContent が返す
 * プレースホルダー文言。`onDidCloseTextDocument` は、ユーザーがタブを
 * 閉じていなくても VSCode が内部的に TextDocument の参照を解放した際に
 * 発火しうる（issue #92）。タブ自体は残ったままなので、その状態で
 * タブに戻ると再度 provideTextDocumentContent が呼ばれるが register() は
 * 呼ばれない。従来は `?? ""` で無言の空白を返しており、ユーザーが内容消失に
 * 気付けなかった。無言の空白より、何が起きたか分かる文言を返す方が安全。
 */
export const CONTENT_LOST_PLACEHOLDER =
  "Totonoe Log: このビューの内容は失われました。コマンドを再実行して開き直してください。";

/**
 * 仮想ドキュメントの表示行から元ログの該当行へ移動するための対応情報
 * （issue #137）。`lineSources` の各要素は表示行（0始まり）に対応し、
 * `fileIndex` で `sourceUris` から元ファイルの URI を引く。
 */
export interface SourceLineMap {
  /** 元ログファイルの URI 一覧。{@link LineSource.fileIndex} で参照する。 */
  readonly sourceUris: readonly vscode.Uri[];
  /** 表示行ごとの元位置。ギャップマーカー等の生成行は `undefined`。 */
  readonly lineSources: readonly (LineSource | undefined)[];
}

/**
 * 絞り込みをやり直した結果の本文と、それに対応する行対応情報（issue #248）。
 */
export interface FilteredViewContent {
  readonly text: string;
  readonly lineSources: readonly (LineSource | undefined)[];
  /** 絞り込み後に残ったエントリ。非表示行数の通知に使う。 */
  readonly visibleEntries: readonly LogEntry[];
}

/**
 * 開いている仮想ドキュメントに対して絞り込みを掛け直すために、ビューが
 * 手放さずに持っておく「絞り込み前の材料」（issue #248）。
 *
 * これを持たせるまでは、整形済みテキストしか残っていなかったため、後から
 * 条件を変えるには表示テキストを再パースするしかなかった（`parseLog` は
 * 行頭アンカーで判定するので、ガター付きの整形済みテキストは正しく読めない
 * ——{@link guardAgainstVirtualDocumentSource} が防いでいるのと同じ問題、#57）。
 * 元のエントリを持っておけば再パースは不要になる。
 */
export interface FilterableViewSource {
  /**
   * 絞り込み前の全エントリ。セベリティ選択のプロンプトと、非表示行数の通知の
   * 分母に使う。
   */
  readonly allEntries: readonly LogEntry[];
  /**
   * 条件を掛け直して本文と行対応情報を作り直す。**前回の結果には重ねない**
   * ——出発点は常に絞り込み前のエントリなので、条件を緩めれば行は戻る。
   * パターンの評価がタイムアウトした場合は `undefined` を返す。
   */
  applyFilter(criteria: FilterCriteria): Promise<FilteredViewContent | undefined>;
}

/**
 * URIごとにテキスト内容を保持する読み取り専用の仮想ドキュメントプロバイダ。
 * 正規化ビュー・比較ビューなど、スキームだけが異なる複数の機能が共有する
 * 基底実装。ドキュメントが閉じられたら保持内容（本文・行対応情報・絞り込み
 * 材料）を解放し、コマンドを繰り返し実行してもメモリが増え続けないようにする。
 */
export class VirtualDocumentContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly contentByUri = new Map<string, string>();
  private readonly sourceLineMapByUri = new Map<string, SourceLineMap>();
  private readonly filterSourceByUri = new Map<string, FilterableViewSource>();
  private readonly closeListener: vscode.Disposable;
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

  /**
   * 保持している本文を差し替えたことをVSCodeへ知らせるイベント。これを発火
   * すると `provideTextDocumentContent` が呼び直され、開いたままのタブの
   * 内容が入れ替わる（issue #248 の「同じタブを書き換える」経路）。
   */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly scheme: string) {
    this.closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
      this.release(document.uri);
    });
  }

  register(uri: vscode.Uri, content: string, sourceLineMap?: SourceLineMap): void {
    this.contentByUri.set(uri.toString(), content);
    if (sourceLineMap) {
      this.sourceLineMapByUri.set(uri.toString(), sourceLineMap);
    }
  }

  /**
   * この URI のビューを後から絞り込めるようにする（issue #248）。
   *
   * 登録するのは「素の正規化 / マージ結果」を開いたときだけ。Interactive View
   * からの書き出し（issue #175）には登録しない——あちらは折りたたみ・マスクを
   * 含むパネルの表示状態のスナップショットで、元エントリから作り直すとその
   * 状態が消えてしまうため。絞り込み自体もパネル側で完結している。
   */
  registerFilterSource(uri: vscode.Uri, filterSource: FilterableViewSource): void {
    this.filterSourceByUri.set(uri.toString(), filterSource);
  }

  /**
   * 指定した URI の仮想ドキュメントに紐づく行対応情報を返す。登録されて
   * いない（比較ビュー等の対象外ビュー、または解放済み）場合は `undefined`。
   */
  getSourceLineMap(uri: vscode.Uri): SourceLineMap | undefined {
    return this.sourceLineMapByUri.get(uri.toString());
  }

  /**
   * 指定した URI の絞り込み材料を返す。絞り込みに対応しないビュー、または
   * 内容が解放済みの場合は `undefined`。
   */
  getFilterSource(uri: vscode.Uri): FilterableViewSource | undefined {
    return this.filterSourceByUri.get(uri.toString());
  }

  /**
   * 保持している本文と行対応情報を差し替え、開いているタブへ反映する。
   * `register` と分けているのは、こちらだけが `onDidChange` を発火するため
   * ——初回登録は `openTextDocument` が内容を取りに来るので発火は不要で、
   * 発火すると開く前のURIに対する無駄な問い合わせが1回増える。
   */
  update(uri: vscode.Uri, content: string, sourceLineMap?: SourceLineMap): void {
    this.register(uri, content, sourceLineMap);
    this.changeEmitter.fire(uri);
  }

  /** 指定した URI の保持内容を破棄する。対象スキーム以外の URI は無視する。 */
  release(uri: vscode.Uri): void {
    if (uri.scheme === this.scheme) {
      this.contentByUri.delete(uri.toString());
      this.sourceLineMapByUri.delete(uri.toString());
      this.filterSourceByUri.delete(uri.toString());
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? CONTENT_LOST_PLACEHOLDER;
  }

  dispose(): void {
    this.closeListener.dispose();
    this.changeEmitter.dispose();
  }
}
