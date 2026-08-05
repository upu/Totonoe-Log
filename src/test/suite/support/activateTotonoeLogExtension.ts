import * as assert from "node:assert";
import * as vscode from "vscode";

/** テスト対象の拡張機能を取得・有効化し、未検出なら明確に失敗させる。 */
export async function activateTotonoeLogExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension("upu.totonoe-log");
  assert.ok(extension, "extension should be discoverable by id");
  await extension.activate();
  return extension;
}
