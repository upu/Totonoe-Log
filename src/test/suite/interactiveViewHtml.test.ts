import * as assert from "node:assert";
import { buildInteractiveViewHtml } from "../../interactiveViewHtml";

const NONCE = "TEST_NONCE_0123456789";
const SCRIPT_URL = "https://file+.vscode-resource.vscode-cdn.net/out/webview/interactiveView/main.js";

/**
 * `src/webview/interactiveView/main.ts` が `getElementById` で引く要素の id。
 * テンプレート側で id を消す・綴りを変えると、型では捕まらず Webview を開いた
 * ときに初めて壊れる（片側だけ直しても両方ともコンパイルは通る）。切り出しで
 * マークアップを移動させる以上、ここで突き合わせておく。
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
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    assert.ok(html.startsWith("<!DOCTYPE html>"), "should start with a doctype");
    assert.ok(html.includes('<html lang="ja">'), "should keep the document language");
    assert.ok(html.trimEnd().endsWith("</html>"), "should close the document");
  });

  test("puts the nonce on the CSP meta, the style tag and the script tag", () => {
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    assert.ok(
      html.includes(`style-src 'nonce-${NONCE}'; script-src 'nonce-${NONCE}';`),
      "CSP should allow only the nonced style and script"
    );
    assert.ok(html.includes(`<style nonce="${NONCE}">`), "style tag should carry the nonce");
    assert.ok(html.includes(`<script nonce="${NONCE}"`), "script tag should carry the nonce");
  });

  test("keeps the default-src 'none' baseline in the CSP", () => {
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    assert.ok(html.includes("default-src 'none';"), "everything not nonced must stay blocked");
  });

  test("points the script tag at the given webview URL", () => {
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    assert.ok(html.includes(`src="${SCRIPT_URL}"`), "script src should be the resolved webview URL");
  });

  test("contains every element id the webview script looks up", () => {
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    for (const id of REQUIRED_ELEMENT_IDS) {
      assert.ok(html.includes(`id="${id}"`), `missing element id="${id}"`);
    }
  });

  test("still ships the stylesheet with the document", () => {
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    const styleStart = html.indexOf("<style");
    const styleEnd = html.indexOf("</style>");
    assert.ok(styleStart >= 0 && styleEnd > styleStart, "should contain a style block");
    assert.ok(
      html.slice(styleStart, styleEnd).includes("--vscode-"),
      "styles should keep using VS Code theme variables"
    );
  });

  test("does not leak an unresolved template placeholder", () => {
    const html = buildInteractiveViewHtml({ nonce: NONCE, scriptUrl: SCRIPT_URL });

    assert.ok(!html.includes("${"), "every interpolation should have been substituted");
  });
});
