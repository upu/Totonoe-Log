import { describeThrownError, type SettingsValidationError } from "./settingsErrors";
import type { LogEntry } from "./types";

/**
 * 時刻オフセット補正（クロックスキュー補正、issue #15）の純粋ロジック。
 *
 * タイムゾーン正規化（issue #13、`timezone.ts`）が「タイムゾーン表記を
 * 持たないタイムスタンプの解釈」を補うのに対し、こちらは「時計そのものが
 * ずれているホスト」のログを補正する。したがって明示的なオフセットや `Z`
 * を持つタイムスタンプ・エポック形式にも一律に適用する——時計自体が
 * ずれている以上、ログに書かれた時刻表記も同じだけずれているため。
 *
 * 補正はパース後の `timestampMs` にのみ適用し、`raw` / `rawTimestamp` の
 * 元テキストは決して書き換えない（情報を失わない方針）。
 */

/**
 * `totonoeLog.clockSkew.fileOffsets` 設定の1項目に期待する形。設定値は
 * ユーザーが自由に書ける JSON のため、実際の入力は
 * {@link compileClockSkewRules} が `unknown` として受け取り検証する。
 */
export interface ClockSkewRuleSetting {
  /** ファイル名（パスを除いたベース名）にマッチさせる正規表現パターン。 */
  readonly filePattern: string;
  /**
   * 適用する補正量（秒）。ホストの時計が進んでいる場合は負の値で戻す。
   * 小数も許容する（ミリ秒精度に丸める）。
   */
  readonly offsetSeconds: number;
}

/** コンパイル済みの、ファイル名パターン→クロックスキュー補正の規則1件。 */
export interface ClockSkewRule {
  readonly regex: RegExp;
  readonly offsetMs: number;
}

/**
 * {@link compileClockSkewRules} の結果。不正な項目があっても全体を失敗には
 * せず、有効な規則と項目ごとのエラーを分けて返す（`compileFileOffsetRules`
 * と同じ方針。設定の1項目のタイポで他の規則まで無効になるのを防ぐ）。
 */
export interface CompileClockSkewRulesResult {
  readonly rules: ClockSkewRule[];
  /** 無効だった項目ごとのエラー（文言は呼び出し側が組み立てる。issue #279）。 */
  readonly errors: SettingsValidationError[];
}

/**
 * `totonoeLog.clockSkew.fileOffsets` 設定（JSON 配列）を検証し、
 * {@link resolveClockSkewMs} に渡せる規則の配列へコンパイルする。
 */
export function compileClockSkewRules(
  settings: readonly unknown[]
): CompileClockSkewRulesResult {
  const rules: ClockSkewRule[] = [];
  const errors: SettingsValidationError[] = [];

  settings.forEach((setting, index) => {
    if (typeof setting !== "object" || setting === null) {
      errors.push({ code: "notAnObject", index });
      return;
    }

    const { filePattern, offsetSeconds } = setting as Partial<ClockSkewRuleSetting>;

    if (typeof filePattern !== "string" || filePattern === "") {
      errors.push({ code: "missingStringProperty", index, property: "filePattern" });
      return;
    }

    let regex: RegExp;
    try {
      regex = new RegExp(filePattern);
    } catch (error) {
      errors.push({
        code: "invalidRegexProperty",
        index,
        property: "filePattern",
        reason: describeThrownError(error),
      });
      return;
    }

    if (typeof offsetSeconds !== "number" || !Number.isFinite(offsetSeconds)) {
      errors.push({ code: "invalidOffsetSeconds", index });
      return;
    }

    rules.push({ regex, offsetMs: Math.round(offsetSeconds * 1000) });
  });

  return { rules, errors };
}

/**
 * ファイル名に最初にマッチした規則の補正量（ミリ秒）を返す。どの規則にも
 * マッチしない場合は `undefined`（補正なし）。「先勝ち」なのは
 * `resolveFileOffsetMinutes` と同じで、設定を上から順に読める素直な規則に
 * するため。
 */
export function resolveClockSkewMs(
  fileName: string,
  rules: readonly ClockSkewRule[]
): number | undefined {
  for (const rule of rules) {
    // g / y フラグは付けずにコンパイルしているため lastIndex の状態は持たないが、
    // 念のため毎回先頭から評価する。
    rule.regex.lastIndex = 0;
    if (rule.regex.test(fileName)) {
      return rule.offsetMs;
    }
  }
  return undefined;
}

/**
 * 認識済みタイムスタンプ（`timestampMs`）へ一律に補正量（ミリ秒）を加えた
 * エントリ配列を返す。入力は変更しない。タイムスタンプ未認識のエントリは
 * 補正対象が無いためそのまま返す。
 */
export function applyClockSkew(entries: readonly LogEntry[], skewMs: number): LogEntry[] {
  if (skewMs === 0) {
    return [...entries];
  }
  return entries.map((entry) =>
    entry.timestampMs === undefined ? entry : { ...entry, timestampMs: entry.timestampMs + skewMs }
  );
}
