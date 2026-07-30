/**
 * 設定変更を Interactive View にどう反映すべきかの区分（issue #183）。
 *
 * - `"reparse"` — パース結果そのものが変わるため、再パース（`recomputeEntries`）から必要
 * - `"redisplay"` — 整形・描画にだけ効くため、現在のエントリを送り直すだけで足りる
 * - `"none"` — Interactive View が読まない設定
 */
export type InteractiveViewConfigChangeEffect = "reparse" | "redisplay" | "none";

/**
 * 再パースまで必要な設定。ソースオフセットとクロックスキューは、読み込み時に
 * 解決した値が `LogFileInput` へ焼き付いているため、再パースの前に
 * `reresolveLogFileOffsets` で解決し直す必要もある。
 */
const REPARSE_SECTIONS: readonly string[] = [
  "totonoeLog.timestampFormats",
  "totonoeLog.timezone.sourceOffset",
  "totonoeLog.timezone.fileOffsets",
  "totonoeLog.clockSkew.fileOffsets",
];

/** 送り直すだけで足りる設定（いずれも `postState` の中で毎回読み直している）。 */
const REDISPLAY_SECTIONS: readonly string[] = [
  "totonoeLog.timezone.display",
  "totonoeLog.gap.thresholdSeconds",
  "totonoeLog.collapse.threshold",
  "totonoeLog.interactiveView.maxDisplayLines",
  "totonoeLog.highlightRules",
];

/**
 * 設定変更イベントから、Interactive View が取るべき反映の仕方を決める。
 *
 * `vscode.ConfigurationChangeEvent` そのものではなく `affectsConfiguration`
 * 相当の述語を受け取るのは、この判定を VSCode API から切り離してテストできる
 * ようにするため。
 *
 * `totonoeLog.copyMasked.*`（マスク対象の初期選択、issue #194）はここに
 * 含めない——パネル上のマスク対象はユーザーがその場で切り替える表示状態で、
 * 設定はその初期値としてしか効かないため、開いているパネルの選択を設定変更で
 * 上書きするのは操作の取り消しになってしまう。
 */
export function classifyInteractiveViewConfigChange(
  affectsConfiguration: (section: string) => boolean
): InteractiveViewConfigChangeEffect {
  if (REPARSE_SECTIONS.some((section) => affectsConfiguration(section))) {
    return "reparse";
  }
  if (REDISPLAY_SECTIONS.some((section) => affectsConfiguration(section))) {
    return "redisplay";
  }
  return "none";
}
