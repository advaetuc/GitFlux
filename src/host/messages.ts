import type { WebviewToHost, CommitDraft } from "../shared/protocol";
import type { LocalDateTime, ShellSetting } from "../core/types";

const ALLOWED_SHELLS: readonly ShellSetting[] = [
  "auto",
  "bash",
  "zsh",
  "sh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
];

function isInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && Number.isFinite(val);
}

function isStringWithMax(val: unknown, maxLen: number): val is string {
  return typeof val === "string" && val.length <= maxLen;
}

function isLocalDateTime(val: unknown): val is LocalDateTime {
  if (!val || typeof val !== "object") return false;
  const o = val as Record<string, unknown>;
  return (
    isInteger(o["year"]) &&
    isInteger(o["month"]) &&
    isInteger(o["day"]) &&
    isInteger(o["hour"]) &&
    isInteger(o["minute"]) &&
    isInteger(o["second"])
  );
}

function isCommitDraft(val: unknown): val is CommitDraft {
  if (!val || typeof val !== "object") return false;
  const o = val as Record<string, unknown>;

  // repoId: string <= 255
  if (!isStringWithMax(o["repoId"], 255)) return false;

  // revision: finite integer
  if (!isInteger(o["revision"])) return false;

  // paths: Array <= 20000, each string <= 4096
  const paths = o["paths"];
  if (!Array.isArray(paths) || paths.length > 20000) return false;
  for (const p of paths) {
    if (!isStringWithMax(p, 4096)) return false;
  }

  // message: subject <= 500, body <= 8192
  const msg = o["message"];
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (!isStringWithMax(m["subject"], 500)) return false;
  if (!isStringWithMax(m["body"], 8192)) return false;

  // when: local (LocalDateTime), offsetMinutes (finite integer)
  const when = o["when"];
  if (!when || typeof when !== "object") return false;
  const w = when as Record<string, unknown>;
  if (!isInteger(w["offsetMinutes"])) return false;
  if (!isLocalDateTime(w["local"])) return false;

  // push: enabled (boolean), remote (string <= 255)
  const push = o["push"];
  if (!push || typeof push !== "object") return false;
  const p = push as Record<string, unknown>;
  if (typeof p["enabled"] !== "boolean") return false;
  if (!isStringWithMax(p["remote"], 255)) return false;

  // shell: in allowed enum
  const shell = o["shell"];
  if (typeof shell !== "string" || !ALLOWED_SHELLS.includes(shell as ShellSetting)) {
    return false;
  }

  return true;
}

/**
 * Strict type-guard validating messages received from the webview (§7.2).
 * Never throws on any input.
 * Enforces size limits and checks all numeric fields are finite integers.
 */
export function isWebviewToHost(raw: unknown): raw is WebviewToHost {
  if (!raw || typeof raw !== "object") {
    return false;
  }

  const msg = raw as Record<string, unknown>;
  const type = msg["type"];
  if (typeof type !== "string") {
    return false;
  }

  switch (type) {
    case "ready": {
      return isInteger(msg["protocolVersion"]);
    }
    case "selectRepo": {
      return isStringWithMax(msg["repoId"], 255);
    }
    case "initRepository": {
      return true;
    }
    case "cancel": {
      return isStringWithMax(msg["requestId"], 64);
    }
    case "copy":
    case "sendToTerminal":
    case "run":
    case "amendHead": {
      if (!isStringWithMax(msg["requestId"], 64)) {
        return false;
      }
      return isCommitDraft(msg["draft"]);
    }
    default:
      return false;
  }
}
