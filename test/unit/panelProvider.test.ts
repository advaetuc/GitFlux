import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      inspect: vi.fn(),
    })),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  Uri: {
    file: (f: string) => ({ fsPath: f, scheme: "file" }),
    joinPath: (_base: unknown, ...segments: string[]) => ({
      fsPath: "/" + segments.join("/"),
      toString: () => "/" + segments.join("/"),
    }),
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
    })),
    createTerminal: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  env: {
    shell: "/bin/bash",
    clipboard: {
      writeText: vi.fn(),
    },
  },
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn(),
  },
}));

import { resolveEffectiveShell } from "../../src/host/panelProvider";

describe("panelProvider shell resolution (§8.3)", () => {
  it("uses draft shell override when not auto", () => {
    expect(resolveEffectiveShell("fish", "bash", "zsh")).toBe("fish");
    expect(resolveEffectiveShell("cmd", "auto", "unsupported")).toBe("cmd");
  });

  it("falls back to config shell when draft is auto", () => {
    expect(resolveEffectiveShell("auto", "pwsh", "zsh")).toBe("pwsh");
    expect(resolveEffectiveShell("auto", "sh", "unsupported")).toBe("sh");
  });

  it("falls back to detected shell when draft and config are auto", () => {
    expect(resolveEffectiveShell("auto", "auto", "zsh")).toBe("zsh");
    expect(resolveEffectiveShell("auto", "auto", "bash")).toBe("bash");
  });

  it("returns none when all are auto/unsupported", () => {
    expect(resolveEffectiveShell("auto", "auto", "unsupported")).toBe("none");
  });
});
