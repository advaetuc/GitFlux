import * as vscode from "vscode";
import { statSync } from "node:fs";
import { relative } from "node:path";
import type { API as GitAPI, Repository } from "./vendor/git";
import { resolveRepository, normalizeFsPath } from "./gitApi";

export interface ResolvedSelection {
  readonly repo: Repository | undefined;
  readonly paths: readonly string[];
  readonly droppedCount: number;
}

interface SCMResource {
  resourceUri?: vscode.Uri;
}

interface SCMGroup {
  resourceStates?: SCMResource[];
}

/**
 * Extracts candidate vscode.Uri objects from unknown context menu / palette arguments (AM-17).
 */
export function extractUrisFromArgs(args: unknown[]): vscode.Uri[] {
  if (args.length === 0) {
    // Palette fallback: active text editor
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc && activeDoc.uri.scheme === "file") {
      return [activeDoc.uri];
    }
    return [];
  }

  const uris: vscode.Uri[] = [];

  // Shape 1: Explorer context menu (clickedUri, selectedUris[])
  const first = args[0];
  const second = args[1];

  if (
    first &&
    typeof first === "object" &&
    "scheme" in first &&
    Array.isArray(second) &&
    second.length > 0 &&
    second.every((u) => u && typeof u === "object" && "scheme" in u)
  ) {
    return second as vscode.Uri[];
  }

  // General shape: multiple items (Uris, SourceControlResourceStates, or Groups)
  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;

    // Direct Uri
    if ("scheme" in arg && "fsPath" in arg) {
      uris.push(arg as vscode.Uri);
      continue;
    }

    // SourceControlResourceState ({ resourceUri })
    const scmRes = arg as SCMResource;
    if (scmRes.resourceUri && "scheme" in scmRes.resourceUri) {
      uris.push(scmRes.resourceUri);
      continue;
    }

    // SourceControlResourceGroup ({ resourceStates: [...] })
    const scmGroup = arg as SCMGroup;
    if (Array.isArray(scmGroup.resourceStates)) {
      for (const res of scmGroup.resourceStates) {
        if (res.resourceUri && "scheme" in res.resourceUri) {
          uris.push(res.resourceUri);
        }
      }
    }
  }

  return uris;
}

/**
 * Resolves URIs into repository-relative POSIX paths:
 * - Drops non-file: URIs
 * - Groups by repo root (first repo wins; others counted in droppedCount)
 * - Expands folders to changed files matching folder prefix in repo
 */
export function resolveSelection(
  api: GitAPI,
  args: unknown[],
  changedFilesInRepo?: readonly string[],
): ResolvedSelection {
  const candidateUris = extractUrisFromArgs(args);

  if (candidateUris.length === 0) {
    return { repo: undefined, paths: [], droppedCount: 0 };
  }

  let targetRepo: Repository | undefined;
  const targetUris: vscode.Uri[] = [];
  let droppedCount = 0;

  for (const uri of candidateUris) {
    // Drop non-file schemes
    if (uri.scheme !== "file") {
      droppedCount++;
      continue;
    }

    const repo = resolveRepository(api, uri);
    if (!repo) {
      droppedCount++;
      continue;
    }

    if (!targetRepo) {
      targetRepo = repo;
      targetUris.push(uri);
    } else if (normalizeFsPath(targetRepo.rootUri.fsPath) === normalizeFsPath(repo.rootUri.fsPath)) {
      targetUris.push(uri);
    } else {
      // Belongs to another repository
      droppedCount++;
    }
  }

  if (!targetRepo) {
    return { repo: undefined, paths: [], droppedCount };
  }

  const repoRoot = targetRepo.rootUri.fsPath;
  const normRepoRoot = normalizeFsPath(repoRoot);
  const paths: string[] = [];

  for (const uri of targetUris) {
    const normUriPath = normalizeFsPath(uri.fsPath);
    const rel = relative(normRepoRoot, normUriPath).replace(/\\/g, "/");
    if (rel.startsWith("..") || rel.length === 0) {
      droppedCount++;
      continue;
    }

    // Check if path is a directory (via filesystem or matching prefix in changed files)
    let isDir = false;
    try {
      const stat = statSync(uri.fsPath);
      isDir = stat.isDirectory();
    } catch {
      // If path does not exist on disk, check if it matches a folder prefix in changed files
      if (changedFilesInRepo && changedFilesInRepo.some((f) => f.startsWith(rel + "/"))) {
        isDir = true;
      }
    }

    if (isDir) {
      // Expand folder to changed files under this folder prefix
      if (changedFilesInRepo) {
        const prefix = rel + "/";
        let folderMatched = false;
        for (const chPath of changedFilesInRepo) {
          if (chPath.startsWith(prefix) && !paths.includes(chPath)) {
            paths.push(chPath);
            folderMatched = true;
          }
        }
        if (!folderMatched) {
          droppedCount++;
        }
      }
    } else {
      if (!paths.includes(rel)) {
        paths.push(rel);
      }
    }
  }

  return {
    repo: targetRepo,
    paths,
    droppedCount,
  };
}
