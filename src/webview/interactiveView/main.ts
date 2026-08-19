import type {
  ExtensionToWebviewMessage,
  HighlightRuleRow,
  InteractiveViewLabels,
  InteractiveViewStateMessage,
  LineHighlight,
  SerializedFilterCriteria,
  SerializedFilterPattern,
  TimestampFormatRow,
  TimestampFormatRowPreview,
  TimestampPatternInferenceResponse,
} from "./protocol";

/**
 * Webview側のブートストラップ。絞り込み・整形は拡張機能本体側
 * （`src/interactiveView.ts`）が行うため、ここではフォームの状態を
 * 集めて `postMessage` するのと、届いた結果を描画するだけの薄い
 * レンダラーに徹する（issue #166）。
 */

let labels: InteractiveViewLabels | undefined;

function currentLabels(): InteractiveViewLabels {
  if (!labels) {
    throw new Error("Interactive View labels have not been initialized");
  }
  return labels;
}

function formatLabel(template: string, ...values: readonly (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    return String(values[Number(index)] ?? match);
  });
}

function arrayValueAt<T>(values: readonly T[], index: number): T | undefined {
  return values[index];
}

/** `state` メッセージの `items` の要素の型（Webview側は `normalize` を直接importできないため、メッセージ型からの導出で参照する）。 */
type DisplayItem = NonNullable<InteractiveViewStateMessage["items"]>[number];

/** 行1件分の元ログ上の位置（{@link DisplayItem} と同じ理由でメッセージ型から導出する）。 */
type LineSource = NonNullable<NonNullable<InteractiveViewStateMessage["lineSources"]>[number]>;

const vscodeApi = acquireVsCodeApi();

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
const highlightOptionsButton = document.getElementById(
  "highlight-options-button"
) as HTMLButtonElement;
const highlightPanel = document.getElementById("highlight-panel") as HTMLDivElement;
const highlightRuleList = document.getElementById("highlight-rules") as HTMLDivElement;
const addHighlightRuleButton = document.getElementById("add-highlight-rule") as HTMLButtonElement;
const timestampOptionsButton = document.getElementById(
  "timestamp-options-button"
) as HTMLButtonElement;
const timestampPanel = document.getElementById("timestamp-panel") as HTMLDivElement;
const timestampFormatList = document.getElementById("timestamp-formats") as HTMLDivElement;
const addTimestampFormatButton = document.getElementById(
  "add-timestamp-format"
) as HTMLButtonElement;
const timestampScopeLabel = document.getElementById("timestamp-scope-label") as HTMLParagraphElement;
const unrecognizedLinesList = document.getElementById(
  "timestamp-unrecognized-lines"
) as HTMLDivElement;
const suggestFromSelectionButton = document.getElementById(
  "suggest-from-selection"
) as HTMLButtonElement;
const timestampSelectionStatus = document.getElementById(
  "timestamp-selection-status"
) as HTMLParagraphElement;
const timestampProposalContainer = document.getElementById("timestamp-proposal") as HTMLDivElement;
const timestampProposalNameInput = document.getElementById(
  "timestamp-proposal-name"
) as HTMLInputElement;
const timestampProposalPatternInput = document.getElementById(
  "timestamp-proposal-pattern"
) as HTMLInputElement;
const addTimestampProposalButton = document.getElementById(
  "add-timestamp-proposal"
) as HTMLButtonElement;
const timestampAmbiguousHint = document.getElementById(
  "timestamp-ambiguous-hint"
) as HTMLParagraphElement;
const timestampDmyButton = document.getElementById("timestamp-dmy-button") as HTMLButtonElement;
const timestampMdyButton = document.getElementById("timestamp-mdy-button") as HTMLButtonElement;
const loadedFilesElement = document.getElementById("loaded-files") as HTMLDivElement;
const severitiesContainer = document.getElementById("severities") as HTMLDivElement;
const dateStartInput = document.getElementById("date-start") as HTMLInputElement;
const dateEndInput = document.getElementById("date-end") as HTMLInputElement;
const matchPatternList = document.getElementById("match-patterns") as HTMLDivElement;
const ignorePatternList = document.getElementById("ignore-patterns") as HTMLDivElement;
const addMatchPatternButton = document.getElementById("add-match-pattern") as HTMLButtonElement;
const addIgnorePatternButton = document.getElementById("add-ignore-pattern") as HTMLButtonElement;
const collapseToggle = document.getElementById("collapse-toggle") as HTMLInputElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const warningElement = document.getElementById("warning") as HTMLDivElement;
const openTimestampPanelFromWarningButton = document.getElementById(
  "open-timestamp-panel-from-warning"
) as HTMLButtonElement;
const displayLimitElement = document.getElementById("display-limit") as HTMLDivElement;
const logOutputElement = document.getElementById("log-output") as HTMLPreElement;

function setControlsDisabled(disabled: boolean): void {
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >("button, input, select")) {
    control.disabled = disabled;
  }
}

// 初回の状態が届く前の空フォームを送信しないよう、描画が完了するまで操作を止める。
setControlsDisabled(true);

function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(...args);
    }, waitMs);
  };
}

