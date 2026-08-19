import * as vscode from "vscode";

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ENTITIES[character]);
}

/**
 * 状態管理の流れを巨大なリテラルで隠さないため、Webview の文書だけを分離する。
 * 拡張機能側で組み立てる文書なので、ブラウザ用の別 tsconfig がある src/webview には置かない。
 */
const INTERACTIVE_VIEW_STYLES = `  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background-color: var(--vscode-editor-background);
    padding: 8px 12px;
  }
  #files-panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 8px;
  }
  button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
  }
  button:hover {
    background-color: var(--vscode-button-hoverBackground);
  }
  /* 読み込み済みファイルは、表示ON/OFFのチェックボックスと取り消しボタンを
     持つ「チップ」として1件ずつ並べる（issue #170）。 */
  #loaded-files {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
  }
  #loaded-files-label {
    font-size: 0.9em;
    opacity: 0.8;
  }
  .loaded-file {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .loaded-file label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  /* 取り消しはファイル名の隣に添える小さな操作なので、上部の主要ボタン
     （追加・書き出し・マスク）と同じ塗りにはせず、地の色に溶かしておく。 */
  .remove-file {
    background-color: transparent;
    color: inherit;
    padding: 0 4px;
    opacity: 0.7;
  }
  .remove-file:hover:enabled {
    background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    opacity: 1;
  }
  /* 最後の1件は取り消せない（読み込み0件になると復帰できないため）。 */
  .remove-file:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .remove-file:disabled:hover {
    background-color: transparent;
  }
  /* マスクパネルはボタンに重ねて開く（issue #194）。絞り込み列に対象を並べると
     #195 で対象が増えたときに横へ伸び続けるため、開閉するパネルに畳んでおく。 */
  #mask-container {
    position: relative;
    display: flex;
    gap: 1px;
  }
  /* ハイライトルールのパネル（issue #238）。マスクパネルと同じ、ボタン直下に
     せり出す作法にする。行の要素が多い（名前・パターン・色・並べ替え・削除）ので
     幅はマスクパネルより広く取る。 */
  #highlight-container {
    position: relative;
    display: flex;
  }
  #highlight-panel {
    position: absolute;
    z-index: 1;
    top: 100%;
    left: 0;
    margin-top: 2px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    white-space: nowrap;
    background-color: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  }
  /* マスクパネルと同じ理由で、閉じた状態を明示する（issue #197）。 */
  #highlight-panel[hidden] {
    display: none;
  }
  #highlight-panel-hint {
    margin: 2px 0 0;
    font-size: 0.9em;
    opacity: 0.8;
  }
  .highlight-rule-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .highlight-rule-row .highlight-rule-name {
    width: 8em;
  }
  .highlight-rule-row .highlight-rule-pattern {
    width: 14em;
  }
  /* 並べ替え（▲▼）と削除（✕）は、読み込み済みファイルの取り消しボタンと
     同じ控えめな見た目に揃える。 */
  .highlight-rule-row button {
    background-color: transparent;
    color: inherit;
    padding: 0 4px;
    opacity: 0.7;
  }
  .highlight-rule-row button:disabled {
    opacity: 0.3;
  }
  /* マスクONの間の見た目は、VSCodeが検索ボックスのオプション（正規表現・
     大文字小文字）のトグルに使っている色に合わせる（issue #197）。ラベルに
     「: ON」「: OFF」と状態を書き込むのはVSCodeの作法から外れているため、
     状態は配色と施錠アイコン（🔓/🔒）の2つで示す（issue #195）。 */
  #mask-button.toggled-on {
    background-color: var(--vscode-inputOption-activeBackground, var(--vscode-button-hoverBackground));
    color: var(--vscode-inputOption-activeForeground, var(--vscode-button-foreground));
    /* 枠線は border ではなく outline で描く（border だとON/OFFでボタンの
       寸法が変わり、隣の「▾」がずれるため）。 */
    outline: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
    outline-offset: -1px;
  }
  #mask-panel {
    position: absolute;
    z-index: 1;
    top: 100%;
    left: 0;
    margin-top: 2px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    white-space: nowrap;
    background-color: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  }
  /* display を指定した要素では UA の [hidden] { display: none } が作者
     スタイルに負けるため、閉じた状態を明示する（issue #197）。
     このスタイルは template literal 内なのでバックティックは使えない。 */
  #mask-panel[hidden] {
    display: none;
  }
  #mask-panel label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* キー指定・任意パターンの入力欄（issue #195、#212）。パネルの他の行は
     チェックボックスだけで短いため、幅を決めておかないとパネルが入力欄の
     既定幅まで広がってしまう。2欄の左端を揃えるため、ラベルの幅も固定する。 */
  #mask-keys,
  #mask-pattern {
    width: 12em;
  }
  .mask-field-label {
    display: inline-block;
    min-width: 6em;
  }
  /* パターン欄（issue #206）。ラベルを左に置き、右の列に入力行を縦に積んで
     その下に「+ 追加」を置く。行が増えても他の絞り込み項目の位置がずれない
     よう、欄そのものは1つのブロックとして #filter-panel に並ぶ。 */
  .pattern-field {
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 6px;
    align-items: start;
  }
  .pattern-field-label {
    grid-column: 1;
    grid-row: 1;
    /* 行が2行以上になっても、ラベルは先頭行の高さに合わせる。 */
    line-height: 1.8;
  }
  .pattern-list {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .add-pattern {
    grid-column: 2;
    grid-row: 2;
    justify-self: start;
  }
  .pattern-row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .pattern-row input[type="text"] {
    width: 12em;
  }
  .remove-pattern {
    background-color: transparent;
    color: inherit;
    padding: 0 4px;
    opacity: 0.7;
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
  #display-limit {
    color: var(--vscode-editorWarning-foreground, var(--vscode-errorForeground));
    margin-bottom: 4px;
  }
  #log-output {
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre;
    overflow-x: auto;
  }
  .collapse-group-header {
    cursor: pointer;
  }
  .collapse-group-header:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
  /* ハイライトルール（issue #18）の色。太字や背景色は使わない——等幅で桁を
     揃えて読むビューなので、字幅が変わりうる装飾は避ける。既定は明るいテーマ
     向けの濃い色で、暗いテーマは下で上書きする（VSCodeがbodyに付ける
     vscode-dark / vscode-high-contrast クラスで出し分ける）。 */
  .highlight-red { color: #c72e0f; }
  .highlight-orange { color: #b8760a; }
  .highlight-yellow { color: #8a7500; }
  .highlight-green { color: #107c10; }
  .highlight-blue { color: #0057b7; }
  .highlight-purple { color: #7a3ea3; }
  body.vscode-dark .highlight-red,
  body.vscode-high-contrast .highlight-red { color: #f48771; }
  body.vscode-dark .highlight-orange,
  body.vscode-high-contrast .highlight-orange { color: #d79c4b; }
  body.vscode-dark .highlight-yellow,
  body.vscode-high-contrast .highlight-yellow { color: #d7d700; }
  body.vscode-dark .highlight-green,
  body.vscode-high-contrast .highlight-green { color: #89d185; }
  body.vscode-dark .highlight-blue,
  body.vscode-high-contrast .highlight-blue { color: #75beff; }
  body.vscode-dark .highlight-purple,
  body.vscode-high-contrast .highlight-purple { color: #c586c0; }
  /* ジャンプはダブルクリック/右クリックメニュー（issue #191）なので、
     シングルクリックを促す cursor: pointer は付けず、行が対象であることは
     ホバーの背景色だけで示す。 */
  .source-line:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
  /* タイムスタンプ形式パネル（issue #316）。マスク・ハイライトと同じ、
     ボタン直下にせり出す作法にする。未認識行の一覧とプレビュー欄を含むぶん
     ハイライトパネルよりさらに幅を取る。 */
  #timestamp-container {
    position: relative;
    display: flex;
  }
  #timestamp-panel {
    position: absolute;
    z-index: 1;
    top: 100%;
    left: 0;
    margin-top: 2px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 28em;
    white-space: normal;
    background-color: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  }
  #timestamp-panel[hidden] {
    display: none;
  }
  .timestamp-format-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .timestamp-format-row .timestamp-format-name {
    width: 8em;
  }
  .timestamp-format-row .timestamp-format-pattern {
    width: 14em;
  }
  .timestamp-format-row button {
    background-color: transparent;
    color: inherit;
    padding: 0 4px;
    opacity: 0.7;
  }
  .timestamp-format-feedback {
    flex-basis: 100%;
    font-size: 0.9em;
    opacity: 0.8;
    margin: 0;
  }
  .timestamp-format-feedback.timestamp-format-error {
    color: var(--vscode-errorForeground);
    opacity: 1;
  }
  #timestamp-scope-label {
    margin: 2px 0;
    font-size: 0.85em;
    opacity: 0.7;
  }
  #timestamp-unrecognized-lines {
    display: flex;
    flex-direction: column;
    max-height: 8em;
    overflow-y: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
    background-color: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    padding: 2px 4px;
  }
  .timestamp-sample-line {
    white-space: pre;
    cursor: text;
  }
  #timestamp-selection-status {
    font-size: 0.85em;
    opacity: 0.8;
    margin: 0;
  }
  #timestamp-proposal {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  #timestamp-proposal[hidden] {
    display: none;
  }
  #timestamp-ambiguous-hint {
    margin: 0;
    font-size: 0.85em;
    opacity: 0.8;
  }
  #timestamp-ambiguous-hint[hidden] {
    display: none;
  }`;

