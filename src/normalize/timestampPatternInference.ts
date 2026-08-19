import { escapeForRegExp } from "./escapeForRegExp";

/**
 * ログ本文で選んだ範囲から `totonoeLog.timestampFormats` 用のパターンを
 * 提案できなかった理由。
 *
 * - `emptySelection`: 選択範囲が空（トリム後に文字が残らない）
 * - `monthName`: 月名の英字（`Jan` 等）を含む。`isoLikeGroupsToEpochMs` の
 *   `mo` グループは数値専用で解釈するため、月名を含むパターンは書いても
 *   永久にマッチしない（組み込みの syslog / access-log 形式は月名専用の
 *   `parse` 実装を別に持つが、カスタム形式の仕様には含まれない）
 * - `unsupportedToken`: 月名でも `Z`/`z` でもない、2文字以上の英字を含む
 *   （`AM`/`PM` 等、現在の名前付きグループ仕様で表現できないトークン）
 * - `twoDigitYear`: 4桁の年に該当する数字runが無く、日付部分が全て2桁以下
 *   （`Number()` 解釈のため2桁のまま使うと西暦24年になってしまう）
 * - `missingFields`: 上記以外で、エポック形式・カレンダー形式のどちらの
 *   数字run構成にも当てはまらない（フィールド不足・時刻部分の区切りが
 *   `:` でない等）
 */
export type TimestampPatternInferenceFailureReason =
  | "emptySelection"
  | "monthName"
  | "unsupportedToken"
  | "twoDigitYear"
  | "missingFields";

/**
 * {@link inferTimestampPattern} のオプション。
 */
export interface TimestampPatternInferenceOptions {
  /**
   * 日付部分の非年フィールド2つがどちらも12以下で月/日の判別が曖昧なとき、
   * どちらの並びとして解釈するか。省略時は年の位置から既定を決める
   * （年が先頭なら月→日、年が末尾なら日→月）。
   */
  readonly dayMonthOrder?: "dmy" | "mdy";
}

/**
 * 提案されたパターン。
 */
export interface TimestampPatternProposal {
  /** `totonoeLog.timestampFormats` の `pattern` にそのまま使える正規表現文字列。 */
  readonly pattern: string;
  /** `name` の初期値の提案（ユーザーが上書きできる）。 */
  readonly suggestedName: string;
  /** パターンに含まれる名前付きキャプチャグループ一覧（出現順）。 */
  readonly groupNames: readonly string[];
  /**
   * 日付部分の月/日の並びが、選択範囲の数字だけからは一意に決められなかった
   * 場合に true。true のときは `dayMonthOrder` オプションで並びを反転できる。
   */
  readonly ambiguousDayMonthOrder: boolean;
}

export type TimestampPatternInferenceResult =
  | { readonly ok: true; readonly proposal: TimestampPatternProposal }
  | { readonly ok: false; readonly reason: TimestampPatternInferenceFailureReason };

/** 選択範囲を分解したトークン1個。 */
interface Token {
  readonly kind: "digits" | "alpha" | "literal";
  readonly text: string;
}

/** 数字run・英字run・それ以外（区切り文字）runに分解する。 */
const TOKEN_PATTERN = /(\d+)|([A-Za-z]+)|([^\dA-Za-z]+)/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    // 数値付きキャプチャグループの undefined 判定は RegExpExecArray の型に
    // 表れない（TS はどの代替グループが参加したかを追えない）ため、代わりに
    // マッチ全体（`match[0]`、こちらは常に string）の先頭文字で種別を見る。
    const runText = match[0];
    const kind: Token["kind"] = /^\d/.test(runText) ? "digits" : /^[A-Za-z]/.test(runText) ? "alpha" : "literal";
    tokens.push({ kind, text: runText });
  }
  return tokens;
}

const MONTH_NAME_PATTERN =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;

/**
 * タイムゾーン抽出（末尾の `Z`/`z`、または符号付きオフセット）の結果。
 * 末尾から取り除くトークン数と、それに代わる正規表現の断片を返す。
 */
interface TimezoneExtraction {
  readonly consumedTokenCount: number;
  readonly patternSuffix: string;
  readonly groupNames: readonly string[];
}

