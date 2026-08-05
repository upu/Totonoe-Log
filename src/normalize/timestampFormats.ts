import type { TimestampFormat } from "./types";
import { parseUtcOffsetMinutes } from "./timezone";

/** syslog 形式のタイムスタンプで使う月の3文字略称。 */
const MONTH_ABBREVIATIONS: Record<string, number | undefined> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

interface IsoLikeDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

function parseFractionalMilliseconds(value: string | undefined): number | undefined {
  if (value === undefined) {
    return 0;
  }
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  // 丸めると実際より後の時刻へ繰り上がり、ログの並びを誤解しやすいため切り捨てる。
  return Number(value.padEnd(3, "0").slice(0, 3));
}

function isValidIsoLikeTime(parts: IsoLikeDateTimeParts): boolean {
  return (
    Number.isInteger(parts.hour) &&
    parts.hour >= 0 &&
    parts.hour <= 23 &&
    Number.isInteger(parts.minute) &&
    parts.minute >= 0 &&
    parts.minute <= 59 &&
    Number.isInteger(parts.second) &&
    parts.second >= 0 &&
    parts.second <= 59
  );
}

function parseIsoLikeDateTimeParts(
  groups: Record<string, string | undefined>
): IsoLikeDateTimeParts | undefined {
  const millisecond = parseFractionalMilliseconds(groups.ms);
  if (millisecond === undefined) {
    return undefined;
  }
  const parts = {
    year: Number(groups.y),
    month: Number(groups.mo) - 1,
    day: Number(groups.d),
    hour: Number(groups.h),
    minute: Number(groups.mi),
    second: Number(groups.s),
    millisecond,
  };
  return isValidIsoLikeTime(parts) ? parts : undefined;
}

function isSameUtcDate(check: Date, parts: IsoLikeDateTimeParts): boolean {
  return (
    check.getUTCFullYear() === parts.year &&
    check.getUTCMonth() === parts.month &&
    check.getUTCDate() === parts.day
  );
}

function toValidatedUtcWallClockMs(parts: IsoLikeDateTimeParts): number | undefined {
  const epochMs = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  // Date.UTC は範囲外の日付を繰り上げるため、オフセット適用前に拒否する。
  return isSameUtcDate(new Date(epochMs), parts) ? epochMs : undefined;
}

function resolveIsoLikeOffsetMinutes(
  groups: Record<string, string | undefined>,
  fallbackUtcOffsetMinutes: number
): number | undefined {
  if (groups.tzs) {
    const offsetText =
      `${groups.tzs}${groups.tzh ?? ""}` +
      (groups.tzm === undefined ? "" : `:${groups.tzm}`);
    return parseUtcOffsetMinutes(offsetText);
  }
  // `Z` は UTC の明示なので、タイムゾーン表記なし用のフォールバックと区別する。
  if (groups.tzz) {
    return 0;
  }
  return fallbackUtcOffsetMinutes;
}

/**
 * 以下の ISO 8601 系フォーマットが共有する名前付きキャプチャグループを
 * エポックミリ秒に変換する。範囲外の日時や UTC オフセットは `undefined` を
 * 返し、不正な値を別の有効日時へ繰り上げて受け入れないようにする。
 *
 * タイムゾーン表記がない場合は `fallbackUtcOffsetMinutes`（既定 0 = UTC）を
 * 仮定する。既定を UTC にすることで、ホストマシンのローカルタイムゾーンに
 * 関わらず解析結果が一定になる（テスト時や異なるマシンで収集したログを
 * 比較する際に重要）。`tzs` グループ（明示オフセット）または `tzz` グループ
 * （`Z` = UTC 明示）が捕捉されている場合は、書かれている情報を優先して
 * フォールバックを適用しない。
 *
 * カスタムフォーマット（`customTimestampFormats.ts`）も同じグループ名を
 * ユーザー向け仕様として採用しているため、モジュール外へ公開している。
 */
