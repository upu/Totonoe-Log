import * as vscode from "vscode";
import {
  getDistinctSeverities,
  parseDateBoundary,
  type DateRange,
  type DisplayTimezone,
  type FilterCriteria,
  type LogEntry,
  type MergedEntry,
} from "./normalize";
import { normalizeFileVisibility } from "./interactiveViewFiles";
import type {
  SerializedFilterCriteria,
  SerializedFilterPattern,
} from "./webview/interactiveView/protocol";

/**
 * Webviewから届いたフォームの状態を、拡張機能本体が使える形へ整える。
 * 現在のファイル数へ合わせ直す以外は、届いた内容をそのまま採用する
 * （`normalizeFileVisibility` の必要性は issue #170 参照）。
 *
 * 絞り込みの変更（`filterChanged`）と書き出し（`exportVirtualDocument`、
 * issue #217）の両方がこれを通る。書き出しが「最後に受け取った条件」ではなく
 * 要求と一緒に届いた条件を使うのは、テキスト欄が300msデバウンスされるため
 * ——入力直後に Export を押すと、直前の入力が反映されないまま書き出されて
 * いた。マスク欄でこれが起きると、伏せたつもりの情報がそのまま共有される。
 */
export function resolveIncomingCriteria(
  incoming: SerializedFilterCriteria,
  fileCount: number
): SerializedFilterCriteria {
  return {
    ...incoming,
    visibleFiles: normalizeFileVisibility(incoming.visibleFiles, fileCount),
  };
}

/**
 * 読み込み済みエントリのセベリティ一覧を返す。Interactive View は単一ファイル
 * 表示とマージ表示でエントリのキャッシュを持ち替えるため、「今使われている方」を
 * ここで吸収する（issue #200）——マージ表示中は単一ファイル側が空になるので、
 * そちらだけを見ていると全セベリティが未チェックのまま開いてしまい、ログが
 * 1行も表示されない。
 */
export function getLoadedDistinctSeverities(
  singleEntries: readonly LogEntry[],
  mergedEntries: readonly MergedEntry[]
): string[] {
  const entries =
    singleEntries.length > 0 ? singleEntries : mergedEntries.map((merged) => merged.entry);
  return getDistinctSeverities(entries);
}

/**
 * ファイル追加後のチェック済みセベリティを求める（issue #200）。追加によって
 * **新しく現れた**セベリティはチェック済みに足すが、追加前から存在していて
 * 外されているものは外したままにする——後者はユーザーが明示的に選んだ状態
 * なので尊重し、前者は「まだ選択の機会が無かった」ものとして既定のON側に寄せる
 * （初期状態が全ONであることと揃える）。
 */
export function addNewlyAppearedSeverities(
  checked: readonly string[],
  previousDistinct: readonly string[],
  nextDistinct: readonly string[]
): string[] {
  const known = new Set(previousDistinct);
  const alreadyChecked = new Set(checked);
  const newlyAppeared = nextDistinct.filter(
    (severity) => !known.has(severity) && !alreadyChecked.has(severity)
  );
  return [...checked, ...newlyAppeared];
}

/**
 * 解釈できなかった入力（{@link toFilterCriteria} や {@link compileMaskPattern}
 * が積んだ説明）を、書き出し時の通知1件にまとめる（issue #217）。該当が無ければ
 * `undefined`。
 *
 * 表示側はパネル内の警告行に出せば済むが、書き出しは押した時点の入力を
 * そのまま使うため、その入力がまだ一度も描画されておらず、ユーザーが警告を
 * 見ていないことがある。不正なマスクパターンが黙って外れたまま、書き出しを
 * そのまま共有してしまうのを防ぐ。
 */
