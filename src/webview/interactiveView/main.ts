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

/** 行1件分の元ログ上の位置（{@link DisplayItem} と同じ理由でメッセージ型から導出する）。 */
type LineSource = NonNullable<NonNullable<ExtensionToWebviewMessage["lineSources"]>[number]>;

const vscodeApi = acquireVsCodeApi<WebviewToExtensionMessage>();

const addFilesButton = document.getElementById("add-files-button") as HTMLButtonElement;
const exportButton = document.getElementById("export-button") as HTMLButtonElement;
const maskButton = document.getElementById("mask-button") as HTMLButtonElement;
const maskOptionsButton = document.getElementById("mask-options-button") as HTMLButtonElement;
const maskPanel = document.getElementById("mask-panel") as HTMLDivElement;
const maskTimestampToggle = document.getElementById("mask-timestamp") as HTMLInputElement;
const maskHostToggle = document.getElementById("mask-host") as HTMLInputElement;
const maskProcessIdToggle = document.getElementById("mask-process-id") as HTMLInputElement;
const maskKeysInput = document.getElementById("mask-keys") as HTMLInputElement;
const maskPatternInput = document.getElementById("mask-pattern") as HTMLInputElement;
const loadedFilesElement = document.getElementById("loaded-files") as HTMLDivElement;
const severitiesContainer = document.getElementById("severities") as HTMLDivElement;
const dateStartInput = document.getElementById("date-start") as HTMLInputElement;
const dateEndInput = document.getElementById("date-end") as HTMLInputElement;
const matchPatternInput = document.getElementById("match-pattern") as HTMLInputElement;
const ignorePatternInput = document.getElementById("ignore-pattern") as HTMLInputElement;
const collapseToggle = document.getElementById("collapse-toggle") as HTMLInputElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const warningElement = document.getElementById("warning") as HTMLDivElement;
const displayLimitElement = document.getElementById("display-limit") as HTMLDivElement;
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
    matchPattern: matchPatternInput.value,
    ignorePattern: ignorePatternInput.value,
    collapseEnabled: collapseToggle.checked,
    mask: {
      enabled: maskButton.getAttribute("aria-pressed") === "true",
      maskTimestamp: maskTimestampToggle.checked,
      maskHost: maskHostToggle.checked,
      maskProcessId: maskProcessIdToggle.checked,
      keys: maskKeysInput.value,
      pattern: maskPatternInput.value,
    },
    // チェック済みだけを集めるセベリティと違い、ファイルは読み込み順の並びを
    // そのまま拡張機能側の一覧に対応させるため、全件の真偽値として送る。
    visibleFiles: Array.from(
      loadedFilesElement.querySelectorAll<HTMLInputElement>("input[type='checkbox']"),
      (checkbox) => checkbox.checked
    ),
  };
}

function postFilterChanged(): void {
  vscodeApi.postMessage({ type: "filterChanged", criteria: collectCriteria() });
}

// チェックボックスは離散的な操作なので即座に送るが、テキスト入力は
// キー入力のたびに拡張機能側との往復を発生させないようデバウンスする。
const postFilterChangedDebounced = debounce(postFilterChanged, 300);

severitiesContainer.addEventListener("change", postFilterChanged);
loadedFilesElement.addEventListener("change", postFilterChanged);
dateStartInput.addEventListener("input", postFilterChangedDebounced);
dateEndInput.addEventListener("input", postFilterChangedDebounced);
matchPatternInput.addEventListener("input", postFilterChangedDebounced);
ignorePatternInput.addEventListener("input", postFilterChangedDebounced);
collapseToggle.addEventListener("change", postFilterChanged);

// ファイル選択ダイアログを開くのは拡張機能本体側の責務（Webviewからは
// vscode.window.showOpenDialog を呼べない）。ボタンは離散的な操作なので
// チェックボックスと同じく即座に送る。
addFilesButton.addEventListener("click", () => {
  vscodeApi.postMessage({ type: "addFiles" });
});

