import * as vscode from "vscode";
import { CONFIG_TERMINAL_AUTO_RUN, OUTPUT_CHANNEL_NAME } from "./ids";

const terminalsByRepo = new Map<string, vscode.Terminal>();

export function getOrCreateTerminal(
  repoId: string,
  repoName: string,
  repoRoot: string,
): vscode.Terminal {
  let terminal = terminalsByRepo.get(repoId);
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({
      name: `${OUTPUT_CHANNEL_NAME}: ${repoName}`,
      cwd: repoRoot,
    });
    terminalsByRepo.set(repoId, terminal);
  }
  return terminal;
}

export function handleTerminalClosed(closedTerminal: vscode.Terminal): void {
  for (const [id, term] of terminalsByRepo.entries()) {
    if (term === closedTerminal) {
      terminalsByRepo.delete(id);
      break;
    }
  }
}

export function resetTerminals(): void {
  terminalsByRepo.clear();
}

/**
 * Reads terminal.autoRun enforcing application scope (Blueprint §6.2, AM-11).
 * Workspace-level settings are ignored.
 */
export function getEffectiveAutoRun(): boolean {
  const config = vscode.workspace.getConfiguration();
  const inspected = config.inspect<boolean>(CONFIG_TERMINAL_AUTO_RUN);
  return inspected?.globalValue ?? inspected?.defaultValue ?? false;
}

/**
 * Sends command line to the dedicated terminal for the repository.
 * Terminal.sendText is called ONLY in this function.
 */
export function sendCommandToTerminal(
  repoId: string,
  repoName: string,
  repoRoot: string,
  commandLine: string,
  autoRunOverride?: boolean,
): void {
  const terminal = getOrCreateTerminal(repoId, repoName, repoRoot);
  terminal.show(true);
  const autoRun = autoRunOverride ?? getEffectiveAutoRun();
  terminal.sendText(commandLine, autoRun);
}
