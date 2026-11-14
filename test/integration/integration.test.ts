import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import { getGitApi, isGitVersionSupported, parseGitVersion } from "../../src/host/gitApi";
import { detectBlockers, buildHeadState } from "../../src/host/repoState";
import { runUnderMutex, buildGitEnv, classifyGitError } from "../../src/host/runner";
import { buildCommitPlan } from "../../src/core/plan";
import { resolveTimestamp } from "../../src/core/timestamp";
import { EXTENSION_ID, COMMAND_OPEN, COMMAND_OPEN_FOR_SELECTION } from "../../src/host/ids";

declare function suite(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void | Promise<void>): void;

suite("GitFlux Integration Tests", () => {
  let tmpDir: string;

  function createRepo(name: string): string {
    const repoPath = path.join(tmpDir, name);
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
    return repoPath;
  }

  test("Extension is activated and commands are registered", async () => {
    const ext = vscode.extensions.getExtension(`advaetuc.${EXTENSION_ID}`);
    if (ext) {
      await ext.activate();
      assert.ok(ext.isActive);
    }

    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(allCommands.includes(COMMAND_OPEN));
    assert.ok(allCommands.includes(COMMAND_OPEN_FOR_SELECTION));
  });

  test("Git API availability and version checking", async () => {
    const api = await getGitApi();
    if (!api) {
      // In minimal test harness without vscode.git running
      return;
    }
    assert.ok(api);
    const ver = parseGitVersion("git version 2.39.0");
    assert.ok(ver);
    assert.ok(isGitVersionSupported("git version 2.39.0"));
  });

  test("Single repo, unborn branch, and initial commit planning", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitflux-int-"));
    const repoDir = createRepo("single-repo");
    fs.writeFileSync(path.join(repoDir, "hello.txt"), "hello world\n");

    const whenRes = resolveTimestamp({ year: 2024, month: 6, day: 15, hour: 10, minute: 0, second: 0 }, 0);
    assert.ok(whenRes.ok);

    const planRes = buildCommitPlan({
      repoRoot: repoDir,
      head: { kind: "unborn", branch: "main" },
      remotes: [],
      blockers: [],
      files: [{ path: "hello.txt", kind: "untracked", staged: false, unstaged: true }],
      selectedPaths: ["hello.txt"],
      message: { subject: "initial commit", body: "" },
      when: { local: { year: 2024, month: 6, day: 15, hour: 10, minute: 0, second: 0 }, offsetMinutes: 0 },
      push: { enabled: false, remote: "" },
    });

    assert.ok(planRes.ok);
    assert.equal(planRes.value.strategy, "index");
    assert.deepEqual(planRes.value.paths, ["hello.txt"]);
  });

  test("Blocker detection: unmerged files and conflict prevention", () => {
    const mockRepo = {
      rootUri: vscode.Uri.file("/tmp/fake-repo"),
      state: {
        HEAD: { name: "main", commit: "abc1234" },
        indexChanges: [],
        workingTreeChanges: [],
        mergeChanges: [{ uri: vscode.Uri.file("/tmp/fake-repo/conflict.txt") }],
        remotes: [],
        submodules: [],
        rebaseCommit: undefined,
      },
    };

    const blockers = detectBlockers(mockRepo as never);
    assert.ok(blockers.includes("UNMERGED_FILES"));

    const planRes = buildCommitPlan({
      repoRoot: "/tmp/fake-repo",
      head: { kind: "branch", name: "main", ahead: 0, behind: 0 },
      remotes: [],
      blockers,
      files: [{ path: "conflict.txt", kind: "modified", staged: false, unstaged: true }],
      selectedPaths: ["conflict.txt"],
      message: { subject: "fix", body: "" },
      when: { local: { year: 2024, month: 6, day: 15, hour: 10, minute: 0, second: 0 }, offsetMinutes: 0 },
      push: { enabled: false, remote: "" },
    });

    assert.equal(planRes.ok, false);
    assert.equal((planRes as { ok: false; error: { code: string } }).error.code, "BLOCKED");
  });

  test("Detached HEAD detection and push prevention", () => {
    const mockRepo = {
      rootUri: vscode.Uri.file("/tmp/fake-repo"),
      state: {
        HEAD: { name: undefined, commit: "0123456789abcdef" },
        indexChanges: [],
        workingTreeChanges: [],
        mergeChanges: [],
        remotes: [{ name: "origin" }],
        submodules: [],
        rebaseCommit: undefined,
      },
    };

    const head = buildHeadState(mockRepo as never);
    assert.equal(head.kind, "detached");
    assert.equal((head as { shortSha: string }).shortSha, "0123456");

    const planRes = buildCommitPlan({
      repoRoot: "/tmp/fake-repo",
      head,
      remotes: ["origin"],
      blockers: [],
      files: [{ path: "file.txt", kind: "modified", staged: true, unstaged: false }],
      selectedPaths: ["file.txt"],
      message: { subject: "feat: change", body: "" },
      when: { local: { year: 2024, month: 6, day: 15, hour: 10, minute: 0, second: 0 }, offsetMinutes: 0 },
      push: { enabled: true, remote: "origin" },
    });

    assert.equal(planRes.ok, false);
    const err = (planRes as { ok: false; error: { code: string; detail: string } }).error;
    assert.equal(err.code, "BLOCKED");
    assert.match(err.detail, /detached HEAD/i);
  });

  test("Stale selection and forged path rejection", () => {
    const planRes1 = buildCommitPlan({
      repoRoot: "/tmp/fake-repo",
      head: { kind: "branch", name: "main", ahead: 0, behind: 0 },
      remotes: [],
      blockers: [],
      files: [{ path: "real.txt", kind: "modified", staged: true, unstaged: false }],
      selectedPaths: ["stale_file_not_in_files.txt"],
      message: { subject: "feat: test", body: "" },
      when: { local: { year: 2024, month: 6, day: 15, hour: 10, minute: 0, second: 0 }, offsetMinutes: 0 },
      push: { enabled: false, remote: "" },
    });

    assert.equal(planRes1.ok, false);
    assert.equal((planRes1 as { ok: false; error: { code: string } }).error.code, "STALE_SELECTION");

    const planRes2 = buildCommitPlan({
      repoRoot: "/tmp/fake-repo",
      head: { kind: "branch", name: "main", ahead: 0, behind: 0 },
      remotes: [],
      blockers: [],
      files: [{ path: "real.txt", kind: "modified", staged: true, unstaged: false }],
      selectedPaths: ["../escape.txt"],
      message: { subject: "feat: test", body: "" },
      when: { local: { year: 2024, month: 6, day: 15, hour: 10, minute: 0, second: 0 }, offsetMinutes: 0 },
      push: { enabled: false, remote: "" },
    });

    assert.equal(planRes2.ok, false);
    assert.equal((planRes2 as { ok: false; error: { code: string } }).error.code, "PATH_REJECTED");
  });

  test("Runner env sanitization strips GIT_DIR and sets LC_MESSAGES=C", () => {
    const env = buildGitEnv({ CUSTOM: "value" });
    assert.equal(env["GIT_DIR"], undefined);
    assert.equal(env["GIT_WORK_TREE"], undefined);
    assert.equal(env["GIT_INDEX_FILE"], undefined);
    assert.equal(env["LC_MESSAGES"], "C");
    assert.equal(env["GIT_TERMINAL_PROMPT"], "0");
    assert.equal(env["CUSTOM"], "value");
  });

  test("Concurrent execution serialization via mutex", async () => {
    const order: number[] = [];
    const p1 = runUnderMutex("repo1", async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push(1);
    });
    const p2 = runUnderMutex("repo1", () => {
      order.push(2);
      return Promise.resolve();
    });
    await Promise.all([p1, p2]);
    assert.deepEqual(order, [1, 2]);
  });

  test("Git error classification: identity missing, index locked, hook rejected", () => {
    assert.equal(
      classifyGitError("fatal: unable to auto-detect email address").code,
      "IDENTITY_MISSING",
    );
    assert.equal(
      classifyGitError("fatal: Unable to create '.git/index.lock': File exists.").code,
      "INDEX_LOCKED",
    );
    assert.equal(
      classifyGitError("pre-commit hook failed (add --no-verify to bypass)").code,
      "HOOK_REJECTED",
    );
    assert.equal(
      classifyGitError("nothing to commit, working tree clean").code,
      "NOTHING_TO_COMMIT",
    );
  });
});