// 書き出しも離散的な操作なので、テキスト入力と違いデバウンスせず即座に送る。
// ただし押した時点のフォーム内容を同送する（issue #217）——デバウンス待ちの
// 入力があると、拡張機能本体が最後に受け取っている条件では直前の入力が欠けた
// まま書き出されてしまう。デバウンスを flush して往復を待つ手もあるが、
// 操作をこのメッセージだけで完結させるほうが単純。
exportButton.addEventListener("click", () => {
  vscodeApi.postMessage({ type: "exportVirtualDocument", criteria: collectCriteria() });
});

/**
 * マスクのON/OFF状態をボタンに反映する（issue #194）。押下状態は
 * `aria-pressed` に持たせ、{@link collectCriteria} もそこから読む——マスクは
 * 「押した瞬間に何かが起きる」操作ではなく、絞り込みや折りたたみと同じ
 * 表示状態なので、ボタン自身がその状態の置き場になる。
 */
function setMaskEnabled(enabled: boolean): void {
  maskButton.setAttribute("aria-pressed", String(enabled));
  maskButton.classList.toggle("toggled-on", enabled);
  // 状態は色だけに頼らず施錠アイコンでも示す（issue #197、色の違いだけでは
  // ON/OFF が判別しづらかった）。ラベルに「: ON」「: OFF」と書き込んでいたのを
  // アイコンに寄せたのは、押下状態を文字で説明するのがVSCodeの作法から
  // 外れているため（issue #195）。
  maskButton.textContent = enabled ? "🔒 Mask" : "🔓 Mask";
}

/** マスク対象の選択パネルの開閉。閉じても選択内容とマスクのON/OFFは保たれる。 */
function setMaskPanelExpanded(expanded: boolean): void {
  maskPanel.hidden = !expanded;
  maskOptionsButton.setAttribute("aria-expanded", String(expanded));
  maskOptionsButton.textContent = expanded ? "▴" : "▾";
}

// マスクの整形は拡張機能本体側で行う（`node:net` を使うホスト判定が
// Webviewでは実行できない）。ボタン・チェックボックスは離散的な操作なので、
// 絞り込みのチェックボックスと同じくデバウンスせず即座に送る。
maskButton.addEventListener("click", () => {
  setMaskEnabled(maskButton.getAttribute("aria-pressed") !== "true");
  postFilterChanged();
});

maskOptionsButton.addEventListener("click", () => {
  // 開閉状態は `hidden` ではなく `aria-expanded` から読む（`hidden` の型は
  // `hidden="until-found"` を許すため真偽値として扱えない）。
  setMaskPanelExpanded(maskOptionsButton.getAttribute("aria-expanded") !== "true");
});

maskTimestampToggle.addEventListener("change", postFilterChanged);
maskHostToggle.addEventListener("change", postFilterChanged);
maskProcessIdToggle.addEventListener("change", postFilterChanged);
// キー指定（issue #212）と任意パターン（issue #195）はテキスト入力なので、
// 絞り込みのパターン欄と同じくデバウンスする。
maskKeysInput.addEventListener("input", postFilterChangedDebounced);
maskPatternInput.addEventListener("input", postFilterChangedDebounced);

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

/**
 * 読み込み済みファイルを、表示ON/OFFのチェックボックスと取り消しボタンを
 * 添えて1件ずつ並べる（issue #170）。ファイル名は非信頼な外部データなので
 * 必ず `textContent` で設定する。ホバーでフルパスを見せるのは、行のホバー
 * （issue #179）と同じく別フォルダの同名ファイルを見分けられるようにするため。
 *
 * 最後の1件の取り消しボタンは無効化する——読み込みが0件になると
 * 「+ Add Files...」も効かなくなり、パネルを閉じる以外に復帰できないため
 * （拡張機能本体側でも同じ条件で弾く）。一時的に外したいだけならチェック
 * ボックスで足りる。
 */