/**
 * パターン欄1つ分の入力行を、フォームの状態としてそのまま集める（issue #206）。
 * 空の行・OFFの行も落とさずに送るのは、条件として使うかどうかを決めるのは
 * 拡張機能側（`toFilterCriteria`）の役目で、こちらは画面の状態を丸ごと預ける
 * 側だから——エコーバックで返ってきた内容がそのまま次の描画になるため、ここで
 * 間引くと入力途中の行やOFFの行が消えてしまう。
 */
function collectPatterns(list: HTMLDivElement): SerializedFilterPattern[] {
  return Array.from(list.querySelectorAll<HTMLElement>(".pattern-row"), (row) => ({
    source: row.querySelector<HTMLInputElement>("input[type='text']")?.value ?? "",
    enabled: row.querySelector<HTMLInputElement>("input[type='checkbox']")?.checked ?? true,
  }));
}

/**
 * パターン入力行を1つ作る。チェックボックスは「この行を条件に含めるか」で、
 * 削除（✕）とは別の操作にしている——調査中は一時的に外して戻す使い方が多く、
 * 消してしまうと打ち直しになるため（issue #206）。
 */
function createPatternRow(patternSource: string, enabled: boolean): HTMLElement {
  const localized = currentLabels();
  const row = document.createElement("span");
  row.className = "pattern-row";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = enabled;
  toggle.title = localized.patternToggleTitle;
  toggle.setAttribute("aria-label", localized.patternEnabledAriaLabel);
  toggle.addEventListener("change", postFilterChanged);

  const input = document.createElement("input");
  input.type = "text";
  input.value = patternSource;
  input.placeholder = localized.regularExpressionPlaceholder;
  input.setAttribute("aria-label", localized.patternAriaLabel);
  input.addEventListener("input", postFilterChangedDebounced);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-pattern";
  removeButton.textContent = "✕";
  removeButton.title = localized.removePatternTitle;
  removeButton.setAttribute("aria-label", localized.removePatternAriaLabel);
  removeButton.addEventListener("click", () => {
    // 親は取り出してから外す（`remove()` の後は `parentElement` が null になる）。
    const list = row.parentElement;
    row.remove();
    // 最後の1行を消しても空の行を1つ残す。読み込み済みファイル（issue #170）と
    // 違って0行でも「+ 追加」で戻せるが、欄そのものが消えたように見えるため。
    if (list instanceof HTMLDivElement && list.childElementCount === 0) {
      list.appendChild(createPatternRow("", true));
    }
    postFilterChanged();
  });

  row.appendChild(toggle);
  row.appendChild(input);
  row.appendChild(removeButton);
  return row;
}

/** 「+ 追加」で空の行を足し、そのまま打ち始められるようフォーカスを移す。 */
function appendPatternRow(list: HTMLDivElement): void {
  const row = createPatternRow("", true);
  list.appendChild(row);
  row.querySelector<HTMLInputElement>("input[type='text']")?.focus();
  // 空の行は条件を変えないが、拡張機能側の状態にも足しておく——次のエコーバック
  // で行数が戻ってしまわないようにするため。
  postFilterChanged();
}

/**
 * 届いた状態にフォーム側の行を合わせる。行数が変わったときだけ作り直し、
 * 同じなら値だけを差し替える——入力のたびにDOMを作り直すと、デバウンス後の
 * エコーバックで入力中のカーソル位置が飛んでしまうため
 * （{@link syncTextInputIfNotFocused} と同じ理由）。
 *
 * 1行も無いときは空の行を1つ描き、欄が消えたように見えないようにする。
 */
function renderPatternRows(
  list: HTMLDivElement,
  patterns: readonly SerializedFilterPattern[]
): void {
  const incoming = patterns.length > 0 ? patterns : [{ source: "", enabled: true }];
  const rows = list.querySelectorAll<HTMLElement>(".pattern-row");

  if (rows.length !== incoming.length) {
    list.textContent = "";
    for (const incomingPattern of incoming) {
      list.appendChild(createPatternRow(incomingPattern.source, incomingPattern.enabled));
    }
    return;
  }

  rows.forEach((row, index) => {
    const input = row.querySelector<HTMLInputElement>("input[type='text']");
    const toggle = row.querySelector<HTMLInputElement>("input[type='checkbox']");
    if (input) {
      syncTextInputIfNotFocused(input, incoming[index].source);
    }
    if (toggle) {
      toggle.checked = incoming[index].enabled;
    }
  });
}

function collectCriteria(): SerializedFilterCriteria {
  const checkedBoxes = severitiesContainer.querySelectorAll<HTMLInputElement>(
    "input[type='checkbox']:checked"
  );
  return {
    severities: Array.from(checkedBoxes, (checkbox) => checkbox.value),
    dateRangeStart: dateStartInput.value,
    dateRangeEnd: dateEndInput.value,
    matchPatterns: collectPatterns(matchPatternList),
    ignorePatterns: collectPatterns(ignorePatternList),
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
collapseToggle.addEventListener("change", postFilterChanged);

// パターン行そのものの入力・チェックは行を作るときに配線する（issue #206）。
// ここは行を増やすボタンだけ。
addMatchPatternButton.addEventListener("click", () => {
  if (labels) {
    appendPatternRow(matchPatternList);
  }
});
addIgnorePatternButton.addEventListener("click", () => {
  if (labels) {
    appendPatternRow(ignorePatternList);
  }
});

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
  const localized = currentLabels();
  maskButton.textContent = enabled ? localized.maskEnabledLabel : localized.maskDisabledLabel;
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
  if (labels) {
    setMaskEnabled(maskButton.getAttribute("aria-pressed") !== "true");
    postFilterChanged();
  }
});

