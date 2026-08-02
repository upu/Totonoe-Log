import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

interface ConfigurationNode {
  description?: string;
  markdownDescription?: string;
  items?: ConfigurationNode;
  properties?: Record<string, ConfigurationNode>;
}

interface ExtensionManifest {
  displayName: string;
  description: string;
  contributes: {
    commands: Array<{ title: string }>;
    configuration: {
      title: string;
      properties: Record<string, ConfigurationNode>;
    };
  };
}

const EXTENSION_ROOT = path.resolve(__dirname, "../../..");

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
});
