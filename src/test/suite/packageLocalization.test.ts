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
const EXCLUDED_TOP_LEVEL_DIRECTORIES = new Set(["normalize", "test", "webview"]);
const EXCLUDED_TOP_LEVEL_FILES = new Set<string>();
const JAPANESE_CHARACTER_PATTERN = /[぀-ヿ㐀-鿿]/u;

function readJson<T>(fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, fileName), "utf8")) as T;
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
        const [keyNode] = node.arguments;
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

function collectJapaneseStringLiterals(filePath: string): string[] {
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
      JAPANESE_CHARACTER_PATTERN.test(node.text)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      matches.push(`${path.relative(EXTENSION_ROOT, filePath)}:${line + 1}: ${node.text}`);
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
    const manifest = readJson<ExtensionManifest>("package.json");
    const english = readJson<Record<string, string>>("package.nls.json");
    const japanese = readJson<Record<string, string>>("package.nls.ja.json");
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

  test("keeps extension-host runtime messages and the Japanese bundle in sync", () => {
    const manifest = readJson<ExtensionManifest>("package.json");
    const japanese = readJson<Record<string, string>>("l10n/bundle.l10n.ja.json");
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
