import type { TimestampFormat } from "./types";

/** syslog 形式のタイムスタンプで使う月の3文字略称。 */
const MONTH_ABBREVIATIONS: Record<string, number> = {
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

/**
 * 以下の ISO 8601 系フォーマットが共有する名前付きキャプチャグループを
 * エポックミリ秒に変換する。範囲外の値（月が 13 など）は `undefined` を返し、
 * 不正な日付をサイレントに受け入れないようにする。
 *
 * タイムゾーンオフセットがない場合は UTC として扱う。これにより、ホスト
 * マシンのローカルタイムゾーンに関わらず解析結果が一定になる（テスト時や
 * 異なるマシンで収集したログを比較する際に重要）。
 */
function isoLikeGroupsToEpochMs(groups: Record<string, string | undefined>): number | undefined {
  const year = Number(groups.y);
  const month = Number(groups.mo) - 1;
  const day = Number(groups.d);
  const hour = Number(groups.h);
  const minute = Number(groups.mi);
  const second = Number(groups.s);
  // 3桁未満（例: ".5" → "500"）は0埋めし、4桁以上（.NETの7桁・Goの9桁など）は
  // 先頭3桁だけを使ってミリ秒に切り捨てる。丸めではなく切り捨てなのは、
  // タイムスタンプ順のマージで「実際より後ろの時刻」に繰り上がる方が
  // 「実際より前」より誤解を招きやすいと判断したため。
  const ms = groups.ms ? Number(groups.ms.padEnd(3, "0").slice(0, 3)) : 0;

  const epochMs = Date.UTC(year, month, day, hour, minute, second, ms);

  // Date.UTC は範囲外の値を繰り上げ処理するため（月12 → 翌年など）、
  // 逆算して比較することで "2024-02-30" のような不正日付を検出する。
  // タイムゾーンオフセット適用前に比較すること。
  const check = new Date(epochMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }

  if (groups.tzs) {
    const tzSign = groups.tzs === "-" ? -1 : 1;
    const tzHours = Number(groups.tzh);
    const tzMinutes = Number(groups.tzm ?? "0");
    return epochMs - tzSign * (tzHours * 60 + tzMinutes) * 60 * 1000;
  }

  return epochMs;
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
  regex:
    /^(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})[T ](?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,9}))?(?:Z|(?<tzs>[+-])(?<tzh>\d{2}):?(?<tzm>\d{2}))?/,
  parse(match) {
    return isoLikeGroupsToEpochMs(match.groups ?? {});
  },
};

/**
 * 角括弧で囲まれた ISO 8601 系タイムスタンプ。例: `[2024-01-02 03:04:05,678]`。
 * log4j / logback 系ログでよく見られる形式。
 */
export const BRACKETED_ISO_8601_FORMAT: TimestampFormat = {
  name: "bracketed-iso8601",
  // 小数秒の桁数上限の理由は ISO_8601_FORMAT のコメント参照。
  regex:
    /^\[(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})[T ](?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:[.,](?<ms>\d{1,9}))?(?:Z|(?<tzs>[+-])(?<tzh>\d{2}):?(?<tzm>\d{2}))?\]/,
  parse(match) {
    return isoLikeGroupsToEpochMs(match.groups ?? {});
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
    parse(match) {
      const groups = match.groups ?? {};
      const month = MONTH_ABBREVIATIONS[(groups.mon ?? "").toLowerCase()];
      if (month === undefined) {
        return undefined;
      }
      const toEpochMs = (year: number): number | undefined =>
        isoLikeGroupsToEpochMs({
          y: String(year),
          mo: String(month + 1).padStart(2, "0"),
          d: groups.d,
          h: groups.h,
          mi: groups.mi,
          s: groups.s,
        });

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
 */
export function getDefaultTimestampFormats(
  syslogOptions: SyslogFormatOptions = {}
): TimestampFormat[] {
  return [BRACKETED_ISO_8601_FORMAT, ISO_8601_FORMAT, createSyslogFormat(syslogOptions)];
}