function renderLoadedFiles(
  fileNames: readonly string[],
  filePaths: readonly string[],
  visibleFiles: readonly boolean[]
): void {
  loadedFilesElement.textContent = "";
  fileNames.forEach((fileName, index) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = visibleFiles[index] ?? true;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(fileName));
    const filePath = filePaths[index];
    label.title =
      filePath !== undefined
        ? `${filePath}（チェックを外すとこのファイルの行を隠します）`
        : "チェックを外すとこのファイルの行を隠します";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-file";
    removeButton.textContent = "✕";
    removeButton.disabled = fileNames.length <= 1;
    const removeLabel = removeButton.disabled
      ? "最後の1ファイルは取り消せません（一時的に隠すにはチェックを外してください）"
      : `${fileName} を読み込みから取り消す`;
    removeButton.title = removeLabel;
    removeButton.setAttribute("aria-label", removeLabel);
    removeButton.addEventListener("click", () => {
      vscodeApi.postMessage({ type: "removeFile", fileIndex: index });
    });

    const chip = document.createElement("span");
    chip.className = "loaded-file";
    chip.appendChild(label);
    chip.appendChild(removeButton);
    loadedFilesElement.appendChild(chip);
  });
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

/** 直近に届いた状態の元ファイルのフルパス一覧（issue #179、`LineSource.fileIndex` で引く）。 */
let sourceFilePaths: readonly string[] = [];

/**
 * 行の右クリックメニュー（issue #191）を出すための `data-vscode-context` の
 * `webviewSection` 値。`package.json` の `contributes.menus."webview/context"`
 * の `when` 句、および `src/interactiveViewContext.ts` と一致させる。
 */
const LINE_CONTEXT_SECTION = "totonoeLogInteractiveLine";

/**
 * 元ログの行に対応づいた1行を、そこへジャンプできる要素として作る
 * （issue #179）。ジャンプ先の解決は拡張機能本体側に任せ、ここは選ばれた行の
 * `lineSource` を送り返すだけにする。ホバーでは、マージビューの
 * HoverProvider（issue #150）と同じくフルパスを見せる——ファイル名列だけでは
 * 別フォルダの同名ファイルを見分けられないため。
 *
 * ジャンプの操作はダブルクリックと右クリックメニューの2つ（issue #191）。
 * シングルクリックはログ本文の選択・スクロールの起点として日常的に使われる
 * ため、ジャンプのような画面が切り替わる操作を割り当てると誤操作になりやすい。
 * 右クリックメニューは `data-vscode-context` 経由で VSCode 側のメニューに
 * 項目を足す仕組みなので、Webview 内に独自メニューを作らなくてよい。
 *
 * ログ本文は非信頼な外部データのため、必ず `textContent` で設定する。
 */
function createSourceLineElement(text: string, lineSource: LineSource): HTMLSpanElement {
  const row = document.createElement("span");
  row.className = "source-line";
  row.textContent = text;

  const sourceFilePath = sourceFilePaths[lineSource.fileIndex];
  if (sourceFilePath !== undefined) {
    row.title = `${sourceFilePath}:${lineSource.line}`;
  }
  row.dataset.vscodeContext = JSON.stringify({
    webviewSection: LINE_CONTEXT_SECTION,
    lineSource,
  });
  row.addEventListener("dblclick", () => {
    vscodeApi.postMessage({ type: "revealSourceLine", lineSource });
  });
  return row;
}

/**
 * 1行を、元ログの行に対応づいていればジャンプできる要素として、そうでなければ
 * ただのテキストとして追加する。ギャップマーカー等の生成行には対応する元行が
 * 無いため、ホバーもジャンプもできない見た目にする（`Go to Source Line` が
 * 「対応する元ログの行がありません」と案内するのと扱いを揃える）。
 */
function appendLine(parent: Node, text: string, lineSource: LineSource | undefined): void {
  parent.appendChild(
    lineSource ? createSourceLineElement(text, lineSource) : document.createTextNode(text)
  );
}

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
 *
 * 見出し行と展開後の先頭行はシングルクリックでの展開/復元が主役なので、
 * 元ファイルへのジャンプ（issue #179、#191）は展開後の2行目以降にだけ付ける
 * ——ダブルクリックすると展開/復元が2回起きてしまい、ジャンプと同時に成立
 * させられないため。
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
  restLines.forEach((line, index) => {
    // `lineSources` は `lines` と同じ並びなので、先頭行のぶんだけずらして引く。
    appendLine(expandedRest, `${PLAIN_ROW_PREFIX}${line}\n`, item.lineSources?.[index + 1]);
  });

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
      appendLine(logOutputElement, `${PLAIN_ROW_PREFIX}${item.text}\n`, item.lineSource);
      continue;
    }
    appendGroupItem(item);
  }
}

