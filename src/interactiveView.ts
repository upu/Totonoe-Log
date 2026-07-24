import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import {
  buildInteractivePayload,
  getDistinctSeverities,
  type FilterCriteria,
  type LogEntry,
} from "./normalize";
import { getSourceDocumentOrWarn, parseSourceLog } from "./logSourceDocument";
import { readDisplayTimezone } from "./timezoneSettings";
import { readGapThresholdMs } from "./gapThresholdSetting";
import { toFilterCriteria } from "./interactiveViewCriteria";
import type {
  ExtensionToWebviewMessage,
  SerializedFilterCriteria,
  WebviewToExtensionMessage,
} from "./webview/interactiveView/protocol";

/** Webviewパネルのビュー種別ID（`createWebviewPanel` 第1引数）。コマンドIDとは別の識別子。 */
const INTERACTIVE_VIEW_TYPE = "totonoeLog.interactiveViewAlpha";

/** Webview側スクリプトのバンドル出力（`scripts/esbuild.js` の第2エントリ）を探すための相対パス。 */
const WEBVIEW_SCRIPT_RELATIVE_PATH = ["out", "webview", "interactiveView", "main.js"];

/** チェック済みセベリティ・空の日付範囲・空の無視パターンという初期状態を作る。 */
function createDefaultSerializedCriteria(entries: readonly LogEntry[]): SerializedFilterCriteria {
  return {
    severities: getDistinctSeverities(entries),
    dateRangeStart: "",
    dateRangeEnd: "",
    ignorePattern: "",
  };
}

/**
 * インラインスクリプト/スタイルだけを許可するnonceを、Webviewの読み込みごとに
 * 発行する。固定値にすると別ドキュメントを開いた際に使い回されてしまうため、
 * `showOrReveal` でパネルを新規作成するたびに呼ぶ。
 */
function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Webviewベースのインタラクティブビュー（issue #166）のパネルを1つだけ保持し、
 * 生成・再表示・破棄とメッセージ配線を行う。
 *
 * 絞り込み・整形は `node:worker_threads` を使う無視パターン評価の都合上、
 * Webview（ブラウザコンテキスト）では実行できないため、このコントローラ
 * （拡張機能本体側、Node実行）が一手に引き受ける。Webview側は届いた結果を
 * 描画するだけの薄いレンダラーにとどめる。
 *
 * パネルはシングルトンで、既に開いている状態で別のログファイルに対して
 * コマンドを実行すると、既存パネルの表示内容がそのファイルに差し替わる
 * （複数ファイルを同時に扱う対応は、#165 の後続フェーズで検討する）。
 */
