import * as vscode from "vscode";
import { createSourceOffsetResolver } from "./timezoneSettings";
import { createClockSkewResolver } from "./clockSkewSettings";
import type { LogFileInput } from "./normalize";

/**
 * VS Code の `files.encoding` が使う識別子と、WHATWG `TextDecoder` の
 * ラベルが異なるものを対応付ける。TextDecoder が対応しないコードページは
 * あえて含めず、黙って文字化けさせずに警告＋UTF-8フォールバックへ回す。
 */
const FILE_ENCODING_DECODER_LABELS: Readonly<Partial<Record<string, string>>> = {
  utf8: "utf-8",
  utf8bom: "utf-8",
  utf16le: "utf-16le",
  utf16be: "utf-16be",
  windows1252: "windows-1252",
  iso88591: "iso-8859-1",
  iso88593: "iso-8859-3",
  iso885915: "iso-8859-15",
  macroman: "macintosh",
  windows1256: "windows-1256",
  iso88596: "iso-8859-6",
  windows1257: "windows-1257",
  iso88594: "iso-8859-4",
  iso885914: "iso-8859-14",
  windows1250: "windows-1250",
  iso88592: "iso-8859-2",
  windows1251: "windows-1251",
  cp866: "ibm866",
  iso88595: "iso-8859-5",
  koi8r: "koi8-r",
  koi8u: "koi8-u",
  iso885913: "iso-8859-13",
  windows1253: "windows-1253",
  iso88597: "iso-8859-7",
  windows1255: "windows-1255",
  iso88598: "iso-8859-8",
  windows1254: "windows-1254",
  iso88599: "iso-8859-9",
  windows1258: "windows-1258",
  gbk: "gbk",
  gb18030: "gb18030",
  cp950: "big5",
  big5hkscs: "big5",
  shiftjis: "shift_jis",
  eucjp: "euc-jp",
  iso2022jp: "iso-2022-jp",
  euckr: "euc-kr",
  windows874: "windows-874",
  iso885910: "iso-8859-10",
  iso885916: "iso-8859-16",
};

/**
 * URIスコープの `files.encoding` でログをデコードする。VS Code が認識しても
 * TextDecoder が扱えないコードページや、不正な手動設定では、ファイル名と
 * 設定値を警告してUTF-8へ明示的にフォールバックする。
 */
function decodeLogFile(bytes: Uint8Array, fileUri: vscode.Uri): string {
  const configuredEncoding = vscode.workspace
    .getConfiguration("files", fileUri)
    .get<string>("encoding", "utf8");
  const decoderLabel = FILE_ENCODING_DECODER_LABELS[configuredEncoding.toLowerCase()];

  if (decoderLabel !== undefined) {
    try {
      return new TextDecoder(decoderLabel).decode(bytes);
    } catch {
      // 実行環境のICU構成によって特定ラベルを扱えない場合も、下の共通警告へ進む。
    }
  }

  const fileName = fileUri.path.split("/").pop() ?? fileUri.toString();
  vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Totonoe Log: files.encoding "{1}" for {0} is not supported when merging, so the file will be read as UTF-8.',
      fileName,
      configuredEncoding
    )
  );
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * 選択されたファイル群を読み込み、{@link mergeLogFiles} に渡す入力へ変換する。
 * ファイルごとのソースオフセット（`totonoeLog.timezone.fileOffsets`、issue #13）
 * とクロックスキュー補正（`totonoeLog.clockSkew.fileOffsets`、issue #15）も
 * ここで解決して添付する。
 *
 * `vscode.workspace.openTextDocument` はエディタのドキュメント管理を経由する
 * ため、VSCodeが拡張機能へ同期しない大容量ファイル（目安約50MB超）で
 * 「Files above 50MB cannot be synchronized with extensions.」というエラーに
 * なる（issue #98）。マージ対象になりやすい本番ログはこのサイズ帯に達し
 * やすいため、`vscode.workspace.fs.readFile` でバイト列として直接読み、
 * URIスコープの `files.encoding` に対応する `TextDecoder` で文字列化する
 * 方式に切り替えてこの制限を回避する。副次効果として、マージのためだけに
 * 全対象ファイルがエディタ管理下に開かれるコストも消える。
 */
