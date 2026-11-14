import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

// Ensure @typescript-eslint never infers single-run mode in test environments
// where ESLint programmatic lintText() evaluates in-memory snippets.
process.env.TSESTREE_SINGLE_RUN = "false";

describe("Architecture Fitness Rules (AM-09 & Blueprint §5.2)", () => {
  const projectRoot = path.resolve(__dirname, "../../");
  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: path.resolve(projectRoot, "eslint.config.mjs"),
  });

  async function lint(code: string, filePath: string) {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
    const results = await eslint.lintText(code, { filePath: resolvedPath });
    return results[0]?.messages ?? [];
  }

  function assertRestrictedImport(
    messages: Array<{ ruleId: string | null; message: string }>,
    desc: string,
  ): void {
    const hasRestricted = messages.some((m) => m.ruleId === "no-restricted-imports");
    if (!hasRestricted) {
      console.error(`[lint-fitness failure] Expected no-restricted-imports for ${desc}, got:`, JSON.stringify(messages, null, 2));
    }
    expect(hasRestricted, `Expected no-restricted-imports for ${desc}`).toBe(true);
  }

  describe("src/core/** restrictions", () => {
    it("blocks import from vscode", async () => {
      const messages = await lint('import "vscode";\n', "src/core/path.ts");
      assertRestrictedImport(messages, 'import "vscode" in src/core/path.ts');
    });

    it("blocks import from child_process in core", async () => {
      const messages = await lint('import "child_process";\n', "src/core/path.ts");
      assertRestrictedImport(messages, 'import "child_process" in src/core/path.ts');
    });

    it("blocks import from node:* built-in", async () => {
      const messages = await lint('import "node:fs";\n', "src/core/path.ts");
      assertRestrictedImport(messages, 'import "node:fs" in src/core/path.ts');
    });

    it("blocks import from bare Node built-in", async () => {
      const messages = await lint('import "fs";\n', "src/core/path.ts");
      assertRestrictedImport(messages, 'import "fs" in src/core/path.ts');
    });

    it("blocks imports from outside src/core", async () => {
      const messages = await lint('import "../shared/protocol";\n', "src/core/path.ts");
      assertRestrictedImport(messages, 'import "../shared/protocol" in src/core/path.ts');
    });

    it("blocks restricted globals in core", async () => {
      const globals = [
        "process",
        "Buffer",
        "window",
        "document",
        "navigator",
        "setTimeout",
        "setInterval",
        "fetch",
      ];
      for (const g of globals) {
        const code = `const val = typeof ${g};\nexport { val };\n`;
        const messages = await lint(code, "src/core/path.ts");
        expect(
          messages.some((m) => m.ruleId === "no-restricted-globals" && m.message.includes(g)),
          `Expected global ${g} to be restricted`,
        ).toBe(true);
      }
    });
  });

  describe("src/webview/** restrictions", () => {
    it("blocks vscode imports", async () => {
      const messages = await lint('import "vscode";\n', "src/webview/main.tsx");
      assertRestrictedImport(messages, 'import "vscode" in src/webview/main.tsx');
    });

    it("blocks child_process in webview", async () => {
      const messages = await lint('import "child_process";\n', "src/webview/main.tsx");
      assertRestrictedImport(messages, 'import "child_process" in src/webview/main.tsx');
    });

    it("blocks node built-ins", async () => {
      const messages = await lint('import "fs";\n', "src/webview/main.tsx");
      assertRestrictedImport(messages, 'import "fs" in src/webview/main.tsx');
    });

    it("blocks imports from host", async () => {
      const messages = await lint('import "../host/runner";\n', "src/webview/main.tsx");
      assertRestrictedImport(messages, 'import "../host/runner" in src/webview/main.tsx');
    });

    it("blocks innerHTML assignment", async () => {
      const code = 'const el: Record<string, unknown> = {}; el.innerHTML = "foo";\n';
      const messages = await lint(code, "src/webview/main.tsx");
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-syntax" && m.message.includes("innerHTML"),
        ),
      ).toBe(true);
    });

    it("blocks outerHTML assignment", async () => {
      const code = 'const el: Record<string, unknown> = {}; el.outerHTML = "foo";\n';
      const messages = await lint(code, "src/webview/main.tsx");
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-syntax" && m.message.includes("outerHTML"),
        ),
      ).toBe(true);
    });

    it("blocks dangerouslySetInnerHTML in JSX", async () => {
      const code = 'export function Comp() { return <div dangerouslySetInnerHTML={{ __html: "" }} />; }\n';
      const messages = await lint(code, "src/webview/main.tsx");
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-syntax" && m.message.includes("dangerouslySetInnerHTML"),
        ),
      ).toBe(true);
    });

    it("blocks eval", async () => {
      const code = 'const fn = eval("1 + 1");\nexport { fn };\n';
      const messages = await lint(code, "src/webview/main.tsx");
      expect(
        messages.some((m) => m.ruleId === "no-restricted-syntax" && m.message.includes("eval")),
      ).toBe(true);
    });

    it("blocks new Function", async () => {
      const code = 'const fn = new Function("return 1");\nexport { fn };\n';
      const messages = await lint(code, "src/webview/main.tsx");
      expect(
        messages.some((m) => m.ruleId === "no-restricted-syntax" && m.message.includes("Function")),
      ).toBe(true);
    });

    it("blocks inline style attribute in JSX", async () => {
      const code = 'export function Comp() { return <div style={{ color: "red" }} />; }\n';
      const messages = await lint(code, "src/webview/main.tsx");
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-syntax" && m.message.includes("style"),
        ),
      ).toBe(true);
    });
  });

  describe("child_process isolation", () => {
    it("blocks child_process in host files other than runner.ts", async () => {
      const messages = await lint('import "child_process";\n', "src/host/extension.ts");
      assertRestrictedImport(messages, 'import "child_process" in src/host/extension.ts');
    });

    it("allows child_process in runner.ts", async () => {
      const messages = await lint('import "child_process";\n', "src/host/runner.ts");
      expect(messages.filter((m) => m.ruleId === "no-restricted-imports")).toHaveLength(0);
    });
  });

  describe("sendText isolation", () => {
    it("blocks sendText outside terminal.ts", async () => {
      const code = 'const term: { sendText: (s: string) => void } = { sendText: () => {} }; term.sendText("test");\n';
      const messages = await lint(code, "src/host/extension.ts");
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-syntax" && m.message.includes("sendText"),
        ),
      ).toBe(true);
    });

    it("allows sendText in terminal.ts", async () => {
      const code = 'const term: { sendText: (s: string) => void } = { sendText: () => {} }; term.sendText("test");\n';
      const messages = await lint(code, "src/host/terminal.ts");
      expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(0);
    });
  });
});