export function isoLikeGroupsToEpochMs(
  groups: Record<string, string | undefined>,
  fallbackUtcOffsetMinutes = 0
): number | undefined {
  const parts = parseIsoLikeDateTimeParts(groups);
  if (parts === undefined) {
    return undefined;
  }
  const epochMs = toValidatedUtcWallClockMs(parts);
  if (epochMs === undefined) {
    return undefined;
  }
  const offsetMinutes = resolveIsoLikeOffsetMinutes(groups, fallbackUtcOffsetMinutes);
  if (offsetMinutes === undefined) {
    return undefined;
  }
  return epochMs - offsetMinutes * 60 * 1000;
}

/**
 * ISO 8601 / RFC 3339 形式のタイムスタンプ。例:
 * - `2024-01-02T03:04:05.678Z`
 * - `2024-01-02 03:04:05,678`（log4j 形式、カンマミリ秒、タイムゾーンなし）
 * - `2024-01-02T03:04:05+09:00`
 */
export const ISO_8601_FORMAT: TimestampFormat = {
  name: "iso8601",
  // 小数秒は .NET（7桁）・Go RFC3339Nano（9桁）を考慮して9桁まで許容する。
  // ミリ秒への変換（isoLikeGroupsToEpochMs）は先頭3桁のみを使うため、6桁を
  // 超える分は自動的に切り捨てられる。桁数を絞りすぎるとタイムゾーン部分が
  // 未マッチのままログメッセージへ混入してしまう（#94）。
  // `Z` を tzz グループで捕捉するのは、「UTC の明示」と「タイムゾーン表記
  // なし」を区別してソースオフセット（#13）を後者にだけ適用するため。
  regex:
    /^(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})[T ](?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,9}))?(?:(?<tzz>Z)|(?<tzs>[+-])(?<tzh>\d{2}):?(?<tzm>\d{2}))?/,
  parse(match, context) {
    return isoLikeGroupsToEpochMs(match.groups ?? {}, context?.fallbackUtcOffsetMinutes);
  },
};

/**
 * 角括弧で囲まれた ISO 8601 系タイムスタンプ。例: `[2024-01-02 03:04:05,678]`。
 * log4j / logback 系ログでよく見られる形式。
 */
export const BRACKETED_ISO_8601_FORMAT: TimestampFormat = {
  name: "bracketed-iso8601",
  // 小数秒の桁数上限・tzz グループの理由は ISO_8601_FORMAT のコメント参照。
  regex:
    /^\[(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})[T ](?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,9}))?(?:(?<tzz>Z)|(?<tzs>[+-])(?<tzh>\d{2}):?(?<tzm>\d{2}))?\]/,
  parse(match, context) {
    return isoLikeGroupsToEpochMs(match.groups ?? {}, context?.fallbackUtcOffsetMinutes);
  },
};

/**
 * スラッシュ区切り日付のタイムスタンプ。例:
 * - `2024/01/02 03:04:05`
 * - `2024/1/2 3:04:05.678`（月・日・時は1桁も許容）
 *
 * 日本語圏の Windows 系アプリ・業務システムのログで広く使われる形式。
 * タイムゾーン表記を持たないログがほとんどのため、オフセットは受け付けず
 * ソースオフセット未指定なら UTC として解釈する（ISO 形式のタイムゾーン
 * なしの場合と同じ扱い）。
 */
export const SLASH_DATE_FORMAT: TimestampFormat = {
  name: "slash-date",
  regex:
    /^(?<y>\d{4})\/(?<mo>\d{1,2})\/(?<d>\d{1,2})[T ](?<h>\d{1,2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,9}))?/,
  parse(match, context) {
    return isoLikeGroupsToEpochMs(match.groups ?? {}, context?.fallbackUtcOffsetMinutes);
  },
};

