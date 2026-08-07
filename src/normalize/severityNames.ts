/**
 * セベリティ名の表記揺れを揃える（issue #302）。
 *
 * プレーンテキストの行と JSON Lines の `level` フィールドの両方から使うため、
 * `parseLog` から独立させている。
 */

/**
 * 略記から、同じ重大度を指す組み込みの長い表記への対応表。
 *
 * 揃えるのは「同じ意味の語が2つある」ものだけに留める。`NOTICE` や `SEVERE` を
 * `INFO` / `ERROR` へ寄せると、元のログに書かれていない語がビューに出て grep と
 * 突き合わせられなくなるため、そのまま残す（#279 と同じ考え方）。
 */
const SEVERITY_ALIASES: Record<string, string | undefined> = {
  WARNING: "WARN",
  ERR: "ERROR",
  CRIT: "CRITICAL",
};

/** セベリティ名を大文字に揃え、別名を代表表記へ寄せる。 */
export function normalizeSeverity(token: string): string {
  const upper = token.toUpperCase();
  return SEVERITY_ALIASES[upper] ?? upper;
}
