/**
 * タイムゾーン正規化（issue #13）の純粋ロジック。
 *
 * - 入力側: タイムゾーン表記を持たないタイムスタンプに適用する「ソース
 *   オフセット」の解析と、ファイル名パターンごとのオフセット規則の
 *   コンパイル・解決。
 * - 表示側: エポックミリ秒を指定タイムゾーンの壁時計表記へ整形する。
 *
 * IANA タイムゾーン名（例: `Asia/Tokyo`）は扱わない。過去ログの DST 境界を
 * 正確に再現するには `Intl` ベースの逆算が必要でコストが高く、固定オフセット
 * ＋ホストローカルで主要ユースケース（サーバ間の TZ ずれの補正）を賄えるため。
 */

import { describeThrownError, type SettingsValidationError } from "./settingsErrors";

/**
 * 表示用タイムゾーンの指定。UTC からのオフセット（分）、または `"local"`
 * （ホストマシンのローカルタイムゾーン。DST を考慮してタイムスタンプごとに
 * オフセットを解決する）。
 */
export type DisplayTimezone = number | "local";

/** UTC オフセットとして許容する上限（分）。実在するオフセットは ±14:00 以内。 */
const MAX_OFFSET_MINUTES = 14 * 60;

/**
 * UTC オフセット表記を分単位のオフセットへ解析する。
 *
 * `+09:00` / `-05:30` の他、コロンなし（`+0900`）・時のみ（`+09`）、および
 * `Z` / `UTC`（大文字小文字を区別しない）を受け付ける。実在しない範囲
 * （±14:00 超、分が 60 以上）や形式外の文字列は `undefined` を返し、
 * 呼び出し側にフォールバック（UTC 扱い＋警告など）を委ねる。
 */
export function parseUtcOffsetMinutes(value: string): number | undefined {
  const trimmed = value.trim();
  if (/^(?:Z|UTC)$/i.test(trimmed)) {
    return 0;
  }

  const match = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (minutes > 59) {
    return undefined;
  }

  const offsetMinutes = sign * (hours * 60 + minutes);
  if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) {
    return undefined;
  }
  return offsetMinutes;
}

/** オフセット（分）を `+09:00` / `-05:30` 形式のサフィックスへ整形する。 */
function formatOffsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

/**
 * エポックミリ秒を、指定した表示タイムゾーンの壁時計表記（ISO 8601）へ
 * 整形する。オフセット 0（UTC）は従来どおり `Z` サフィックスで表示し、
 * 既定の表示を変えない。それ以外は壁時計をずらしたうえで `+09:00` 等の
 * オフセットサフィックスを付け、表示時刻がどのタイムゾーンかを常に明示する。
 *
 * `"local"` はタイムスタンプごとにホストのオフセットを解決する。年間で
 * オフセットが変わる地域（DST）でも、各エントリがその時点のローカル時刻で
 * 表示されるようにするため。
 */
export function formatTimestampForDisplay(
  epochMs: number,
  displayTimezone: DisplayTimezone
): string {
  const offsetMinutes =
    displayTimezone === "local"
      ? -new Date(epochMs).getTimezoneOffset()
      : displayTimezone;
  if (offsetMinutes === 0) {
    return new Date(epochMs).toISOString();
  }
  // 壁時計をオフセット分ずらした Date を UTC 表記させ、`Z` をオフセット
  // サフィックスに置き換える（`Date` は単一インスタントしか表せないため、
  // 「別タイムゾーンの壁時計」はこのずらし方で得るのが最も単純）。
  const shifted = new Date(epochMs + offsetMinutes * 60 * 1000);
  return shifted.toISOString().replace("Z", formatOffsetSuffix(offsetMinutes));
}

/**
 * `totonoeLog.timezone.fileOffsets` 設定の1項目に期待する形。設定値は
 * ユーザーが自由に書ける JSON のため、実際の入力は
 * {@link compileFileOffsetRules} が `unknown` として受け取り検証する。
 */
export interface FileOffsetRuleSetting {
  /** ファイル名（パスを除いたベース名）にマッチさせる正規表現パターン。 */
  readonly filePattern: string;
  /** 適用する UTC オフセット（{@link parseUtcOffsetMinutes} が受け付ける表記）。 */
  readonly offset: string;
}

/** コンパイル済みの、ファイル名パターン→ソースオフセットの規則1件。 */
export interface FileOffsetRule {
  readonly regex: RegExp;
  readonly offsetMinutes: number;
}

/**
 * {@link compileFileOffsetRules} の結果。不正な項目があっても全体を失敗には
 * せず、有効な規則と項目ごとのエラーを分けて返す（`compileCustomTimestampFormats`
 * と同じ方針。設定の1項目のタイポで他の規則まで無効になるのを防ぐ）。
 */
export interface CompileFileOffsetRulesResult {
  readonly rules: FileOffsetRule[];
  /** 無効だった項目ごとのエラー（文言は呼び出し側が組み立てる。issue #279）。 */
  readonly errors: SettingsValidationError[];
}

/**
 * `totonoeLog.timezone.fileOffsets` 設定（JSON 配列）を検証し、
 * {@link resolveFileOffsetMinutes} に渡せる規則の配列へコンパイルする。
 */
export function compileFileOffsetRules(
  settings: readonly unknown[]
): CompileFileOffsetRulesResult {
  const rules: FileOffsetRule[] = [];
  const errors: SettingsValidationError[] = [];

  settings.forEach((setting, index) => {
    if (typeof setting !== "object" || setting === null) {
      errors.push({ code: "notAnObject", index });
      return;
    }

    const { filePattern, offset } = setting as Partial<FileOffsetRuleSetting>;

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

    const offsetMinutes = typeof offset === "string" ? parseUtcOffsetMinutes(offset) : undefined;
    if (offsetMinutes === undefined) {
      errors.push({ code: "invalidUtcOffset", index });
      return;
    }

    rules.push({ regex, offsetMinutes });
  });

  return { rules, errors };
}

/**
 * ファイル名に最初にマッチした規則のオフセット（分）を返す。どの規則にも
 * マッチしない場合は `undefined`（呼び出し側が全体既定のソースオフセットへ
 * フォールバックする）。「先勝ち」なのは、設定を上から順に読める素直な
 * 規則にするため。
 */
export function resolveFileOffsetMinutes(
  fileName: string,
  rules: readonly FileOffsetRule[]
): number | undefined {
  for (const rule of rules) {
    // g / y フラグは付けずにコンパイルしているため lastIndex の状態は持たないが、
    // 念のため毎回先頭から評価する。
    rule.regex.lastIndex = 0;
    if (rule.regex.test(fileName)) {
      return rule.offsetMinutes;
    }
  }
  return undefined;
}
