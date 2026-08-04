import * as assert from "node:assert";
import { buildInteractiveViewHtml } from "../../interactiveViewHtml";

const NONCE = "TEST_NONCE_0123456789";
const SCRIPT_URL = "https://file+.vscode-resource.vscode-cdn.net/out/webview/interactiveView/main.js";

function buildHtml(language = "en"): string {
  return buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL, language });
}

/**
 * `src/webview/interactiveView/main.ts` が `getElementById` で引く要素の id。
 * テンプレート側で id を消す・綴りを変えると、型では捕まらず Webview を開いた
 * ときに初めて壊れる（片側だけ直しても両方ともコンパイルは通る）。切り出しで
 * マークアップを移動させる以上、ここで突き合わせておく。
 *
 * main.ts に id を足したらこの表にも足すこと。探すときは行単位の grep だと
 * Prettier が折り返した呼び出し（`getElementById(\n  "..."\n)`）を取りこぼす。
 */
const REQUIRED_ELEMENT_IDS = [
  "add-files-button",
  "add-highlight-rule",
  "add-ignore-pattern",
  "add-match-pattern",
  "collapse-toggle",
  "date-end",
  "date-start",
  "display-limit",
  "export-button",
  "highlight-options-button",
  "highlight-panel",
  "highlight-rules",
  "ignore-patterns",
  "loaded-files",
  "log-output",
  "mask-button",
  "mask-host",
  "mask-keys",
  "mask-options-button",
  "mask-panel",
  "mask-pattern",
  "mask-process-id",
  "mask-timestamp",
  "match-patterns",
  "severities",
  "status",
  "warning",
];

suite("interactiveViewHtml / buildInteractiveViewHtml (#262)", () => {
  test("returns a full HTML document", () => {
    const html = buildHtml();

    assert.ok(html.startsWith("<!DOCTYPE html>"), "should start with a doctype");
    assert.ok(html.trimEnd().endsWith("</html>"), "should close the document");
  });

  test("uses the supplied VS Code display language as html lang (#278)", () => {
    assert.ok(buildHtml("en").includes('<html lang="en">'));
    assert.ok(buildHtml("ja").includes('<html lang="ja">'));
    assert.ok(buildHtml("pt-br").includes('<html lang="pt-br">'));
  });

  test("escapes the document language before inserting it into HTML (#278)", () => {
    const html = buildHtml('en"><script>alert(1)</script>');

    assert.ok(html.includes('<html lang="en&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  test("renders localized static controls and accessibility text (#278)", () => {
    const html = buildHtml("en");
    const expectedSnippets = [
      ">Loaded files:</span>",
      ">Start date and time ",
      ">End date and time ",
      ">Match patterns</span>",
      ">Ignore patterns</span>",
      ">Collapse repeated entries</label>",
      ">+ Add</button>",
      ">Highlight ▾</button>",
      'placeholder="Regular expression"',
      'title="Choose what to mask"',
      'aria-label="Choose what to mask"',
      "Replace matching text with &lt;MASKED&gt;.",
      'aria-label="Add a highlight rule"',
    ];

    for (const snippet of expectedSnippets) {
      assert.ok(html.includes(snippet), `missing localized HTML: ${snippet}`);
    }
  });

  test("puts the nonce on the CSP meta, the style tag and the script tag", () => {
    const html = buildHtml();

    assert.ok(
      html.includes(`style-src 'nonce-${NONCE}'; script-src 'nonce-${NONCE}';`),
      "CSP should allow only the nonced style and script"
    );
    assert.ok(html.includes(`<style nonce="${NONCE}">`), "style tag should carry the nonce");
    assert.ok(html.includes(`<script nonce="${NONCE}"`), "script tag should carry the nonce");
  });

  test("keeps the default-src 'none' baseline in the CSP", () => {
    const html = buildHtml();

    assert.ok(html.includes("default-src 'none';"), "everything not nonced must stay blocked");
  });

  test("points the script tag at the given webview URL", () => {
    const html = buildHtml();

    assert.ok(html.includes(`src="${SCRIPT_URL}"`), "script src should be the resolved webview URL");
  });

  test("contains every element id the webview script looks up", () => {
    const html = buildHtml();

    for (const id of REQUIRED_ELEMENT_IDS) {
      assert.ok(html.includes(`id="${id}"`), `missing element id="${id}"`);
    }
  });

  test("still ships the stylesheet with the document", () => {
    const html = buildHtml();

    const styleStart = html.indexOf("<style");
    const styleEnd = html.indexOf("</style>");
    assert.ok(styleStart >= 0 && styleEnd > styleStart, "should contain a style block");
    assert.ok(
      html.slice(styleStart, styleEnd).includes("--vscode-"),
      "styles should keep using VS Code theme variables"
    );
  });

  test("does not leak an unresolved template placeholder", () => {
    const html = buildHtml();

    assert.ok(!html.includes("${"), "every interpolation should have been substituted");
  });
});