maskOptionsButton.addEventListener("click", () => {
  // 開閉状態は `hidden` ではなく `aria-expanded` から読む（`hidden` の型は
  // `hidden="until-found"` を許すため真偽値として扱えない）。
  setMaskPanelExpanded(maskOptionsButton.getAttribute("aria-expanded") !== "true");
});

/** ハイライトルールのパネルの開閉。閉じてもルールは設定に残り、効いたまま。 */
function setHighlightPanelExpanded(expanded: boolean): void {
  highlightPanel.hidden = !expanded;
  highlightOptionsButton.setAttribute("aria-expanded", String(expanded));
  const localized = currentLabels();
  highlightOptionsButton.textContent = expanded
    ? localized.highlightExpandedLabel
    : localized.highlightCollapsedLabel;
}

highlightOptionsButton.addEventListener("click", () => {
  if (labels) {
    setHighlightPanelExpanded(highlightOptionsButton.getAttribute("aria-expanded") !== "true");
  }
});

// 編集中に届いて保留したルールを、パネルからフォーカスが抜けた時点で反映する。
highlightPanel.addEventListener("focusout", (event) => {
  // パネル内での移動（欄から欄へ）はまだ編集中なので何もしない。
  if (event.relatedTarget instanceof Node && highlightPanel.contains(event.relatedTarget)) {
    return;
  }
  if (pendingHighlightRules) {
    const rules = pendingHighlightRules;
    pendingHighlightRules = undefined;
    applyHighlightRules(rules);
  }
});

// 追加した空の行は、パターンが空なので設定には書かれない（拡張機能側が落とす）。
// それでも送るのは、他の行の編集で送り直したときに行数が合うようにするため。
addHighlightRuleButton.addEventListener("click", () => {
  if (labels) {
    const row = createHighlightRuleRow({ name: "", pattern: "", color: "yellow" });
    highlightRuleList.appendChild(row);
    row.querySelector<HTMLInputElement>(".highlight-rule-pattern")?.focus();
  }
});

maskTimestampToggle.addEventListener("change", postFilterChanged);
maskHostToggle.addEventListener("change", postFilterChanged);
maskProcessIdToggle.addEventListener("change", postFilterChanged);
// キー指定（issue #212）と任意パターン（issue #195）はテキスト入力なので、
// 絞り込みのパターン欄と同じくデバウンスする。
maskKeysInput.addEventListener("input", postFilterChangedDebounced);
maskPatternInput.addEventListener("input", postFilterChangedDebounced);

/** ハイライトルールで選べる色（`normalize` の `HIGHLIGHT_COLORS` と同じ並び）。 */
const HIGHLIGHT_COLORS: readonly HighlightRuleRow["color"][] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
];

const HIGHLIGHT_COLOR_LABEL_KEYS: Readonly<
  Record<HighlightRuleRow["color"], keyof InteractiveViewLabels>
> = {
  red: "highlightColorRed",
  orange: "highlightColorOrange",
  yellow: "highlightColorYellow",
  green: "highlightColorGreen",
  blue: "highlightColorBlue",
  purple: "highlightColorPurple",
};

/** ハイライトルール編集パネル（issue #238）の現在の行を集める。 */
function collectHighlightRules(): HighlightRuleRow[] {
  return Array.from(
    highlightRuleList.querySelectorAll<HTMLElement>(".highlight-rule-row"),
    (row) => ({
      name: row.querySelector<HTMLInputElement>(".highlight-rule-name")?.value ?? "",
      pattern: row.querySelector<HTMLInputElement>(".highlight-rule-pattern")?.value ?? "",
      color: (row.querySelector<HTMLSelectElement>(".highlight-rule-color")?.value ??
        "yellow") as HighlightRuleRow["color"],
    })
  );
}

/**
 * ルールを設定へ書き戻す。書き戻した結果は設定変更として戻ってくる（#183）ので、
 * 描画はそちらに任せてここでは送るだけにする。
 */
function postHighlightRulesChanged(): void {
  vscodeApi.postMessage({ type: "highlightRulesChanged", rules: collectHighlightRules() });
}

// パターン名・パターンはテキスト入力なので、絞り込みの各欄と同じくデバウンス
// する。設定ファイルへの書き込みを伴うぶん、往復はより重い。
const postHighlightRulesChangedDebounced = debounce(postHighlightRulesChanged, 300);

/** 並べ替え（▲▼）は、DOM上で行を入れ替えてから現在の状態を送り直す。 */
function moveHighlightRuleRow(row: HTMLElement, direction: -1 | 1): void {
  const sibling =
    direction === -1 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) {
    return;
  }
  if (direction === -1) {
    highlightRuleList.insertBefore(row, sibling);
  } else {
    highlightRuleList.insertBefore(sibling, row);
  }
  postHighlightRulesChanged();
}

