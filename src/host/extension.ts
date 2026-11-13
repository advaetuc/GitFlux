import * as vscode from "vscode";
import {
  COMMAND_OPEN,
  COMMAND_OPEN_FOR_SELECTION,
  REGISTERED_COMMANDS,
  VIEW_ID,
  OUTPUT_CHANNEL_NAME,
} from "./ids";
import { CommitPanelProvider } from "./panelProvider";
import { handleTerminalClosed } from "./terminal";
import { extractUrisFromArgs } from "./resourceResolver";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(outputChannel);

  const provider = new CommitPanelProvider(context.extensionUri, outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((term) => {
      handleTerminalClosed(term);
    }),
  );

  const commandHandlers: Record<(typeof REGISTERED_COMMANDS)[number], (...args: unknown[]) => Promise<void>> = {
    [COMMAND_OPEN]: async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    },
    [COMMAND_OPEN_FOR_SELECTION]: async (...args: unknown[]) => {
      const uris = extractUrisFromArgs(args);
      if (uris.length > 0) {
        await provider.handleSelection(uris);
      }
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    },
  };

  for (const cmd of REGISTERED_COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(cmd, commandHandlers[cmd]));
  }
}

export function deactivate(): void {}

// Export list for tests
export { REGISTERED_COMMANDS };
