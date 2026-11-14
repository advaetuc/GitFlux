import { readGit } from "./runner";
import { bucketByUtcDay, utcDateOf, type DayCounts } from "../core/heatmap";
import type { HeadState } from "../core/types";

export interface RepoActivity {
  readonly email: string | undefined;
  readonly dayCounts: DayCounts;
}

interface ActivityCacheEntry {
  readonly cacheKey: string;
  readonly email: string | undefined;
  readonly dayCounts: DayCounts;
}

const activityCache = new Map<string, ActivityCacheEntry>();

export function clearActivityCache(): void {
  activityCache.clear();
}

export interface ActivityQuery {
  readonly gitPath: string;
  readonly repoRoot: string;
  readonly repoId: string;
  readonly head: HeadState;
  readonly headSha?: string;
  readonly nowEpochSeconds?: number;
}

/**
 * Fetches author activity for a repository.
 * Pure read-only via readGit. Caches per repoId keyed by `${headSha}:${utcDateOf(now)}`.
 */
export async function getRepoActivity(
  queryOrGitPath: ActivityQuery | string,
  repoRoot?: string,
  repoId?: string,
  head?: HeadState,
  headSha?: string,
  nowEpochSeconds?: number,
): Promise<RepoActivity> {
  const query: ActivityQuery =
    typeof queryOrGitPath === "string"
      ? {
          gitPath: queryOrGitPath,
          repoRoot: repoRoot ?? "",
          repoId: repoId ?? repoRoot ?? "",
          head: head ?? { kind: "branch", name: "main", ahead: 0, behind: 0 },
          ...(headSha ? { headSha } : {}),
          ...(nowEpochSeconds !== undefined ? { nowEpochSeconds } : {}),
        }
      : queryOrGitPath;

  const now = query.nowEpochSeconds ?? Math.floor(Date.now() / 1000);

  // 1. Read git user.email
  const emailRes = await readGit(query.gitPath, query.repoRoot, ["config", "--get", "user.email"]);
  let email: string | undefined;
  if (emailRes.ok) {
    const raw = emailRes.value.trim();
    if (raw !== "") {
      email = raw.slice(0, 254);
    }
  }

  // If email missing or repo unborn, return empty dayCounts without running git log
  if (!email || query.head.kind === "unborn") {
    return { email, dayCounts: {} };
  }

  // 2. Resolve headSha if not provided
  let currentHeadSha = query.headSha;
  if (!currentHeadSha) {
    const revRes = await readGit(query.gitPath, query.repoRoot, ["rev-parse", "HEAD"]);
    if (revRes.ok) {
      currentHeadSha = revRes.value.trim();
    } else {
      return { email, dayCounts: {} };
    }
  }

  // 3. Check memory cache for this repoId
  const cacheKey = `${currentHeadSha}:${utcDateOf(now)}`;
  const cached = activityCache.get(query.repoId);
  if (cached && cached.cacheKey === cacheKey && cached.email === email) {
    return { email: cached.email, dayCounts: cached.dayCounts };
  }

  // 4. Fetch commit epoch seconds via git log
  const logRes = await readGit(query.gitPath, query.repoRoot, [
    "log",
    "--since=90.days",
    "--max-count=5000",
    "--fixed-strings",
    `--author=${email}`,
    "--format=%at",
  ]);

  if (!logRes.ok) {
    return { email, dayCounts: {} };
  }

  const timestamps: number[] = [];
  for (const line of logRes.value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const sec = parseInt(trimmed, 10);
    if (!Number.isNaN(sec)) {
      timestamps.push(sec);
    }
  }

  const dayCounts = bucketByUtcDay(timestamps);

  // Cache result
  activityCache.set(query.repoId, {
    cacheKey,
    email,
    dayCounts,
  });

  return { email, dayCounts };
}