function extractTrailingZulu(tokens: readonly Token[]): TimezoneExtraction | undefined {
  // 呼び出し元は非空の選択範囲から tokenize した配列しか渡さないため、
  // 少なくとも1トークンは存在する。
  const last = tokens[tokens.length - 1];
  if (last.kind === "alpha" && /^[Zz]$/.test(last.text)) {
    return { consumedTokenCount: 1, patternSuffix: "(?<tzz>[Zz])", groupNames: ["tzz"] };
  }
  return undefined;
}

/**
 * 符号（`+`/`-`）で終わる区切り文字runを、符号の手前部分（そのまま残す接頭辞）と
 * 符号自体に分ける。区切り文字runは空白等と符号が1つのrunにまとまっている
 * ことがある（例: `05 +09:00` の `" +"`）ため、符号だけを取り出す必要がある。
 */
function splitTrailingSign(token: Token): { prefix: string; sign: string } | undefined {
  if (token.kind !== "literal") {
    return undefined;
  }
  const sign = token.text.slice(-1);
  if (sign !== "+" && sign !== "-") {
    return undefined;
  }
  return { prefix: token.text.slice(0, -1), sign };
}

/** `+09:00` のようなコロン区切りのオフセット。 */
function tryColonOffset(tokens: readonly Token[]): TimezoneExtraction | undefined {
  const signIndex = tokens.length - 4;
  if (signIndex < 0) {
    return undefined;
  }
  const split = splitTrailingSign(tokens[signIndex]);
  // signIndex >= 0 なので、tokens.length === signIndex + 4 個以上あり、
  // 以下の3要素は必ず存在する。
  const [hour, colon, minute] = tokens.slice(signIndex + 1);
  if (!split || hour.kind !== "digits" || hour.text.length !== 2) {
    return undefined;
  }
  if (colon.kind !== "literal" || colon.text !== ":") {
    return undefined;
  }
  if (minute.kind !== "digits" || minute.text.length !== 2) {
    return undefined;
  }
  return {
    consumedTokenCount: 4,
    patternSuffix: `${escapeForRegExp(split.prefix)}(?<tzs>[+-])(?<tzh>\\d{2}):(?<tzm>\\d{2})`,
    groupNames: ["tzs", "tzh", "tzm"],
  };
}

/** `+0900` のような、時分が1つの数字runにまとまったオフセット。 */
function tryCombinedOffset(tokens: readonly Token[]): TimezoneExtraction | undefined {
  const signIndex = tokens.length - 2;
  if (signIndex < 0) {
    return undefined;
  }
  const split = splitTrailingSign(tokens[signIndex]);
  const digits = tokens[signIndex + 1];
  if (!split || digits.kind !== "digits" || digits.text.length !== 4) {
    return undefined;
  }
  return {
    consumedTokenCount: 2,
    patternSuffix: `${escapeForRegExp(split.prefix)}(?<tzs>[+-])(?<tzh>\\d{2})(?<tzm>\\d{2})`,
    groupNames: ["tzs", "tzh", "tzm"],
  };
}

/** `+09` のような、分を省略した時のみのオフセット（#297）。 */
function tryHourOnlyOffset(tokens: readonly Token[]): TimezoneExtraction | undefined {
  const signIndex = tokens.length - 2;
  if (signIndex < 0) {
    return undefined;
  }
  const split = splitTrailingSign(tokens[signIndex]);
  const digits = tokens[signIndex + 1];
  if (!split || digits.kind !== "digits" || digits.text.length !== 2) {
    return undefined;
  }
  return {
    consumedTokenCount: 2,
    patternSuffix: `${escapeForRegExp(split.prefix)}(?<tzs>[+-])(?<tzh>\\d{2})`,
    groupNames: ["tzs", "tzh"],
  };
}

function extractTrailingTimezone(tokens: readonly Token[]): TimezoneExtraction | undefined {
  return (
    extractTrailingZulu(tokens) ?? tryColonOffset(tokens) ?? tryCombinedOffset(tokens) ?? tryHourOnlyOffset(tokens)
  );
}

