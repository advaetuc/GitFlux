import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const watch = process.argv.includes("--watch");

// Host bundle: Node, CJS, external vscode
const hostOptions = /** @type {esbuild.BuildOptions} */ ({
  entryPoints: ["src/host/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
});

// Webview bundle: browser, IIFE
const webviewOptions = /** @type {esbuild.BuildOptions} */ ({
  entryPoints: ["src/webview/main.tsx"],
  tsconfig: "tsconfig.webview.json",
  jsx: "automatic",
  jsxImportSource: "preact",
  bundle: true,
  outfile: "dist/webview/main.js",
  platform: "browser",
  target: "es2022",
  format: "iife",
  sourcemap: true,
  minify: !watch,
  loader: { ".css": "css" },
  logLevel: "info",
});

// Copy codicon font to dist/webview/
function copyCodicons() {
  const codiconsDir = resolve("node_modules/@vscode/codicons/dist");
  const destDir = resolve("dist/webview");
  mkdirSync(destDir, { recursive: true });
  for (const file of ["codicon.css", "codicon.ttf"]) {
    const src = resolve(codiconsDir, file);
    if (existsSync(src)) {
      copyFileSync(src, resolve(destDir, file));
    }
  }
}

async function main() {
  copyCodicons();
  if (watch) {
    const hostCtx = await esbuild.context(hostOptions);
    const webviewCtx = await esbuild.context(webviewOptions);
    await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([esbuild.build(hostOptions), esbuild.build(webviewOptions)]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
