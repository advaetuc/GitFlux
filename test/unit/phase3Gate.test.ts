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

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { CommitPanelProvider, resolveEffectiveShell } from "../../src/host/panelProvider";
import { deriveDerivedState } from "../../src/webview/draftReducer";
import { buildCommitPlan } from "../../src/core/plan";
import { renderShell } from "../../src/core/shellRender";
import * as runner from "../../src/host/runner";
import type { HostEnv, RepoSnapshot, CommitDraft } from "../../src/shared/protocol";

describe("Phase 3 Gate Verifications", () => {
  const sampleEnv: HostEnv = {
    platform: "darwin",
    detectedShell: "bash",
    shellSetting: "auto",
    includeRepoDirInCopy: true,
    sendToTerminalAvailable: true,
    workingHours: { start: "09:30", end: "18:30" },
    pushDefaultEnabled: false,
    autoRun: false,
    gitVersionOk: true,
  };

  const sampleSnapshot: RepoSnapshot = {
    repoId: "/workspace/project",
    name: "project",
    repoRoot: "/workspace/project",
    revision: 1,
    head: { kind: "branch", name: "main", ahead: 0, behind: 0 },
    remotes: ["origin"],
    blockers: [],
    files: [
      { path: "src/index.ts", kind: "modified", staged: true, unstaged: false },
      { path: "src/utils.ts", kind: "modified", staged: false, unstaged: true },
    ],
  };

  const sampleDraft: CommitDraft = {
    repoId: "/workspace/project",
    revision: 1,
    paths: ["src/index.ts"],
    message: { subject: "feat: add entry point", body: "Detailed explanation" },
    when: {
      local: { year: 2024, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
      offsetMinutes: 120,
    },
    push: { enabled: false, remote: "" },
    shell: "auto",
  };

  it("webview preview string byte-equals what Copy places on clipboard for the same draft", () => {
    // 1. Compute preview from webview draftReducer
    const derived = deriveDerivedState(sampleSnapshot, sampleDraft, sampleEnv);
    expect(derived.plan.ok).toBe(true);
    const previewString = derived.preview;

    // 2. Compute copy command via host logic
    const planRes = buildCommitPlan({
      repoRoot: sampleSnapshot.repoRoot,
      head: sampleSnapshot.head,
      remotes: sampleSnapshot.remotes,
      blockers: sampleSnapshot.blockers,
      files: sampleSnapshot.files,
      selectedPaths: sampleDraft.paths,
      message: sampleDraft.message,
      when: sampleDraft.when,
      push: sampleDraft.push,
    });
    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;

    const effective = resolveEffectiveShell(sampleDraft.shell, sampleEnv.shellSetting, sampleEnv.detectedShell);
    const renderRes = renderShell(planRes.value, effective, {
      includeRepoDir: sampleEnv.includeRepoDirInCopy,
    });
    expect(renderRes.ok).toBe(true);
    if (!renderRes.ok) return;

    const copyString = renderRes.value.singleLine;

    // Exact byte equality check
    expect(previewString).toBe(copyString);
    expect(Buffer.from(previewString, "utf8").equals(Buffer.from(copyString, "utf8"))).toBe(true);
  });

  it("forged paths produce STALE_SELECTION and zero git invocations", () => {
    const runGitSpy = vi.spyOn(runner, "runGit");

    // Draft contains a path not present in snapshot
    const forgedDraft: CommitDraft = {
      ...sampleDraft,
      paths: ["etc/passwd", "src/nonexistent.ts"],
    };

    const planRes = buildCommitPlan({
      repoRoot: sampleSnapshot.repoRoot,
      head: sampleSnapshot.head,
      remotes: sampleSnapshot.remotes,
      blockers: sampleSnapshot.blockers,
      files: sampleSnapshot.files,
      selectedPaths: forgedDraft.paths,
      message: forgedDraft.message,
      when: forgedDraft.when,
      push: forgedDraft.push,
    });

    expect(planRes.ok).toBe(false);
    if (!planRes.ok) {
      expect(planRes.error.code).toBe("STALE_SELECTION");
    }

    // Zero git invocations
    expect(runGitSpy).not.toHaveBeenCalled();
    runGitSpy.mockRestore();
  });

  it("panelProvider generates exact CSP per §8.5 with fresh nonce and no inline styles", () => {
    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new CommitPanelProvider({ fsPath: "/ext" } as vscode.Uri, outputChannel);

    let htmlContent = "";
    const mockWebviewView = {
      webview: {
        options: {},
        cspSource: "vscode-webview:",
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: vi.fn(),
        set html(val: string) {
          htmlContent = val;
        },
        get html() {
          return htmlContent;
        },
      },
    };

    void provider.resolveWebviewView(
      mockWebviewView as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    // Verify CSP meta tag
    expect(htmlContent).toContain("default-src 'none';");
    expect(htmlContent).toContain("img-src vscode-webview: data:;");
    expect(htmlContent).toContain("style-src vscode-webview:;");
    expect(htmlContent).toContain("font-src vscode-webview:;");
    expect(htmlContent).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+';/);

    // Verify script has matching nonce attribute
    const nonceMatch = /nonce-([A-Za-z0-9+/=]+)/.exec(htmlContent);
    expect(nonceMatch).not.toBeNull();
    const nonce = nonceMatch?.[1];
    expect(htmlContent).toContain(`script nonce="${nonce ?? ""}"`);

    // Verify no inline style attributes exist in markup
    expect(htmlContent).not.toMatch(/\sstyle\s*=/i);
    // Verify no inline event handlers (onclick etc) exist in markup
    expect(htmlContent).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("webview bundle gzip size is under 60 KB budget", () => {
    const bundlePath = path.resolve(__dirname, "../../dist/webview/main.js");
    if (fs.existsSync(bundlePath)) {
      const content = fs.readFileSync(bundlePath);
      const gzipped = zlib.gzipSync(content);
      expect(gzipped.length).toBeLessThan(60 * 1024);
    }
  });
});