export class InteractiveViewPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private entries: readonly LogEntry[] = [];
  private criteria: SerializedFilterCriteria = createDefaultSerializedCriteria([]);

  constructor(private readonly extensionUri: vscode.Uri) {}

  async showOrReveal(sourceDocument: vscode.TextDocument): Promise<void> {
    this.entries = parseSourceLog(sourceDocument);
    this.criteria = createDefaultSerializedCriteria(this.entries);

    if (this.panel) {
      this.panel.title = this.buildTitle(sourceDocument);
      this.panel.reveal();
      await this.postState();
      return;
    }

    const nonce = generateNonce();
    const panel = vscode.window.createWebviewPanel(
      INTERACTIVE_VIEW_TYPE,
      this.buildTitle(sourceDocument),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "out", "webview", "interactiveView"),
        ],
      }
    );
    panel.webview.html = this.renderHtml(panel.webview, nonce);
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.handleMessage(message);
    });
    this.panel = panel;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private buildTitle(sourceDocument: vscode.TextDocument): string {
    const baseName = sourceDocument.uri.path.split("/").pop() ?? "log";
    return `Totonoe Log (Alpha): ${baseName}`;
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (message.type === "ready") {
      await this.postState();
      return;
    }
    this.criteria = message.criteria;
    await this.postState();
  }

  /**
   * 現在の `this.criteria` を実際に適用して結果を送り返す。無視パターンの
   * 評価がタイムアウト/エラーになった場合は、そのパターンだけを外して
   * 再計算し、警告文とともに送る（QuickPickの警告ダイアログで処理を
   * 中断する既存コマンドと異なり、Webviewはその場で再描画され続けるため
   * 必ず何らかの状態を返す）。
   */
  private async postState(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const displayTimezone = readDisplayTimezone();
    const { criteria, errors } = toFilterCriteria(this.criteria, displayTimezone);

    const payload = await buildInteractivePayload(this.entries, criteria, {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
    });

    if (payload.ok) {
      await this.sendState(payload, errors);
      return;
    }

    const fallbackCriteria: FilterCriteria = { ...criteria, ignorePattern: undefined };
    const fallbackPayload = await buildInteractivePayload(this.entries, fallbackCriteria, {
      gapThresholdMs: readGapThresholdMs(),
      displayTimezone,
    });
    if (fallbackPayload.ok) {
      const reason =
        payload.reason === "timeout"
          ? "入力されたパターンの処理に時間がかかりすぎたため、無視パターンを適用せずに表示しています。より単純なパターンをお試しください。"
          : "無視パターンの評価中にエラーが発生したため、無視パターンを適用せずに表示しています。";
      await this.sendState(fallbackPayload, [...errors, reason]);
    }
  }

  /**
   * `criteria` はユーザーがWebview上のフォームへ入力した生の文字列
   * （`this.criteria`）をそのままエコーバックする。無視パターンが不正で
   * 適用されなかった場合も、ユーザーが入力欄を修正できるよう入力内容を
   * 消さずに `warning` だけで通知する。
   */
  private async sendState(
    payload: Extract<Awaited<ReturnType<typeof buildInteractivePayload>>, { ok: true }>,
    errors: readonly string[]
  ): Promise<void> {
    if (!this.panel) {
      return;
    }

    const message: ExtensionToWebviewMessage = {
      type: "state",
      criteria: this.criteria,
      distinctSeverities: payload.distinctSeverities,
      text: payload.text,
      totalLineCount: payload.totalLineCount,
      visibleLineCount: payload.visibleLineCount,
      warning: errors.length > 0 ? errors.join(" / ") : undefined,
    };
    await this.panel.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview, nonce: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_SCRIPT_RELATIVE_PATH)
    );

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background-color: var(--vscode-editor-background);
    padding: 8px 12px;
  }
  #filter-panel {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 8px;
  }
  #severities {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  #severities label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  input[type="text"] {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 2px 4px;
  }
  #status {
    font-size: 0.9em;
    opacity: 0.8;
    margin-bottom: 4px;
  }
  #warning {
    color: var(--vscode-errorForeground);
    margin-bottom: 4px;
  }
  #log-output {
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre;
    overflow-x: auto;
  }
</style>
</head>
<body>
  <div id="filter-panel">
    <div id="severities"></div>
    <label>開始日時 <input type="text" id="date-start" placeholder="YYYY-MM-DD"></label>
    <label>終了日時 <input type="text" id="date-end" placeholder="YYYY-MM-DD"></label>
    <label>無視パターン <input type="text" id="ignore-pattern" placeholder="正規表現"></label>
  </div>
  <div id="status"></div>
  <div id="warning"></div>
  <pre id="log-output"></pre>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

/**
 * `Totonoe Log: Show Interactive View (Alpha)` コマンドのハンドラを作る。
 * 正規化ビュー系コマンドと同じ手順（{@link getSourceDocumentOrWarn}）で
 * アクティブなログファイルを取得し、コントローラにパネルの表示を委譲する。
 */
export function createShowInteractiveViewAlphaCommand(
  controller: InteractiveViewPanelController
): () => Promise<void> {
  return async function showInteractiveViewAlpha(): Promise<void> {
    const sourceDocument = getSourceDocumentOrWarn("表示する");
    if (!sourceDocument) {
      return;
    }
    await controller.showOrReveal(sourceDocument);
  };
}
