import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  sanitizeStderr,
  classifyGitError,
  buildGitEnv,
  runGit,
  parseVerifyOutput,
  mapPushError,
  runUnderMutex,
  executePlan,
  executeAmendPlan,
  isHeadPublished,
} from "../../src/host/runner";
import { GitErrorCodes } from "../../src/host/gitStatus";
import type { AmendPlan, CommitPlan, GitPath } from "../../src/core/types";
import { buildCommitPlan, buildAmendPlan } from "../../src/core/plan";
import type { Repository } from "../../src/host/vendor/git";

describe("runner sanitization & classification", () => {
  it("strips ANSI escape sequences and truncates to 4 KB", () => {
    const ansiString = "\x1B[31mError occurred\x1B[0m: \x1B[1mfailed\x1B[0m";
    expect(sanitizeStderr(ansiString)).toBe("Error occurred: failed");

    const hugeString = "a".repeat(5000);
    const sanitized = sanitizeStderr(hugeString);
    expect(sanitized).toHaveLength(4096);
  });

  it("classifies nothing to commit", () => {
    expect(classifyGitError("nothing to commit, working tree clean").code).toBe("NOTHING_TO_COMMIT");
    expect(classifyGitError("no changes added to commit").code).toBe("NOTHING_TO_COMMIT");
  });

  it("classifies identity missing", () => {
    expect(classifyGitError("fatal: unable to auto-detect email address").code).toBe("IDENTITY_MISSING");
    expect(classifyGitError("*** Please tell me who you are.").code).toBe("IDENTITY_MISSING");
  });

  it("classifies index.lock contention", () => {
    expect(classifyGitError("fatal: Unable to create '.git/index.lock': File exists.").code).toBe("INDEX_LOCKED");
  });

  it("classifies signing failed and offers sendToTerminal fallback", () => {
    const res = classifyGitError("error: gpg failed to sign the data");
    expect(res.code).toBe("SIGNING_FAILED");
    expect(res.fallback).toBe("sendToTerminal");
  });

  it("classifies hook rejection", () => {
    expect(classifyGitError("pre-commit hook failed (add --no-verify to bypass)").code).toBe("HOOK_REJECTED");
    expect(classifyGitError("commit-msg hook rejected").code).toBe("HOOK_REJECTED");
  });

  it("classifies generic git failure", () => {
    expect(classifyGitError("fatal: some unknown git error").code).toBe("GIT_FAILED");
  });
});

describe("buildGitEnv", () => {
  it("sanitizes environment variables per §8.2", () => {
    process.env["GIT_DIR"] = "/fake/git";
    process.env["GIT_WORK_TREE"] = "/fake/wt";
    process.env["GIT_INDEX_FILE"] = "/fake/idx";
    process.env["GIT_AUTHOR_NAME"] = "Attacker";
    process.env["GIT_COMMITTER_NAME"] = "Attacker";

    const env = buildGitEnv({ GIT_AUTHOR_DATE: "2026-03-02T10:41:07+0530" });

    expect(env["GIT_DIR"]).toBeUndefined();
    expect(env["GIT_WORK_TREE"]).toBeUndefined();
    expect(env["GIT_INDEX_FILE"]).toBeUndefined();
    expect(env["GIT_AUTHOR_NAME"]).toBeUndefined();
    expect(env["GIT_COMMITTER_NAME"]).toBeUndefined();

    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["LC_MESSAGES"]).toBe("C");
    expect(env["GIT_AUTHOR_DATE"]).toBe("2026-03-02T10:41:07+0530");

    delete process.env["GIT_DIR"];
    delete process.env["GIT_WORK_TREE"];
    delete process.env["GIT_INDEX_FILE"];
    delete process.env["GIT_AUTHOR_NAME"];
    delete process.env["GIT_COMMITTER_NAME"];
  });
});

describe("runGit security guard", () => {
  it("refuses git.path ending in .cmd or .bat", async () => {
    const res = await runGit("C:\\Git\\bin\\git.cmd", ["status"], { cwd: "." });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("Refused to run batch script wrapper (.cmd/.bat)");

    const resBat = await runGit("/path/to/git.bat", ["status"], { cwd: "." });
    expect(resBat.ok).toBe(false);
    expect(resBat.stderr).toContain("Refused to run batch script wrapper (.cmd/.bat)");
  });
});