export function buildIgnoredInputWarning(errors: readonly string[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  return vscode.l10n.t(
    "Invalid input: {0}. Exported without applying the affected criteria.",
    errors.join(" / ")
  );
}

/** {@link toFilterCriteria} の結果。 */
export interface ToFilterCriteriaResult {
  readonly criteria: FilterCriteria;
  /** 解釈できなかった入力があれば、その説明（日本語）を1件ずつ格納する。 */
  readonly errors: readonly string[];
}

/**
 * Webviewから届いたJSON化済みの絞り込み条件（{@link SerializedFilterCriteria}）を、
 * `filterEntriesByCriteria` にそのまま渡せる {@link FilterCriteria} へ変換する。
 *
 * QuickPick/InputBoxベースの既存プロンプト（`promptDateBoundary`・
 * `promptIgnorePattern`）と異なり、不正な入力があってもダイアログで
 * 中断させることはできない（Webviewはその場で再描画され続ける）。そのため
 * 不正な入力は該当条件だけを無視して `errors` に理由を積み、呼び出し側が
 * 警告として画面に表示する。
 *
 * 日付範囲は、開始・終了のどちらも空文字列の場合は絞り込み条件に含めない
 * （`dateRange` を `undefined` のままにする）。`filterEntriesByDateRange` は
 * `dateRange` が指定されているだけでタイムスタンプ未認識のエントリを除外する
 * ため、ユーザーが日付範囲を一切入力していない状態でそれらのエントリが
 * 消えてしまわないようにするため。
 */
export function toFilterCriteria(
  serialized: SerializedFilterCriteria,
  displayTimezone: DisplayTimezone
): ToFilterCriteriaResult {
  const errors: string[] = [];

  const severities = new Set(serialized.severities);

  const dateRange = parseDateRange(serialized, displayTimezone, errors);
  const matchPatterns = compilePatterns(serialized.matchPatterns, "match", errors);
  const ignorePatterns = compilePatterns(serialized.ignorePatterns, "ignore", errors);

  return { criteria: { severities, dateRange, matchPatterns, ignorePatterns }, errors };
}

/**
 * パターン欄1つ分（複数行）をコンパイルする（issue #206）。OFF の行と空の行は
 * 条件から外すだけでエラーにしない——OFF は「消さずに一時的に外す」ための状態
 * であり、空行は「+ 追加」を押した直後の入力途中だからで、どちらも警告を出す
 * ような入力ミスではない。
 *
 * 使える行が1つも無い場合は `undefined` を返し、その条件自体を組み立てない
 * （空配列を渡すとワーカーが起動しない実装ではあるが、`filterEntriesByCriteria`
 * の段で「条件が無い」ことを明示するほうが読みやすい）。
 *
 * 不正な行はその1件だけを落とし、残りは適用する。エラー文言には欄名に加えて
 * 何件目かを添えるが、行が1つしか無いときは添えない（「1件目」とだけ言われても
 * 情報が増えないため）。
 */
type PatternKind = "match" | "ignore" | "mask";

function compilePatterns(
  inputs: readonly SerializedFilterPattern[],
  kind: "match" | "ignore",
  errors: string[]
): RegExp[] | undefined {
  const compiled: RegExp[] = [];

  inputs.forEach((input, index) => {
    if (!input.enabled || input.source.trim() === "") {
      return;
    }
    const position = inputs.length > 1 ? index + 1 : undefined;
    const pattern = compilePattern(input.source, kind, errors, position);
    if (pattern !== undefined) {
      compiled.push(pattern);
    }
  });

  return compiled.length > 0 ? compiled : undefined;
}

/** {@link compileMaskPattern} の結果。 */
export interface CompileMaskPatternResult {
  /** コンパイルできた正規表現。入力が空、または不正なら `undefined`。 */
  readonly pattern?: RegExp;
  /** 解釈できなかった場合の説明（日本語）。 */
  readonly errors: readonly string[];
}

/**
 * マスクパネルの任意パターン入力（issue #195）を `RegExp` にコンパイルする。
 * 絞り込みの2欄と同じ規則（`i` で大文字小文字を無視、`m` で複数行エントリの
 * 各行に `^` / `$` が当たる）に加えて `g` を足す——絞り込みは「一致したか」だけ
 * 見ればよいのに対し、マスクは一致箇所を**全て**置き換える必要があるため。
 */
export function compileMaskPattern(input: string): CompileMaskPatternResult {
  const errors: string[] = [];
  const pattern = compilePattern(input, "mask", errors, undefined, "gim");
  return { pattern, errors };
}

function parseDateRange(
  serialized: SerializedFilterCriteria,
  displayTimezone: DisplayTimezone,
  errors: string[]
): DateRange | undefined {
  const startInput = serialized.dateRangeStart.trim();
  const endInput = serialized.dateRangeEnd.trim();
  if (startInput === "" && endInput === "") {
    return undefined;
  }

  let startMs: number | undefined;
  if (startInput !== "") {
    startMs = parseDateBoundary(startInput, "start", displayTimezone);
    if (startMs === undefined) {
      errors.push(
        vscode.l10n.t('Could not parse the start date and time: "{0}".', startInput)
      );
    }
  }

  let endMs: number | undefined;
  if (endInput !== "") {
    endMs = parseDateBoundary(endInput, "end", displayTimezone);
    if (endMs === undefined) {
      errors.push(
        vscode.l10n.t('Could not parse the end date and time: "{0}".', endInput)
      );
    }
  }

  // 解釈できた境界が1つも無いなら、日付条件そのものを付けない（issue #220）。
  // `filterEntriesByDateRange` は DateRange が指定されているだけでタイムスタンプ
  // 未認識のエントリを除外するため、両端とも `undefined` の範囲を返すと、
  // 日付では何も絞り込めていないのに未認識行だけが黙って消える。
  if (startMs === undefined && endMs === undefined) {
    return undefined;
  }

  return { startMs, endMs };
}

/**
 * パターン入力欄1つ分を `RegExp` にコンパイルする。一致パターン・無視パターン・
 * マスクパターンの各欄で解釈の規則を揃えるため（issue #182、#195）、共通の
 * 実装にする。`"i"` で大文字小文字を無視し、`"m"` で `^` / `$` が複数行
 * エントリの各行に当たるようにする。
 *
 * `label` はエラー文言に埋め込む欄の名前。入力欄が複数あるため、どの欄が
 * 不正なのかがユーザーに分かるようにする。
 */
function compilePattern(
  input: string,
  kind: PatternKind,
  errors: string[],
  position?: number,
  flags = "im"
): RegExp | undefined {
  const trimmedInput = input.trim();
  if (trimmedInput === "") {
    return undefined;
  }

  try {
    return new RegExp(trimmedInput, flags);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(buildPatternError(kind, trimmedInput, reason, position));
    return undefined;
  }
}

function buildPatternError(
  kind: PatternKind,
  input: string,
  reason: string,
  position?: number
): string {
  if (kind === "mask") {
    return vscode.l10n.t(
      'Could not parse the mask pattern as a regular expression: "{0}" ({1})',
      input,
      reason
    );
  }
  if (kind === "match") {
    return position === undefined
      ? vscode.l10n.t(
          'Could not parse the match pattern as a regular expression: "{0}" ({1})',
          input,
          reason
        )
      : vscode.l10n.t(
          'Could not parse match pattern {0} as a regular expression: "{1}" ({2})',
          position,
          input,
          reason
        );
  }
  return position === undefined
    ? vscode.l10n.t(
        'Could not parse the ignore pattern as a regular expression: "{0}" ({1})',
        input,
        reason
      )
    : vscode.l10n.t(
        'Could not parse ignore pattern {0} as a regular expression: "{1}" ({2})',
        position,
        input,
        reason
      );
}