/**
 * 折りたたみ表示でないときの本文描画。行対応情報（issue #179）が届いていれば
 * 行ごとに要素を分けてクリック可能にし、無ければ従来どおり本文を1つの
 * テキストとして流し込む（要素数を増やさずに済むため）。
 */
function renderText(text: string, lineSources: ExtensionToWebviewMessage["lineSources"]): void {
  if (!lineSources) {
    // ログ本文は非信頼な外部データのため、HTMLとして解釈されないよう
    // 必ず textContent で設定する（innerHTML は使わない）。
    logOutputElement.textContent = text;
    return;
  }

  logOutputElement.textContent = "";
  const lines = text === "" ? [] : text.split("\n");
  lines.forEach((line, index) => {
    // 末尾に余分な空行が出ないよう、最終行だけ改行を付けない。
    const suffix = index === lines.length - 1 ? "" : "\n";
    appendLine(logOutputElement, `${line}${suffix}`, lineSources[index]);
  });
}

/**
 * 表示行数の上限で切り詰めた旨の案内（issue #178）。エラーではなく縮退した
 * だけなので、`#warning`（無視パターンの失敗など）とは別の行に出す。全体を
 * 見る手段として、既にUIにある「Export as Virtual Document」へ誘導する。
 */
function renderDisplayLimit(displayLimit: ExtensionToWebviewMessage["displayLimit"]): void {
  if (!displayLimit) {
    displayLimitElement.textContent = "";
    return;
  }
  displayLimitElement.textContent =
    `表示上限の ${displayLimit.maxDisplayLines} 行を超えたため、先頭 ${displayLimit.displayedLineCount} 行のみ表示しています。` +
    "絞り込むと全体を表示できます。全体をそのまま扱うには「Export as Virtual Document」で開いてください。";
}

function renderState(state: ExtensionToWebviewMessage): void {
  // 本文の描画（ホバー表示）より先に更新する必要がある。
  sourceFilePaths = state.sourceFilePaths;
  renderLoadedFiles(state.loadedFileNames, state.sourceFilePaths, state.criteria.visibleFiles);
  renderSeverities(state.distinctSeverities, state.criteria.severities);
  syncTextInputIfNotFocused(dateStartInput, state.criteria.dateRangeStart);
  syncTextInputIfNotFocused(dateEndInput, state.criteria.dateRangeEnd);
  syncTextInputIfNotFocused(matchPatternInput, state.criteria.matchPattern);
  syncTextInputIfNotFocused(ignorePatternInput, state.criteria.ignorePattern);
  collapseToggle.checked = state.criteria.collapseEnabled;
  collapseToggle.disabled = !state.collapsibleSupported;
  setMaskEnabled(state.criteria.mask.enabled);
  maskTimestampToggle.checked = state.criteria.mask.maskTimestamp;
  maskHostToggle.checked = state.criteria.mask.maskHost;
  maskProcessIdToggle.checked = state.criteria.mask.maskProcessId;
  syncTextInputIfNotFocused(maskKeysInput, state.criteria.mask.keys);
  syncTextInputIfNotFocused(maskPatternInput, state.criteria.mask.pattern);

  statusElement.textContent = `${state.visibleLineCount} / ${state.totalLineCount} 行を表示`;
  warningElement.textContent = state.warning ?? "";
  renderDisplayLimit(state.displayLimit);
  if (state.items) {
    renderItems(state.items);
  } else {
    renderText(state.text, state.lineSources);
  }
}

window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
  if (event.data.type === "state") {
    renderState(event.data);
  }
});

vscodeApi.postMessage({ type: "ready" });
