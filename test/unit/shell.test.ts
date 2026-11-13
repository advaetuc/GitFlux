import { describe, it, expect } from "vitest";
import { detectShell, resolveEffectiveShell } from "../../src/host/shell";

describe("detectShell (AM-12)", () => {
  const table = [
    { input: "bash", expectedKind: "bash", expectedWsl: false },
    { input: "/bin/bash", expectedKind: "bash", expectedWsl: false },
    { input: "git-bash", expectedKind: "bash", expectedWsl: false },
    { input: "C:\\Program Files\\Git\\bin\\git-bash.exe", expectedKind: "bash", expectedWsl: false },
    { input: "zsh", expectedKind: "zsh", expectedWsl: false },
    { input: "/bin/zsh", expectedKind: "zsh", expectedWsl: false },
    { input: "fish", expectedKind: "fish", expectedWsl: false },
    { input: "/usr/local/bin/fish", expectedKind: "fish", expectedWsl: false },
    { input: "sh", expectedKind: "sh", expectedWsl: false },
    { input: "dash", expectedKind: "sh", expectedWsl: false },
    { input: "ash", expectedKind: "sh", expectedWsl: false },
    { input: "/bin/dash", expectedKind: "sh", expectedWsl: false },
    { input: "pwsh", expectedKind: "pwsh", expectedWsl: false },
    { input: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", expectedKind: "pwsh", expectedWsl: false },
    { input: "powershell", expectedKind: "powershell", expectedWsl: false },
    { input: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", expectedKind: "powershell", expectedWsl: false },
    { input: "cmd", expectedKind: "cmd", expectedWsl: false },
    { input: "C:\\Windows\\System32\\cmd.exe", expectedKind: "cmd", expectedWsl: false },
    { input: "wsl", expectedKind: "bash", expectedWsl: true },
    { input: "C:\\Windows\\System32\\wsl.exe", expectedKind: "bash", expectedWsl: true },
    { input: "", expectedKind: "unsupported", expectedWsl: false },
    { input: "   ", expectedKind: "unsupported", expectedWsl: false },
    { input: "nu", expectedKind: "unsupported", expectedWsl: false },
    { input: "xonsh", expectedKind: "unsupported", expectedWsl: false },
    { input: "elvish", expectedKind: "unsupported", expectedWsl: false },
  ];

  for (const row of table) {
    it(`maps '${row.input}' to kind '${row.expectedKind}' (wslStyle: ${String(row.expectedWsl)})`, () => {
      const res = detectShell(row.input);
      expect(res.kind).toBe(row.expectedKind);
      expect(res.wslStyle).toBe(row.expectedWsl);
    });
  }
});

describe("resolveEffectiveShell (§8.3)", () => {
  it("draft override takes highest precedence", () => {
    expect(resolveEffectiveShell("fish", "cmd", "bash")).toBe("fish");
  });

  it("config setting takes second precedence when draft is auto", () => {
    expect(resolveEffectiveShell("auto", "zsh", "bash")).toBe("zsh");
  });

  it("detected shell takes third precedence when draft and config are auto", () => {
    expect(resolveEffectiveShell("auto", "auto", "pwsh")).toBe("pwsh");
  });

  it("returns undefined when detected is unsupported and both draft/config are auto", () => {
    expect(resolveEffectiveShell("auto", "auto", "unsupported")).toBeUndefined();
  });
});
