import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as runner from "../../src/host/runner";
import { getRepoActivity, clearActivityCache } from "../../src/host/activity";
import type { HeadState } from "../../src/core/types";

describe("Host Activity Service and readGit (Milestone B)", () => {
  const tempDirs: string[] = [];

  function createTestRepo(initialCommit = true): string {
    const dir = mkdtempSync(join(tmpdir(), "gitflux-activity-"));
    tempDirs.push(dir);
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Activity Test"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "me@example.com"], { cwd: dir, stdio: "ignore" });
    if (initialCommit) {
      writeFileSync(join(dir, "file.txt"), "hello\n", "utf8");
      execFileSync("git", ["add", "file.txt"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir, stdio: "ignore" });
    }
    return dir;
  }

  beforeEach(() => {
    clearActivityCache();
  });

  afterEach(() => {
    clearActivityCache();
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0;
  });

  it("excludes another author's commits", async () => {
    const dir = createTestRepo(true);

    // Commit 1 by me@example.com
    writeFileSync(join(dir, "me.txt"), "me\n", "utf8");
    execFileSync("git", ["add", "me.txt"], { cwd: dir, stdio: "ignore" });
    execFileSync(
      "git",
      ["commit", "--author=Activity Test <me@example.com>", "-m", "commit by me"],
      { cwd: dir, stdio: "ignore" },
    );

    // Commit 2 by other@example.com
    writeFileSync(join(dir, "other.txt"), "other\n", "utf8");
    execFileSync("git", ["add", "other.txt"], { cwd: dir, stdio: "ignore" });
    execFileSync(
      "git",
      ["commit", "--author=Other User <other@example.com>", "-m", "commit by other"],
      { cwd: dir, stdio: "ignore" },
    );

    const head: HeadState = { kind: "branch", name: "main", ahead: 0, behind: 0 };
    const activity = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
    });

    expect(activity.email).toBe("me@example.com");
    // me@example.com committed initial commit + "commit by me" = 2 commits
    const totalMeCommits = Object.values(activity.dayCounts).reduce((a, b) => a + b, 0);
    expect(totalMeCommits).toBe(2);
  });

  it("returns email: undefined and skips git log when user.email is unset", async () => {
    const dir = createTestRepo(true);

    const readGitSpy = vi.spyOn(runner, "readGit");
    // Simulate git config --get user.email failing with exit code 1 (NONZERO)
    readGitSpy.mockResolvedValueOnce({ ok: false, error: "NONZERO" });

    const head: HeadState = { kind: "branch", name: "main", ahead: 0, behind: 0 };
    const activity = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
    });

    expect(activity.email).toBeUndefined();
    expect(activity.dayCounts).toEqual({});

    // Verify git log was not called
    const logCalls = readGitSpy.mock.calls.filter((call) => call[2][0] === "log");
    expect(logCalls).toHaveLength(0);

    readGitSpy.mockRestore();
  });

  it("hits the cache on second call with the same HEAD (git log skipped)", async () => {
    const dir = createTestRepo(true);
    const head: HeadState = { kind: "branch", name: "main", ahead: 0, behind: 0 };
    const fixedNow = 1772625600; // 2026-03-04

    const readGitSpy = vi.spyOn(runner, "readGit");

    // First call: populates cache
    const first = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
      nowEpochSeconds: fixedNow,
    });
    expect(first.email).toBe("me@example.com");

    const firstLogCalls = readGitSpy.mock.calls.filter((call) => call[2][0] === "log").length;
    expect(firstLogCalls).toBe(1);

    // Second call with same HEAD and same day
    const second = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
      nowEpochSeconds: fixedNow,
    });
    expect(second.email).toBe(first.email);
    expect(second.dayCounts).toEqual(first.dayCounts);

    // git log must not have been called again
    const secondLogCalls = readGitSpy.mock.calls.filter((call) => call[2][0] === "log").length;
    expect(secondLogCalls).toBe(1);

    readGitSpy.mockRestore();
  });

  it("misses the cache when a new commit or amend changes HEAD", async () => {
    const dir = createTestRepo(true);
    const head: HeadState = { kind: "branch", name: "main", ahead: 0, behind: 0 };
    const fixedNow = 1772625600;

    const readGitSpy = vi.spyOn(runner, "readGit");

    // First call
    const first = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
      nowEpochSeconds: fixedNow,
    });
    const firstCount = Object.values(first.dayCounts).reduce((a, b) => a + b, 0);

    // Create a new commit to advance HEAD
    writeFileSync(join(dir, "update.txt"), "update\n", "utf8");
    execFileSync("git", ["add", "update.txt"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "new commit"], { cwd: dir, stdio: "ignore" });

    // Call again -> HEAD sha has changed -> cache miss
    const second = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
      nowEpochSeconds: fixedNow,
    });
    const secondCount = Object.values(second.dayCounts).reduce((a, b) => a + b, 0);

    expect(secondCount).toBe(firstCount + 1);

    const logCalls = readGitSpy.mock.calls.filter((call) => call[2][0] === "log").length;
    expect(logCalls).toBe(2);

    readGitSpy.mockRestore();
  });

  it("returns empty dayCounts without calling git log for an unborn repo", async () => {
    const dir = createTestRepo(false); // no commits
    const head: HeadState = { kind: "unborn", branch: "main" };

    const readGitSpy = vi.spyOn(runner, "readGit");

    const activity = await getRepoActivity({
      gitPath: "git",
      repoRoot: dir,
      repoId: dir,
      head,
    });

    expect(activity.email).toBe("me@example.com");
    expect(activity.dayCounts).toEqual({});

    // Verify git log was never invoked
    const logCalls = readGitSpy.mock.calls.filter((call) => call[2][0] === "log");
    expect(logCalls).toHaveLength(0);

    readGitSpy.mockRestore();
  });

  it("ignores inherited GIT_DIR environment variable in readGit", async () => {
    const dir = createTestRepo(true);

    const originalGitDir = process.env.GIT_DIR;
    try {
      // Set an invalid GIT_DIR that would normally break git commands
      process.env.GIT_DIR = "/invalid/nonexistent/git/dir";

      const res = await runner.readGit("git", dir, ["status", "--porcelain"]);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe("");
      }
    } finally {
      if (originalGitDir !== undefined) {
        process.env.GIT_DIR = originalGitDir;
      } else {
        delete process.env.GIT_DIR;
      }
    }
  });
});
