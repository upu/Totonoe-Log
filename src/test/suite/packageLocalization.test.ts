import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

interface ConfigurationNode {
  description?: string;
  markdownDescription?: string;
  items?: ConfigurationNode;
  properties?: Record<string, ConfigurationNode>;
}

interface ExtensionManifest {
  displayName: string;
  description: string;
  l10n?: string;
  contributes: {
    commands: Array<{ title: string }>;
    configuration: {
      title: string;
      properties: Record<string, ConfigurationNode>;
    };
  };
}

const EXTENSION_ROOT = path.resolve(__dirname, "../../..");
const EXTENSION_HOST_SOURCE_ROOT = path.join(EXTENSION_ROOT, "src");
const WEBVIEW_MAIN_SOURCE_PATH = path.join(
  EXTENSION_ROOT,
  "src",
  "webview",
  "interactiveView",
  "main.ts"
);
const NORMALIZE_SOURCE_ROOT = path.join(EXTENSION_ROOT, "src", "normalize");
const INTERACTIVE_VIEW_HTML_SOURCE_PATH = path.join(EXTENSION_ROOT, "src", "interactiveViewHtml.ts");
const EXCLUDED_TOP_LEVEL_DIRECTORIES = new Set(["normalize", "test", "webview"]);
const EXCLUDED_TOP_LEVEL_FILES = new Set<string>();
const JAPANESE_CHARACTER_PATTERN = /[぀-ヿ㐀-鿿]/u;
/**
 * normalize 層の出力に許さない文字（issue #279）。日本語に加えて、本文の安定性の
 * ために ASCII へ寄せた記号も見る——`×`（U+00D7）と波ダッシュ / 全角チルダは
 * 日本語の文字範囲に入らないため、`JAPANESE_CHARACTER_PATTERN` だけでは
 * 出戻りを検出できない。
 */
const NON_PORTABLE_CHARACTER_PATTERN = /[぀-ヿ㐀-鿿×〜～]/u;

function readJson(fileName: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, fileName), "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isConfigurationNode(value: unknown): value is ConfigurationNode {
  if (!isRecord(value)) {
    return false;
  }

  if (
    (value.description !== undefined && typeof value.description !== "string") ||
    (value.markdownDescription !== undefined && typeof value.markdownDescription !== "string") ||
    (value.items !== undefined && !isConfigurationNode(value.items))
  ) {
    return false;
  }

  return (
    value.properties === undefined ||
    (isRecord(value.properties) && Object.values(value.properties).every(isConfigurationNode))
  );
}

function isExtensionManifest(value: unknown): value is ExtensionManifest {
  if (
    !isRecord(value) ||
    typeof value.displayName !== "string" ||
    typeof value.description !== "string" ||
    (value.l10n !== undefined && typeof value.l10n !== "string") ||
    !isRecord(value.contributes)
  ) {
    return false;
  }

  const { commands, configuration } = value.contributes;
  return (
    Array.isArray(commands) &&
    commands.every((command) => isRecord(command) && typeof command.title === "string") &&
    isRecord(configuration) &&
    typeof configuration.title === "string" &&
    isRecord(configuration.properties) &&
    Object.values(configuration.properties).every(isConfigurationNode)
  );
}

function readExtensionManifest(fileName: string): ExtensionManifest {
  const manifest = readJson(fileName);
  assert.ok(isExtensionManifest(manifest), `${fileName} should be a valid extension manifest`);
  return manifest;
}

function readStringRecord(fileName: string): Record<string, string> {
  const translations = readJson(fileName);
  assert.ok(isStringRecord(translations), `${fileName} should be a string-to-string JSON object`);
  return translations;
}

function collectConfigurationDescriptions(node: ConfigurationNode): string[] {
  const descriptions = [node.description, node.markdownDescription].filter(
    (value): value is string => value !== undefined
  );
  for (const child of Object.values(node.properties ?? {})) {
    descriptions.push(...collectConfigurationDescriptions(child));
  }
  if (node.items !== undefined) {
    descriptions.push(...collectConfigurationDescriptions(node.items));
  }
  return descriptions;
}

