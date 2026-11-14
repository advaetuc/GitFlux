import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { isWebviewToHost } from "./messages";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type {
  WebviewToHost,
  HostToWebview,
  RepoSnapshot,
  RepoSummary,
  HostEnv,
  ActionResult,
} from "../shared/protocol";
import { getGitApi, isGitVersionSupported } from "./gitApi";
import { buildRepoSnapshot } from "./repoState";
import { detectShell } from "./shell";
import { runGit, executePlan, executeAmendPlan, isHeadPublished } from "./runner";
import { buildCommitPlan, buildAmendPlan } from "../core/plan";
import { renderShell } from "../core/shellRender";
import { sendCommandToTerminal, getEffectiveAutoRun } from "./terminal";
import { resolveSelection, extractUrisFromArgs } from "./resourceResolver";
import {
  CONFIG_SHELL,
  CONFIG_WORKING_HOURS_START,
  CONFIG_WORKING_HOURS_END,
  CONFIG_PUSH_DEFAULT_ENABLED,
  VIEW_ID,
} from "./ids";
import type { ShellKind, ShellSetting } from "../core/types";
import type { API as GitAPI, Repository } from "./vendor/git";

export function resolveEffectiveShell(
  draftShell: ShellSetting,
  configShell: ShellSetting,
  detected: string,
): ShellKind | "none" {
  if (draftShell !== "auto") return draftShell;
  if (configShell !== "auto") return configShell;
  if (detected !== "unsupported") return detected as ShellKind;
  return "none";
}

