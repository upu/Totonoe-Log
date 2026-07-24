const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Emits the markers the tasks.json `$esbuild` background problem matcher waits
// for, so F5 knows when the first watch build has finished.
const problemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[watch] build started"));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

// 拡張機能本体（Node実行、vscodeモジュールは外部化）と、Webview側スクリプト
// （ブラウザ実行、vscodeモジュールへの依存を持たせない）の2つを別々にビルド
// する。後者に `external: ["vscode"]` を付けないのは、Webview側コードが
// 誤って拡張機能本体側のモジュール（vscode依存）をimportした場合に、ビルド
// エラーとして検出させるため（issue #166）。
const buildConfigs = [
  {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "out/extension.js",
    external: ["vscode"],
    minify: production,
    sourcemap: production ? "external" : true,
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  },
  {
    entryPoints: ["src/webview/interactiveView/main.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    outfile: "out/webview/interactiveView/main.js",
    minify: production,
    sourcemap: production ? "external" : true,
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  },
];

async function main() {
  const contexts = await Promise.all(buildConfigs.map((config) => esbuild.context(config)));
  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
