import * as assert from "node:assert";
import { buildInteractiveViewLabels } from "../../interactiveViewLabels";

suite("interactiveViewLabels (#278)", () => {
  test("builds every label required by the Webview protocol", () => {
    const labels = buildInteractiveViewLabels();

    assert.deepStrictEqual(Object.keys(labels).sort(), [
      "addProposalLabel",
      "ambiguousDayMonthOrderHint",
      "cannotRemoveLastFileLabel",
      "dayMonthOrderDmyLabel",
      "dayMonthOrderMdyLabel",
      "displayLimitMessage",
      "hideFileTitle",
      "hideFileWithPathTitle",
      "highlightCollapsedLabel",
      "highlightColorAriaLabel",
      "highlightColorBlue",
      "highlightColorGreen",
      "highlightColorOrange",
      "highlightColorPurple",
      "highlightColorRed",
      "highlightColorYellow",
      "highlightExpandedLabel",
      "highlightPatternAriaLabel",
      "maskDisabledLabel",
      "maskEnabledLabel",
      "matchSummaryMessage",
      "moveRuleDownAriaLabel",
      "moveRuleDownTitle",
      "moveRuleUpAriaLabel",
      "moveRuleUpTitle",
      "noSelectionMessage",
      "patternAriaLabel",
      "patternEnabledAriaLabel",
      "patternToggleTitle",
      "regularExpressionPlaceholder",
      "removeFileLabel",
      "removePatternAriaLabel",
      "removePatternTitle",
      "removeRuleAriaLabel",
      "removeRuleTitle",
      "removeTimestampFormatAriaLabel",
      "removeTimestampFormatTitle",
      "ruleNameAriaLabel",
      "ruleNamePlaceholder",
      "savedToUserLabel",
      "savedToWorkspaceLabel",
      "sourceFilesTitle",
      "statusMessage",
      "suggestFromSelectionLabel",
      "timestampFormatNameAriaLabel",
      "timestampFormatPatternAriaLabel",
      "unrecognizedLinesEmptyMessage",
      "unrecognizedSeverity",
    ]);
    assert.ok(labels.unrecognizedSeverity.length > 0);
    assert.ok(labels.maskEnabledLabel.startsWith("🔒"));
    assert.ok(labels.highlightCollapsedLabel.endsWith("▾"));
    assert.ok(labels.removeFileLabel.includes("{0}"));
    assert.ok(labels.displayLimitMessage.includes("{0}"));
    assert.ok(labels.statusMessage.includes("{1}"));
  });
});