/** ファイルパネル（追加・書き出し・マスク・ハイライト・タイムスタンプ形式）の静的文言。 */
function buildFilesPanelLabels() {
  return {
    addFiles: escapeHtml(vscode.l10n.t("+ Add Files...")),
    exportVirtualDocument: escapeHtml(vscode.l10n.t("Export as Virtual Document")),
    maskTitle: escapeHtml(
      vscode.l10n.t("Mask the selected data in the display (the masked text can be copied as-is)")
    ),
    maskLabel: escapeHtml(vscode.l10n.t("🔓 Mask")),
    maskOptionsTitle: escapeHtml(vscode.l10n.t("Choose what to mask")),
    timestamp: escapeHtml(vscode.l10n.t("Timestamp")),
    host: escapeHtml(vscode.l10n.t("Host name / IP address")),
    processId: escapeHtml(vscode.l10n.t("Process ID")),
    key: escapeHtml(vscode.l10n.t("Key")),
    keyPlaceholder: escapeHtml(vscode.l10n.t("user, token")),
    keyMaskTitle: escapeHtml(
      vscode.l10n.t(
        "Mask only the values of these keys (user=hoge → user=<MASKED>). Separate keys with commas or spaces. Both = and : separators and quoted values are supported."
      )
    ),
    customPattern: escapeHtml(vscode.l10n.t("Custom pattern")),
    regularExpression: escapeHtml(vscode.l10n.t("Regular expression")),
    customPatternTitle: escapeHtml(
      vscode.l10n.t(
        "Replace matching text with <MASKED>. To preserve a key name, use the Key field above instead."
      )
    ),
    highlightTitle: escapeHtml(
      vscode.l10n.t("Register patterns to highlight (saved in Settings)")
    ),
    highlightLabel: escapeHtml(vscode.l10n.t("Highlight ▾")),
    highlightRules: escapeHtml(vscode.l10n.t("Highlight rules")),
    addHighlightRule: escapeHtml(vscode.l10n.t("Add a highlight rule")),
    add: escapeHtml(vscode.l10n.t("+ Add")),
    highlightHint: escapeHtml(
      vscode.l10n.t("Higher rows take priority when ranges overlap.")
    ),
    timestampFormatsTitle: escapeHtml(
      vscode.l10n.t(
        "Add timestamp formats not recognized by the built-ins, or suggest one from a selection (saved in Settings)"
      )
    ),
    timestampFormatsLabel: escapeHtml(vscode.l10n.t("Timestamp ▾")),
    timestampFormats: escapeHtml(vscode.l10n.t("Timestamp formats")),
    addTimestampFormat: escapeHtml(vscode.l10n.t("Add a timestamp format")),
    unrecognizedLines: escapeHtml(vscode.l10n.t("Unrecognized lines")),
    unrecognizedLinesHint: escapeHtml(
      vscode.l10n.t("Select part of a line below (or in the log) to get a pattern suggestion.")
    ),
    suggestFromSelection: escapeHtml(vscode.l10n.t("Suggest from selection")),
    addProposal: escapeHtml(vscode.l10n.t("+ Add to timestamp formats")),
    ambiguousDayMonthOrderHint: escapeHtml(
      vscode.l10n.t("The day/month order was ambiguous — pick one if this looks wrong:")
    ),
    dayMonthOrderDmy: escapeHtml(vscode.l10n.t("Use day, month order")),
    dayMonthOrderMdy: escapeHtml(vscode.l10n.t("Use month, day order")),
    loadedFiles: escapeHtml(vscode.l10n.t("Loaded files:")),
  };
}

