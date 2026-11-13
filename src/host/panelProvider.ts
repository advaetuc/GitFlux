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
import { runGit, executePlan } from "./runner";
import { buildCommitPlan } from "../core/plan";
import { renderShell } from "../core/shellRender";
import { sendCommandToTerminal, getEffectiveAutoRun } from "./terminal";
import { resolveSelection } from "./resourceResolver";
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

export class CommitPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private activeRepoId?: string;
  private pendingPreselect?: { repoId: string; paths: readonly string[]; droppedCount: number } | undefined;
  private readonly activeRuns = new Map<string, AbortController>();
  private gitVersionOk = true;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    void _context;
    void _token;
    this.view = webviewView;

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

    // Check git version once
    const gitApi = await getGitApi();
    if (gitApi) {
      try {
        const vRes = await runGit(gitApi.git.path, ["--version"], { cwd: process.cwd() });
        this.gitVersionOk = isGitVersionSupported(vRes.stdout);
      } catch {
        this.gitVersionOk = false;
      }
    }
  }

  public async handleSelection(uris: vscode.Uri[]): Promise<void> {
    const gitApi = await getGitApi();
    if (!gitApi) return;

    const resolved = resolveSelection(gitApi, uris);
    if (!resolved.repo) return;

    const repo = resolved.repo;
    const repoId = repo.rootUri.fsPath;
    this.activeRepoId = repoId;

    if (this.view) {
      const snapshot = await buildRepoSnapshot(repo, repoId);
      this.postMessage({ type: "snapshot", snapshot });
      this.postMessage({
        type: "preselect",
        repoId,
        paths: resolved.paths,
        droppedCount: resolved.droppedCount,
      });
    } else {
      this.pendingPreselect = {
        repoId,
        paths: resolved.paths,
        droppedCount: resolved.droppedCount,
      };
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
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
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.outputChannel.appendLine(`Protocol version mismatch: expected ${String(PROTOCOL_VERSION)}, got ${String(msg.protocolVersion)}`);
          void vscode.window.showErrorMessage(
            `GitFlux protocol error: expected version ${String(PROTOCOL_VERSION)}, got ${String(msg.protocolVersion)}. Please reload VS Code.`,
          );
          return;
        }

        const repos: RepoSummary[] = (gitApi?.repositories ?? []).map((r) => ({
          repoId: r.rootUri.fsPath,
          name: r.rootUri.fsPath.split("/").pop() || r.rootUri.fsPath,
        }));

        const activeRepo = this.getActiveRepository(gitApi);
        let snapshot: RepoSnapshot | undefined;
        if (activeRepo) {
          snapshot = await buildRepoSnapshot(activeRepo, activeRepo.rootUri.fsPath);
          this.activeRepoId = activeRepo.rootUri.fsPath;
        }

        this.postMessage({
          type: "init",
          protocolVersion: PROTOCOL_VERSION,
          env,
          repos,
          ...(this.activeRepoId ? { activeRepoId: this.activeRepoId } : {}),
          ...(snapshot ? { snapshot } : {}),
        });

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
        // Re-read repositories and send updated init
        const repos: RepoSummary[] = (gitApi?.repositories ?? []).map((r) => ({
          repoId: r.rootUri.fsPath,
          name: r.rootUri.fsPath.split("/").pop() || r.rootUri.fsPath,
        }));
        const active = this.getActiveRepository(gitApi);
        let snapshot: RepoSnapshot | undefined;
        if (active) {
          snapshot = await buildRepoSnapshot(active, active.rootUri.fsPath);
          this.activeRepoId = active.rootUri.fsPath;
        }
        this.postMessage({
          type: "init",
          protocolVersion: PROTOCOL_VERSION,
          env,
          repos,
          ...(this.activeRepoId ? { activeRepoId: this.activeRepoId } : {}),
          ...(snapshot ? { snapshot } : {}),
        });
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