/**
 * Apache / Nginx アクセスログのタイムスタンプ。例: `[02/Jan/2024:03:04:05 +0900]`。
 * Common Log Format の `%t` に相当する。オフセット部分は省略も許容し、
 * その場合は UTC として解釈する。
 *
 * 注意: 実際のアクセスログ行では IP アドレス等がタイムスタンプより前に
 * 置かれることが多いが、`parseLog` は行頭のタイムスタンプのみを認識する
 * 設計のため、この形式は角括弧が行頭にあるログ（アプリが `%t` 形式だけを
 * 先頭に出すケース）を対象とする。
 */
export const APACHE_ACCESS_LOG_FORMAT: TimestampFormat = {
  name: "apache-access-log",
  regex:
    /^\[(?<d>\d{2})\/(?<mon>[A-Za-z]{3})\/(?<y>\d{4}):(?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?: (?<tzs>[+-])(?<tzh>\d{2})(?<tzm>\d{2}))?\]/,
  parse(match, context) {
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const month = MONTH_ABBREVIATIONS[(groups.mon ?? "").toLowerCase()];
    if (month === undefined) {
      return undefined;
    }
    // オフセット部分が省略されている場合のみ、isoLikeGroupsToEpochMs 側の
    // 判定によりソースオフセットのフォールバックが適用される。
    return isoLikeGroupsToEpochMs(
      {
        ...groups,
        mo: String(month + 1),
      },
      context?.fallbackUtcOffsetMinutes
    );
  },
};

/**
 * 行頭のエポック秒（10桁、小数部つきも可）またはエポックミリ秒（13桁）。例:
 * - `1704164645 INFO ...`
 * - `1704164645.678 ...`
 * - `1704164645678 ...`
 *
 * 桁数を 10 / 13 に固定しているのは、行頭の任意の数値をタイムスタンプと
 * 誤認しないための安全策。10桁は 2001〜2286 年、13桁も同じ範囲をカバーする
 * ため、実用上のログはこの範囲に収まる。直後にさらに数字が続く場合
 * （11〜12桁・14桁以上の数値の一部だった場合）はマッチさせない。
 */
export const EPOCH_FORMAT: TimestampFormat = {
  name: "epoch",
  regex: /^(?:(?<epochMs>\d{13})|(?<epochSec>\d{10})(?:[.,](?<frac>\d{1,9}))?)(?!\d)/,
  parse(match) {
    const groups = match.groups ?? {};
    if (groups.epochMs) {
      return Number(groups.epochMs);
    }
    // 小数部はミリ秒3桁に切り捨てる（切り捨ての理由は isoLikeGroupsToEpochMs
    // の ms 処理と同じ）。
    const ms = groups.frac ? Number(groups.frac.padEnd(3, "0").slice(0, 3)) : 0;
    return Number(groups.epochSec) * 1000 + ms;
  },
};

/**
 * {@link createSyslogFormat} のオプション。
 */
export interface SyslogFormatOptions {
  /**
   * 年を省略している従来の syslog タイムスタンプ（`MMM d HH:mm:ss`）に
   * 補完する暦年。指定すると年推定ヒューリスティックを使わず常にこの年を使う。
   * 省略時は {@link referenceTimeMs} を基準にログ行ごとに年を推定する
   * （{@link createSyslogFormat} 参照）。
   */
  readonly assumedYear?: number;

  /**
   * 年推定の基準時刻（エポックミリ秒）。省略時は現在時刻（`Date.now()`）。
   * 主にテストで推定結果を決定的にするために指定する。
   */
  readonly referenceTimeMs?: number;
}

