import * as vscode from "vscode";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Repository } from "./vendor/git";
import { GitStatus } from "./gitStatus";
import { isHeadPublished } from "./runner";
import type {
  Blocker,
  ChangedFile,
  FileChangeKind,
  HeadState,
  RepoSnapshot,
} from "../shared/protocol";
import { logDiag } from "./diag";

const revisionsByRepo = new Map<string, number>();

export function getNextRevision(repoId: string): number {
  const current = revisionsByRepo.get(repoId) ?? 0;
  const next = current + 1;
  revisionsByRepo.set(repoId, next);
  return next;
}

export function resetRevisions(): void {
  revisionsByRepo.clear();
}

/**
 * Normalizes a filesystem path for comparisons and repo-relative calculation:
 * - Replaces backslashes with slashes.
 * - Resolves symlinks if path exists (or resolves parent directory if file is absent).
 * - On macOS, strips "/private" prefix from "/private/tmp", "/private/var", "/private/etc"
 *   so that symlinked system directories match their canonical mount names.
 */
export function normalizeFsPath(fsPath: string): string {
  let norm = fsPath.replace(/\\/g, "/");
  try {
    norm = realpathSync(fsPath).replace(/\\/g, "/");
  } catch {
    try {
      const idx = norm.lastIndexOf("/");
      if (idx > 0) {
        const parent = norm.slice(0, idx);
        const name = norm.slice(idx);
        norm = realpathSync(parent).replace(/\\/g, "/") + name;
      }
    } catch {
      // ignore
    }
  }
  if (process.platform === "darwin") {
    if (norm === "/private/tmp" || norm.startsWith("/private/tmp/")) {
      norm = norm.slice(8);
    } else if (norm === "/private/var" || norm.startsWith("/private/var/")) {
      norm = norm.slice(8);
    } else if (norm === "/private/etc" || norm.startsWith("/private/etc/")) {
      norm = norm.slice(8);
    }
  }
  return norm;
}

/**
 * Normalizes an absolute file URI into a POSIX repo-relative path.
 */
export function toRepoRelative(repoRoot: string, fileUri: vscode.Uri): string {
  const normRoot = normalizeFsPath(repoRoot).replace(/\/$/, "");
  const normPath = normalizeFsPath(fileUri.fsPath);

  if (normPath.startsWith(normRoot + "/")) {
    return normPath.slice(normRoot.length + 1);
  }
  return normPath;
}

/**
 * Checks for git operations in progress that block commits (§10):
 * MERGE, REBASE, CHERRY_PICK, REVERT, UNMERGED_FILES.
 */
export function detectBlockers(repo: Repository, gitDir?: string): Blocker[] {
  const blockers: Blocker[] = [];

  // Check for merge conflicts in repository state
  if (repo.state.mergeChanges.length > 0) {
    blockers.push("UNMERGED_FILES");
  }

  // Check if rebaseCommit is present
  if (repo.state.rebaseCommit !== undefined) {
    blockers.push("REBASE");
  }

  // Check git directory special files if gitDir is provided or known
  const dir = gitDir ?? (repo as unknown as { dotGit?: { fsPath: string } }).dotGit?.fsPath ?? join(repo.rootUri.fsPath, ".git");

  try {
    if (existsSync(join(dir, "MERGE_HEAD"))) {
      if (!blockers.includes("MERGE")) blockers.push("MERGE");
    }
    if (existsSync(join(dir, "CHERRY_PICK_HEAD"))) {
      if (!blockers.includes("CHERRY_PICK")) blockers.push("CHERRY_PICK");
    }
    if (existsSync(join(dir, "REVERT_HEAD"))) {
      if (!blockers.includes("REVERT")) blockers.push("REVERT");
    }
    if (existsSync(join(dir, "rebase-merge")) || existsSync(join(dir, "rebase-apply"))) {
      if (!blockers.includes("REBASE")) blockers.push("REBASE");
    }
  } catch {
    // If dotGit does not exist (worktrees, bare), ignore filesystem check
  }

  return blockers;
}

function mapStatusToKind(status: number): { kind: FileChangeKind; isIgnored: boolean } {
  switch (status) {
    case GitStatus.INDEX_MODIFIED:
    case GitStatus.MODIFIED:
      return { kind: "modified", isIgnored: false };
    case GitStatus.INDEX_ADDED:
    case GitStatus.INTENT_TO_ADD:
      return { kind: "added", isIgnored: false };
    case GitStatus.INDEX_DELETED:
    case GitStatus.DELETED:
      return { kind: "deleted", isIgnored: false };
    case GitStatus.INDEX_RENAMED:
    case GitStatus.INDEX_COPIED:
    case GitStatus.INTENT_TO_RENAME:
      return { kind: "renamed", isIgnored: false };
    case GitStatus.UNTRACKED:
      return { kind: "untracked", isIgnored: false };
    case GitStatus.TYPE_CHANGED:
      return { kind: "typechange", isIgnored: false };
    case GitStatus.IGNORED:
      return { kind: "modified", isIgnored: true };
    default:
      return { kind: "modified", isIgnored: false };
  }
}

export function extractChangeUris(change: {
  uri: vscode.Uri;
  originalUri?: vscode.Uri | undefined;
  renameUri?: vscode.Uri | undefined;
  status?: unknown;
}): { newUri: vscode.Uri; oldUri?: vscode.Uri | undefined } {
  const isRename =
    change.status === GitStatus.INDEX_RENAMED ||
    change.status === GitStatus.INTENT_TO_RENAME ||
    change.renameUri !== undefined;

  if (isRename) {
    const newUri = change.renameUri ?? change.uri;
    const oldUri = change.originalUri;
    return {
      newUri,
      oldUri: oldUri && oldUri.fsPath !== newUri.fsPath ? oldUri : undefined,
    };
  }

  const newUri = change.uri;
  const origUri = change.originalUri;
  return {
    newUri,
    oldUri: origUri && origUri.fsPath !== newUri.fsPath ? origUri : undefined,
  };
}

