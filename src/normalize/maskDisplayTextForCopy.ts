import { parseLog, type ParseLogOptions } from "./parseLog";
import { maskLogTextForCopy, type MaskForCopyOptions } from "./maskForCompare";

/**
 * 整形済み表示テキスト1行の行頭プレフィックス（マージ表示のファイル名/種別欄、
 * ガター欄、折りたたみ矢印）を切り出す正規表現。
 *
 * {@link maskLogTextForCopy} はタイムスタンプを行頭でしか認識しない
 * （{@link parseLog} が `index === 0` のマッチだけを採用する）ため、表示
 * テキストをそのまま渡すとガター欄に阻まれてタイムスタンプがマスクされない。
 * プレフィックスを一旦切り離してから本文だけを解析する。
 *
 * ファイル名/種別欄の繰り返しを遅延（`{0,2}?`）にしているのは、本文に ` | `
 * を含む単一ファイル表示の行（`1 | ... a | b`）でプレフィックスを本文側まで
 * 食い込ませないため——0欄から順に試すことで、ガター欄だけを持つ行は常に
 * 最短のプレフィックスで確定する。
 */
const DISPLAY_LINE_PREFIX_REGEX =
  /^(?:[▶▼] )?(?:[^|\r\n]*\| ){0,2}? *(?:\d+(?:-\d+)?|\.\.\.) \| /;

/** {@link maskDisplayTextForCopy} のオプション。マスク対象の切り替えと、本文の解析条件をそのまま受け取る。 */
export interface MaskDisplayTextForCopyOptions extends MaskForCopyOptions, ParseLogOptions {}

/**
 * Interactive View（Webview）が表示している整形済みテキストを、
 * {@link maskLogTextForCopy} と同じ規則でマスクする（issue #180）。
 *
 * 生ログではなく「画面に見えているテキスト」を対象にするため、行頭の
 * プレフィックス（{@link DISPLAY_LINE_PREFIX_REGEX}）は本文の解析対象から
 * 外し、マスク後にそのまま復元する——ガター欄の行番号は元ログを追う手がかり
 * として貼り付け先でも役に立つので、マスクの都合で崩さない。
 *
 * 選択範囲の一部だけを渡してもよい（継続行やギャップ区切り行から始まる断片は
 * タイムスタンプ未認識のエントリとして扱われ、IPアドレスのマスクだけが働く）。
 *
 * なお表示テキストのタイムスタンプは既に ISO 形式へ正規化済みのため、syslog
 * のホスト名トークン（生ログのみで位置が確定する）はマスク対象にならない。
 * IPv4/IPv6 アドレスは本文中のどこにあってもマスクされる。
 */
export function maskDisplayTextForCopy(
  displayText: string,
  options: MaskDisplayTextForCopyOptions = {}
): string {
  const prefixes: string[] = [];
  const bodies: string[] = [];
  for (const line of displayText.split(/\r\n|\r|\n/)) {
    const prefix = DISPLAY_LINE_PREFIX_REGEX.exec(line)?.[0] ?? "";
    prefixes.push(prefix);
    bodies.push(line.slice(prefix.length));
  }

  const entries = parseLog(bodies.join("\n"), options);
  // `maskLogTextForCopy` は入力の物理行と1対1で行を返すため、行番号で
  // プレフィックスと突き合わせられる。
  const maskedBodies = maskLogTextForCopy(entries, options).split("\n");
  return prefixes.map((prefix, index) => prefix + (maskedBodies[index] ?? "")).join("\n");
}