export class CommitPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView | undefined;
  private activeRepoId?: string | undefined;
  private pendingPreselect?: { repoId: string; paths: readonly string[]; droppedCount: number } | undefined;
  private readonly activeRuns = new Map<string, AbortController>();
  private gitVersionOk = true;
  private webviewReady = false;
  private gitApi?: GitAPI | undefined;
  private readonly gitSubscriptions: vscode.Disposable[] = [];
  private readonly repoSubscriptions = new Map<string, vscode.Disposable>();
  private readonly repoDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    void this.initGit();
  }

  public async initGit(): Promise<GitAPI | undefined> {
    if (this.gitApi) {
      return this.gitApi;
    }
    const gitApi = await getGitApi();
    if (!gitApi) return undefined;
    this.gitApi = gitApi;

    try {
      const vRes = await runGit(gitApi.git.path, ["--version"], { cwd: process.cwd() });
      this.gitVersionOk = isGitVersionSupported(vRes.stdout);
    } catch {
      this.gitVersionOk = false;
    }

    this.gitSubscriptions.push(
      gitApi.onDidChangeState(() => {
        void this.handleGitStateChanged();
      }),
      gitApi.onDidOpenRepository((repo) => {
        void this.handleRepoOpened(repo);
      }),
      gitApi.onDidCloseRepository((repo) => {
        void this.handleRepoClosed(repo);
      }),
    );

    for (const repo of gitApi.repositories) {
      this.subscribeToRepo(repo);
    }

    return gitApi;
  }

  private subscribeToRepo(repo: Repository): void {
    const repoId = repo.rootUri.fsPath;
    if (this.repoSubscriptions.has(repoId)) return;

    const sub = repo.state.onDidChange(() => {
      this.debounceRepoStateChange(repo);
    });
    this.repoSubscriptions.set(repoId, sub);
  }

  private unsubscribeFromRepo(repoId: string): void {
    const sub = this.repoSubscriptions.get(repoId);
    if (sub) {
      sub.dispose();
      this.repoSubscriptions.delete(repoId);
    }
    const timer = this.repoDebounceTimers.get(repoId);
    if (timer) {
      clearTimeout(timer);
      this.repoDebounceTimers.delete(repoId);
    }
  }

  private debounceRepoStateChange(repo: Repository): void {
    const repoId = repo.rootUri.fsPath;
    const existing = this.repoDebounceTimers.get(repoId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.repoDebounceTimers.delete(repoId);
      void this.handleRepoStateChanged(repo);
    }, 250);
    this.repoDebounceTimers.set(repoId, timer);
  }

  private async handleRepoStateChanged(repo: Repository): Promise<void> {
    const repoId = repo.rootUri.fsPath;
    if (!this.activeRepoId) {
      this.activeRepoId = repoId;
      if (this.view && this.webviewReady) {
        await this.sendFullInit();
      }
      return;
    }

    if (this.activeRepoId === repoId) {
      if (this.view && this.webviewReady) {
        const snapshot = await buildRepoSnapshot(repo, repoId);
        this.postMessage({ type: "snapshot", snapshot });
      }
    }
  }

  private async handleRepoOpened(repo: Repository): Promise<void> {
    this.subscribeToRepo(repo);
    if (!this.activeRepoId) {
      this.activeRepoId = repo.rootUri.fsPath;
    }
    if (this.view && this.webviewReady) {
      await this.sendFullInit();
    }
  }

  private async handleRepoClosed(repo: Repository): Promise<void> {
    const repoId = repo.rootUri.fsPath;
    this.unsubscribeFromRepo(repoId);
    if (this.activeRepoId === repoId) {
      const nextRepo = this.gitApi?.repositories.find((r) => r.rootUri.fsPath !== repoId);
      this.activeRepoId = nextRepo ? nextRepo.rootUri.fsPath : undefined;
    }
    if (this.view && this.webviewReady) {
      await this.sendFullInit();
    }
  }

  private async handleGitStateChanged(): Promise<void> {
    if (this.view && this.webviewReady) {
      await this.sendFullInit();
    }
  }

  private async sendFullInit(): Promise<void> {
    const gitApi = await this.initGit();
    const { kind: detectedKind, wslStyle } = detectShell(vscode.env.shell);
    const env = this.getHostEnv(detectedKind, wslStyle);

    const repos: RepoSummary[] = (gitApi?.repositories ?? []).map((r) => ({
      repoId: r.rootUri.fsPath,
      name: r.rootUri.fsPath.split("/").pop() || r.rootUri.fsPath,
    }));

    const activeRepo = this.getActiveRepository(gitApi);
    let snapshot: RepoSnapshot | undefined;
    if (activeRepo) {
      snapshot = await buildRepoSnapshot(activeRepo, activeRepo.rootUri.fsPath);
      this.activeRepoId = activeRepo.rootUri.fsPath;
    } else {
      this.activeRepoId = undefined;
    }

    this.postMessage({
      type: "init",
      protocolVersion: PROTOCOL_VERSION,
      env,
      repos,
      ...(this.activeRepoId ? { activeRepoId: this.activeRepoId } : {}),
      ...(snapshot ? { snapshot } : {}),
    });
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    void _context;
    void _token;
    this.webviewReady = false;
    this.view = webviewView;

    if ("onDidDispose" in webviewView && typeof webviewView.onDidDispose === "function") {
      webviewView.onDidDispose(() => {
        this.webviewReady = false;
        this.view = undefined;
      });
    }

    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };

    const nonce = crypto.randomBytes(16).toString("base64");
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview, nonce);

    webviewView.webview.onDidReceiveMessage(async (data: unknown) => {
      if (!isWebviewToHost(data)) {
        this.outputChannel.appendLine(`Rejected malformed message: ${typeof data === "object" && data !== null && "type" in data ? String((data as { type: unknown }).type) : "unknown"}`);
        return;
      }
      await this.handleMessage(data);
    });

    await this.initGit();
  }

  public async handleSelection(args: unknown[]): Promise<void> {
    const gitApi = await this.initGit();
    if (!gitApi) return;

    if (gitApi.repositories.length === 0) {
      const uris = extractUrisFromArgs(args);
      for (const uri of uris) {
        try {
          await gitApi.openRepository(uri);
        } catch {
          // ignore
        }
      }
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        try {
          await gitApi.openRepository(folder.uri);
        } catch {
          // ignore
        }
      }
    }

    const initialResolve = resolveSelection(gitApi, args);
    if (!initialResolve.repo) {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      return;
    }

    const repo = initialResolve.repo;
    const repoId = repo.rootUri.fsPath;
    this.activeRepoId = repoId;

    const snapshot = await buildRepoSnapshot(repo, repoId);
    const resolved = resolveSelection(gitApi, args, snapshot.files.map((f) => f.path));

    const mappedPaths = resolved.paths.map((p) => {
      const match = snapshot.files.find((f) => f.oldPath === p);
      return match ? match.path : p;
    });
    const finalPaths = Array.from(new Set(mappedPaths));

    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);

    if (this.view && this.webviewReady) {
      this.postMessage({ type: "snapshot", snapshot });
      this.postMessage({
        type: "preselect",
        repoId,
        paths: finalPaths,
        droppedCount: resolved.droppedCount,
      });
    } else {
      this.pendingPreselect = {
        repoId,
        paths: finalPaths,
        droppedCount: resolved.droppedCount,
      };
    }
  }

  public dispose(): void {
    for (const d of this.gitSubscriptions) {
      d.dispose();
    }
    this.gitSubscriptions.length = 0;
    for (const [, sub] of this.repoSubscriptions) {
      sub.dispose();
    }
    this.repoSubscriptions.clear();
    for (const [, timer] of this.repoDebounceTimers) {
      clearTimeout(timer);
    }
    this.repoDebounceTimers.clear();
  }

  private postMessage(msg: HostToWebview): void {
    if (this.view) {
      void this.view.webview.postMessage(msg);
    }
  }

  private getHostEnv(detectedKind: string, isWsl: boolean): HostEnv {
    const config = vscode.workspace.getConfiguration();
    const shellSetting = config.get<ShellSetting>(CONFIG_SHELL, "auto");
    const start = config.get<string>(CONFIG_WORKING_HOURS_START, "09:30");
    const end = config.get<string>(CONFIG_WORKING_HOURS_END, "18:30");
    const pushDefault = config.get<boolean>(CONFIG_PUSH_DEFAULT_ENABLED, false);
    const autoRun = getEffectiveAutoRun();

    const effective = resolveEffectiveShell(shellSetting, shellSetting, detectedKind);
    const sendToTerminalAvailable =
      detectedKind !== "unsupported" && effective === detectedKind;

    const platform =
      process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";

    return {
      platform,
      detectedShell: detectedKind as HostEnv["detectedShell"],
      shellSetting,
      includeRepoDirInCopy: !isWsl,
      sendToTerminalAvailable,
      workingHours: { start, end },
      pushDefaultEnabled: pushDefault,
      autoRun,
      gitVersionOk: this.gitVersionOk,
    };
  }

  private async handleMessage(msg: WebviewToHost): Promise<void> {
    const gitApi = await getGitApi();
    const { kind: detectedKind, wslStyle } = detectShell(vscode.env.shell);
    const env = this.getHostEnv(detectedKind, wslStyle);

    switch (msg.type) {
      case "ready": {
        this.webviewReady = true;
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.outputChannel.appendLine(`Protocol version mismatch: expected ${String(PROTOCOL_VERSION)}, got ${String(msg.protocolVersion)}`);
          void vscode.window.showErrorMessage(
            `GitFlux protocol error: expected version ${String(PROTOCOL_VERSION)}, got ${String(msg.protocolVersion)}. Please reload VS Code.`,
          );
          return;
        }

        if (this.pendingPreselect) {
          this.activeRepoId = this.pendingPreselect.repoId;
        }

        await this.sendFullInit();

        if (this.pendingPreselect) {
          const pre = this.pendingPreselect;
          this.pendingPreselect = undefined;
          const preRepo = gitApi?.repositories.find((r) => r.rootUri.fsPath === pre.repoId);
          if (preRepo) {
            const preSnapshot = await buildRepoSnapshot(preRepo, pre.repoId);
            this.postMessage({ type: "snapshot", snapshot: preSnapshot });
            this.postMessage({
              type: "preselect",
              repoId: pre.repoId,
              paths: pre.paths,
              droppedCount: pre.droppedCount,
            });
          }
        }
        break;
      }

      case "selectRepo": {
        const repo = gitApi?.repositories.find((r) => r.rootUri.fsPath === msg.repoId);
        if (repo) {
          this.activeRepoId = msg.repoId;
          const snapshot = await buildRepoSnapshot(repo, msg.repoId);
          this.postMessage({ type: "snapshot", snapshot });
        }
        break;
      }

      case "initRepository": {
        await vscode.commands.executeCommand("git.init");
        await this.sendFullInit();
        break;
      }

      case "copy": {
        const repo = gitApi?.repositories.find((r) => r.rootUri.fsPath === msg.draft.repoId);
        if (!repo) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "INTERNAL", message: "Repository not found", rolledBack: false },
          });
          return;
        }

        // Freshness rule: build fresh snapshot immediately before planning
        const freshSnapshot = await buildRepoSnapshot(repo, msg.draft.repoId);
        const planRes = buildCommitPlan({
          repoRoot: freshSnapshot.repoRoot,
          head: freshSnapshot.head,
          remotes: freshSnapshot.remotes,
          blockers: freshSnapshot.blockers,
          files: freshSnapshot.files,
          selectedPaths: msg.draft.paths,
          message: msg.draft.message,
          when: msg.draft.when,
          push: msg.draft.push,
        });

        if (!planRes.ok) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: planRes.error.code, message: planRes.error.detail, rolledBack: false },
          });
          return;
        }

        const effective = resolveEffectiveShell(msg.draft.shell, env.shellSetting, env.detectedShell);
        if (effective === "none") {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "UNSUPPORTED_SHELL", message: "Select a shell dialect", rolledBack: false },
          });
          return;
        }

        const renderRes = renderShell(planRes.value, effective, {
          includeRepoDir: env.includeRepoDirInCopy,
        });

        if (!renderRes.ok) {
          const detail =
            renderRes.error.code === "UNSAFE_CHARACTER"
              ? `Not allowed in ${effective} commands: ${renderRes.error.character}. Use Run Now or another shell.`
              : `Command too long (${String(renderRes.error.length)} / ${String(renderRes.error.limit)}).`;
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: renderRes.error.code, message: detail, rolledBack: false },
          });
          return;
        }

        await vscode.env.clipboard.writeText(renderRes.value.singleLine);
        this.postMessage({
          type: "result",
          requestId: msg.requestId,
          result: { ok: true, action: "copy" },
        });
        break;
      }

      case "sendToTerminal": {
        const repo = gitApi?.repositories.find((r) => r.rootUri.fsPath === msg.draft.repoId);
        if (!repo) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "INTERNAL", message: "Repository not found", rolledBack: false },
          });
          return;
        }

        const effective = resolveEffectiveShell(msg.draft.shell, env.shellSetting, env.detectedShell);
        // AM-11: Send to Terminal only when dialects match
        if (env.detectedShell === "unsupported" || effective !== env.detectedShell) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: {
              ok: false,
              code: "UNSUPPORTED_SHELL",
              message: `Shell dialect mismatch: terminal is '${env.detectedShell}' but selected is '${effective}'. Shell override applies to Copy only.`,
              rolledBack: false,
            },
          });
          return;
        }

        const freshSnapshot = await buildRepoSnapshot(repo, msg.draft.repoId);
        const planRes = buildCommitPlan({
          repoRoot: freshSnapshot.repoRoot,
          head: freshSnapshot.head,
          remotes: freshSnapshot.remotes,
          blockers: freshSnapshot.blockers,
          files: freshSnapshot.files,
          selectedPaths: msg.draft.paths,
          message: msg.draft.message,
          when: msg.draft.when,
          push: msg.draft.push,
        });

        if (!planRes.ok) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: planRes.error.code, message: planRes.error.detail, rolledBack: false },
          });
          return;
        }

        const renderRes = renderShell(planRes.value, effective, {
          includeRepoDir: false,
        });

        if (!renderRes.ok) {
          const detail =
            renderRes.error.code === "UNSAFE_CHARACTER"
              ? `Not allowed in ${effective} commands: ${renderRes.error.character}. Use Run Now or another shell.`
              : `Command too long (${String(renderRes.error.length)} / ${String(renderRes.error.limit)}).`;
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: renderRes.error.code, message: detail, rolledBack: false },
          });
          return;
        }

        sendCommandToTerminal(
          msg.draft.repoId,
          freshSnapshot.name,
          freshSnapshot.repoRoot,
          renderRes.value.singleLine,
        );

        this.postMessage({
          type: "result",
          requestId: msg.requestId,
          result: { ok: true, action: "sendToTerminal" },
        });
        break;
      }

      case "run": {
        const repo = gitApi?.repositories.find((r) => r.rootUri.fsPath === msg.draft.repoId);
        if (!repo) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "INTERNAL", message: "Repository not found", rolledBack: false },
          });
          return;
        }

        const freshSnapshot = await buildRepoSnapshot(repo, msg.draft.repoId);
        const planRes = buildCommitPlan({
          repoRoot: freshSnapshot.repoRoot,
          head: freshSnapshot.head,
          remotes: freshSnapshot.remotes,
          blockers: freshSnapshot.blockers,
          files: freshSnapshot.files,
          selectedPaths: msg.draft.paths,
          message: msg.draft.message,
          when: msg.draft.when,
          push: msg.draft.push,
        });

        if (!planRes.ok) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: planRes.error.code, message: planRes.error.detail, rolledBack: false },
          });
          return;
        }

        if (!gitApi) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "INTERNAL", message: "Git API unavailable", rolledBack: false },
          });
          return;
        }

        const abortController = new AbortController();
        this.activeRuns.set(msg.requestId, abortController);

        let result: ActionResult;
        try {
          result = await executePlan(
            gitApi.git.path,
            repo,
            msg.draft.repoId,
            planRes.value,
            (step, status) => {
              this.postMessage({
                type: "progress",
                requestId: msg.requestId,
                step,
                status,
              });
            },
            abortController.signal,
          );
        } finally {
          this.activeRuns.delete(msg.requestId);
        }

        this.postMessage({
          type: "result",
          requestId: msg.requestId,
          result,
        });

        // Push fresh snapshot immediately so committed files clear from the UI
        try {
          const postRunSnapshot = await buildRepoSnapshot(repo, msg.draft.repoId);
          this.postMessage({ type: "snapshot", snapshot: postRunSnapshot });
        } catch {
          // If repo state reading fails, ignore
        }

        // Display results to user
        if (!result.ok) {
          if (this.view && !this.view.visible) {
            void vscode.window.showErrorMessage(result.message);
          }
        } else if (result.action === "run") {
          const shortSha = result.commitSha.slice(0, 7);
          const iso = planRes.value.timestamp.iso;
          void vscode.window
            .showInformationMessage(`Committed ${shortSha} at ${iso}`, "Copy SHA")
            .then((selected) => {
              if (selected === "Copy SHA") {
                void vscode.env.clipboard.writeText(result.commitSha);
              }
            });
        }
        break;
      }

      case "amendHead": {
        const repo = gitApi?.repositories.find((r) => r.rootUri.fsPath === msg.draft.repoId);
        if (!repo) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "INTERNAL", message: "Repository not found", rolledBack: false },
          });
          return;
        }

        if (!gitApi) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: "INTERNAL", message: "Git API unavailable", rolledBack: false },
          });
          return;
        }

        // Re-build fresh snapshot + re-run isHeadPublished at execution time (never trust cached state)
        const freshSnapshot = await buildRepoSnapshot(repo, msg.draft.repoId, undefined, gitApi.git.path);
        const isPublished = await isHeadPublished(gitApi.git.path, repo.rootUri.fsPath);

        const planRes = buildAmendPlan({
          repoRoot: freshSnapshot.repoRoot,
          head: freshSnapshot.head,
          blockers: freshSnapshot.blockers,
          when: msg.draft.when,
          isPublished,
        });

        if (!planRes.ok) {
          this.postMessage({
            type: "result",
            requestId: msg.requestId,
            result: { ok: false, code: planRes.error.code, message: planRes.error.detail, rolledBack: false },
          });
          return;
        }

        const abortController = new AbortController();
        this.activeRuns.set(msg.requestId, abortController);

        let result: ActionResult;
        try {
          result = await executeAmendPlan(
            gitApi.git.path,
            repo,
            msg.draft.repoId,
            planRes.value,
            (step, status) => {
              this.postMessage({
                type: "progress",
                requestId: msg.requestId,
                step,
                status,
              });
            },
            abortController.signal,
          );
        } finally {
          this.activeRuns.delete(msg.requestId);
        }

        this.postMessage({
          type: "result",
          requestId: msg.requestId,
          result,
        });

        // Push fresh snapshot immediately
        try {
          const postRunSnapshot = await buildRepoSnapshot(repo, msg.draft.repoId, undefined, gitApi.git.path);
          this.postMessage({ type: "snapshot", snapshot: postRunSnapshot });
        } catch {
          // If repo state reading fails, ignore
        }

        // Display results to user
        if (!result.ok) {
          if (this.view && !this.view.visible) {
            void vscode.window.showErrorMessage(result.message);
          }
        } else if (result.action === "amendHead") {
          const shortSha = result.commitSha.slice(0, 7);
          void vscode.window
            .showInformationMessage(`Rewrote the date of local commit ${shortSha}.`, "Copy SHA")
            .then((selected) => {
              if (selected === "Copy SHA") {
                void vscode.env.clipboard.writeText(result.commitSha);
              }
            });
        }
        break;
      }

      case "cancel": {
        const controller = this.activeRuns.get(msg.requestId);
        if (controller) {
          controller.abort();
        }
        break;
      }
    }
  }

  private getActiveRepository(gitApi?: GitAPI | null): Repository | undefined {
    if (!gitApi || gitApi.repositories.length === 0) return undefined;
    if (this.activeRepoId) {
      const match = gitApi.repositories.find((r) => r.rootUri.fsPath === this.activeRepoId);
      if (match) return match;
    }
    return gitApi.repositories[0];
  }

  private getHtmlForWebview(webview: vscode.Webview, nonce: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "codicon.css"),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${codiconUri.toString()}">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Commit With Custom Date</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
