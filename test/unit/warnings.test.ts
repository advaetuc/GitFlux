import { describe, it, expect } from "vitest";
import { planWarnings } from "../../src/core/warnings";
import type { CommitPlan, GitPath, HeadState, ChangedFile, RemoteName, BranchName } from "../../src/core/types";

describe("planWarnings (AM-04)", () => {
  const basePlan: CommitPlan = {
    repoRoot: "/workspace/repo",
    paths: ["src/file.ts" as GitPath],
    untrackedPaths: [],
    strategy: "only",
    message: { paragraphs: ["feat: short subject"] },
    timestamp: {
      iso: "2024-06-15T12:00:00+0000",
      epochSeconds: 1718452800,
      offsetMinutes: 0,
    },
  };

  const baseHead: HeadState = {
    kind: "branch",
    name: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
  };

  const baseFiles: ChangedFile[] = [
    { path: "src/file.ts", kind: "modified", staged: false, unstaged: true },
  ];

  it("warns FUTURE_DATE when timestamp.epochSeconds > now + 300", () => {
    // timestamp is 1718452800. now is 1718452400 (diff is 400s > 300s)
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718452400,
    });
    expect(warnings).toContain("FUTURE_DATE");
  });

  it("does not warn FUTURE_DATE when timestamp is within 300s of now", () => {
    // diff is 200s <= 300s
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718452600,
    });
    expect(warnings).not.toContain("FUTURE_DATE");
  });

  it("warns BEFORE_PARENT when timestamp < headCommitEpochSeconds", () => {
    // timestamp is 1718452800. parent is 1718453000
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718453000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("BEFORE_PARENT");
  });

  it("warns SUBJECT_OVER_72 when subject exceeds 72 characters", () => {
    const longSubjectPlan: CommitPlan = {
      ...basePlan,
      message: { paragraphs: ["a".repeat(73)] },
    };
    const warnings = planWarnings({
      plan: longSubjectPlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("SUBJECT_OVER_72");
  });

  it("warns BEHIND_UPSTREAM when branch is behind upstream and push is enabled", () => {
    const behindHead: HeadState = {
      ...baseHead,
      behind: 2,
    };
    const planWithPush: CommitPlan = {
      ...basePlan,
      push: { remote: "origin" as RemoteName, branch: "main" as BranchName, setUpstream: false },
    };
    const warnings = planWarnings({
      plan: planWithPush,
      head: behindHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("BEHIND_UPSTREAM");
  });

  it("warns DETACHED_HEAD when HEAD is detached", () => {
    const detachedHead: HeadState = {
      kind: "detached",
      shortSha: "1234567",
    };
    const warnings = planWarnings({
      plan: basePlan,
      head: detachedHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("DETACHED_HEAD");
  });

  it("warns PARTIALLY_STAGED when a selected file has staged && unstaged", () => {
    const partiallyStagedFiles: ChangedFile[] = [
      { path: "src/file.ts", kind: "modified", staged: true, unstaged: true },
    ];
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: partiallyStagedFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("PARTIALLY_STAGED");
  });

  it("returns no warnings when all checks pass cleanly", () => {
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718452800,
    });
    expect(warnings).toEqual([]);
  });
});
