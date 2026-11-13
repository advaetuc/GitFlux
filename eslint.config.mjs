// @ts-check
import tseslint from "typescript-eslint";
import { builtinModules } from "node:module";

const bareBuiltins = builtinModules.filter((m) => !m.startsWith("_"));
const nodePrefixed = bareBuiltins.map((m) => `node:${m}`);

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "out/**", "*.mjs", "docs/**"],
  },

  // Base TypeScript config for all source and test files
  ...tseslint.configs.strictTypeChecked.map((cfg) => ({
    ...cfg,
    files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["tsconfig.json", "tsconfig.webview.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── All files except runner.ts: ban child_process ──
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
    ignores: ["src/host/runner.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "child_process", message: "child_process may only be imported in runner.ts." },
            { name: "node:child_process", message: "child_process may only be imported in runner.ts." },
          ],
        },
      ],
    },
  },

  // ── All files except terminal.ts: ban sendText ──
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
    ignores: ["src/host/terminal.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='sendText']",
          message: "sendText may only be called in terminal.ts.",
        },
      ],
    },
  },

  // ── src/core/** ── PURE: no vscode, no node:*, no DOM globals, no imports outside src/core ──
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "vscode", message: "core must not import vscode." },
            { name: "child_process", message: "child_process may only be imported in runner.ts." },
            { name: "node:child_process", message: "child_process may only be imported in runner.ts." },
          ],
          patterns: [
            { group: ["node:*", ...nodePrefixed], message: "core must not import Node built-ins." },
            { group: bareBuiltins, message: "core must not import Node built-ins." },
            { group: ["../*", "../**"], message: "core must not import paths outside src/core." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "process", message: "core must not access process." },
        { name: "Buffer", message: "core must not access Buffer." },
        { name: "window", message: "core must not access window." },
        { name: "document", message: "core must not access document." },
        { name: "navigator", message: "core must not access navigator." },
        { name: "setTimeout", message: "core must not access setTimeout." },
        { name: "setInterval", message: "core must not access setInterval." },
        { name: "fetch", message: "core must not access fetch." },
      ],
    },
  },

  // ── src/webview/** ── allow only preact, codicons, core, shared, webview ──
  {
    files: ["src/webview/**/*.ts", "src/webview/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "vscode", message: "webview must not import vscode." },
            { name: "child_process", message: "child_process may only be imported in runner.ts." },
            { name: "node:child_process", message: "child_process may only be imported in runner.ts." },
          ],
          patterns: [
            { group: ["node:*", ...nodePrefixed], message: "webview must not import Node built-ins." },
            { group: bareBuiltins, message: "webview must not import Node built-ins." },
            { group: ["../host/**", "**/host/**"], message: "webview must not import host." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "AssignmentExpression[left.property.name='innerHTML']", message: "innerHTML is banned in webview." },
        { selector: "AssignmentExpression[left.property.name='outerHTML']", message: "outerHTML is banned in webview." },
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "dangerouslySetInnerHTML is banned." },
        { selector: "CallExpression[callee.name='eval']", message: "eval is banned." },
        { selector: "NewExpression[callee.name='Function']", message: "new Function is banned." },
        { selector: "JSXAttribute[name.name='style']", message: "Inline style attributes are banned; use CSS classes." },
      ],
    },
  },
);