export async function readLogFiles(fileUris: readonly vscode.Uri[]): Promise<LogFileInput[]> {
  const resolveSourceOffsetMinutes = createSourceOffsetResolver();
  const resolveClockSkewMs = createClockSkewResolver();
  return Promise.all(
    fileUris.map(async (fileUri) => {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const fileName = fileUri.path.split("/").pop() ?? "log";
      return {
        fileName,
        text: decodeLogFile(bytes, fileUri),
        sourceUtcOffsetMinutes: resolveSourceOffsetMinutes(fileName),
        clockSkewMs: resolveClockSkewMs(fileName),
      };
    })
  );
}

/**
 * 読み込み済みのログファイル1件。{@link LogFileInput} は整形パイプラインへの
 * 入力、`uri` は行ジャンプ（issue #179）・書き出し（issue #175）で元ファイルを
 * 解決するために保持する。`LineSource.fileIndex` は、この型の配列のインデックス
 * を指す。
 */
export interface LoadedLogFile {
  readonly uri: vscode.Uri;
  readonly input: LogFileInput;
}

/**
 * 読み込み済みファイルのソースオフセット（`totonoeLog.timezone.*`）と
 * クロックスキュー補正（`totonoeLog.clockSkew.fileOffsets`）を、現在の設定で
 * 解決し直す（issue #183）。これらは読み込み時に解決した値が
 * {@link LogFileInput} へ焼き付いているため、開いたままのパネルで再パースする
 * だけでは設定変更が反映されない。
 *
 * ファイル本文は読み直さない——エディタの内容から組み立てた入力（コマンド
 * パレット経由、{@link buildLogFileInputFromDocument}）はディスク上の内容と
 * 一致するとは限らず、設定変更をきっかけに未保存の変更が消えてしまうため。
 */
export function reresolveLogFileOffsets(
  files: readonly LoadedLogFile[]
): LoadedLogFile[] {
  const resolveSourceOffsetMinutes = createSourceOffsetResolver();
  const resolveClockSkewMs = createClockSkewResolver();
  return files.map((file) => ({
    uri: file.uri,
    input: {
      ...file.input,
      sourceUtcOffsetMinutes: resolveSourceOffsetMinutes(file.input.fileName),
      clockSkewMs: resolveClockSkewMs(file.input.fileName),
    },
  }));
}

/**
 * {@link readLogFiles} の結果を、読み込み元の URI と対にして返す。URI と入力を
 * 別々の配列で持ち回ると並びがずれたときに気付けないため、対にして扱う
 * （issue #181）。
 */
export async function loadLogFiles(
  fileUris: readonly vscode.Uri[]
): Promise<LoadedLogFile[]> {
  const inputs = await readLogFiles(fileUris);
  return inputs.map((input, index) => ({ uri: fileUris[index], input }));
}

/**
 * エクスプローラのコンテキストメニューコマンドが受け取る `(クリックされた項目,
 * 選択項目全体の配列)` から、フォルダを除いた対象ファイルの URI 一覧を解決する
 * （issue #151、#181）。`selectedUris` を優先し、単一クリック時のフォールバック
 * として `clickedUri` を使う。
 *
 * コマンドパレットから実行された場合はどちらも `undefined` で渡ってくるため
 * 空配列を返す——呼び出し側はそれを「エクスプローラ経由ではない」の判定に使う。
 * 必要な選択数（マージは2つ以上、Interactive View は1つ以上）は用途ごとに
 * 違うため、ここでは件数を検査しない。
 */
export async function resolveExplorerSelectionUris(
  clickedUri: vscode.Uri | undefined,
  selectedUris: readonly vscode.Uri[] | undefined
): Promise<vscode.Uri[]> {
  const candidateUris =
    selectedUris && selectedUris.length > 0 ? selectedUris : clickedUri ? [clickedUri] : [];
  if (candidateUris.length === 0) {
    return [];
  }
  return filterOutFolders(candidateUris);
}

/** フォルダを除いたファイルの URI だけを残す。 */
export async function filterOutFolders(uris: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (const uri of uris) {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) === 0) {
      files.push(uri);
    }
  }
  return files;
}