/** 絞り込みパネル（日付・パターン・折りたたみ）の静的文言。 */
function buildFilterPanelLabels() {
  return {
    datePlaceholder: escapeHtml(vscode.l10n.t("YYYY-MM-DD")),
    startDateTime: escapeHtml(vscode.l10n.t("Start date and time")),
    endDateTime: escapeHtml(vscode.l10n.t("End date and time")),
    matchPatterns: escapeHtml(vscode.l10n.t("Match patterns")),
    matchPatternsTitle: escapeHtml(
      vscode.l10n.t("Show only lines matching any of these patterns (multiple patterns use OR)")
    ),
    addMatchPattern: escapeHtml(vscode.l10n.t("Add a match pattern")),
    ignorePatterns: escapeHtml(vscode.l10n.t("Ignore patterns")),
    ignorePatternsTitle: escapeHtml(
      vscode.l10n.t("Hide lines matching any of these patterns (multiple patterns use OR)")
    ),
    addIgnorePattern: escapeHtml(vscode.l10n.t("Add an ignore pattern")),
    collapseRepeated: escapeHtml(vscode.l10n.t("Collapse repeated entries")),
    // 認識率警告のモーダル通知（timestampRecognitionWarning.ts）のアクション
    // ボタンと同じ英語原文を使い、l10n バンドルの訳を1つに保つ（issue #321）。
    openTimestampHelperFromWarning: escapeHtml(vscode.l10n.t("Open Timestamp Format Helper")),
  };
}

