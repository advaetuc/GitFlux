import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendText = vi.fn();
const mockShow = vi.fn();
let mockInspectReturn: { globalValue?: boolean; defaultValue?: boolean; workspaceValue?: boolean } = {};

vi.mock("vscode", () => ({
  window: {
    createTerminal: vi.fn((opts: { name: string; cwd: string }) => ({
      name: opts.name,
      cwd: opts.cwd,
      show: mockShow,
      sendText: mockSendText,
      exitStatus: undefined,
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      inspect: vi.fn(() => mockInspectReturn),
    })),
  },
}));

import * as vscode from "vscode";
import {
  getOrCreateTerminal,
  handleTerminalClosed,
  getEffectiveAutoRun,
  sendCommandToTerminal,
  resetTerminals,
} from "../../src/host/terminal";

describe("terminal service (Phase 4)", () => {
  beforeEach(() => {
    resetTerminals();
    vi.clearAllMocks();
    mockInspectReturn = {};
  });

  it("creates dedicated terminal per repo named from ids.ts", () => {
    const term = getOrCreateTerminal("repo-1", "my-repo", "/workspace/my-repo");
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: "Commit With Custom Date: my-repo",
      cwd: "/workspace/my-repo",
    });
    expect(term.name).toBe("Commit With Custom Date: my-repo");
  });

  it("reuses terminal while alive and cleans up on close", () => {
    const term1 = getOrCreateTerminal("repo-1", "my-repo", "/workspace/my-repo");
    const term2 = getOrCreateTerminal("repo-1", "my-repo", "/workspace/my-repo");
    expect(term1).toBe(term2);
    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1);

    // Simulate close
    handleTerminalClosed(term1);

    // After close, a new terminal is created
    const term3 = getOrCreateTerminal("repo-1", "my-repo", "/workspace/my-repo");
    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2);
    expect(term3).toBeDefined();
  });

  it("enforces terminal.autoRun application scope (ignores workspace overrides)", () => {
    // Case 1: Default false
    mockInspectReturn = { defaultValue: false };
    expect(getEffectiveAutoRun()).toBe(false);

    // Case 2: Workspace setting tries to set true (ignored)
    mockInspectReturn = { defaultValue: false, workspaceValue: true };
    expect(getEffectiveAutoRun()).toBe(false);

    // Case 3: Global (application/user) setting sets true (respected)
    mockInspectReturn = { defaultValue: false, workspaceValue: false, globalValue: true };
    expect(getEffectiveAutoRun()).toBe(true);
  });

  it("sends command line to terminal and shows it", () => {
    sendCommandToTerminal("repo-1", "my-repo", "/workspace/my-repo", "git commit -m 'test'", false);
    expect(mockShow).toHaveBeenCalledWith(true);
    expect(mockSendText).toHaveBeenCalledWith("git commit -m 'test'", false);
  });
});
