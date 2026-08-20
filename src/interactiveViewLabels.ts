import * as vscode from "vscode";
import type { InteractiveViewLabels } from "./webview/interactiveView/protocol";

/** Webview側で動的に作る要素へ渡す文言を、拡張機能本体側で翻訳する。 */
export function buildInteractiveViewLabels(): InteractiveViewLabels {
  return {
    unrecognizedSeverity: vscode.l10n.t("(no severity)"),
    patternToggleTitle: vscode.l10n.t("Temporarily exclude this row (the input is preserved)"),
    patternEnabledAriaLabel: vscode.l10n.t("Enable this pattern"),
    regularExpressionPlaceholder: vscode.l10n.t("Regular expression"),
    patternAriaLabel: vscode.l10n.t("Pattern (regular expression)"),
    removePatternTitle: vscode.l10n.t("Delete this row"),
    removePatternAriaLabel: vscode.l10n.t("Delete this pattern"),
    maskEnabledLabel: vscode.l10n.t("🔒 Mask"),
    maskDisabledLabel: vscode.l10n.t("🔓 Mask"),
    highlightExpandedLabel: vscode.l10n.t("Highlight ▴"),
    highlightCollapsedLabel: vscode.l10n.t("Highlight ▾"),
    highlightColorAriaLabel: vscode.l10n.t("Color"),
    highlightColorRed: vscode.l10n.t("Red"),
    highlightColorOrange: vscode.l10n.t("Orange"),
    highlightColorYellow: vscode.l10n.t("Yellow"),
    highlightColorGreen: vscode.l10n.t("Green"),
    highlightColorBlue: vscode.l10n.t("Blue"),
    highlightColorPurple: vscode.l10n.t("Purple"),
    moveRuleUpTitle: vscode.l10n.t("Increase priority"),
    moveRuleDownTitle: vscode.l10n.t("Decrease priority"),
    moveRuleUpAriaLabel: vscode.l10n.t("Increase the priority of this rule"),
    moveRuleDownAriaLabel: vscode.l10n.t("Decrease the priority of this rule"),
    removeRuleTitle: vscode.l10n.t("Delete this rule"),
    removeRuleAriaLabel: vscode.l10n.t("Delete this highlight rule"),
    ruleNamePlaceholder: vscode.l10n.t("Name (optional)"),
    ruleNameAriaLabel: vscode.l10n.t("Rule name (optional)"),
    highlightPatternAriaLabel: vscode.l10n.t("Pattern to highlight (regular expression)"),
    hideFileWithPathTitle: vscode.l10n.t("{0} (uncheck to hide lines from this file)"),
    hideFileTitle: vscode.l10n.t("Uncheck to hide lines from this file"),
    cannotRemoveLastFileLabel: vscode.l10n.t(
      "The last file cannot be removed (uncheck it to hide it temporarily)"
    ),
    removeFileLabel: vscode.l10n.t("Remove {0} from the loaded files"),
    sourceFilesTitle: vscode.l10n.t("Source files:\n{0}"),
    displayLimitMessage: vscode.l10n.t(
      "The display limit of {0} lines was exceeded, so only the first {1} lines are shown. Filter the results to view all matching lines, or use Export as Virtual Document to open the complete result."
    ),
    statusMessage: vscode.l10n.t("Showing {0} / {1} lines"),
    timestampFormatNameAriaLabel: vscode.l10n.t("Timestamp format name (optional)"),
    timestampFormatPatternAriaLabel: vscode.l10n.t("Pattern to recognize (regular expression)"),
    removeTimestampFormatTitle: vscode.l10n.t("Delete this timestamp format"),
    removeTimestampFormatAriaLabel: vscode.l10n.t("Delete this timestamp format"),
    noSelectionMessage: vscode.l10n.t("Select part of a line first."),
    matchSummaryMessage: vscode.l10n.t("{0} / {1} unrecognized lines matched"),
    savedToWorkspaceLabel: vscode.l10n.t("Saved to workspace settings"),
    savedToUserLabel: vscode.l10n.t("Saved to user settings"),
    unrecognizedLinesEmptyMessage: vscode.l10n.t("No unrecognized lines to select from."),
  };
}
