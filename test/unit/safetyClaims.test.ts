import { describe, it, expect } from "vitest";
import { buildExecPlan, buildAmendExecPlan } from "../../src/core/execPlan";
import { renderShell } from "../../src/core/shellRender";
import type {
  AmendPlan,
  BranchName,
  CommitPlan,
  ExecPlan,
  ExecStep,
  GitPath,
  RemoteName,
  ShellKind,
} from "../../src/core/types";

const ALL_SHELLS: readonly ShellKind[] = [
  "bash",
  "zsh",
  "sh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
];

function assertStepSafety(step: ExecStep): void {
  for (const arg of step.argv) {
    expect(arg).not.toBe("--no-verify");
    expect(arg).not.toBe("-n");
    expect(arg).not.toBe("--force");
    expect(arg).not.toBe("-f");
    expect(arg).not.toBe("--force-with-lease");
    expect(arg).not.toBe(".");
    expect(arg).not.toBe("-A");

    expect(arg).not.toContain("--no-verify");
    expect(arg).not.toContain("--force");
    expect(arg).not.toContain("--force-with-lease");
  }
}

function assertExecPlanSafety(plan: ExecPlan): void {
  for (const step of plan.steps) {
    assertStepSafety(step);
  }
  if (plan.rollback) {
    assertStepSafety(plan.rollback);
  }
}

function assertRenderSafety(singleLine: string): void {
  expect(singleLine).not.toContain("--no-verify");
  expect(singleLine).not.toContain("--force");
  expect(singleLine).not.toContain("--force-with-lease");
  expect(singleLine).not.toContain("add .");
  expect(singleLine).not.toContain("add -A");

  // Flags cannot appear as standalone CLI option flags (-n or -f)
  expect(singleLine).not.toMatch(/\s-n(\s|$)/);
  expect(singleLine).not.toMatch(/\s-f(\s|$)/);
}

describe("Behavioral Safety Claims", () => {
  const baseCommitPlan: CommitPlan = {
    repoRoot: "/workspace/repo",
    paths: ["src/file1.ts" as GitPath, "src/file2.ts" as GitPath],
    untrackedPaths: [],
    strategy: "only",
    message: { paragraphs: ["feat: add safe commit feature", "Closes #123."] },
    timestamp: {
      iso: "2026-03-02T10:41:07+0530",
      epochSeconds: 1772428267,
      offsetMinutes: 330,
    },
  };

  const baseAmendPlan: AmendPlan = {
    repoRoot: "/workspace/repo",
    timestamp: {
      iso: "2026-03-02T10:41:07+0530",
      epochSeconds: 1772428267,
      offsetMinutes: 330,
    },
  };

  describe("buildExecPlan safety invariants", () => {
    it("never includes forbidden flags in strategy 'only' without untrackedPaths", () => {
      const plan = buildExecPlan({ ...baseCommitPlan, strategy: "only", untrackedPaths: [] });
      assertExecPlanSafety(plan);
    });

    it("never includes forbidden flags in strategy 'only' with untrackedPaths (including rollback)", () => {
      const plan = buildExecPlan({
        ...baseCommitPlan,
        strategy: "only",
        paths: ["src/file1.ts" as GitPath, "untracked.txt" as GitPath],
        untrackedPaths: ["untracked.txt" as GitPath],
      });
      expect(plan.rollback).toBeDefined();
      assertExecPlanSafety(plan);
    });

    it("never includes forbidden flags in strategy 'index' without untrackedPaths", () => {
      const plan = buildExecPlan({ ...baseCommitPlan, strategy: "index", untrackedPaths: [] });
      assertExecPlanSafety(plan);
    });

    it("never includes forbidden flags in strategy 'index' with untrackedPaths", () => {
      const plan = buildExecPlan({
        ...baseCommitPlan,
        strategy: "index",
        paths: ["src/file1.ts" as GitPath, "untracked.txt" as GitPath],
        untrackedPaths: ["untracked.txt" as GitPath],
      });
      assertExecPlanSafety(plan);
    });
  });

  describe("buildAmendExecPlan safety invariants", () => {
    it("never includes forbidden flags when amending HEAD", () => {
      const plan = buildAmendExecPlan(baseAmendPlan);
      assertExecPlanSafety(plan);
      expect(plan.rollback).toBeUndefined();
    });
  });

  describe("renderShell safety invariants across all 7 shells and execution options", () => {
    const strategies = ["only", "index"] as const;
    const untrackedOptions = [
      [],
      ["untracked.txt" as GitPath],
    ];
    const pushOptions = [
      undefined,
      { remote: "origin" as RemoteName, branch: "main" as BranchName, setUpstream: false },
      { remote: "origin" as RemoteName, branch: "feature" as BranchName, setUpstream: true },
    ];
    const repoDirOptions = [true, false];

    for (const shell of ALL_SHELLS) {
      for (const strategy of strategies) {
        for (const untracked of untrackedOptions) {
          for (const push of pushOptions) {
            for (const includeRepoDir of repoDirOptions) {
              const testTitle =
                `shell=${shell} strategy=${strategy} untracked=${String(untracked.length)} ` +
                `push=${push ? (push.setUpstream ? "upstream" : "normal") : "none"} ` +
                `repoDir=${String(includeRepoDir)}`;

              it(`guarantees safety for ${testTitle}`, () => {
                const plan: CommitPlan = {
                  ...baseCommitPlan,
                  strategy,
                  paths: [
                    "src/file1.ts" as GitPath,
                    ...(untracked.length > 0 ? untracked : []),
                  ],
                  untrackedPaths: untracked,
                  ...(push ? { push } : {}),
                };

                const res = renderShell(plan, shell, { includeRepoDir });
                expect(res.ok).toBe(true);
                if (res.ok) {
                  assertRenderSafety(res.value.singleLine);
                }
              });
            }
          }
        }
      }
    }
  });
});