function createHighlightRuleTextInput(
  className: string,
  value: string,
  placeholder: string,
  ariaLabel: string
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = className;
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", ariaLabel);
  input.addEventListener("input", postHighlightRulesChangedDebounced);
  return input;
}

function createHighlightColorSelect(
  patternInput: HTMLInputElement,
  color: HighlightRuleRow["color"]
): HTMLSelectElement {
  const localized = currentLabels();
  const colorSelect = document.createElement("select");
  colorSelect.className = "highlight-rule-color";
  colorSelect.setAttribute("aria-label", localized.highlightColorAriaLabel);
  for (const availableColor of HIGHLIGHT_COLORS) {
    const option = document.createElement("option");
    option.value = availableColor;
    option.textContent = localized[HIGHLIGHT_COLOR_LABEL_KEYS[availableColor]];
    colorSelect.appendChild(option);
  }
  colorSelect.value = color;
  const applyColorPreview = (): void => {
    patternInput.className = `highlight-rule-pattern highlight-${colorSelect.value}`;
  };
  applyColorPreview();
  colorSelect.addEventListener("change", () => {
    applyColorPreview();
    postHighlightRulesChanged();
  });
  return colorSelect;
}

function createHighlightMoveButton(row: HTMLElement, direction: -1 | 1): HTMLButtonElement {
  const localized = currentLabels();
  const movesUp = direction === -1;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = movesUp ? "▲" : "▼";
  button.title = movesUp ? localized.moveRuleUpTitle : localized.moveRuleDownTitle;
  button.setAttribute(
    "aria-label",
    movesUp ? localized.moveRuleUpAriaLabel : localized.moveRuleDownAriaLabel
  );
  button.addEventListener("click", () => {
    moveHighlightRuleRow(row, direction);
  });
  return button;
}

function createHighlightRemoveButton(row: HTMLElement): HTMLButtonElement {
  const localized = currentLabels();
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "✕";
  button.title = localized.removeRuleTitle;
  button.setAttribute("aria-label", localized.removeRuleAriaLabel);
  button.addEventListener("click", () => {
    row.remove();
    postHighlightRulesChanged();
  });
  return button;
}

/**
 * ハイライトルール1行分を作る（issue #238）。色を選ぶと、その色をパターン欄の
 * 文字色にも反映して結果が見えるようにする——`option` 自体への着色は環境差が
 * 大きいため頼らない。
 */
function createHighlightRuleRow(rule: HighlightRuleRow): HTMLElement {
  const localized = currentLabels();
  const row = document.createElement("div");
  row.className = "highlight-rule-row";

  const nameInput = createHighlightRuleTextInput(
    "highlight-rule-name",
    rule.name,
    localized.ruleNamePlaceholder,
    localized.ruleNameAriaLabel
  );
  const patternInput = createHighlightRuleTextInput(
    "highlight-rule-pattern",
    rule.pattern,
    localized.regularExpressionPlaceholder,
    localized.highlightPatternAriaLabel
  );
  const colorSelect = createHighlightColorSelect(patternInput, rule.color);
  const moveUpButton = createHighlightMoveButton(row, -1);
  const moveDownButton = createHighlightMoveButton(row, 1);
  const removeButton = createHighlightRemoveButton(row);

  row.append(
    nameInput,
    patternInput,
    colorSelect,
    moveUpButton,
    moveDownButton,
    removeButton
  );
  return row;
}

/**
 * 届いたルールにパネルの行を合わせる。絞り込みのパターン欄（issue #206）と同じく
 * 行数が変わったときだけ作り直し、同じなら値だけ差し替える——設定への書き戻しが
 * 設定変更として戻ってくるため、入力のたびに作り直すとカーソル位置が飛ぶ。
 *
 * パネル内にフォーカスがある間は一切触らない。パターン欄を一度空にしてから
 * 打ち直すと、空の行は設定に書かれない（＝戻ってくる行数が減る）ため、
 * 上の行数比較だけでは編集中の行ごと作り直してしまう。編集中はパネルの側を
 * 正とし、フォーカスが外れてから設定の内容に合わせ直す。
 */
function renderHighlightRules(rules: readonly HighlightRuleRow[]): void {
  if (highlightPanel.contains(document.activeElement)) {
    // 届いた内容は覚えておき、フォーカスが外れた時点で反映する。捨ててしまうと
    // 「合わせ直す」機会が次の state まで来ず、設定に無い行（打ち終えていない
    // 空行など）が残ったままになる。
    pendingHighlightRules = rules;
    return;
  }

  pendingHighlightRules = undefined;
  applyHighlightRules(rules);
}

/** 直近に届いた、フォーカスが外れてから反映するルール（issue #238）。 */
let pendingHighlightRules: readonly HighlightRuleRow[] | undefined;

