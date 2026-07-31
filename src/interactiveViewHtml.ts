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
  }`;

const INTERACTIVE_VIEW_BODY = `  <div id="files-panel">
    <button id="add-files-button" type="button">+ Add Files...</button>
    <button id="export-button" type="button">Export as Virtual Document</button>
    <div id="mask-container">
      <button id="mask-button" type="button" aria-pressed="false" title="選んだ対象を伏せて表示します（そのままコピーできます）">🔓 Mask</button>
      <button id="mask-options-button" type="button" aria-expanded="false" aria-controls="mask-panel" title="マスクする対象を選ぶ">▾</button>
      <div id="mask-panel" hidden>
        <label><input type="checkbox" id="mask-timestamp">タイムスタンプ</label>
        <label><input type="checkbox" id="mask-host">ホスト名 / IPアドレス</label>
        <label><input type="checkbox" id="mask-process-id">プロセスID</label>
        <!-- キー指定・任意パターンにチェックボックスを添えないのは、入力欄が
             空かどうかがそのままON/OFFになるため（絞り込みのパターン欄と同じ
             扱い）。キー指定を上に置くのは、正規表現を書かずに済むこちらを
             先に目に入れてほしいため（issue #212）。 -->
        <label><span class="mask-field-label">キー</span><input type="text" id="mask-keys" placeholder="user, token" title="ここに挙げたキーの値だけを伏せます（user=hoge → user=&lt;MASKED&gt;）。カンマまたは空白区切り。= と : の両方、クォート付きの値にも対応します"></label>
        <label><span class="mask-field-label">任意パターン</span><input type="text" id="mask-pattern" placeholder="正規表現" title="一致した箇所を &lt;MASKED&gt; に置き換えます。キー名を残したいだけなら上の「キー」欄の方が簡単です"></label>
      </div>
    </div>
    <!-- ハイライトルール（issue #238）。マスクと同じ「▾」で開く折りたたみパネルに
         する。マスクと違いON/OFFボタンは無い——ルールは設定に保存され、あれば
         常に効く（issue #18）。 -->
    <div id="highlight-container">
      <button id="highlight-options-button" type="button" aria-expanded="false" aria-controls="highlight-panel" title="ハイライトするパターンを登録する（設定に保存されます）">ハイライト ▾</button>
      <div id="highlight-panel" hidden>
        <div id="highlight-rules" role="group" aria-label="ハイライトルール"></div>
        <button id="add-highlight-rule" type="button" class="add-pattern" aria-label="ハイライトルールを追加する">+ 追加</button>
        <p id="highlight-panel-hint">上の行ほど優先されます（範囲が重なったとき）。</p>
      </div>
    </div>
    <span id="loaded-files-label">読み込み済み:</span>
    <div id="loaded-files"></div>
  </div>
  <div id="filter-panel">
    <div id="severities"></div>
    <label>開始日時 <input type="text" id="date-start" placeholder="YYYY-MM-DD"></label>
    <label>終了日時 <input type="text" id="date-end" placeholder="YYYY-MM-DD"></label>
    <!-- パターンは1行1件で、行ごとにチェックで外せる（issue #206）。同じ欄の中は
         OR、欄同士は AND。行の並びは main.ts が状態から描く。 -->
    <div class="pattern-field">
      <span class="pattern-field-label" title="ここに挙げたどれかに一致する行だけを表示します（複数指定は OR）">一致パターン</span>
      <!-- 行ごとの入力欄は動的に増減するため <label> で囲めない。欄の名前は
           グループとして持たせ、行の中の各操作には aria-label を付ける。 -->
      <div id="match-patterns" class="pattern-list" role="group" aria-label="一致パターン"></div>
      <button id="add-match-pattern" type="button" class="add-pattern" aria-label="一致パターンを追加する">+ 追加</button>
    </div>
    <div class="pattern-field">
      <span class="pattern-field-label" title="ここに挙げたどれかに一致する行を隠します（複数指定は OR）">無視パターン</span>
      <div id="ignore-patterns" class="pattern-list" role="group" aria-label="無視パターン"></div>
      <button id="add-ignore-pattern" type="button" class="add-pattern" aria-label="無視パターンを追加する">+ 追加</button>
    </div>
    <label><input type="checkbox" id="collapse-toggle" checked>繰り返しを折りたたむ</label>
  </div>
  <div id="status"></div>
  <div id="warning"></div>
  <div id="display-limit"></div>
  <pre id="log-output"></pre>`;

export function buildInteractiveViewHtml(options: { nonce: string; scriptUrl: string }): string {
  const { nonce, scriptUrl } = options;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
${INTERACTIVE_VIEW_STYLES}
</style>
</head>
<body>
${INTERACTIVE_VIEW_BODY}
  <script nonce="${nonce}" src="${scriptUrl}"></script>
</body>
</html>`;
}