/** `max-lines-per-function` を超えないよう、パネルごとに分けた文言を1つにまとめる。 */
function buildInteractiveViewBodyLabels() {
  return { ...buildFilesPanelLabels(), ...buildFilterPanelLabels() };
}

type InteractiveViewBodyLabels = ReturnType<typeof buildInteractiveViewBodyLabels>;

/**
 * タイムスタンプ形式パネル（issue #316）。マスク・ハイライトと同じ「▾」で
 * 開く折りたたみパネルにする。行の一覧に加えて、未認識行から選んでパターンを
 * 提案してもらう導線を持つ（issue #320 の inferTimestampPattern を使う）。
 * `buildFilesPanel` を60行以内に収めるための分割（issue #325）。
 */
function buildTimestampFormatPanel(labels: InteractiveViewBodyLabels): string {
  return `    <div id="timestamp-container">
      <button id="timestamp-options-button" type="button" aria-expanded="false" aria-controls="timestamp-panel" title="${labels.timestampFormatsTitle}">${labels.timestampFormatsLabel}</button>
      <div id="timestamp-panel" hidden>
        <div id="timestamp-formats" role="group" aria-label="${labels.timestampFormats}"></div>
        <button id="add-timestamp-format" type="button" class="add-pattern" aria-label="${labels.addTimestampFormat}">${labels.add}</button>
        <!-- 保存済みの行が1件も無い間は空のまま——何もしていないのに
             「保存されました」と出てしまわないよう、main.ts 側で
             件数を見てから文言を入れる（issue #325）。 -->
        <p id="timestamp-scope-label"></p>
        <!-- 案内文を一覧より先に置く。「下の行を選択」という文言と実際の
             位置を一致させる（issue #325）。 -->
        <p id="timestamp-unrecognized-lines-hint">${labels.unrecognizedLinesHint}</p>
        <div id="timestamp-unrecognized-lines" role="group" aria-label="${labels.unrecognizedLines}"></div>
        <button id="suggest-from-selection" type="button">${labels.suggestFromSelection}</button>
        <p id="timestamp-selection-status"></p>
        <div id="timestamp-proposal" hidden>
          <input type="text" id="timestamp-proposal-name">
          <input type="text" id="timestamp-proposal-pattern">
          <button id="add-timestamp-proposal" type="button">${labels.addProposal}</button>
          <p id="timestamp-ambiguous-hint" hidden>
            ${labels.ambiguousDayMonthOrderHint}
            <button id="timestamp-dmy-button" type="button">${labels.dayMonthOrderDmy}</button>
            <button id="timestamp-mdy-button" type="button">${labels.dayMonthOrderMdy}</button>
          </p>
        </div>
      </div>
    </div>`;
}

