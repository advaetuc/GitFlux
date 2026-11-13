import { defineConfig } from "@vscode/test-cli";

export default defineConfig([
  {
    label: "integration-tests-1.90",
    files: "out/test/integration/**/*.test.js",
    version: "1.90.0",
    mocha: {
      ui: "tdd",
      timeout: 20000,
    },
  },
  {
    label: "integration-tests-stable",
    files: "out/test/integration/**/*.test.js",
    version: "stable",
    mocha: {
      ui: "tdd",
      timeout: 20000,
    },
  },
]);