/**
 * タイムゾーン抽出後に残ったトークンの中に、月名でも1文字の区切り文字
 * （ISO の `T` 等）でもない英字runが無いか調べる。
 */
function checkForUnsupportedAlpha(
  tokens: readonly Token[]
): TimestampPatternInferenceFailureReason | undefined {
  for (const token of tokens) {
    if (token.kind !== "alpha" || token.text.length === 1) {
      // 1文字の英字（ISO の `T` 区切り等）は月名になり得ないため素通しする。
      continue;
    }
    if (MONTH_NAME_PATTERN.test(token.text)) {
      return "monthName";
    }
    return "unsupportedToken";
  }
  return undefined;
}

/** 数字runへ割り当てる役割（キャプチャグループ名と、そのグループの正規表現幅）。 */
interface DigitRole {
  readonly group: string;
  readonly widthPattern: string;
}

interface CalendarClassification {
  readonly roles: ReadonlyMap<number, DigitRole>;
  readonly ambiguousDayMonthOrder: boolean;
}

/** カレンダー形式の日付部分（年・月・日の3トークン）の役割を決める。 */
function classifyDatePart(
  triple: readonly [Token, Token, Token],
  positions: readonly [number, number, number],
  options: TimestampPatternInferenceOptions
): { roles: Map<number, DigitRole>; ambiguous: boolean } | "twoDigitYear" | "missingFields" {
  const fourDigitPositions = [0, 1, 2].filter((i) => triple[i].text.length === 4);
  if (fourDigitPositions.length !== 1) {
    const allShort = triple.every((token) => token.text.length <= 2);
    return allShort ? "twoDigitYear" : "missingFields";
  }
  const yearIndex = fourDigitPositions[0];
  const [posA, posB] = [0, 1, 2].filter((i) => i !== yearIndex);
  const valueA = Number(triple[posA].text);
  const valueB = Number(triple[posB].text);
  const ambiguous = valueA <= 12 && valueB <= 12;

  let dayPos: number;
  let monthPos: number;
  if (!ambiguous) {
    [dayPos, monthPos] = valueA > 12 ? [posA, posB] : [posB, posA];
  } else {
    const order = options.dayMonthOrder ?? (yearIndex === 0 ? "mdy" : "dmy");
    [dayPos, monthPos] = order === "dmy" ? [posA, posB] : [posB, posA];
  }

  const roles = new Map<number, DigitRole>([
    [positions[yearIndex], { group: "y", widthPattern: "\\d{4}" }],
    [positions[monthPos], { group: "mo", widthPattern: "\\d{1,2}" }],
    [positions[dayPos], { group: "d", widthPattern: "\\d{1,2}" }],
  ]);
  return { roles, ambiguous };
}

/** カレンダー形式の時刻部分が `h:mi:s` の形で連続しているか確認する。 */
function classifyTimePart(
  mainTokens: readonly Token[],
  positions: readonly [number, number, number]
): Map<number, DigitRole> | undefined {
  const [hourIdx, minuteIdx, secondIdx] = positions;
  if (minuteIdx !== hourIdx + 2 || secondIdx !== minuteIdx + 2) {
    return undefined;
  }
  // hourIdx+2 === minuteIdx（上のチェックで確認済み）かつ minuteIdx が
  // 有効な数字runの位置なので、間の区切りトークンは必ず存在する。
  const betweenHourMinute = mainTokens[hourIdx + 1];
  const betweenMinuteSecond = mainTokens[minuteIdx + 1];
  if (betweenHourMinute.text !== ":" || betweenMinuteSecond.text !== ":") {
    return undefined;
  }
  return new Map<number, DigitRole>([
    [hourIdx, { group: "h", widthPattern: "\\d{1,2}" }],
    [minuteIdx, { group: "mi", widthPattern: "\\d{2}" }],
    [secondIdx, { group: "s", widthPattern: "\\d{2}" }],
  ]);
}

/**
 * 数字runが6個（`y mo d h mi s`）または7個（末尾に `.`/`,` 区切りの `ms` を
 * 含む）のとき、カレンダー形式として役割を割り当てる。日付3個・時刻3個は
 * 「時刻は必ず最後の3個で `:` 区切り」という前提で判別する（日付が先、
 * 時刻が後というのはあらゆる実用フォーマットで共通のため）。
 */
