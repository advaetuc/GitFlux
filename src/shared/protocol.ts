// src/shared/protocol.ts — §7.2 + AM-02 + AM-05
import type { DetectedShell, LocalDateTime, ShellSetting } from "../core/types";
// AM-02: re-export shared snapshot types from core
export type { ChangedFile, FileChangeKind, HeadState, Blocker } from "../core/types";

export const PROTOCOL_VERSION = 1;

/** Opaque to the webview. Host maps it to a repository root. */
export type RepoId = string;

// ---- Snapshot (host to webview) --------------------------------------------

export interface RepoSummary {
  readonly repoId: RepoId;
  readonly name: string;
}

export interface RepoSnapshot {
  readonly repoId: RepoId;
  readonly name: string;
  /** AM-05: absolute path, needed by webview for preview. */
  readonly repoRoot: string;
  /** Monotonic per repo. Echoed back in CommitDraft.revision. */
  readonly revision: number;
  readonly head: import("../core/types").HeadState;
  readonly remotes: readonly string[];
  /** Committer date of HEAD, for the "earlier than parent" warning. Absent when unborn. */
  readonly headCommitEpochSeconds?: number;
  readonly blockers: readonly import("../core/types").Blocker[];
  /** Conflicted files are excluded (they raise UNMERGED_FILES). */
  readonly files: readonly import("../core/types").ChangedFile[];
}

export interface HostEnv {
  readonly platform: "win32" | "darwin" | "linux";
  readonly detectedShell: DetectedShell;
  readonly shellSetting: ShellSetting;
  /** AM-05: false only when the detected shell is WSL-style. */
  readonly includeRepoDirInCopy: boolean;
  /** AM-05: detectedShell !== "unsupported" AND effective shell === detectedShell. */
  readonly sendToTerminalAvailable: boolean;
  readonly workingHours: { readonly start: string; readonly end: string };
  readonly pushDefaultEnabled: boolean;
  readonly autoRun: boolean;
  readonly gitVersionOk: boolean;
}

// ---- Draft (webview to host; DATA ONLY) --------------------------------------

export interface CommitDraft {
  readonly repoId: RepoId;
  readonly revision: number;
  /** Repo-relative POSIX paths chosen from the latest snapshot. Re-validated by the host. */
  readonly paths: readonly string[];
  readonly message: { readonly subject: string; readonly body: string };
  /** Offset already resolved in the webview (user's clock). Host never reads local timezone. */
  readonly when: { readonly local: LocalDateTime; readonly offsetMinutes: number };
  readonly push: { readonly enabled: boolean; readonly remote: string };
  readonly shell: ShellSetting;
}

// ---- Results ------------------------------------------------------------------

export type RunStepId = "preflight" | "add" | "commit" | "verify" | "push";

export type ErrorCode =
  | "MALFORMED_REQUEST" | "STALE_SELECTION" | "BLOCKED" | "GIT_TOO_OLD"
  | "PATH_REJECTED" | "MESSAGE_REJECTED" | "DATE_REJECTED"
  | "UNSAFE_CHARACTER" | "COMMAND_TOO_LONG" | "UNSUPPORTED_SHELL"
  | "NOTHING_TO_COMMIT" | "IDENTITY_MISSING" | "INDEX_LOCKED"
  | "HOOK_REJECTED" | "SIGNING_FAILED" | "GIT_FAILED"
  | "PUSH_REJECTED" | "AUTH_FAILED" | "NETWORK" | "CANCELLED" | "TIMEOUT" | "INTERNAL";

export type ActionResult =
  | { readonly ok: true; readonly action: "copy" | "sendToTerminal" }
  | {
      readonly ok: true;
      readonly action: "run";
      readonly commitSha: string;
      /** false if post-commit date verification disagreed (commit exists; user is told). */
      readonly verified: boolean;
      readonly pushed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly step?: RunStepId;
      /** ANSI-stripped, truncated to 4 KB. Rendered as text only. */
      readonly message: string;
      readonly rolledBack: boolean;
      /** Offered when Run Now cannot work but the terminal might (signing prompt, credentials). */
      readonly fallback?: "sendToTerminal";
    };

// ---- Messages -------------------------------------------------------------------

export type WebviewToHost =
  | { readonly type: "ready"; readonly protocolVersion: number }
  | { readonly type: "selectRepo"; readonly repoId: RepoId }
  | { readonly type: "initRepository" }
  | { readonly type: "copy"; readonly requestId: string; readonly draft: CommitDraft }
  | { readonly type: "sendToTerminal"; readonly requestId: string; readonly draft: CommitDraft }
  | { readonly type: "run"; readonly requestId: string; readonly draft: CommitDraft }
  | { readonly type: "cancel"; readonly requestId: string };

export type HostToWebview =
  | {
      readonly type: "init";
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly env: HostEnv;
      readonly repos: readonly RepoSummary[];
      readonly activeRepoId?: RepoId;
      readonly snapshot?: RepoSnapshot;
    }
  | { readonly type: "snapshot"; readonly snapshot: RepoSnapshot }
  | {
      readonly type: "preselect";
      readonly repoId: RepoId;
      readonly paths: readonly string[];
      /** Selected resources that belonged to other repos or had no changes. */
      readonly droppedCount: number;
    }
  | {
      readonly type: "progress";
      readonly requestId: string;
      readonly step: RunStepId;
      readonly status: "start" | "ok" | "fail";
    }
  | { readonly type: "result"; readonly requestId: string; readonly result: ActionResult };

export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
