import {
  maskHostAddresses,
  maskProcessIds,
  maskSyslogTagProcessId,
  HOST_PLACEHOLDER,
  TIMESTAMP_PLACEHOLDER,
} from "./maskForCompare";
import { formatTimestampForDisplay, type DisplayTimezone } from "./timezone";

/**
 * 整形済み表示テキストに対するマスク設定（issue #194）。Interactive View の
 * マスクトグルの状態がそのまま渡ってくる。
 *
 * {@link MaskForCopyOptions} と同じ対象を持つが、**省略時の既定が逆**（あちらは
 * マスクする、こちらはしない）。マスクは Interactive View のトグルでONに
 * したときだけ効く表示状態であり、オプションを渡さない既存の呼び出し
 * （正規化ビュー・マージビュー・折りたたみビューの各コマンド）の出力を
 * 変えてはいけないため。
 */
export interface DisplayMaskOptions {
  /** タイムスタンプを {@link TIMESTAMP_PLACEHOLDER} に置き換えるか。省略時はマスクしない。 */
  readonly maskTimestamp?: boolean;
  /** IPv4/IPv6アドレス・syslogホスト名を {@link HOST_PLACEHOLDER} に置き換えるか。省略時はマスクしない。 */
  readonly maskHost?: boolean;
  /** プロセスIDを {@link PROCESS_ID_PLACEHOLDER} に置き換えるか（issue #195）。省略時はマスクしない。 */
  readonly maskProcessId?: boolean;
}

/**
 * 見出し行のタイムスタンプ表記を返す。マスクONなら実際の時刻の代わりに
 * プレースホルダーを返す。
 *
 * スパン表示（折りたたみグループの `開始 〜 終了`）の判定は呼び出し側が
 * `timestampMs` で行うため、マスクしても「範囲であること」は表示に残る。
 */
export function formatMaskableTimestamp(
  epochMs: number,
  displayTimezone: DisplayTimezone,
  mask: DisplayMaskOptions | undefined
): string {
  return mask?.maskTimestamp === true
    ? TIMESTAMP_PLACEHOLDER
    : formatTimestampForDisplay(epochMs, displayTimezone);
}

/**
 * メッセージ本文を書き換えるマスクが1つでも有効か。タイムスタンプのマスクは
 * 本文に現れない（{@link formatMaskableTimestamp} が別に受け持つ）ため数えない。
 *
 * 「本文が変わらないなら分割・結合ごと省く」判断を呼び出し側でも使えるよう、
 * 対象の知識をこのモジュールに集約しておく（折りたたみの一致判定は全エントリに
 * 対して再描画のたびに走るため、既定のマスクOFFで余計な割り当てを増やさない）。
 */
export function masksMessageText(mask: DisplayMaskOptions | undefined): boolean {
  return mask?.maskHost === true || mask?.maskProcessId === true;
}

/**
 * エントリのメッセージ行（見出し行の本文＋継続行）に、ホスト系・プロセスIDの
 * マスクを掛ける。
 *
 * 整形の段階でマスクするため、`timestampFormat` が分かる——syslog（RFC3164）は
 * タイムスタンプの直後が必ずホスト名で、その次がタグ `name[pid]:` なので、その
 * 位置のトークンだけを狙ってマスクできる（{@link maskLogTextForCopy} と同じ
 * 位置指定マスク）。他の形式ではスタックトレースのクラス名を誤ってホスト名と
 * みなさないよう、この位置指定マスクは行わない。
 */
export function maskDisplayMessageLines(
  messageLines: readonly string[],
  timestampFormat: string | undefined,
  mask: DisplayMaskOptions | undefined
): string[] {
  if (!masksMessageText(mask)) {
    return [...messageLines];
  }
  const maskHost = mask?.maskHost === true;
  const maskProcessId = mask?.maskProcessId === true;

  const masked = messageLines.map((line) => {
    const withHostMasked = maskHost ? maskHostAddresses(line) : line;
    return maskProcessId ? maskProcessIds(withHostMasked) : withHostMasked;
  });
  if (timestampFormat === "syslog" && masked.length > 0) {
    // `parseLog` はタイムスタンプ直後の区切り文字を落としてから `message` に
    // するため、ホスト名トークンは常に先頭にある。
    if (maskHost) {
      masked[0] = masked[0].replace(/^\S+/, HOST_PLACEHOLDER);
    }
    if (maskProcessId) {
      masked[0] = maskSyslogTagProcessId(masked[0]);
    }
  }
  return masked;
}
