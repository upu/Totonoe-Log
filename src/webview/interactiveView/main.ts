import type {
  ExtensionToWebviewMessage,
  SerializedFilterCriteria,
  WebviewToExtensionMessage,
} from "./protocol";

/**
 * Webview側のブートストラップ。絞り込み・整形は拡張機能本体側
 * （`src/interactiveView.ts`）が行うため、ここではフォームの状態を
 * 集めて `postMessage` するのと、届いた結果を描画するだけの薄い
 * レンダラーに徹する（issue #166）。
 */

/** セベリティ未認識のエントリを表すチェックボックスのラベル（`normalize` の `UNRECOGNIZED_SEVERITY_KEY` に対応）。 */
const UNRECOGNIZED_SEVERITY_LABEL = "(no severity)";

/** {@link ExtensionToWebviewMessage.items} の要素の型（Webview側は `normalize` を直接importできないため、メッセージ型からの導出で参照する）。 */
type DisplayItem = NonNullable<ExtensionToWebviewMessage["items"]>[number];

const vscodeApi = acquireVsCodeApi<WebviewToExtensionMessage>();

const addFilesButton = document.getElementById("add-files-button") as HTMLButtonElement;
const loadedFilesElement = document.getElementById("loaded-files") as HTMLSpanElement;
const severitiesContainer = document.getElementById("severities") as HTMLDivElement;
const dateStartInput = document.getElementById("date-start") as HTMLInputElement;
const dateEndInput = document.getElementById("date-end") as HTMLInputElement;
const ignorePatternInput = document.getElementById("ignore-pattern") as HTMLInputElement;
const collapseToggle = document.getElementById("collapse-toggle") as HTMLInputElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const warningElement = document.getElementById("warning") as HTMLDivElement;
const logOutputElement = document.getElementById("log-output") as HTMLPreElement;

function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function collectCriteria(): SerializedFilterCriteria {
  const checkedBoxes = severitiesContainer.querySelectorAll<HTMLInputElement>(
    "input[type='checkbox']:checked"
  );
  return {
    severities: Array.from(checkedBoxes, (checkbox) => checkbox.value),
    dateRangeStart: dateStartInput.value,
    dateRangeEnd: dateEndInput.value,
    ignorePattern: ignorePatternInput.value,
    collapseEnabled: collapseToggle.checked,
  };
}

function postFilterChanged(): void {
  vscodeApi.postMessage({ type: "filterChanged", criteria: collectCriteria() });
}

// チェックボックスは離散的な操作なので即座に送るが、テキスト入力は
// キー入力のたびに拡張機能側との往復を発生させないようデバウンスする。
const postFilterChangedDebounced = debounce(postFilterChanged, 300);

severitiesContainer.addEventListener("change", postFilterChanged);
dateStartInput.addEventListener("input", postFilterChangedDebounced);
dateEndInput.addEventListener("input", postFilterChangedDebounced);
ignorePatternInput.addEventListener("input", postFilterChangedDebounced);
collapseToggle.addEventListener("change", postFilterChanged);

// ファイル選択ダイアログを開くのは拡張機能本体側の責務（Webviewからは
// vscode.window.showOpenDialog を呼べない）。ボタンは離散的な操作なので
// チェックボックスと同じく即座に送る。
addFilesButton.addEventListener("click", () => {
  vscodeApi.postMessage({ type: "addFiles" });
});

function renderSeverities(distinctSeverities: readonly string[], checked: readonly string[]): void {
  const checkedSet = new Set(checked);
  severitiesContainer.textContent = "";
  for (const severity of distinctSeverities) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = severity;
    checkbox.checked = checkedSet.has(severity);
    label.appendChild(checkbox);
    label.appendChild(
      document.createTextNode(severity === "" ? UNRECOGNIZED_SEVERITY_LABEL : severity)
    );
    severitiesContainer.appendChild(label);
  }
}

/** テキスト入力中のフィールドを拡張機能側の値で上書きすると、入力中のカーソル位置が飛ぶため避ける。 */
function syncTextInputIfNotFocused(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input) {
    input.value = value;
  }
}

function renderLoadedFiles(fileNames: readonly string[]): void {
  loadedFilesElement.textContent = `読み込み済み: ${fileNames.join(", ")}`;
}

/**
 * 折りたたみ状態を示す矢印（拡張機能から届く非信頼データではなく、UI側の
 * 固定文字）。ガター欄の直前に置く、折りたためない通常行の余白
 * （{@link PLAIN_ROW_PREFIX}）と同じ幅にすることで、矢印の有無に関わらず
 * ガターの `|` が縦に揃う。
 */
