/**
 * キー名から「その値だけ」を狙う正規表現を組み立てる（issue #212）。
 *
 * #195 で任意パターン欄を入れたが、`user=\w+` と書くと `user=` ごと伏せられて
 * しまい、キーを残すには `(?<=user=)\w+` と後読みで書く必要があった。ログの
 * 多くは `key=value` 形式なので、キー名を挙げるだけで済む入口を用意して、
 * 正規表現を書けなくても値を伏せられるようにする。
 */

/** キー欄の区切り（カンマと空白のどちらでも書ける）。 */
const KEY_SEPARATOR_REGEX = /[,\s]+/;

/**
 * 値の終わりとみなす文字。区切り記号で止めることで、`user=hoge, id=3` の
 * `, id=3` まで巻き込まずに済む。
 */
const VALUE_TERMINATORS = "\\s,;)\\]}\"'";

/** 正規表現のメタ文字を打ち消す。キー名はリテラルとして扱う（`a.b` が `axb` に当たらないように）。 */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * キー欄の入力文字列から、値の位置だけに一致する正規表現を作る。
 * 一致するのは値そのものだけなので、{@link maskEntriesByPatterns} の
 * 「一致箇所をプレースホルダーに置き換える」処理にそのまま渡せる
 * （キー名・区切り・クォートは一致に含まれないため残る）。
 *
 * キーの直前を `\b` ではなく `(?<![\w.-])` で判定しているのは2つの理由から——
 * `\b` は ASCII の単語文字を前提にしているため `契約ID` のような非ASCIIの
 * キー名では働かず、また `superuser=x` の中の `user` や `order.id=42` の中の
 * `id` を拾わないためには `.` と `-` も境界として扱う必要がある。
 *
 * 値の候補はクォート内を先に並べる。先に「区切りまでの連続」を試すと、
 * `token="abc 123"` の空白で切れて閉じクォートが残ってしまうため。
 */
export function buildKeyMaskPattern(keysInput: string): RegExp | undefined {
  const keys = keysInput
    .split(KEY_SEPARATOR_REGEX)
    .map((key) => key.trim())
    .filter((key) => key !== "");
  if (keys.length === 0) {
    return undefined;
  }

  const keyAlternatives = keys.map(escapeForRegExp).join("|");
  // 区切りの後の空白は `:` の場合だけ許す。`=` でも許すと、値が空のキーに続く
  // 別の語（`user= and user:` の `and`）を値と取り違えてしまう——字面だけでは
  // 「空白を挟んだ値」と区別できないため、慣習（logfmt の `key=value` は詰めて
  // 書き、`key: value` は空白を挟む）に合わせて誤マスクしない側に倒す。
  const afterKey = `(?<=(?<![\\w.-])(?:${keyAlternatives})\\s*(?:=|:\\s*)`;

  return new RegExp(
    [
      `${afterKey}")[^"\\n]+(?=")`,
      `${afterKey}')[^'\\n]+(?=')`,
      `${afterKey})[^${VALUE_TERMINATORS}]+`,
    ].join("|"),
    "gi"
  );
}
