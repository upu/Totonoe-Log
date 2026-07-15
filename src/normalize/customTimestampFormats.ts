import { isoLikeGroupsToEpochMs } from "./timestampFormats";
import type { TimestampFormat } from "./types";

/**
 * `totonoeLog.timestampFormats` 設定の1項目に期待する形。設定値はユーザーが
 * 自由に書ける JSON のため、実際の入力は {@link compileCustomTimestampFormats}
 * が `unknown` として受け取り検証する。
 */
export interface CustomTimestampFormatSetting {
  /** `LogEntry.timestampFormat` に入る表示名。省略時は `custom-<番号>`。 */
  readonly name?: string;
  /**
   * タイムスタンプにマッチする正規表現パターン。名前付きキャプチャグループで
   * パース方法を指定する（カレンダー形式: `y` `mo` `d` `h` `mi` `s` と任意の
   * `ms` `tzz` `tzs` `tzh` `tzm` / エポック形式: `epochMs` または `epochSec`＋任意の `ms`）。
   * `tzz` は `Z`（UTC の明示）を捕捉するグループで、これか `tzs` が捕捉されて
   * いる場合はソースオフセット（#13）のフォールバックを適用しない。
   */
  readonly pattern: string;
}

/**
 * {@link compileCustomTimestampFormats} の結果。不正な項目があっても全体を
 * 失敗にはせず、有効な項目のフォーマットと項目ごとのエラーを分けて返す
 * （設定の1項目のタイポで既存のカスタム形式まで全部無効になるのを防ぐ）。
 */
export interface CompileCustomTimestampFormatsResult {
  readonly formats: TimestampFormat[];
  /** 無効だった項目ごとの、ユーザー向けエラーメッセージ。 */
  readonly errors: string[];
}

/** カレンダー形式のパースに最低限必要な名前付きキャプチャグループ。 */
const REQUIRED_CALENDAR_GROUPS = ["y", "mo", "d", "h", "mi", "s"] as const;

/**
 * 正規表現に含まれる名前付きキャプチャグループの一覧を返す。
 * 空文字列に必ずマッチする `|` を末尾に足した正規表現を空文字列に適用すると、
 * `groups` オブジェクトに全グループがキーとして現れることを利用する
 * （パターン文字列の字面を走査するより、コメントやエスケープの影響を
 * 受けない確実な方法）。
 */
function getNamedGroups(source: string): string[] {
  const probe = new RegExp(`(?:${source})|`).exec("");
  return Object.keys(probe?.groups ?? {});
}

/**
 * 検証済みのグループ名一覧から、この形式のパース方法を決めてマッチ結果を
 * エポックミリ秒へ変換する parse 関数を作る。
 */
function createParseFunction(groupNames: readonly string[]): TimestampFormat["parse"] {
  const hasEpochMs = groupNames.includes("epochMs");
  const hasEpochSec = groupNames.includes("epochSec");
  return (match, context) => {
    const groups = match.groups ?? {};
    if (hasEpochMs && groups.epochMs) {
      const epochMs = Number(groups.epochMs);
      return Number.isFinite(epochMs) ? epochMs : undefined;
    }
    if (hasEpochSec && groups.epochSec) {
      const epochSec = Number(groups.epochSec);
      if (!Number.isFinite(epochSec)) {
        return undefined;
      }
      // 小数ミリ秒の桁埋め・切り捨て規則は組み込み形式（isoLikeGroupsToEpochMs）
      // と揃える。
      const ms = groups.ms ? Number(groups.ms.padEnd(3, "0").slice(0, 3)) : 0;
      return epochSec * 1000 + ms;
    }
    // カレンダー形式は組み込み形式と同じ規則でソースオフセット（#13）の
    // フォールバック対象になる（tzs / tzz グループを捕捉していれば書かれて
    // いる情報が優先される）。エポック形式は絶対時刻のため対象外。
    return isoLikeGroupsToEpochMs(groups, context?.fallbackUtcOffsetMinutes);
  };
}

/**
 * `totonoeLog.timestampFormats` 設定（JSON 配列）を検証し、`parseLog` に渡せる
 * {@link TimestampFormat} の配列へコンパイルする。
 *
 * パターンは行頭にアンカーして使う（`^(?:...)` で包む）。`parseLog` が行頭
 * マッチしか受け付けないため、アンカーなしのパターンをそのまま使うと
 * 「書いたのに一度もマッチしない」という分かりにくい挙動になる。それを
 * 設定側の書き忘れに関わらず防ぐ。
 */
export function compileCustomTimestampFormats(
  settings: readonly unknown[]
): CompileCustomTimestampFormatsResult {
  const formats: TimestampFormat[] = [];
  const errors: string[] = [];

  settings.forEach((setting, index) => {
    if (typeof setting !== "object" || setting === null) {
      errors.push(`${index + 1}番目の項目: オブジェクトではありません`);
      return;
    }

    const { name: rawName, pattern } = setting as Partial<CustomTimestampFormatSetting>;
    const name = typeof rawName === "string" && rawName !== "" ? rawName : `custom-${index + 1}`;

    if (typeof pattern !== "string" || pattern === "") {
      errors.push(`${name}: pattern（文字列）が指定されていません`);
      return;
    }

    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${pattern})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: 正規表現として不正です（${reason}）`);
      return;
    }

    const groupNames = getNamedGroups(pattern);
    const hasEpochGroup = groupNames.includes("epochMs") || groupNames.includes("epochSec");
    const hasCalendarGroups = REQUIRED_CALENDAR_GROUPS.every((group) =>
      groupNames.includes(group)
    );
    if (!hasEpochGroup && !hasCalendarGroups) {
      errors.push(
        `${name}: 名前付きキャプチャグループが不足しています` +
          `（${REQUIRED_CALENDAR_GROUPS.join(" ")} をすべて、または epochMs / epochSec を含めてください）`
      );
      return;
    }

    formats.push({ name, regex, parse: createParseFunction(groupNames) });
  });

  return { formats, errors };
}
