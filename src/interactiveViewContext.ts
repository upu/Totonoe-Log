import type { LineSource } from "./normalize";

/** 1始まりの行番号・0始まりのファイル位置として成立する値か。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * `webview/context` メニューのコマンドに渡されるコンテキストから、行対応情報
 * を取り出す（issue #191）。Webview から届く値は非信頼な外部データとして
 * 扱い、URI の解決やドキュメントの読み込みに使う前にここで形と範囲を検証する
 * （壊れていれば `undefined` を返し、呼び出し側は何もしない）。
 */
export function parseWebviewLineSource(context: unknown): LineSource | undefined {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }

  const { lineSource } = context as { lineSource?: unknown };
  if (typeof lineSource !== "object" || lineSource === null) {
    return undefined;
  }

  const { fileIndex, line } = lineSource as { fileIndex?: unknown; line?: unknown };
  if (!isNonNegativeInteger(fileIndex) || !isNonNegativeInteger(line) || line < 1) {
    return undefined;
  }
  return { fileIndex, line };
}
