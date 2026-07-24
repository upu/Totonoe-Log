/**
 * Webviewのグローバルスコープに拡張機能ホストが注入する関数。
 * `@types/vscode` はNode/拡張機能本体側のAPIのみを型付けしており、
 * このWebview専用グローバルは含まれないため個別に宣言する。
 */
declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: T): void;
};
