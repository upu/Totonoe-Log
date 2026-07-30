/**
 * ハイライトルール（issue #18）の設定値を検証してコンパイルする。
 *
 * 絞り込み（一致 / 無視パターン）が「合わない行を消す」のに対し、ハイライトは
 * 行を残したまま目立たせる。調査中は「消したい」より先に「見つけたい」が来る
 * ことが多く、消してしまうと前後の文脈が読めなくなるため、両方を別の機能として
 * 持つ。
 */

/**
 * ルールに指定できる色。テーマカラーIDや任意のCSS色ではなく限定した名前に
 * しているのは、明・暗テーマそれぞれで読める値をこちら側で用意するため
 * ——ユーザーが色コードを知らなくてよく、テーマを切り替えても読めなくならない。
 * 実際の色は Webview 側のCSS（`.highlight-<色名>`）が持つ。
 */
export const HIGHLIGHT_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** `color` を省略したルールに使う色。 */
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

/**
 * `totonoeLog.highlightRules` 設定の1項目。ユーザーが自由に書ける JSON のため、
 * 実際の入力は {@link compileHighlightRules} が `unknown` として受け取り検証する。
 *
 * キー名を `label` ではなく `name` にしているのは、同じ形の既存設定
 * （`totonoeLog.timestampFormats`）に合わせるため。#207（よく使うパターンの登録）も
 * `{ name, pattern }` を土台にできる。
 */
export interface HighlightRuleSetting {
  /** ルールの表示名（エラー文言で使う）。省略時は `highlight-<番号>`。 */
  readonly name?: string;
  /** ハイライトする箇所にマッチする正規表現。 */
  readonly pattern: string;
  /** {@link HIGHLIGHT_COLORS} のいずれか。省略時は {@link DEFAULT_HIGHLIGHT_COLOR}。 */
  readonly color?: string;
}

/** コンパイル済みのハイライトルール。 */
export interface HighlightRule {
  readonly name: string;
  readonly regex: RegExp;
  readonly color: HighlightColor;
}

/**
 * {@link compileHighlightRules} の結果。不正な項目があっても全体を失敗には
 * せず、有効なルールと項目ごとのエラーを分けて返す（設定の1項目のタイポで
 * 既存のハイライトまで全部効かなくなるのを防ぐ）。
 */
export interface CompileHighlightRulesResult {
  readonly rules: HighlightRule[];
  /** 無効だった項目ごとの、ユーザー向けエラーメッセージ。 */
  readonly errors: string[];
}

function isHighlightColor(value: string): value is HighlightColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

/**
 * 設定値の配列を {@link HighlightRule} の配列へコンパイルする。
 *
 * フラグは `"gim"` 固定。`g` は1行の中の一致箇所を**全て**色付けするため
 * （絞り込みは「一致したか」だけ見ればよいが、ハイライトはマスクと同じく
 * 全ての箇所が要る）、`i` と `m` はパターン欄（#182、#206）と解釈を揃えるため。
 */
export function compileHighlightRules(
  settings: readonly unknown[]
): CompileHighlightRulesResult {
  const rules: HighlightRule[] = [];
  const errors: string[] = [];

  settings.forEach((setting, index) => {
    if (typeof setting !== "object" || setting === null) {
      errors.push(`${index + 1}番目の項目: オブジェクトではありません`);
      return;
    }

    const { name: rawName, pattern, color: rawColor } = setting as Partial<HighlightRuleSetting>;
    const name = typeof rawName === "string" && rawName !== "" ? rawName : `highlight-${index + 1}`;

    if (typeof pattern !== "string" || pattern === "") {
      errors.push(`${name}: pattern（文字列）が指定されていません`);
      return;
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "gim");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: 正規表現として不正です（${reason}）`);
      return;
    }

    let color = DEFAULT_HIGHLIGHT_COLOR;
    if (rawColor !== undefined) {
      if (typeof rawColor !== "string" || !isHighlightColor(rawColor)) {
        errors.push(
          `${name}: color は ${HIGHLIGHT_COLORS.join(" / ")} のいずれかを指定してください` +
            `（指定値: ${JSON.stringify(rawColor)}）`
        );
        return;
      }
      color = rawColor;
    }

    rules.push({ name, regex, color });
  });

  return { rules, errors };
}