describe("mapPushError", () => {
  it("maps PushRejected", () => {
    expect(mapPushError({ gitErrorCode: GitErrorCodes.PushRejected })).toEqual({
      code: "PUSH_REJECTED",
    });
  });

  it("maps AuthenticationFailed with fallback", () => {
    expect(mapPushError({ gitErrorCode: GitErrorCodes.AuthenticationFailed })).toEqual({
      code: "AUTH_FAILED",
      fallback: "sendToTerminal",
    });
  });

  it("maps RemoteConnectionError", () => {
    expect(mapPushError({ gitErrorCode: GitErrorCodes.RemoteConnectionError })).toEqual({
      code: "NETWORK",
    });
  });
});

describe("parseVerifyOutput", () => {
  it("parses valid verify output correctly", () => {
    const raw = "7f7f03a3a9358b252a7a2c6b0e5880d9ddf8b852\x001772428267 +0530\x001772428267 +0530\n";
    const res = parseVerifyOutput(raw);
    expect(res).toBeDefined();
    expect(res?.sha).toBe("7f7f03a3a9358b252a7a2c6b0e5880d9ddf8b852");
    expect(res?.author).toEqual({ epoch: 1772428267, offset: "+0530" });
    expect(res?.committer).toEqual({ epoch: 1772428267, offset: "+0530" });
  });

  it("returns undefined for malformed verify output", () => {
    expect(parseVerifyOutput("not-valid")).toBeUndefined();
    expect(parseVerifyOutput("sha\x00bad\x00bad")).toBeUndefined();
  });
});

describe("runUnderMutex", () => {
  it("serializes concurrent operations per repo", async () => {
    const order: number[] = [];

    const op1 = runUnderMutex("repoA", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });

    const op2 = runUnderMutex("repoA", () => {
      order.push(2);
      return Promise.resolve();
    });

    await Promise.all([op1, op2]);
    expect(order).toEqual([1, 2]);
  });
});