function localizationKey(value: string): string {
  const match = /^%([^%]+)%$/.exec(value);
  assert.ok(match, `manifest value should be a single localization placeholder: ${value}`);
  return match[1];
}

function isVscodeL10nCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  const l10nAccess = node.expression.expression;
  return (
    node.expression.name.text === "t" &&
    ts.isPropertyAccessExpression(l10nAccess) &&
    l10nAccess.name.text === "l10n" &&
    ts.isIdentifier(l10nAccess.expression) &&
    l10nAccess.expression.text === "vscode"
  );
}

function collectExtensionHostSourceFiles(directory = EXTENSION_HOST_SOURCE_ROOT): string[] {
  const sourceFiles: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const isTopLevel = directory === EXTENSION_HOST_SOURCE_ROOT;
    if (
      isTopLevel &&
      ((entry.isDirectory() && EXCLUDED_TOP_LEVEL_DIRECTORIES.has(entry.name)) ||
        (entry.isFile() && EXCLUDED_TOP_LEVEL_FILES.has(entry.name)))
    ) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles.push(...collectExtensionHostSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sourceFiles.push(entryPath);
    }
  }
  return sourceFiles.sort();
}

function collectRuntimeLocalizationKeys(): string[] {
  const keys = new Set<string>();
  for (const filePath of collectExtensionHostSourceFiles()) {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (isVscodeL10nCall(node)) {
        const keyNode = node.arguments.length > 0 ? node.arguments[0] : undefined;
        assert.ok(
          keyNode !== undefined &&
            (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)),
          `${path.relative(EXTENSION_ROOT, filePath)} must pass a literal directly to vscode.l10n.t`
        );
        keys.add(keyNode.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return [...keys].sort();
}

function collectMatchingStringLiterals(filePath: string, pattern: RegExp): string[] {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      pattern.test(node.text)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      matches.push(`${path.relative(EXTENSION_ROOT, filePath)}:${String(line + 1)}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function collectJapaneseStringLiterals(filePath: string): string[] {
  return collectMatchingStringLiterals(filePath, JAPANESE_CHARACTER_PATTERN);
}

function collectNormalizeSourceFiles(directory = NORMALIZE_SOURCE_ROOT): string[] {
  const sourceFiles: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles.push(...collectNormalizeSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sourceFiles.push(entryPath);
    }
  }
  return sourceFiles.sort();
}

/**
 * HTML コメントと CSS のブロックコメントを、同じ長さの空白へ潰す。消さずに
 * 置き換えるのは、残った文字の位置がソース上の位置とずれず、報告する行番号が
 * そのまま使えるようにするため。
 */
function blankMarkupComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " ")
  );
}

/**
 * Unicode エスケープを実際の文字へ戻す。元のエスケープと同じ長さになるよう
 * 右を空白で埋めるのは、`blankMarkupComments` と同じく位置を保つため。
 *
 * ソースの見た目のまま探すとエスケープで書いた日本語をすり抜けるので、
 * `eslint.config.mjs` が `TemplateElement` の `value.cooked`（エスケープ解決後）を
 * 見ているのに合わせる。
 */
function decodeUnicodeEscapes(value: string): string {
  return value.replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g,
    (escape, braced: string | undefined, plain: string | undefined) =>
      String.fromCodePoint(Number.parseInt(braced ?? plain ?? "", 16)).padEnd(escape.length, " ")
  );
}

/**
 * `src/interactiveViewHtml.ts` の文字列（テンプレート含む）から、HTML/CSS の
 * コメントを除いた部分に残る日本語を拾う。
 */
function collectJapaneseHtmlDocumentText(): string[] {
  const sourceText = fs.readFileSync(INTERACTIVE_VIEW_HTML_SOURCE_PATH, "utf8");
  const sourceFile = ts.createSourceFile(
    INTERACTIVE_VIEW_HTML_SOURCE_PATH,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    const isTemplate = ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node);
    if (isTemplate || ts.isStringLiteral(node)) {
      const start = node.getStart(sourceFile);
      // コメントを先に潰してから復号する。コメントの中のエスケープを
      // 数え直しても意味がないため。
      const withoutComments = decodeUnicodeEscapes(blankMarkupComments(node.getText(sourceFile)));
      const index = withoutComments.search(JAPANESE_CHARACTER_PATTERN);
      if (index !== -1) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(start + index);
        matches.push(
          `${path.relative(EXTENSION_ROOT, INTERACTIVE_VIEW_HTML_SOURCE_PATH)}:${String(line + 1)}: ` +
            withoutComments.slice(index, index + 60).trim()
        );
      }
      // ネストしたテンプレートは外側の getText に含まれているので、二重に
      // 数えないようここで打ち切る。
      if (isTemplate) {
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function positionalPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
}

suite("Package localization", () => {
  test("keeps the manifest placeholders and English/Japanese bundles in sync", () => {
    const manifest = readExtensionManifest("package.json");
    const english = readStringRecord("package.nls.json");
    const japanese = readStringRecord("package.nls.ja.json");
    const manifestValues = [
      manifest.displayName,
      manifest.description,
      ...manifest.contributes.commands.map((command) => command.title),
      ...Object.values(manifest.contributes.configuration.properties).flatMap((property) =>
        collectConfigurationDescriptions(property)
      ),
    ];
    const referencedKeys = manifestValues.map(localizationKey).sort();
    const englishKeys = Object.keys(english).sort();
    const japaneseKeys = Object.keys(japanese).sort();

    assert.strictEqual(manifest.contributes.configuration.title, "Totonoe Log");
    assert.strictEqual(referencedKeys.length, 30, "all in-scope manifest strings should be localized");
    assert.deepStrictEqual(englishKeys, japaneseKeys, "English and Japanese keys should match");
    assert.deepStrictEqual(
      referencedKeys,
      englishKeys,
      "every localization key should be referenced exactly once"
    );
  });

  test("keeps Japanese UI literals out of the Webview script (#278)", () => {
    assert.deepStrictEqual(
      collectJapaneseStringLiterals(WEBVIEW_MAIN_SOURCE_PATH),
      [],
      "Webview UI text should come from the localized labels sent by the extension host"
    );
  });

  test("keeps language-dependent literals out of the normalize layer (#279)", () => {
    // `src/normalize/` は VSCode API に依存できない（AGENTS.md）ため、ここに
    // 文言が残っていると `vscode.l10n.t()` で訳す手立てが無い。整形結果の本文は
    // 英語固定、設定バリデーションはメッセージコードを返す方針（#279）の担保。
    assert.deepStrictEqual(
      collectNormalizeSourceFiles().flatMap((filePath) =>
        collectMatchingStringLiterals(filePath, NON_PORTABLE_CHARACTER_PATTERN)
      ),
      [],
      "normalize layer output should be language-independent"
    );
  });

  test("keeps Japanese out of the Webview document text, comments aside (#281)", () => {
    // このファイルだけは eslint.config.mjs の no-restricted-syntax から
    // TemplateElement を外している——HTML/CSS の文書をテンプレートリテラルで
    // 組み立てており、その中の日本語は全て `<!-- -->` / ブロックコメントだが、
    // ESLint のセレクタからは本文と区別が付かないため。外した分の穴を、
    // コメントを空白へ潰してから見るこのテストで塞ぐ。
    assert.deepStrictEqual(
      collectJapaneseHtmlDocumentText(),
      [],
      "Webview document text should come from the localized labels, not literals"
    );
  });

  test("keeps extension-host runtime messages and the Japanese bundle in sync", () => {
    const manifest = readExtensionManifest("package.json");
    const japanese = readStringRecord("l10n/bundle.l10n.ja.json");
    const sourceKeys = collectRuntimeLocalizationKeys();
    const japaneseKeys = Object.keys(japanese).sort();

    assert.strictEqual(manifest.l10n, "./l10n");
    assert.ok(sourceKeys.length > 0, "extension-host source should contain runtime localization keys");
    assert.deepStrictEqual(
      sourceKeys,
      japaneseKeys,
      "every direct runtime localization key should have exactly one Japanese translation"
    );
    for (const key of sourceKeys) {
      assert.deepStrictEqual(
        positionalPlaceholders(key),
        positionalPlaceholders(japanese[key]),
        `positional placeholders should match for: ${key}`
      );
    }
  });
});