function classifyCalendar(
  mainTokens: readonly Token[],
  digitPositions: readonly number[],
  options: TimestampPatternInferenceOptions
): CalendarClassification | TimestampPatternInferenceFailureReason {
  let corePositions = digitPositions;
  let msPosition: number | undefined;
  if (digitPositions.length === 7) {
    const last = digitPositions[6];
    // digitPositions は mainTokens 内の昇順インデックスなので、7個目
    // （last）は必ず last >= 6、その手前 (last - 1) は有効な添字。
    const separator = mainTokens[last - 1];
    if (separator.kind !== "literal" || !/^[.,]$/.test(separator.text)) {
      return "missingFields";
    }
    msPosition = last;
    corePositions = digitPositions.slice(0, 6);
  }

  const timePositions = corePositions.slice(3, 6) as [number, number, number];
  const timeRoles = classifyTimePart(mainTokens, timePositions);
  if (!timeRoles) {
    return "missingFields";
  }

  const datePositions = corePositions.slice(0, 3) as [number, number, number];
  const dateTriple = datePositions.map((i) => mainTokens[i]) as [Token, Token, Token];
  const dateResult = classifyDatePart(dateTriple, datePositions, options);
  if (dateResult === "twoDigitYear" || dateResult === "missingFields") {
    return dateResult;
  }

  const roles = new Map([...dateResult.roles, ...timeRoles]);
  if (msPosition !== undefined) {
    roles.set(msPosition, { group: "ms", widthPattern: "\\d{1,9}" });
  }
  return { roles, ambiguousDayMonthOrder: dateResult.ambiguous };
}

/** 数字runが1個または2個のとき、エポック形式として役割を割り当てる。 */
function classifyEpoch(
  mainTokens: readonly Token[],
  digitPositions: readonly number[]
): CalendarClassification | "missingFields" {
  if (digitPositions.length === 1) {
    const [index] = digitPositions;
    const text = mainTokens[index].text;
    if (text.length === 13) {
      return {
        roles: new Map([[index, { group: "epochMs", widthPattern: "\\d{13}" }]]),
        ambiguousDayMonthOrder: false,
      };
    }
    if (text.length === 10) {
      return {
        roles: new Map([[index, { group: "epochSec", widthPattern: "\\d{10}" }]]),
        ambiguousDayMonthOrder: false,
      };
    }
    return "missingFields";
  }

  const [secIndex, msIndex] = digitPositions;
  const secText = mainTokens[secIndex].text;
  // msIndex > secIndex（digitPositions は昇順）なので secIndex + 1 は
  // 必ず存在する（msIndex 自身か、その手前の区切りトークンのどちらか）。
  const separator = mainTokens[secIndex + 1];
  const isAdjacentMs = msIndex === secIndex + 2 && separator.kind === "literal" && /^[.,]$/.test(separator.text);
  if (secText.length !== 10 || !isAdjacentMs) {
    return "missingFields";
  }
  return {
    roles: new Map([
      [secIndex, { group: "epochSec", widthPattern: "\\d{10}" }],
      [msIndex, { group: "ms", widthPattern: "\\d{1,9}" }],
    ]),
    ambiguousDayMonthOrder: false,
  };
}

function classifyMainTokens(
  mainTokens: readonly Token[],
  options: TimestampPatternInferenceOptions
): CalendarClassification | TimestampPatternInferenceFailureReason {
  const digitPositions = mainTokens.reduce<number[]>((acc, token, index) => {
    if (token.kind === "digits") {
      acc.push(index);
    }
    return acc;
  }, []);

  if (digitPositions.length === 1 || digitPositions.length === 2) {
    return classifyEpoch(mainTokens, digitPositions);
  }
  if (digitPositions.length === 6 || digitPositions.length === 7) {
    return classifyCalendar(mainTokens, digitPositions, options);
  }
  return "missingFields";
}

