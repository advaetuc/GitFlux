import type {
  AmendPlan,
  AmendPlanInput,
  Blocker,
  BranchName,
  ChangedFile,
  CommitPlan,
  ErrorCode,
  GitPath,
  HeadState,
  LocalDateTime,
  RemoteName,
  Result,
} from "./types";
import { normalizeMessage } from "./message";
import { resolveTimestamp } from "./timestamp";
import { validateGitPath } from "./path";

export interface PlanInput {
  readonly repoRoot: string;
  readonly head: HeadState;
  readonly remotes: readonly string[];
  readonly blockers: readonly Blocker[];
  readonly files: readonly ChangedFile[]; // the snapshot's file list
  readonly selectedPaths: readonly string[]; // from the draft
  readonly message: { readonly subject: string; readonly body: string };
  readonly when: { readonly local: LocalDateTime; readonly offsetMinutes: number };
  readonly push: { readonly enabled: boolean; readonly remote: string };
}

export type PlanErrorCode =
  | "BLOCKED"
  | "PATH_REJECTED"
  | "STALE_SELECTION"
  | "MESSAGE_REJECTED"
  | "DATE_REJECTED"
  | "NOTHING_TO_COMMIT";

// Compile-time check asserting PlanErrorCode is a subset of the protocol's ErrorCode (AM-03)
export const _assertPlanErrorCode = (null as unknown as PlanErrorCode) satisfies ErrorCode;

export interface PlanError {
  readonly code: PlanErrorCode;
  readonly detail: string; // human-readable, no user-controlled markup
  readonly paths?: readonly string[]; // e.g. extra staged files (unborn case)
}

const REMOTE_REGEX = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

/**
 * Builds a validated CommitPlan following the strict algorithm in AM-03.
 * Single source of truth for both host and webview.
 */
