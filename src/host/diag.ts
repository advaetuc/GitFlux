export interface DiagOutputChannel {
  appendLine(val: string): void;
}

let diagChannel: DiagOutputChannel | undefined;

export function getDiagChannel(): DiagOutputChannel | undefined {
  if (process.env.GITFLUX_SPIKE_LOG !== "1") {
    return undefined;
  }
  if (!diagChannel) {
    try {
      // Dynamic require so host unit tests outside VS Code extension host run cleanly
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require("vscode") as { window: { createOutputChannel(name: string): DiagOutputChannel } };
      diagChannel = vscode.window.createOutputChannel("Commit With Custom Date [Diag]");
    } catch {
      // vscode not available in unit test environment
      return undefined;
    }
  }
  return diagChannel;
}

export function logDiag(header: string, payload: unknown): void {
  const ch = getDiagChannel();
  if (ch) {
    ch.appendLine(`[${new Date().toISOString()}] === ${header} ===`);
    ch.appendLine(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  }
}