function buildFilesPanel(labels: InteractiveViewBodyLabels): string {
  return `  <div id="files-panel">
    <button id="add-files-button" type="button">${labels.addFiles}</button>
    <button id="export-button" type="button">${labels.exportVirtualDocument}</button>
    <div id="mask-container">
      <button id="mask-button" type="button" aria-pressed="false" title="${labels.maskTitle}">${labels.maskLabel}</button>
      <button id="mask-options-button" type="button" aria-expanded="false" aria-controls="mask-panel" aria-label="${labels.maskOptionsTitle}" title="${labels.maskOptionsTitle}">▾</button>
      <div id="mask-panel" hidden>
        <label><input type="checkbox" id="mask-timestamp">${labels.timestamp}</label>
        <label><input type="checkbox" id="mask-host">${labels.host}</label>
        <label><input type="checkbox" id="mask-process-id">${labels.processId}</label>
        <!-- キー指定・任意パターンにチェックボックスを添えないのは、入力欄が
             空かどうかがそのままON/OFFになるため（絞り込みのパターン欄と同じ
             扱い）。キー指定を上に置くのは、正規表現を書かずに済むこちらを
             先に目に入れてほしいため（issue #212）。 -->
        <label><span class="mask-field-label">${labels.key}</span><input type="text" id="mask-keys" placeholder="${labels.keyPlaceholder}" title="${labels.keyMaskTitle}"></label>
        <label><span class="mask-field-label">${labels.customPattern}</span><input type="text" id="mask-pattern" placeholder="${labels.regularExpression}" title="${labels.customPatternTitle}"></label>
      </div>
    </div>
    <!-- ハイライトルール（issue #238）。マスクと同じ「▾」で開く折りたたみパネルに
         する。マスクと違いON/OFFボタンは無い——ルールは設定に保存され、あれば
         常に効く（issue #18）。 -->
    <div id="highlight-container">
      <button id="highlight-options-button" type="button" aria-expanded="false" aria-controls="highlight-panel" title="${labels.highlightTitle}">${labels.highlightLabel}</button>
      <div id="highlight-panel" hidden>
        <div id="highlight-rules" role="group" aria-label="${labels.highlightRules}"></div>
        <button id="add-highlight-rule" type="button" class="add-pattern" aria-label="${labels.addHighlightRule}">${labels.add}</button>
        <p id="highlight-panel-hint">${labels.highlightHint}</p>
      </div>
    </div>
${buildTimestampFormatPanel(labels)}
    <span id="loaded-files-label">${labels.loadedFiles}</span>
    <div id="loaded-files"></div>
  </div>`;
}

function buildFilterPanel(labels: InteractiveViewBodyLabels): string {
  return `  <div id="filter-panel">
    <div id="severities"></div>
    <label>${labels.startDateTime} <input type="text" id="date-start" placeholder="${labels.datePlaceholder}"></label>
    <label>${labels.endDateTime} <input type="text" id="date-end" placeholder="${labels.datePlaceholder}"></label>
    <!-- パターンは1行1件で、行ごとにチェックで外せる（issue #206）。同じ欄の中は
         OR、欄同士は AND。行の並びは main.ts が状態から描く。 -->
    <div class="pattern-field">
      <span class="pattern-field-label" title="${labels.matchPatternsTitle}">${labels.matchPatterns}</span>
      <!-- 行ごとの入力欄は動的に増減するため <label> で囲めない。欄の名前は
           グループとして持たせ、行の中の各操作には aria-label を付ける。 -->
      <div id="match-patterns" class="pattern-list" role="group" aria-label="${labels.matchPatterns}"></div>
      <button id="add-match-pattern" type="button" class="add-pattern" aria-label="${labels.addMatchPattern}">${labels.add}</button>
    </div>
    <div class="pattern-field">
      <span class="pattern-field-label" title="${labels.ignorePatternsTitle}">${labels.ignorePatterns}</span>
      <div id="ignore-patterns" class="pattern-list" role="group" aria-label="${labels.ignorePatterns}"></div>
      <button id="add-ignore-pattern" type="button" class="add-pattern" aria-label="${labels.addIgnorePattern}">${labels.add}</button>
    </div>
    <label><input type="checkbox" id="collapse-toggle" checked>${labels.collapseRepeated}</label>
  </div>
  <div id="status"></div>
  <div id="warning"></div>
  <!-- タイムスタンプ認識率の警告（issue #101）が出ているときだけ見せる、
       タイムスタンプ形式パネルへの近道（issue #321）。手動で「タイムスタンプ ▾」
       を押すのと同じ状態に飛ぶだけで、ワンショットの確定操作ではない。 -->
  <button id="open-timestamp-panel-from-warning" type="button" hidden>${labels.openTimestampHelperFromWarning}</button>
  <div id="display-limit"></div>
  <pre id="log-output"></pre>`;
}

function buildInteractiveViewBody(): string {
  const labels = buildInteractiveViewBodyLabels();
  return `${buildFilesPanel(labels)}\n${buildFilterPanel(labels)}`;
}

export function buildInteractiveViewHtml(options: {
  nonce: string;
  scriptUrl: string;
  language: string;
}): string {
  const { nonce, scriptUrl, language } = options;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
${INTERACTIVE_VIEW_STYLES}
</style>
</head>
<body>
${buildInteractiveViewBody()}
  <script nonce="${nonce}" src="${scriptUrl}"></script>
</body>
</html>`;
}