/**
 * 年推定で「未来のタイムスタンプ」とみなさない猶予。ログを書いたマシンの
 * 時計がホストより少し進んでいるだけのケースを、1年前のログと誤認しない
 * ための余裕（rsyslog 等の実装と同趣旨のクロックスキュー対策）。
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * 年を含まない従来の syslog タイムスタンプ。例: `Jan  1 00:00:00`。
 * フォーマット自体に年がないため、年は次の規則で補完する:
 *
 * - `assumedYear` が指定されていれば常にその年を使う（従来どおり）。
 * - 省略時は基準時刻（`referenceTimeMs`、既定は現在時刻）の UTC 年を仮定し、
 *   その解釈が基準時刻より {@link FUTURE_TOLERANCE_MS} を超えて未来になる
 *   場合は1年繰り下げる（例: 2026年1月に開いた「Dec 31」は2025年と推定）。
 *   多くの syslog パーサが使う年またぎヒューリスティックと同じ方式。
 *   基準年では存在しない日付（平年の Feb 29）も前年で解釈を試みる。
 */
export function createSyslogFormat(options: SyslogFormatOptions = {}): TimestampFormat {
  const referenceTimeMs = options.referenceTimeMs ?? Date.now();
  // タイムスタンプは常に UTC として解釈するため、基準年も UTC で取る。
  const referenceYear = new Date(referenceTimeMs).getUTCFullYear();
  return {
    name: "syslog",
    regex: /^(?<mon>[A-Za-z]{3})\s+(?<d>\d{1,2})\s(?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})/,
    parse(match, context) {
      const groups: Record<string, string | undefined> = match.groups ?? {};
      const month = MONTH_ABBREVIATIONS[(groups.mon ?? "").toLowerCase()];
      if (month === undefined) {
        return undefined;
      }
      // syslog はタイムゾーン表記を持たないため、常にフォールバック
      // オフセットの適用対象になる。年推定の未来判定はオフセット適用後の
      // 値で行うが、ずれは最大 ±14 時間で FUTURE_TOLERANCE_MS（24時間）に
      // 収まるため判定を壊さない。
      const toEpochMs = (year: number): number | undefined =>
        isoLikeGroupsToEpochMs(
          {
            y: String(year),
            mo: String(month + 1).padStart(2, "0"),
            d: groups.d,
            h: groups.h,
            mi: groups.mi,
            s: groups.s,
          },
          context?.fallbackUtcOffsetMinutes
        );

      if (options.assumedYear !== undefined) {
        return toEpochMs(options.assumedYear);
      }

      const currentYearMs = toEpochMs(referenceYear);
      if (currentYearMs === undefined) {
        // 基準年では存在しない日付（平年の Feb 29 など）。前年なら存在する
        // 可能性があるため試す（前年も不正なら undefined のまま）。
        return toEpochMs(referenceYear - 1);
      }
      if (currentYearMs > referenceTimeMs + FUTURE_TOLERANCE_MS) {
        // 前年でも不正な日付（閏年の Feb 29 を未来と判定した場合など）は、
        // 未来ではあっても有効な基準年の解釈を残す。
        return toEpochMs(referenceYear - 1) ?? currentYearMs;
      }
      return currentYearMs;
    },
  };
}

/**
 * デフォルトの組み込みタイムスタンプフォーマット一覧を返す（試行順）。
 * 追加 / カスタムフォーマットは `parseLog` に直接渡すことができる。
 *
 * 試行順は「限定的な形式ほど先、曖昧な形式ほど後」を原則とする。特に
 * エポック形式は行頭の数字列だけでマッチする最も曖昧な形式のため必ず
 * 最後に置く（例: `2024...` で始まる行を先にエポックと誤認しないため。
 * 現状 ISO 形式は4桁目にハイフンが来るため衝突しないが、順序で守る方が
 * 将来の形式追加に対して頑健）。
 */
export function getDefaultTimestampFormats(
  syslogOptions: SyslogFormatOptions = {}
): TimestampFormat[] {
  return [
    BRACKETED_ISO_8601_FORMAT,
    ISO_8601_FORMAT,
    SLASH_DATE_FORMAT,
    APACHE_ACCESS_LOG_FORMAT,
    createSyslogFormat(syslogOptions),
    EPOCH_FORMAT,
  ];
}