function applyHighlightRules(rules: readonly HighlightRuleRow[]): void {
  const rows = highlightRuleList.querySelectorAll<HTMLElement>(".highlight-rule-row");

  if (rows.length !== rules.length) {
    highlightRuleList.textContent = "";
    for (const rule of rules) {
      highlightRuleList.appendChild(createHighlightRuleRow(rule));
    }
    return;
  }

  rows.forEach((row, index) => {
    const nameInput = row.querySelector<HTMLInputElement>(".highlight-rule-name");
    const patternInput = row.querySelector<HTMLInputElement>(".highlight-rule-pattern");
    const colorSelect = row.querySelector<HTMLSelectElement>(".highlight-rule-color");
    if (nameInput) {
      syncTextInputIfNotFocused(nameInput, rules[index].name);
    }
    if (patternInput) {
      syncTextInputIfNotFocused(patternInput, rules[index].pattern);
      patternInput.className = `highlight-rule-pattern highlight-${rules[index].color}`;
    }
    if (colorSelect) {
      colorSelect.value = rules[index].color;
    }
  });
}

/** タイムスタンプ形式パネル（issue #316）の開閉。閉じても行は設定に残り、効いたまま。 */
function setTimestampPanelExpanded(expanded: boolean): void {
  timestampPanel.hidden = !expanded;
  timestampOptionsButton.setAttribute("aria-expanded", String(expanded));
}

timestampOptionsButton.addEventListener("click", () => {
  if (labels) {
    setTimestampPanelExpanded(timestampOptionsButton.getAttribute("aria-expanded") !== "true");
  }
});

// 警告行のボタン（issue #321）は「タイムスタンプ ▾」を手動で押すのと同じ
// 状態に飛ぶだけの近道なので、拡張機能本体には何も送らずローカルで開くだけ。
openTimestampPanelFromWarningButton.addEventListener("click", () => {
  setTimestampPanelExpanded(true);
});

/** タイムスタンプ形式編集パネルの現在の行を集める（保存済みの検証情報は含めない）。 */
function collectTimestampFormatRows(): TimestampFormatRow[] {
  return Array.from(
    timestampFormatList.querySelectorAll<HTMLElement>(".timestamp-format-row"),
    (row) => ({
      name: row.querySelector<HTMLInputElement>(".timestamp-format-name")?.value ?? "",
      pattern: row.querySelector<HTMLInputElement>(".timestamp-format-pattern")?.value ?? "",
    })
  );
}

/** ルールを設定へ書き戻す。結果は設定変更として戻ってくる（#183）ので、描画はそちらに任せる。 */
function postTimestampFormatsChanged(): void {
  vscodeApi.postMessage({
    type: "timestampFormatsChanged",
    rows: collectTimestampFormatRows(),
  });
}

const postTimestampFormatsChangedDebounced = debounce(postTimestampFormatsChanged, 300);

/**
 * 行の検証フィードバック（issue #316、#320）。エラーがあればそれを、無ければ
 * 未認識行サンプルに対するマッチ件数を出す——保存時と同じ検証をその場で見せる、
 * この機能の主目的にあたる部分。
 */
function renderTimestampFormatFeedback(row: HTMLElement, preview: TimestampFormatRowPreview): void {
  let feedback = row.querySelector<HTMLParagraphElement>(".timestamp-format-feedback");
  if (!feedback) {
    feedback = document.createElement("p");
    feedback.className = "timestamp-format-feedback";
    row.appendChild(feedback);
  }
  if (preview.errorMessage) {
    feedback.textContent = preview.errorMessage;
    feedback.classList.add("timestamp-format-error");
    return;
  }
  feedback.classList.remove("timestamp-format-error");
  feedback.textContent =
    preview.totalSampleCount > 0
      ? formatLabel(
          currentLabels().matchSummaryMessage,
          preview.matchedSampleCount,
          preview.totalSampleCount
        )
      : "";
}

function createTimestampFormatRow(row: TimestampFormatRow): HTMLElement {
  const localized = currentLabels();
  const element = document.createElement("div");
  element.className = "timestamp-format-row";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "timestamp-format-name";
  nameInput.value = row.name;
  nameInput.placeholder = localized.ruleNamePlaceholder;
  nameInput.setAttribute("aria-label", localized.timestampFormatNameAriaLabel);
  nameInput.addEventListener("input", postTimestampFormatsChangedDebounced);

  const patternInput = document.createElement("input");
  patternInput.type = "text";
  patternInput.className = "timestamp-format-pattern";
  patternInput.value = row.pattern;
  patternInput.placeholder = localized.regularExpressionPlaceholder;
  patternInput.setAttribute("aria-label", localized.timestampFormatPatternAriaLabel);
  patternInput.addEventListener("input", postTimestampFormatsChangedDebounced);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "✕";
  removeButton.title = localized.removeTimestampFormatTitle;
  removeButton.setAttribute("aria-label", localized.removeTimestampFormatAriaLabel);
  removeButton.addEventListener("click", () => {
    element.remove();
    postTimestampFormatsChanged();
  });

  element.append(nameInput, patternInput, removeButton);
  return element;
}

addTimestampFormatButton.addEventListener("click", () => {
  if (labels) {
    const row = createTimestampFormatRow({ name: "", pattern: "" });
    timestampFormatList.appendChild(row);
    row.querySelector<HTMLInputElement>(".timestamp-format-pattern")?.focus();
  }
});

/** フォーカスが外れてから反映する、直近に届いた行（issue #238 の highlightRules と同じ理由）。 */
let pendingTimestampFormatRows: readonly TimestampFormatRowPreview[] | undefined;

