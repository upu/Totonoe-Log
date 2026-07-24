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

const vscodeApi = acquireVsCodeApi<WebviewToExtensionMessage>();

const addFilesButton = document.getElementById("add-files-button") as HTMLButtonElement;
const loadedFilesElement = document.getElementById("loaded-files") as HTMLSpanElement;
const severitiesContainer = document.getElementById("severities") as HTMLDivElement;
const dateStartInput = document.getElementById("date-start") as HTMLInputElement;
const dateEndInput = document.getElementById("date-end") as HTMLInputElement;
const ignorePatternInput = document.getElementById("ignore-pattern") as HTMLInputElement;
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

function renderState(state: ExtensionToWebviewMessage): void {
  renderLoadedFiles(state.loadedFileNames);
  renderSeverities(state.distinctSeverities, state.criteria.severities);
  syncTextInputIfNotFocused(dateStartInput, state.criteria.dateRangeStart);
  syncTextInputIfNotFocused(dateEndInput, state.criteria.dateRangeEnd);
  syncTextInputIfNotFocused(ignorePatternInput, state.criteria.ignorePattern);

  statusElement.textContent = `${state.visibleLineCount} / ${state.totalLineCount} 行を表示`;
  warningElement.textContent = state.warning ?? "";
  // ログ本文は非信頼な外部データのため、HTMLとして解釈されないよう
  // 必ず textContent で設定する（innerHTML は使わない）。
  logOutputElement.textContent = state.text;
}

window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
  if (event.data.type === "state") {
    renderState(event.data);
  }
});

vscodeApi.postMessage({ type: "ready" });
