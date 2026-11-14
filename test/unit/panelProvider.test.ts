import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetGitApi } = vi.hoisted(() => ({
  mockGetGitApi: vi.fn(),
}));

vi.mock("../../src/host/gitApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/host/gitApi")>();
  return {
    ...actual,
    getGitApi: mockGetGitApi,
  };
});

vi.mock("../../src/host/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/host/runner")>();
  return {
    ...actual,
    runGit: vi.fn().mockImplementation((_gitPath: string, argv: readonly string[]) => {
      if (argv[0] === "--version") {
        return Promise.resolve({ stdout: "git version 2.40.0\n", stderr: "", code: 0 });
      }
      if (argv[0] === "config") {
        return Promise.resolve({ stdout: "user@example.com\n", stderr: "", code: 0 });
      }
      if (argv[0] === "log") {
        return Promise.resolve({ stdout: "1772625600\n", stderr: "", code: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", code: 0 });
    }),
  };
});

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      inspect: vi.fn(),
    })),
    workspaceFolders: [],
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

import * as vscode from "vscode";
import { resolveEffectiveShell, CommitPanelProvider } from "../../src/host/panelProvider";
import type { HostToWebview } from "../../src/shared/protocol";

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

describe("CommitPanelProvider webview handshake & debounce", () => {
  type StateListener = () => void;
  const repoPath = "/workspace/test-repo";

  const createMockGit = () => {
    let stateListeners: StateListener[] = [];
    const stateDidChange = (listener: StateListener) => {
      stateListeners.push(listener);
      return {
        dispose: () => {
          stateListeners = stateListeners.filter((l) => l !== listener);
        },
      };
    };

    const repo = {
      rootUri: vscode.Uri.file(repoPath),
      state: {
        HEAD: { name: "main", commit: "1234567890abcdef" },
        indexChanges: [],
        workingTreeChanges: [],
        mergeChanges: [],
        remotes: [{ name: "origin" }],
        submodules: [],
        rebaseCommit: undefined,
        onDidChange: stateDidChange,
      },
      getCommit: vi.fn().mockResolvedValue({
        hash: "1234567890abcdef",
        commitDate: new Date("2024-01-01T00:00:00Z"),
      }),
    };

    const gitApi = {
      git: { path: "git" },
      repositories: [repo],
      onDidChangeState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidOpenRepository: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCloseRepository: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      getRepository: vi.fn((uri: { fsPath: string }) =>
        uri.fsPath.startsWith(repoPath) ? repo : undefined,
      ),
      openRepository: vi.fn(),
    };

    return {
      gitApi,
      repo,
      triggerStateChange: () => {
        for (const l of stateListeners) l();
      },
    };
  };

  const createMockWebviewView = () => {
    const messages: HostToWebview[] = [];
    let messageHandler: ((msg: unknown) => Promise<void>) | undefined;
    let disposeHandler: (() => void) | undefined;

    const webview = {
      options: {},
      html: "",
      asWebviewUri: vi.fn((u: unknown) => u),
      cspSource: "https://mock.csp",
      postMessage: vi.fn((msg: HostToWebview) => {
        messages.push(msg);
        return Promise.resolve(true);
      }),
      onDidReceiveMessage: vi.fn((handler: (msg: unknown) => Promise<void>) => {
        messageHandler = handler;
        return { dispose: vi.fn() };
      }),
    };

    const view = {
      webview,
      onDidDispose: vi.fn((handler: () => void) => {
        disposeHandler = handler;
        return { dispose: vi.fn() };
      }),
      visible: true,
    };

    return {
      view,
      messages,
      sendMessage: async (msg: unknown) => {
        if (messageHandler) await messageHandler(msg);
      },
      dispose: () => {
        if (disposeHandler) disposeHandler();
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles selection BEFORE webview is ready (queues pending preselect, sends on ready)", async () => {
    const mockGit = createMockGit();
    mockGetGitApi.mockResolvedValue(mockGit.gitApi);

    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new CommitPanelProvider(vscode.Uri.file("/ext"), outputChannel);

    const mockView = createMockWebviewView();
    // Resolve webview (webviewReady is initially false)
    await provider.resolveWebviewView(
      mockView.view as unknown as vscode.WebviewView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );

    // Call handleSelection with a file before webview sends "ready"
    await provider.handleSelection([vscode.Uri.file(`${repoPath}/src/foo.ts`)]);

    // Should NOT have sent preselect yet because webview is not ready
    expect(mockView.messages.some((m) => m.type === "preselect")).toBe(false);

    // Now webview sends "ready"
    await mockView.sendMessage({ type: "ready", protocolVersion: 1 });

    // Should have sent init, then snapshot, then preselect
    const msgTypes = mockView.messages.map((m) => m.type);
    expect(msgTypes).toContain("init");
    expect(msgTypes).toContain("snapshot");
    expect(msgTypes).toContain("preselect");

    const preselectMsg = mockView.messages.find((m) => m.type === "preselect");
    expect(preselectMsg).toEqual({
      type: "preselect",
      repoId: repoPath,
      paths: ["src/foo.ts"],
      droppedCount: 0,
    });

    provider.dispose();
  });

  it("handles selection AFTER webview is ready (immediately posts snapshot and preselect)", async () => {
    const mockGit = createMockGit();
    mockGetGitApi.mockResolvedValue(mockGit.gitApi);

    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new CommitPanelProvider(vscode.Uri.file("/ext"), outputChannel);

    const mockView = createMockWebviewView();
    await provider.resolveWebviewView(
      mockView.view as unknown as vscode.WebviewView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );

    // Send "ready" first
    await mockView.sendMessage({ type: "ready", protocolVersion: 1 });
    mockView.messages.length = 0; // Clear messages

    // Now call handleSelection
    await provider.handleSelection([vscode.Uri.file(`${repoPath}/src/bar.ts`)]);

    // Immediately posted snapshot and preselect
    const msgTypes = mockView.messages.map((m) => m.type);
    expect(msgTypes).toContain("snapshot");
    expect(msgTypes).toContain("preselect");

    const preselectMsg = mockView.messages.find((m) => m.type === "preselect");
    expect(preselectMsg).toEqual({
      type: "preselect",
      repoId: repoPath,
      paths: ["src/bar.ts"],
      droppedCount: 0,
    });

    provider.dispose();
  });

  it("debounces repo.state.onDidChange by 250ms", async () => {
    vi.useFakeTimers();

    const mockGit = createMockGit();
    mockGetGitApi.mockResolvedValue(mockGit.gitApi);

    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new CommitPanelProvider(vscode.Uri.file("/ext"), outputChannel);

    const mockView = createMockWebviewView();
    await provider.resolveWebviewView(
      mockView.view as unknown as vscode.WebviewView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );

    // Send "ready"
    await mockView.sendMessage({ type: "ready", protocolVersion: 1 });
    mockView.messages.length = 0;

    // Fire 3 change events within 100ms
    mockGit.triggerStateChange();
    vi.advanceTimersByTime(50);
    mockGit.triggerStateChange();
    vi.advanceTimersByTime(50);
    mockGit.triggerStateChange();

    // No snapshot should be posted yet (within 250ms debounce)
    expect(mockView.messages.filter((m) => m.type === "snapshot")).toHaveLength(0);

    // Advance 250ms past last event
    await vi.advanceTimersByTimeAsync(250);

    // Now exactly 1 snapshot should be posted
    expect(mockView.messages.filter((m) => m.type === "snapshot")).toHaveLength(1);

    provider.dispose();
  });

  it("dispatches init before activity on ready", async () => {
    vi.useRealTimers();
    const mockGit = createMockGit();
    mockGetGitApi.mockResolvedValue(mockGit.gitApi);

    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new CommitPanelProvider(vscode.Uri.file("/ext"), outputChannel);

    const mockView = createMockWebviewView();
    await provider.resolveWebviewView(
      mockView.view as unknown as vscode.WebviewView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );

    // Send "ready"
    await mockView.sendMessage({ type: "ready", protocolVersion: 1 });

    // Wait for fire-and-forget pushActivity
    await new Promise((resolve) => setTimeout(resolve, 50));

    const msgTypes = mockView.messages.map((m) => m.type);
    expect(msgTypes).toContain("init");
    expect(msgTypes).toContain("activity");

    const initIndex = msgTypes.indexOf("init");
    const activityIndex = msgTypes.indexOf("activity");
    expect(initIndex).toBeLessThan(activityIndex);

    provider.dispose();
  });

  it("dispatches activity on selectRepo", async () => {
    vi.useRealTimers();
    const mockGit = createMockGit();
    mockGetGitApi.mockResolvedValue(mockGit.gitApi);

    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new CommitPanelProvider(vscode.Uri.file("/ext"), outputChannel);

    const mockView = createMockWebviewView();
    await provider.resolveWebviewView(
      mockView.view as unknown as vscode.WebviewView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );

    await mockView.sendMessage({ type: "ready", protocolVersion: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockView.messages.length = 0; // Clear messages

    // Send "selectRepo"
    await mockView.sendMessage({ type: "selectRepo", repoId: repoPath });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const msgTypes = mockView.messages.map((m) => m.type);
    expect(msgTypes).toContain("snapshot");
    expect(msgTypes).toContain("activity");

    const activityMsg = mockView.messages.find((m) => m.type === "activity");
    expect(activityMsg).toMatchObject({
      type: "activity",
      repoId: repoPath,
    });

    provider.dispose();
  });
});