function applyTimestampFormatRows(rows: readonly TimestampFormatRowPreview[]): void {
  const rowElements = timestampFormatList.querySelectorAll<HTMLElement>(".timestamp-format-row");

  if (rowElements.length !== rows.length) {
    timestampFormatList.textContent = "";
    for (const row of rows) {
      const element = createTimestampFormatRow(row);
      timestampFormatList.appendChild(element);
      renderTimestampFormatFeedback(element, row);
    }
    return;
  }

  rowElements.forEach((element, index) => {
    const nameInput = element.querySelector<HTMLInputElement>(".timestamp-format-name");
    const patternInput = element.querySelector<HTMLInputElement>(".timestamp-format-pattern");
    if (nameInput) {
      syncTextInputIfNotFocused(nameInput, rows[index].name);
    }
    if (patternInput) {
      syncTextInputIfNotFocused(patternInput, rows[index].pattern);
    }
    renderTimestampFormatFeedback(element, rows[index]);
  });
}

function renderTimestampFormatRows(rows: readonly TimestampFormatRowPreview[]): void {
  if (timestampFormatList.contains(document.activeElement)) {
    pendingTimestampFormatRows = rows;
    return;
  }
  pendingTimestampFormatRows = undefined;
  applyTimestampFormatRows(rows);
}

timestampFormatList.addEventListener("focusout", (event) => {
  if (event.relatedTarget instanceof Node && timestampFormatList.contains(event.relatedTarget)) {
    return;
  }
  if (pendingTimestampFormatRows) {
    const rows = pendingTimestampFormatRows;
    pendingTimestampFormatRows = undefined;
    applyTimestampFormatRows(rows);
  }
});

function renderTimestampFormatsScope(scope: "workspace" | "user"): void {
  const localized = currentLabels();
  timestampScopeLabel.textContent =
    scope === "workspace" ? localized.savedToWorkspaceLabel : localized.savedToUserLabel;
}

/**
 * 未認識行の一覧（issue #316）。各行の生テキストを `data-raw-line` に持たせる
 * ——{@link findSelectionSource} が、選択範囲の入れ物を汎用に探せるようにする
 * ため（ログ本文の `.source-line` 要素も同じ属性を持つ）。
 */
function renderUnrecognizedLines(lines: readonly string[]): void {
  unrecognizedLinesList.textContent = "";
  if (lines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "timestamp-format-feedback";
    empty.textContent = currentLabels().unrecognizedLinesEmptyMessage;
    unrecognizedLinesList.appendChild(empty);
    return;
  }
  for (const line of lines) {
    const element = document.createElement("div");
    element.className = "timestamp-sample-line";
    element.dataset.rawLine = line;
    // ログ本文と同じく非信頼な外部データのため textContent で設定する。
    element.textContent = line;
    unrecognizedLinesList.appendChild(element);
  }
}

/**
 * いま選ばれているテキストが、どの行（未認識行の一覧、またはログ本文の
 * `.source-line`）の何文字目から何文字目かを求める。`Range` を使った厳密な
 * オフセット計算は、行が矢印などの飾り（{@link PLAIN_ROW_PREFIX} 等）を
 * 含むため複雑になる——選択されたテキスト自体を `data-raw-line` の中で
 * `indexOf` する方が単純で、複数行にまたがる選択（一致しない）も自然に弾ける。
 */
function findSelectionSource(): { line: string; start: number; end: number } | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return undefined;
  }
  const selectedText = selection.toString();
  if (selectedText.trim() === "") {
    return undefined;
  }
  const anchorNode = selection.anchorNode;
  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
  const container = anchorElement?.closest<HTMLElement>("[data-raw-line]");
  const line = container?.dataset.rawLine;
  if (line === undefined) {
    return undefined;
  }
  const start = line.indexOf(selectedText);
  if (start === -1) {
    return undefined;
  }
  return { line, start, end: start + selectedText.length };
}

/** 直近にホストへ送った推論要求（issue #316）。日/月順の選び直しで同じ選択範囲を再送するために覚えておく。 */
let lastInferenceRequestSource: { line: string; start: number; end: number } | undefined;

function requestTimestampPatternInference(
  source: { line: string; start: number; end: number },
  dayMonthOrder?: "dmy" | "mdy"
): void {
  lastInferenceRequestSource = source;
  vscodeApi.postMessage({
    type: "timestampPatternRequested",
    request: {
      line: source.line,
      selectionStart: source.start,
      selectionEnd: source.end,
      dayMonthOrder,
    },
  });
}

suggestFromSelectionButton.addEventListener("click", () => {
  const source = findSelectionSource();
  if (!source) {
    timestampSelectionStatus.textContent = currentLabels().noSelectionMessage;
    return;
  }
  timestampSelectionStatus.textContent = "";
  requestTimestampPatternInference(source);
});

/** 提案の追加（issue #316）。既存の保存済み行 + この1行を送り、通常の書き戻し経路で保存する。 */
addTimestampProposalButton.addEventListener("click", () => {
  const rows = [
    ...collectTimestampFormatRows(),
    { name: timestampProposalNameInput.value, pattern: timestampProposalPatternInput.value },
  ];
  vscodeApi.postMessage({ type: "timestampFormatsChanged", rows });
  timestampProposalContainer.hidden = true;
  timestampAmbiguousHint.hidden = true;
});