/** 役割が割り当てられたトークン列から、正規表現パターン文字列を組み立てる。 */
function buildPattern(
  mainTokens: readonly Token[],
  roles: ReadonlyMap<number, DigitRole>,
  timezone: TimezoneExtraction | undefined,
  unanchoredPrefixLength: number
): { pattern: string; groupNames: string[] } {
  const groupNames: string[] = [];
  const fragments = mainTokens.map((token, index) => {
    const role = roles.get(index);
    if (role) {
      groupNames.push(role.group);
      return `(?<${role.group}>${role.widthPattern})`;
    }
    return escapeForRegExp(token.text);
  });
  if (timezone) {
    fragments.push(timezone.patternSuffix);
    groupNames.push(...timezone.groupNames);
  }

  const prefix = unanchoredPrefixLength > 0 ? `.{0,${String(unanchoredPrefixLength)}}?` : "";
  return { pattern: prefix + fragments.join(""), groupNames };
}

/** `compileCustomTimestampFormats` の行頭アンカーに対応する、前置き許容の上限文字数。 */
const MAX_UNANCHORED_PREFIX_LENGTH = 128;

function suggestNameFor(roles: ReadonlyMap<number, DigitRole>): string {
  const groups = new Set([...roles.values()].map((role) => role.group));
  if (groups.has("epochMs")) {
    return "custom-epoch-ms";
  }
  if (groups.has("epochSec")) {
    return "custom-epoch-sec";
  }
  return "custom-calendar";
}

function trimSelection(line: string, start: number, end: number): { start: number; end: number } {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/.test(line[trimmedStart] ?? "")) {
    trimmedStart++;
  }
  while (trimmedEnd > trimmedStart && /\s/.test(line[trimmedEnd - 1] ?? "")) {
    trimmedEnd--;
  }
  return { start: trimmedStart, end: trimmedEnd };
}

/**
 * ログ本文中で選んだ範囲（`selectionStart` 〜 `selectionEnd`、`line` 内の
 * 文字インデックス）から、`totonoeLog.timestampFormats` に登録できるパターンを
 * 推論する。
 *
 * 選択範囲を数字run・英字run・区切り文字runに分解し、値の桁数・並び・区切り
 * 記号から役割（年・月・日・時・分・秒、またはエポック）を判定する。月名や
 * 2桁年など、カスタム形式の名前付きグループ仕様（README「カスタムタイムスタンプ
 * 形式」参照）で表現できない入力は、後で保存してもマッチしないパターンを
 * 黙って提案しないよう理由付きで断る。
 */
export function inferTimestampPattern(
  line: string,
  selectionStart: number,
  selectionEnd: number,
  options: TimestampPatternInferenceOptions = {}
): TimestampPatternInferenceResult {
  const clampedStart = Math.max(0, Math.min(selectionStart, line.length));
  const clampedEnd = Math.max(clampedStart, Math.min(selectionEnd, line.length));
  const { start, end } = trimSelection(line, clampedStart, clampedEnd);
  if (start === end) {
    return { ok: false, reason: "emptySelection" };
  }

  const tokens = tokenize(line.slice(start, end));
  const timezone = extractTrailingTimezone(tokens);
  const mainTokens = timezone ? tokens.slice(0, tokens.length - timezone.consumedTokenCount) : tokens;

  const unsupportedReason = checkForUnsupportedAlpha(mainTokens);
  if (unsupportedReason) {
    return { ok: false, reason: unsupportedReason };
  }

  const classification = classifyMainTokens(mainTokens, options);
  if (typeof classification === "string") {
    return { ok: false, reason: classification };
  }

  // 行頭ではない選択には、`compileCustomTimestampFormats` の行頭アンカーに
  // 対応する境界付き前置き（`.{0,N}?`）を付ける。`.*?` を使わないのは、長い行
  // での不要なバックトラックを避けるため。
  const unanchoredPrefixLength = Math.min(start, MAX_UNANCHORED_PREFIX_LENGTH);
  const { pattern, groupNames } = buildPattern(
    mainTokens,
    classification.roles,
    timezone,
    unanchoredPrefixLength
  );

  return {
    ok: true,
    proposal: {
      pattern,
      suggestedName: suggestNameFor(classification.roles),
      groupNames,
      ambiguousDayMonthOrder: classification.ambiguousDayMonthOrder,
    },
  };
}
