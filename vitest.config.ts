import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "test/unit/**/*.test.ts", "test/shell-matrix/**/*.test.ts"],
    exclude: ["test/integration/**/*"],
    globals: false,
    testTimeout: 30_000,
  },
});