timestampDmyButton.addEventListener("click", () => {
  if (lastInferenceRequestSource) {
    requestTimestampPatternInference(lastInferenceRequestSource, "dmy");
  }
});
timestampMdyButton.addEventListener("click", () => {
  if (lastInferenceRequestSource) {
    requestTimestampPatternInference(lastInferenceRequestSource, "mdy");
  }
});

/** パターン推論の結果（issue #316、#320）を、提案プレビュー欄に反映する。 */
function handleTimestampPatternResult(response: TimestampPatternInferenceResponse): void {
  if (!response.ok) {
    timestampSelectionStatus.textContent = response.message;
    timestampProposalContainer.hidden = true;
    timestampAmbiguousHint.hidden = true;
    return;
  }
  timestampSelectionStatus.textContent = "";
  timestampProposalNameInput.value = response.suggestedName;
  timestampProposalPatternInput.value = response.pattern;
  timestampProposalContainer.hidden = false;
  timestampAmbiguousHint.hidden = !response.ambiguousDayMonthOrder;
}

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
      document.createTextNode(severity === "" ? currentLabels().unrecognizedSeverity : severity)
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
  const localized = currentLabels();
  loadedFilesElement.textContent = "";
  fileNames.forEach((fileName, index) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = visibleFiles[index] ?? true;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(fileName));
    const filePath = arrayValueAt(filePaths, index);
    label.title =
      filePath !== undefined
        ? formatLabel(localized.hideFileWithPathTitle, filePath)
        : localized.hideFileTitle;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-file";
    removeButton.textContent = "✕";
    removeButton.disabled = fileNames.length <= 1;
    const removeLabel = removeButton.disabled
      ? localized.cannotRemoveLastFileLabel
      : formatLabel(localized.removeFileLabel, fileName);
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

/** 直近に届いたハイライト範囲（issue #18）。行のテキストで引く。 */
let lineHighlights = new Map<string, readonly LineHighlight[]>();

/**
 * 1行を、ハイライト範囲（issue #18）に沿って色付きの断片に分けて追加する。
 * 一致が無い行は断片を作らず、テキストノード1つで済ませる（行数が多いので、
 * 色が付かない行の要素を増やさない）。
 *
 * ログ本文は非信頼な外部データのため、断片も必ず `textContent` で設定する
 * （`innerHTML` は使わない）。色はインラインスタイルではなくCSSクラスで当てる
 * ——値をCSSに流し込む経路を作らずに済み、明暗テーマの出し分けもCSS側に寄せられる。
 */