/**
 * Merges indexChanges and workingTreeChanges into a list of ChangedFiles.
 */
export function buildChangedFiles(repo: Repository): ChangedFile[] {
  const repoRoot = repo.rootUri.fsPath;
  const fileMap = new Map<string, { staged: boolean; unstaged: boolean; kind: FileChangeKind; oldPath?: string | undefined }>();

  // Set of submodule paths
  const submodulePaths = new Set(
    repo.state.submodules.map((s) => s.path.replace(/\\/g, "/")),
  );

  // 1. Process indexChanges (staged)
  for (const change of repo.state.indexChanges) {
    const { kind, isIgnored } = mapStatusToKind(change.status);
    if (isIgnored) continue;

    const { newUri, oldUri } = extractChangeUris(change);
    const relPath = toRepoRelative(repoRoot, newUri);
    let oldPath: string | undefined;
    if (oldUri && oldUri.fsPath !== newUri.fsPath) {
      oldPath = toRepoRelative(repoRoot, oldUri);
    }

    fileMap.set(relPath, {
      staged: true,
      unstaged: false,
      kind: submodulePaths.has(relPath) ? "submodule" : kind,
      oldPath,
    });
  }

  // 2. Process workingTreeChanges (unstaged)
  for (const change of repo.state.workingTreeChanges) {
    const { kind, isIgnored } = mapStatusToKind(change.status);
    if (isIgnored) continue;

    const { newUri, oldUri } = extractChangeUris(change);
    const relPath = toRepoRelative(repoRoot, newUri);
    const existing = fileMap.get(relPath);

    if (existing) {
      existing.unstaged = true;
    } else {
      let oldPath: string | undefined;
      if (oldUri && oldUri.fsPath !== newUri.fsPath) {
        oldPath = toRepoRelative(repoRoot, oldUri);
      }
      fileMap.set(relPath, {
        staged: false,
        unstaged: true,
        kind: submodulePaths.has(relPath) ? "submodule" : kind,
        oldPath,
      });
    }
  }

  // Convert map to array
  const result: ChangedFile[] = [];
  for (const [path, info] of fileMap.entries()) {
    result.push({
      path,
      kind: info.kind,
      staged: info.staged,
      unstaged: info.unstaged,
      ...(info.oldPath ? { oldPath: info.oldPath } : {}),
    });
  }

  return result;
}

/**
 * Builds HeadState from repository.state.HEAD.
 */
export function buildHeadState(repo: Repository): HeadState {
  const head = repo.state.HEAD;
  if (!head || !head.commit) {
    return {
      kind: "unborn",
      branch: head?.name ?? "main",
    };
  }

  if (!head.name) {
    return {
      kind: "detached",
      shortSha: head.commit.slice(0, 7),
    };
  }

  return {
    kind: "branch",
    name: head.name,
    ...(head.upstream?.name ? { upstream: head.upstream.name } : {}),
    ahead: head.ahead ?? 0,
    behind: head.behind ?? 0,
  };
}

/**
 * Builds an immutable RepoSnapshot from Repository state.
 */
export async function buildRepoSnapshot(
  repo: Repository,
  repoId: string,
  gitDir?: string,
  gitPath?: string,
): Promise<RepoSnapshot> {
  const revision = getNextRevision(repoId);

  if (process.env.GITFLUX_SPIKE_LOG === "1") {
    const mapChange = (c: { uri: vscode.Uri; originalUri?: vscode.Uri | undefined; renameUri?: vscode.Uri | undefined; status?: unknown }) => ({
      fsPath: c.uri.fsPath,
      ...(c.originalUri ? { originalUri: c.originalUri.fsPath } : {}),
      ...(c.renameUri ? { renameUri: c.renameUri.fsPath } : {}),
      ...(c.status !== undefined ? { status: c.status } : {}),
    });
    logDiag("Repository.state entries on snapshot build", {
      repoId,
      workingTreeChanges: repo.state.workingTreeChanges.map(mapChange),
      indexChanges: repo.state.indexChanges.map(mapChange),
      mergeChanges: repo.state.mergeChanges.map(mapChange),
    });
  }

  const head = buildHeadState(repo);
  const blockers = detectBlockers(repo, gitDir);
  const files = buildChangedFiles(repo);
  const remotes = repo.state.remotes.map((r) => r.name);

  // Read committer date of HEAD if not unborn
  let headCommitEpochSeconds: number | undefined;
  if (repo.state.HEAD?.commit) {
    try {
      const commit = await repo.getCommit(repo.state.HEAD.commit);
      if (commit.commitDate) {
        headCommitEpochSeconds = Math.floor(commit.commitDate.getTime() / 1000);
      }
    } catch {
      // Ignore if getCommit fails
    }
  }

  // Publication check (computed only when head.kind === "branch")
  let headPublished: boolean | undefined;
  if (head.kind === "branch") {
    try {
      headPublished = await isHeadPublished(gitPath ?? "git", repo.rootUri.fsPath);
    } catch {
      headPublished = false;
    }
  }

  // Repo name from rootUri
  const rootPath = repo.rootUri.fsPath.replace(/\\/g, "/");
  const name = rootPath.slice(rootPath.lastIndexOf("/") + 1) || rootPath;

  return {
    repoId,
    name,
    repoRoot: repo.rootUri.fsPath,
    revision,
    head,
    remotes,
    blockers,
    files,
    ...(headCommitEpochSeconds !== undefined ? { headCommitEpochSeconds } : {}),
    ...(headPublished !== undefined ? { headPublished } : {}),
  };
}