const COLLAPSED_PREFIX = "▶ ";
const EXPANDED_PREFIX = "▼ ";
/** 折りたためない通常行・展開後2行目以降の左余白（矢印列の幅に合わせる）。 */
const PLAIN_ROW_PREFIX = " ".repeat(COLLAPSED_PREFIX.length);

/**
 * 折りたたみグループ1件をDOMに追加する。展開/復元はここに閉じたローカル
 * 状態だけで完結させ、拡張機能本体へは何も送らない（issue #172、届いた
 * `lines` の表示/非表示を切り替えるだけで済むため）。
 *
 * 折りたたみ中は範囲ラベルの行（`item.headerText`）1行だけを表示し、展開時は
 * それを消して `item.lines`（各エントリ個別の行）をそのまま並べる——折りたたみ
 * を戻す操作は、展開後の先頭行（グループの最初のエントリ）自体をクリック
 * 対象にする。専用の「折りたたむ」行を別途挟むと、代表エントリの内容が
 * 展開後の本文と二重に見えて読みにくいという指摘（#172 PRレビュー）への対応。
 */
function appendGroupItem(item: Extract<DisplayItem, { kind: "group" }>): void {
  const [firstLine, ...restLines] = item.lines;

  const collapsedRow = document.createElement("span");
  collapsedRow.className = "collapse-group-header";
  collapsedRow.setAttribute("role", "button");
  collapsedRow.tabIndex = 0;
  collapsedRow.textContent = `${COLLAPSED_PREFIX}${item.headerText}\n`;

  const expandedFirstRow = document.createElement("span");
  expandedFirstRow.className = "collapse-group-header";
  expandedFirstRow.setAttribute("role", "button");
  expandedFirstRow.tabIndex = 0;
  expandedFirstRow.textContent = `${EXPANDED_PREFIX}${firstLine}\n`;

  const expandedRest = document.createElement("span");
  // グループ本文もログ由来の非信頼データのため textContent で設定する。
  expandedRest.textContent = restLines.map((line) => `${PLAIN_ROW_PREFIX}${line}\n`).join("");

  let expanded = false;
  const applyExpandedState = (): void => {
    collapsedRow.hidden = expanded;
    expandedFirstRow.hidden = !expanded;
    expandedRest.hidden = !expanded;
  };
  applyExpandedState();

  const toggle = (): void => {
    expanded = !expanded;
    applyExpandedState();
  };
  for (const clickableRow of [collapsedRow, expandedFirstRow]) {
    clickableRow.addEventListener("click", toggle);
    clickableRow.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  }

  logOutputElement.appendChild(collapsedRow);
  logOutputElement.appendChild(expandedFirstRow);
  logOutputElement.appendChild(expandedRest);
}

function renderItems(items: readonly DisplayItem[]): void {
  logOutputElement.textContent = "";
  for (const item of items) {
    if (item.kind === "line") {
      // 折りたたみ矢印の列幅ぶんだけ、折りたためない通常行も余白を揃える。
      logOutputElement.appendChild(document.createTextNode(`${PLAIN_ROW_PREFIX}${item.text}\n`));
      continue;
    }
    appendGroupItem(item);
  }
}

function renderState(state: ExtensionToWebviewMessage): void {
  renderLoadedFiles(state.loadedFileNames);
  renderSeverities(state.distinctSeverities, state.criteria.severities);
  syncTextInputIfNotFocused(dateStartInput, state.criteria.dateRangeStart);
  syncTextInputIfNotFocused(dateEndInput, state.criteria.dateRangeEnd);
  syncTextInputIfNotFocused(ignorePatternInput, state.criteria.ignorePattern);
  collapseToggle.checked = state.criteria.collapseEnabled;
  collapseToggle.disabled = !state.collapsibleSupported;

  statusElement.textContent = `${state.visibleLineCount} / ${state.totalLineCount} 行を表示`;
  warningElement.textContent = state.warning ?? "";
  if (state.items) {
    renderItems(state.items);
  } else {
    // ログ本文は非信頼な外部データのため、HTMLとして解釈されないよう
    // 必ず textContent で設定する（innerHTML は使わない）。
    logOutputElement.textContent = state.text;
  }
}

window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
  if (event.data.type === "state") {
    renderState(event.data);
  }
});

vscodeApi.postMessage({ type: "ready" });