function appendHighlightedText(parent: Node, text: string): void {
  const highlights = lineHighlights.get(text);
  if (!highlights || highlights.length === 0) {
    parent.appendChild(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  for (const highlight of highlights) {
    if (highlight.start > cursor) {
      parent.appendChild(document.createTextNode(text.slice(cursor, highlight.start)));
    }
    const marked = document.createElement("span");
    marked.className = `highlight-${highlight.color}`;
    marked.textContent = text.slice(highlight.start, highlight.end);
    parent.appendChild(marked);
    cursor = highlight.end;
  }
  if (cursor < text.length) {
    parent.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

/**
 * 行の本文をハイライトしつつ、折りたたみ矢印の列（{@link PLAIN_ROW_PREFIX} 等）や
 * 末尾の改行を添えて描く。飾りを本文と分けて渡すのは、ハイライトの対応表を
 * **本文そのもの**で引くため——飾り込みの文字列で引くと一致しない。
 */
function appendDecoratedText(parent: Node, text: string, prefix: string, suffix: string): void {
  if (prefix !== "") {
    parent.appendChild(document.createTextNode(prefix));
  }
  appendHighlightedText(parent, text);
  if (suffix !== "") {
    parent.appendChild(document.createTextNode(suffix));
  }
}

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
function createSourceLineElement(
  text: string,
  lineSource: LineSource,
  prefix: string,
  suffix: string
): HTMLSpanElement {
  const row = document.createElement("span");
  row.className = "source-line";
  appendDecoratedText(row, text, prefix, suffix);
  // タイムスタンプ形式パネル（issue #316）が、ログ本文で選んだ範囲からパターンを
  // 提案する導線（issue #320）の入口。矢印などの飾り抜きの生テキストを持たせる
  // ことで、{@link findSelectionSource} が prefix/suffix を意識せずに拾える。
  row.dataset.rawLine = text;

  const sourceFilePath = arrayValueAt(sourceFilePaths, lineSource.fileIndex);
  if (sourceFilePath !== undefined) {
    row.title = `${sourceFilePath}:${String(lineSource.line)}`;
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
function appendLine(
  parent: Node,
  text: string,
  lineSource: LineSource | undefined,
  prefix = "",
  suffix = "\n"
): void {
  if (lineSource) {
    parent.appendChild(createSourceLineElement(text, lineSource, prefix, suffix));
    return;
  }
  appendDecoratedText(parent, text, prefix, suffix);
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
  // マージ表示のグループは見出しの列に代表1件しか出せないため、全ての由来を
  // ホバーで見せる（issue #158）。行のホバー（issue #179）と同じくフルパスに
  // するのは、別フォルダの同名ファイルを見分けられるようにするため。
  // 折りたたんだ状態にだけ付けるのは、展開すれば各行にファイル名が並ぶため。
  const headerFilePaths = item.headerFileIndices
    ?.map((fileIndex) => arrayValueAt(sourceFilePaths, fileIndex))
    .filter((filePath): filePath is string => filePath !== undefined);
  if (headerFilePaths && headerFilePaths.length > 0) {
    collapsedRow.title = formatLabel(
      currentLabels().sourceFilesTitle,
      headerFilePaths.join("\n")
    );
  }
  appendDecoratedText(collapsedRow, item.headerText, COLLAPSED_PREFIX, "\n");

  const expandedFirstRow = document.createElement("span");
  expandedFirstRow.className = "collapse-group-header";
  expandedFirstRow.setAttribute("role", "button");
  expandedFirstRow.tabIndex = 0;
  appendDecoratedText(expandedFirstRow, firstLine, EXPANDED_PREFIX, "\n");

  const expandedRest = document.createElement("span");
  restLines.forEach((line, index) => {
    // `lineSources` は `lines` と同じ並びなので、先頭行のぶんだけずらして引く。
    appendLine(expandedRest, line, item.lineSources?.[index + 1], PLAIN_ROW_PREFIX);
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
      appendLine(logOutputElement, item.text, item.lineSource, PLAIN_ROW_PREFIX);
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
function renderText(text: string, lineSources: InteractiveViewStateMessage["lineSources"]): void {
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
    appendLine(logOutputElement, line, lineSources[index], "", suffix);
  });
}

/**
 * 表示行数の上限で切り詰めた旨の案内（issue #178）。エラーではなく縮退した
 * だけなので、`#warning`（無視パターンの失敗など）とは別の行に出す。全体を
 * 見る手段として、既にUIにある「Export as Virtual Document」へ誘導する。
 */
function renderDisplayLimit(displayLimit: InteractiveViewStateMessage["displayLimit"]): void {
  if (!displayLimit) {
    displayLimitElement.textContent = "";
    return;
  }
  displayLimitElement.textContent = formatLabel(
    currentLabels().displayLimitMessage,
    displayLimit.maxDisplayLines,
    displayLimit.displayedLineCount
  );
}

function renderState(state: InteractiveViewStateMessage): void {
  labels = state.labels;
  setControlsDisabled(false);
  // 本文の描画（ホバー表示・ハイライト）より先に更新する必要がある。
  sourceFilePaths = state.sourceFilePaths;
  // 組の配列から作り直す（issue #18）。プレーンなオブジェクトで受け取ると
  // ログ本文がキーになる都合上 `__proto__` 等と衝突しうるため、`Map` にする。
  lineHighlights = new Map(state.highlights ?? []);
  renderHighlightRules(state.highlightRules);
  renderTimestampFormatRows(state.timestampFormatRows);
  renderTimestampFormatsScope(state.timestampFormatsScope);
  renderUnrecognizedLines(state.unrecognizedSampleLines);
  renderLoadedFiles(state.loadedFileNames, state.sourceFilePaths, state.criteria.visibleFiles);
  renderSeverities(state.distinctSeverities, state.criteria.severities);
  syncTextInputIfNotFocused(dateStartInput, state.criteria.dateRangeStart);
  syncTextInputIfNotFocused(dateEndInput, state.criteria.dateRangeEnd);
  renderPatternRows(matchPatternList, state.criteria.matchPatterns);
  renderPatternRows(ignorePatternList, state.criteria.ignorePatterns);
  collapseToggle.checked = state.criteria.collapseEnabled;
  collapseToggle.disabled = !state.collapsibleSupported;
  setMaskEnabled(state.criteria.mask.enabled);
  maskTimestampToggle.checked = state.criteria.mask.maskTimestamp;
  maskHostToggle.checked = state.criteria.mask.maskHost;
  maskProcessIdToggle.checked = state.criteria.mask.maskProcessId;
  syncTextInputIfNotFocused(maskKeysInput, state.criteria.mask.keys);
  syncTextInputIfNotFocused(maskPatternInput, state.criteria.mask.pattern);

  statusElement.textContent = formatLabel(
    state.labels.statusMessage,
    state.visibleLineCount,
    state.totalLineCount
  );
  warningElement.textContent = state.warning ?? "";
  // ボタンは認識率警告があるときだけ出す（issue #321）。`warning` は他の
  // 警告文と1本の文字列に連結済みで種別を判別できないため、専用フラグを見る。
  openTimestampPanelFromWarningButton.hidden = !state.hasTimestampRecognitionWarning;
  if (state.focusTimestampPanel) {
    setTimestampPanelExpanded(true);
  }
  renderDisplayLimit(state.displayLimit);
  if (state.items) {
    renderItems(state.items);
  } else {
    renderText(state.text, state.lineSources);
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return;
  }
  const typed = message as ExtensionToWebviewMessage;
  if (typed.type === "state") {
    renderState(typed);
    return;
  }
  handleTimestampPatternResult(typed.response);
});

vscodeApi.postMessage({ type: "ready" });
