import { describe, it, expect } from "vitest";
import { buildExecPlan } from "../../src/core/execPlan";
import type { CommitPlan, GitPath } from "../../src/core/types";

describe("buildExecPlan", () => {
  const basePlan: CommitPlan = {
    repoRoot: "/workspace/repo",
    paths: ["src/a.ts" as GitPath],
    untrackedPaths: [],
    strategy: "only",
    message: { paragraphs: ["fix: subject"] },
    timestamp: {
      iso: "2026-03-02T10:41:07+0530",
      epochSeconds: 1772428267,
      offsetMinutes: 330,
    },
  };

  it("builds plan for strategy 'only' without untracked paths", () => {
    const plan = buildExecPlan(basePlan);
    expect(plan.steps).toHaveLength(2); // commit, verify
    expect(plan.steps[0]?.id).toBe("commit");
    expect(plan.steps[1]?.id).toBe("verify");
    expect(plan.rollback).toBeUndefined();

    // Verify commit step
    const commit = plan.steps[0];
    expect(commit).toBeDefined();
    if (!commit) return;
    expect(commit.argv).toEqual([
      "--literal-pathspecs",
      "commit",
      "--only",
      "--cleanup=whitespace",
      "-m",
      "fix: subject",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ]);
    expect(commit.stdin).toBe("src/a.ts\0");
    expect(commit.env).toEqual({
      GIT_AUTHOR_DATE: "2026-03-02T10:41:07+0530",
      GIT_COMMITTER_DATE: "2026-03-02T10:41:07+0530",
    });

    // Verify verify step
    const verify = plan.steps[1];
    expect(verify).toBeDefined();
    if (!verify) return;
    expect(verify.argv).toEqual(["log", "-1", "--format=%H%x00%ad%x00%cd", "--date=raw"]);
    expect(verify.stdin).toBeUndefined();

    // Expected
    expect(plan.expected).toEqual({
      epochSeconds: 1772428267,
      offsetMinutes: 330,
    });
  });

  it("builds plan for strategy 'only' with untracked paths (includes add and rollback)", () => {
    const planWithUntracked: CommitPlan = {
      ...basePlan,
      paths: ["src/a.ts" as GitPath, "new.ts" as GitPath],
      untrackedPaths: ["new.ts" as GitPath],
    };
    const plan = buildExecPlan(planWithUntracked);

    expect(plan.steps).toHaveLength(3); // add, commit, verify
    expect(plan.steps[0]?.id).toBe("add");
    expect(plan.steps[1]?.id).toBe("commit");
    expect(plan.steps[2]?.id).toBe("verify");
    expect(plan.rollback).toBeDefined();

    // Add step: only untracked paths
    const add = plan.steps[0];
    expect(add).toBeDefined();
    if (!add) return;
    expect(add.argv).toEqual([
      "--literal-pathspecs",
      "add",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ]);
    expect(add.stdin).toBe("new.ts\0");

    // Commit step: all paths
    const commit = plan.steps[1];
    expect(commit).toBeDefined();
    if (!commit) return;
    expect(commit.stdin).toBe("src/a.ts\0new.ts\0");

    // Rollback step (AM-13): operates on untrackedPaths only
    const rollback = plan.rollback;
    expect(rollback).toBeDefined();
    if (!rollback) return;
    expect(rollback.argv).toEqual([
      "--literal-pathspecs",
      "rm",
      "--cached",
      "-q",
      "--ignore-unmatch",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ]);
    expect(rollback.stdin).toBe("new.ts\0");
  });

  it("builds plan for strategy 'index' (unborn HEAD)", () => {
    const indexPlan: CommitPlan = {
      ...basePlan,
      strategy: "index",
      paths: ["file1.ts" as GitPath, "file2.ts" as GitPath],
      untrackedPaths: ["file1.ts" as GitPath, "file2.ts" as GitPath],
    };
    const plan = buildExecPlan(indexPlan);

    expect(plan.steps).toHaveLength(3); // add, commit, verify
    const add = plan.steps[0];
    expect(add).toBeDefined();
    if (!add) return;
    expect(add.argv).toEqual([
      "--literal-pathspecs",
      "add",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ]);
    // In index strategy, add step adds all paths
    expect(add.stdin).toBe("file1.ts\0file2.ts\0");

    const commit = plan.steps[1];
    expect(commit).toBeDefined();
    if (!commit) return;
    expect(commit.argv).toEqual(["commit", "--cleanup=whitespace", "-m", "fix: subject"]);
    expect(commit.stdin).toBeUndefined();

    // Rollback operates on untrackedPaths only
    expect(plan.rollback?.stdin).toBe("file1.ts\0file2.ts\0");
  });

  it("handles 3 message paragraphs as distinct -m arguments", () => {
    const multiParaPlan: CommitPlan = {
      ...basePlan,
      message: { paragraphs: ["Subject line", "Body para 1", "Body para 2"] },
    };
    const plan = buildExecPlan(multiParaPlan);
    const commit = plan.steps.find((s) => s.id === "commit");
    expect(commit).toBeDefined();
    if (!commit) return;
    expect(commit.argv).toContain("-m");
    const mIndices: number[] = [];
    commit.argv.forEach((arg, idx) => {
      if (arg === "-m") mIndices.push(idx);
    });
    expect(mIndices).toHaveLength(3);
    const idx0 = mIndices[0];
    const idx1 = mIndices[1];
    const idx2 = mIndices[2];
    expect(idx0).toBeDefined();
    expect(idx1).toBeDefined();
    expect(idx2).toBeDefined();
    if (idx0 === undefined || idx1 === undefined || idx2 === undefined) return;
    expect(commit.argv[idx0 + 1]).toBe("Subject line");
    expect(commit.argv[idx1 + 1]).toBe("Body para 1");
    expect(commit.argv[idx2 + 1]).toBe("Body para 2");
  });

  it("asserts no argv element is a joined shell string", () => {
    const plan = buildExecPlan({
      ...basePlan,
      paths: ["src/a.ts" as GitPath, "new.ts" as GitPath],
      untrackedPaths: ["new.ts" as GitPath],
    });
    const allArgvs = [...plan.steps.map((s) => s.argv), plan.rollback?.argv ?? []];
    for (const argv of allArgvs) {
      for (const arg of argv) {
        expect(arg.includes("&&")).toBe(false);
        expect(arg.includes(";")).toBe(false);
        expect(arg.includes("|")).toBe(false);
        expect(arg.includes(">")).toBe(false);
        expect(arg.includes("<")).toBe(false);
      }
    }
  });
});