export function buildCommitPlan(input: PlanInput): Result<CommitPlan, PlanError> {
  // 1. blockers.length > 0 → BLOCKED
  if (input.blockers.length > 0) {
    return {
      ok: false,
      error: {
        code: "BLOCKED",
        detail: `Operation blocked: ${input.blockers.join(", ")} in progress.`,
      },
    };
  }

  // 2. normalizeMessage fails → MESSAGE_REJECTED
  const msgResult = normalizeMessage(input.message.subject, input.message.body);
  if (!msgResult.ok) {
    return {
      ok: false,
      error: {
        code: "MESSAGE_REJECTED",
        detail: `Message rejected: ${msgResult.error}`,
      },
    };
  }

  // 3. resolveTimestamp fails → DATE_REJECTED
  const timeResult = resolveTimestamp(input.when.local, input.when.offsetMinutes);
  if (!timeResult.ok) {
    return {
      ok: false,
      error: {
        code: "DATE_REJECTED",
        detail: `Date rejected: ${timeResult.error}`,
      },
    };
  }

  // 4. selectedPaths empty → NOTHING_TO_COMMIT ("No files selected")
  if (input.selectedPaths.length === 0) {
    return {
      ok: false,
      error: {
        code: "NOTHING_TO_COMMIT",
        detail: "No files selected.",
      },
    };
  }

  // 5. For each selected path: validateGitPath fails → PATH_REJECTED; dedupe;
  // the path must equal some files[i].path, else STALE_SELECTION.
  const filesByPath = new Map<string, ChangedFile>();
  for (const f of input.files) {
    filesByPath.set(f.path, f);
  }

  const validatedSelectedPaths: GitPath[] = [];
  const seenPaths = new Set<string>();

  for (const p of input.selectedPaths) {
    const valRes = validateGitPath(p);
    if (!valRes.ok) {
      return {
        ok: false,
        error: {
          code: "PATH_REJECTED",
          detail: `Invalid path: ${p} (${valRes.error})`,
        },
      };
    }
    if (seenPaths.has(p)) {
      continue;
    }
    seenPaths.add(p);

    if (!filesByPath.has(p)) {
      return {
        ok: false,
        error: {
          code: "STALE_SELECTION",
          detail: `Selected file is no longer changed: ${p}`,
        },
      };
    }
    validatedSelectedPaths.push(valRes.value);
  }

  // 6. paths = selected paths, plus oldPath (validated) of every selected renamed file.
  // untrackedPaths = selected files whose kind === "untracked" (new path only).
  const finalPaths: GitPath[] = [...validatedSelectedPaths];
  const untrackedPaths: GitPath[] = [];

  for (const p of validatedSelectedPaths) {
    const file = filesByPath.get(p);
    if (!file) {
      continue;
    }
    if (file.kind === "untracked") {
      untrackedPaths.push(p);
    }
    if (file.kind === "renamed" && file.oldPath !== undefined) {
      const oldVal = validateGitPath(file.oldPath);
      if (!oldVal.ok) {
        return {
          ok: false,
          error: {
            code: "PATH_REJECTED",
            detail: `Invalid rename old path: ${file.oldPath} (${oldVal.error})`,
          },
        };
      }
      finalPaths.push(oldVal.value);
    }
  }

  // 7. strategy = head.kind === "unborn" ? "index" : "only".
  // If index: let extras = files with staged === true whose path and oldPath are not in paths;
  // if non-empty → BLOCKED with paths: extras.
  const strategy = input.head.kind === "unborn" ? "index" : "only";
  if (strategy === "index") {
    const committedPathSet = new Set<string>(finalPaths);
    const extras: string[] = [];

    for (const f of input.files) {
      if (f.staged) {
        const inPaths = committedPathSet.has(f.path) || (f.oldPath ? committedPathSet.has(f.oldPath) : false);
        if (!inPaths) {
          extras.push(f.path);
        }
      }
    }

    if (extras.length > 0) {
      return {
        ok: false,
        error: {
          code: "BLOCKED",
          detail: "Staged files outside selection must be committed or unstaged on an unborn branch.",
          paths: extras,
        },
      };
    }
  }

  // 8. If push.enabled:
  // head.kind === "detached" → BLOCKED ("Push is unavailable on a detached HEAD").
  // push.remote must match /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, be <= 255 chars, and be a member of remotes, else BLOCKED.
  // branch = head.name (branch) or head.branch (unborn).
  // setUpstream = head.kind === "unborn" || head.upstream === undefined.
  let pushSpec: CommitPlan["push"] | undefined;
  if (input.push.enabled) {
    if (input.head.kind === "detached") {
      return {
        ok: false,
        error: {
          code: "BLOCKED",
          detail: "Push is unavailable on a detached HEAD",
        },
      };
    }

    const { remote } = input.push;
    if (
      !REMOTE_REGEX.test(remote) ||
      remote.length > 255 ||
      !input.remotes.includes(remote)
    ) {
      return {
        ok: false,
        error: {
          code: "BLOCKED",
          detail: `Invalid remote for push: ${remote}`,
        },
      };
    }

    const branch = (input.head.kind === "unborn" ? input.head.branch : input.head.name) as BranchName;
    const setUpstream = input.head.kind === "unborn" || input.head.upstream === undefined;

    pushSpec = {
      remote: remote as RemoteName,
      branch,
      setUpstream,
    };
  }

  // 9. Return the CommitPlan (repoRoot unchanged)
  return {
    ok: true,
    value: {
      repoRoot: input.repoRoot,
      paths: finalPaths,
      untrackedPaths,
      strategy,
      message: msgResult.value,
      timestamp: timeResult.value,
      ...(pushSpec ? { push: pushSpec } : {}),
    },
  };
}

/**
 * Builds an AmendPlan for amending the HEAD commit date (Phase 5).
 * Preconditions: blockers.length === 0, head.kind === "branch",
 * resolveTimestamp succeeds, and isPublished === false.
 */
export function buildAmendPlan(input: AmendPlanInput): Result<AmendPlan, PlanError> {
  if (input.blockers.length > 0) {
    return {
      ok: false,
      error: {
        code: "BLOCKED",
        detail: `Operation blocked: ${input.blockers.join(", ")} in progress.`,
      },
    };
  }

  if (input.head.kind !== "branch") {
    return {
      ok: false,
      error: {
        code: "BLOCKED",
        detail: "Amending HEAD date is only supported on a branch.",
      },
    };
  }

  if (input.isPublished) {
    return {
      ok: false,
      error: {
        code: "BLOCKED",
        detail: "Commit is already on a remote; changing its date would require a force push (unsupported).",
      },
    };
  }

  const timeResult = resolveTimestamp(input.when.local, input.when.offsetMinutes);
  if (!timeResult.ok) {
    return {
      ok: false,
      error: {
        code: "DATE_REJECTED",
        detail: `Date rejected: ${timeResult.error}`,
      },
    };
  }

  return {
    ok: true,
    value: {
      repoRoot: input.repoRoot,
      timestamp: timeResult.value,
    },
  };
}