describe("real-git CLI fixture tests (Task 5)", () => {
  function createTestRepo(initialCommit = true): string {
    const dir = mkdtempSync(join(tmpdir(), "gitflux-runner-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Runner Test"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "runner@example.com"], { cwd: dir, stdio: "ignore" });
    if (initialCommit) {
      writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
      execFileSync("git", ["add", "base.txt"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir, stdio: "ignore" });
    }
    return dir;
  }

  function makeMockRepo(dir: string): Repository {
    return {
      id: "test-repo",
      rootUri: { fsPath: dir },
      push: () => Promise.resolve(),
      status: () => Promise.resolve(),
    } as unknown as Repository;
  }

  it("strategy 'only' leaves unrelated pre-staged file staged in the index", async () => {
    const dir = createTestRepo(true);
    try {
      writeFileSync(join(dir, "prestaged.txt"), "prestaged content\n", "utf8");
      execFileSync("git", ["add", "prestaged.txt"], { cwd: dir });

      writeFileSync(join(dir, "base.txt"), "modified base\n", "utf8");

      const plan: CommitPlan = {
        repoRoot: dir,
        paths: ["base.txt" as GitPath],
        untrackedPaths: [],
        strategy: "only",
        message: { paragraphs: ["commit only base"] },
        timestamp: {
          iso: "2026-03-02T10:41:07+0530",
          epochSeconds: 1772428267,
          offsetMinutes: 330,
        },
      };

      const result = await executePlan("git", makeMockRepo(dir), "test-repo", plan, () => {});
      expect(result.ok).toBe(true);

      const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
      expect(status).toContain("A  prestaged.txt");
      expect(status).not.toContain("base.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strategy 'only' with untracked file + failing hook: asserts rolledBack: true, HOOK_REJECTED, untracked file unstaged, pre-staged file untouched", async () => {
    const dir = createTestRepo(true);
    try {
      writeFileSync(join(dir, "prestaged.txt"), "pre-staged\n", "utf8");
      execFileSync("git", ["add", "prestaged.txt"], { cwd: dir });

      writeFileSync(join(dir, "untracked.txt"), "new content\n", "utf8");

      const hooksDir = join(dir, ".git", "hooks");
      const hookPath = join(hooksDir, "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\necho 'pre-commit hook failed' >&2\nexit 1\n", "utf8");
      chmodSync(hookPath, 0o755);

      const plan: CommitPlan = {
        repoRoot: dir,
        paths: ["untracked.txt" as GitPath],
        untrackedPaths: ["untracked.txt" as GitPath],
        strategy: "only",
        message: { paragraphs: ["will fail due to hook"] },
        timestamp: {
          iso: "2026-03-02T10:41:07+0530",
          epochSeconds: 1772428267,
          offsetMinutes: 330,
        },
      };

      const result = await executePlan("git", makeMockRepo(dir), "test-repo", plan, () => {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("HOOK_REJECTED");
        expect(result.rolledBack).toBe(true);
      }

      const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
      expect(status).toContain("?? untracked.txt");
      expect(status).toContain("A  prestaged.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strategy 'index' on an unborn branch commits successfully, and BLOCKED when staged ⊈ selected", async () => {
    const dir = createTestRepo(false);
    try {
      writeFileSync(join(dir, "first.txt"), "hello world\n", "utf8");

      const plan: CommitPlan = {
        repoRoot: dir,
        paths: ["first.txt" as GitPath],
        untrackedPaths: ["first.txt" as GitPath],
        strategy: "index",
        message: { paragraphs: ["initial commit"] },
        timestamp: {
          iso: "2026-03-02T10:41:07+0530",
          epochSeconds: 1772428267,
          offsetMinutes: 330,
        },
      };

      const result = await executePlan("git", makeMockRepo(dir), "test-repo", plan, () => {});
      expect(result.ok).toBe(true);
      const log = execFileSync("git", ["log", "-1", "--format=%B"], { cwd: dir, encoding: "utf8" }).trim();
      expect(log).toBe("initial commit");

      const unbornDir = createTestRepo(false);
      try {
        writeFileSync(join(unbornDir, "file1.txt"), "one\n", "utf8");
        writeFileSync(join(unbornDir, "file2.txt"), "two\n", "utf8");
        execFileSync("git", ["add", "file1.txt", "file2.txt"], { cwd: unbornDir });

        const planRes = buildCommitPlan({
          repoRoot: unbornDir,
          head: { kind: "unborn", branch: "main" },
          remotes: [],
          blockers: [],
          files: [
            { path: "file1.txt", kind: "added", staged: true, unstaged: false },
            { path: "file2.txt", kind: "added", staged: true, unstaged: false },
          ],
          selectedPaths: ["file1.txt"],
          message: { subject: "init", body: "" },
          when: { local: { year: 2026, month: 3, day: 2, hour: 10, minute: 0, second: 0 }, offsetMinutes: 0 },
          push: { enabled: false, remote: "" },
        });

        expect(planRes.ok).toBe(false);
        if (!planRes.ok) {
          expect(planRes.error.code).toBe("BLOCKED");
          expect(planRes.error.paths).toEqual(["file2.txt"]);
        }
      } finally {
        rmSync(unbornDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("commits renames with both oldPath and path passed via stdin pathspec", async () => {
    const dir = createTestRepo(true);
    try {
      execFileSync("git", ["mv", "base.txt", "renamed.txt"], { cwd: dir });

      const plan: CommitPlan = {
        repoRoot: dir,
        paths: ["renamed.txt" as GitPath, "base.txt" as GitPath],
        untrackedPaths: [],
        strategy: "only",
        message: { paragraphs: ["rename file"] },
        timestamp: {
          iso: "2026-03-02T10:41:07+0530",
          epochSeconds: 1772428267,
          offsetMinutes: 330,
        },
      };

      const result = await executePlan("git", makeMockRepo(dir), "test-repo", plan, () => {});
      expect(result.ok).toBe(true);

      const diff = execFileSync("git", ["diff", "--name-status", "HEAD~1", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
      expect(diff).toMatch(/^R\d*\s+base\.txt\s+renamed\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retries once after 300ms on INDEX_LOCKED contention and succeeds when lock is cleared within 150ms", async () => {
    const dir = createTestRepo(true);
    try {
      writeFileSync(join(dir, "base.txt"), "updated for lock test\n", "utf8");
      const lockPath = join(dir, ".git", "index.lock");
      writeFileSync(lockPath, "lock", "utf8");

      setTimeout(() => {
        rmSync(lockPath, { force: true });
      }, 150);

      const plan: CommitPlan = {
        repoRoot: dir,
        paths: ["base.txt" as GitPath],
        untrackedPaths: [],
        strategy: "only",
        message: { paragraphs: ["lock retry test"] },
        timestamp: {
          iso: "2026-03-02T10:41:07+0530",
          epochSeconds: 1772428267,
          offsetMinutes: 330,
        },
      };

      const result = await executePlan("git", makeMockRepo(dir), "test-repo", plan, () => {});
      expect(result.ok).toBe(true);
      if (result.ok && result.action === "run") {
        expect(result.verified).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sanitizes inherited GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_AUTHOR_DATE, and GIT_COMMITTER_DATE", async () => {
    const dir = createTestRepo(true);
    try {
      writeFileSync(join(dir, "base.txt"), "sanitization test\n", "utf8");

      process.env["GIT_DIR"] = "/nonexistent/git/dir";
      process.env["GIT_WORK_TREE"] = "/nonexistent/work/tree";
      process.env["GIT_INDEX_FILE"] = "/nonexistent/index";
      process.env["GIT_AUTHOR_DATE"] = "2000-01-01T00:00:00+0000";
      process.env["GIT_COMMITTER_DATE"] = "2000-01-01T00:00:00+0000";

      const targetTimestamp = {
        iso: "2026-03-02T10:41:07+0530",
        epochSeconds: 1772428267,
        offsetMinutes: 330,
      };

      const plan: CommitPlan = {
        repoRoot: dir,
        paths: ["base.txt" as GitPath],
        untrackedPaths: [],
        strategy: "only",
        message: { paragraphs: ["sanitized commit"] },
        timestamp: targetTimestamp,
      };

      const result = await executePlan("git", makeMockRepo(dir), "test-repo", plan, () => {});
      expect(result.ok).toBe(true);
      if (result.ok && result.action === "run") {
        expect(result.verified).toBe(true);
      }

      const cleanEnv = () => {
        delete process.env["GIT_DIR"];
        delete process.env["GIT_WORK_TREE"];
        delete process.env["GIT_INDEX_FILE"];
        delete process.env["GIT_AUTHOR_DATE"];
        delete process.env["GIT_COMMITTER_DATE"];
      };

      // Restore process.env before checking git log in the test process
      cleanEnv();

      const rawDate = execFileSync("git", ["log", "-1", "--format=%ad", "--date=raw"], { cwd: dir, encoding: "utf8" }).trim();
      expect(rawDate).toBe("1772428267 +0530");
    } finally {
      delete process.env["GIT_DIR"];
      delete process.env["GIT_WORK_TREE"];
      delete process.env["GIT_INDEX_FILE"];
      delete process.env["GIT_AUTHOR_DATE"];
      delete process.env["GIT_COMMITTER_DATE"];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("Phase 5: executeAmendPlan and isHeadPublished", () => {
    it("amends unpublished local HEAD date and leaves staged changes and working tree byte-identical", async () => {
      const dir = createTestRepo(true);
      try {
        // Create staged change
        writeFileSync(join(dir, "staged.txt"), "staged content for index\n", "utf8");
        execFileSync("git", ["add", "staged.txt"], { cwd: dir });

        // Create unstaged change in working tree
        writeFileSync(join(dir, "unstaged.txt"), "unstaged working tree file\n", "utf8");

        const stagedBefore = readFileSync(join(dir, "staged.txt"), "utf8");
        const unstagedBefore = readFileSync(join(dir, "unstaged.txt"), "utf8");

        const targetTimestamp = {
          iso: "2026-04-10T14:20:00+0200",
          epochSeconds: 1775823600,
          offsetMinutes: 120,
        };

        const amendPlan: AmendPlan = {
          repoRoot: dir,
          timestamp: targetTimestamp,
        };

        const progressSteps: string[] = [];
        const result = await executeAmendPlan(
          "git",
          makeMockRepo(dir),
          "test-repo",
          amendPlan,
          (step, status) => {
            progressSteps.push(`${step}:${status}`);
          },
        );

        expect(result.ok).toBe(true);
        if (result.ok && result.action === "amendHead") {
          expect(result.verified).toBe(true);
          expect(result.commitSha).toBeTruthy();
        }

        // Verify git log dates (both author and committer must match target)
        const logOutput = execFileSync("git", ["log", "-1", "--format=%ad|%cd", "--date=raw"], {
          cwd: dir,
          encoding: "utf8",
        }).trim();
        expect(logOutput).toBe("1775823600 +0200|1775823600 +0200");

        // Verify working tree and index status before and after are byte-identical
        const statusAfter = execFileSync("git", ["status", "--porcelain"], {
          cwd: dir,
          encoding: "utf8",
        });
        expect(statusAfter).toContain("A  staged.txt");
        expect(statusAfter).toContain("?? unstaged.txt");
        expect(readFileSync(join(dir, "staged.txt"), "utf8")).toBe(stagedBefore);
        expect(readFileSync(join(dir, "unstaged.txt"), "utf8")).toBe(unstagedBefore);

        // Verify progress step sequence
        expect(progressSteps).toEqual([
          "preflight:start",
          "preflight:ok",
          "commit:start",
          "commit:ok",
          "verify:start",
          "verify:ok",
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("hard-blocks published HEAD against a local bare remote (returns BLOCKED and does NOT run commit --amend)", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitflux-bare-"));
      const dir = createTestRepo(true);
      try {
        execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: bareDir });
        execFileSync("git", ["remote", "add", "origin", bareDir], { cwd: dir });
        execFileSync("git", ["push", "-u", "origin", "main"], { cwd: dir });

        const shaBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

        // Check isHeadPublished: should be true because HEAD is in origin/main
        const published = await isHeadPublished("git", dir);
        expect(published).toBe(true);

        // buildAmendPlan must return BLOCKED with the exact §10 message
        const planRes = buildAmendPlan({
          repoRoot: dir,
          head: { kind: "branch", name: "main", upstream: "origin/main", ahead: 0, behind: 0 },
          blockers: [],
          when: {
            local: { year: 2026, month: 4, day: 10, hour: 14, minute: 20, second: 0 },
            offsetMinutes: 120,
          },
          isPublished: published,
        });

        expect(planRes.ok).toBe(false);
        if (!planRes.ok) {
          expect(planRes.error.code).toBe("BLOCKED");
          expect(planRes.error.detail).toBe(
            "Commit is already on a remote; changing its date would require a force push (unsupported).",
          );
        }

        // Assert commit --amend was never run and commit sha is identical
        const shaAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
        expect(shaAfter).toBe(shaBefore);

        // Now create a new local commit without pushing it
        writeFileSync(join(dir, "local.txt"), "local commit content\n", "utf8");
        execFileSync("git", ["add", "local.txt"], { cwd: dir });
        execFileSync("git", ["commit", "-m", "unpushed local commit"], { cwd: dir });

        // Now isHeadPublished should be false because the new HEAD is not on origin
        const publishedNew = await isHeadPublished("git", dir);
        expect(publishedNew).toBe(false);

        // buildAmendPlan now succeeds
        const planResNew = buildAmendPlan({
          repoRoot: dir,
          head: { kind: "branch", name: "main", upstream: "origin/main", ahead: 1, behind: 0 },
          blockers: [],
          when: {
            local: { year: 2026, month: 4, day: 10, hour: 14, minute: 20, second: 0 },
            offsetMinutes: 120,
          },
          isPublished: publishedNew,
        });
        expect(planResNew.ok).toBe(true);

        // Execute amend on the unpublished local commit succeeds
        if (planResNew.ok) {
          const result = await executeAmendPlan(
            "git",
            makeMockRepo(dir),
            "test-repo",
            planResNew.value,
            () => {},
          );
          expect(result.ok).toBe(true);
        }
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("verifies no --force or --no-verify flags exist in amend execution or plans", async () => {
      const targetTimestamp = {
        iso: "2026-04-10T14:20:00+0200",
        epochSeconds: 1775823600,
        offsetMinutes: 120,
      };

      const plan: AmendPlan = {
        repoRoot: "/workspace/repo",
        timestamp: targetTimestamp,
      };

      const { buildAmendExecPlan } = await import("../../src/core/execPlan");
      const exec = buildAmendExecPlan(plan);
      for (const step of exec.steps) {
        expect(step.argv).not.toContain("--no-verify");
        expect(step.argv).not.toContain("--force");
        expect(step.argv).not.toContain("-f");
        expect(step.argv).not.toContain("--force-with-lease");
      }
    });
  });
});
