import type { DetectedShell, ShellKind, ShellSetting } from "../core/types";

export interface ShellDetection {
  readonly kind: DetectedShell;
  readonly wslStyle: boolean;
}

/**
 * Normalizes shell path by extracting the basename, lowercasing, and stripping trailing .exe.
 * Supports both POSIX and Windows path separators.
 */
export function detectShell(shellPath: string): ShellDetection {
  if (!shellPath || shellPath.trim().length === 0) {
    return { kind: "unsupported", wslStyle: false };
  }

  // Handle both / and \ separators
  const normalized = shellPath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  let base = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  // Lowercase and strip trailing .exe
  base = base.toLowerCase();
  if (base.endsWith(".exe")) {
    base = base.slice(0, -4);
  }

  switch (base) {
    case "bash":
    case "git-bash":
      return { kind: "bash", wslStyle: false };
    case "zsh":
      return { kind: "zsh", wslStyle: false };
    case "fish":
      return { kind: "fish", wslStyle: false };
    case "sh":
    case "dash":
    case "ash":
      return { kind: "sh", wslStyle: false };
    case "pwsh":
      return { kind: "pwsh", wslStyle: false };
    case "powershell":
      return { kind: "powershell", wslStyle: false };
    case "cmd":
      return { kind: "cmd", wslStyle: false };
    case "wsl":
      return { kind: "bash", wslStyle: true };
    default:
      return { kind: "unsupported", wslStyle: false };
  }
}

/**
 * Computes effective shell according to Blueprint §8.3:
 * 1. draft.shell if not "auto"
 * 2. config.shell if not "auto"
 * 3. detected if not "unsupported"
 * 4. undefined (none available)
 */
export function resolveEffectiveShell(
  draftShell: ShellSetting,
  configShell: ShellSetting,
  detected: DetectedShell,
): ShellKind | undefined {
  if (draftShell !== "auto") {
    return draftShell;
  }
  if (configShell !== "auto") {
    return configShell;
  }
  if (detected !== "unsupported") {
    return detected;
  }
  return undefined;
}
