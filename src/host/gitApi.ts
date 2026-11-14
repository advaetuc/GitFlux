import * as vscode from "vscode";
import type { GitExtension, API as GitAPI, Repository } from "./vendor/git";
import { normalizeFsPath } from "./repoState";

export { normalizeFsPath };

export function parseGitVersion(versionOutput: string): { major: number; minor: number; patch: number } | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(versionOutput);
  if (!match || !match[1] || !match[2]) {
    return undefined;
  }
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = match[3] ? parseInt(match[3], 10) : 0;
  return { major, minor, patch };
}

export function isGitVersionSupported(versionOutput: string): boolean {
  const parsed = parseGitVersion(versionOutput);
  if (!parsed) return false;
  // Minimum Git 2.26.0 required (§9.1)
  if (parsed.major > 2) return true;
  if (parsed.major === 2 && parsed.minor >= 26) return true;
  return false;
}

/**
 * Obtains the vscode.git API via the verified sequence (S3).
 * Gates on workspace configuration `git.enabled`.
 */
export async function getGitApi(): Promise<GitAPI | undefined> {
  const gitConfig = vscode.workspace.getConfiguration("git");
  const enabled = gitConfig.get<boolean>("enabled", true);
  if (!enabled) {
    return undefined;
  }

  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }

  const exports = await extension.activate();
  return exports.getAPI(1);
}

/**
 * Resolves repository for a URI with closest-root semantics.
 */
export function resolveRepository(api: GitAPI, uri: vscode.Uri): Repository | undefined {
  const repo = api.getRepository(uri);
  if (repo) {
    return repo;
  }

  const normUri = normalizeFsPath(uri.fsPath);

  // Fallback: search all open repositories for longest matching root prefix
  let bestMatch: Repository | undefined;
  let bestLen = -1;

  for (const r of api.repositories) {
    const normRoot = normalizeFsPath(r.rootUri.fsPath);
    if ((normUri === normRoot || normUri.startsWith(normRoot + "/")) && normRoot.length > bestLen) {
      bestMatch = r;
      bestLen = normRoot.length;
    }
  }

  return bestMatch;
}
