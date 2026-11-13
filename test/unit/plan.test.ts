import { describe, it, expect } from "vitest";
import { buildCommitPlan, type PlanInput } from "../../src/core/plan";

describe("buildCommitPlan (AM-03)", () => {
  const baseInput: PlanInput = {
    repoRoot: "/workspace/repo",
    head: { kind: "branch", name: "main", upstream: "origin/main", ahead: 0, behind: 0 },
    remotes: ["origin"],
    blockers: [],
    files: [
      { path: "src/file1.ts", kind: "modified", staged: false, unstaged: true },
      { path: "src/file2.ts", kind: "untracked", staged: false, unstaged: true },
      { path: "renamed.ts", oldPath: "old.ts", kind: "renamed", staged: true, unstaged: false },
    ],
    selectedPaths: ["src/file1.ts"],
    message: { subject: "feat: add stuff", body: "Description" },
    when: {
      local: { year: 2024, month: 6, day: 15, hour: 12, minute: 0, second: 0 },
      offsetMinutes: 0,
    },
    push: { enabled: false, remote: "origin" },
  };

  it("returns BLOCKED if blockers are present (Step 1)", () => {
    const input: PlanInput = { ...baseInput, blockers: ["MERGE"] };
    const res = buildCommitPlan(input);
    expect(res).toEqual({
      ok: false,
      error: { code: "BLOCKED", detail: "Operation blocked: MERGE in progress." },
    });
  });

  it("returns MESSAGE_REJECTED if normalizeMessage fails (Step 2)", () => {
    const input: PlanInput = {
      ...baseInput,
      message: { subject: "", body: "body without subject" },
    };
    const res = buildCommitPlan(input);
    expect(res).toEqual({
      ok: false,
      error: { code: "MESSAGE_REJECTED", detail: "Message rejected: EMPTY_SUBJECT" },
    });
  });

  it("returns DATE_REJECTED if resolveTimestamp fails (Step 3)", () => {
    const input: PlanInput = {
      ...baseInput,
      when: {
        local: { year: 2024, month: 2, day: 30, hour: 12, minute: 0, second: 0 }, // Feb 30 invalid
        offsetMinutes: 0,
      },
    };
    const res = buildCommitPlan(input);
    expect(res).toEqual({
      ok: false,
      error: { code: "DATE_REJECTED", detail: "Date rejected: INVALID_DATE" },
    });
  });

  it("returns NOTHING_TO_COMMIT if selectedPaths is empty (Step 4)", () => {
    const input: PlanInput = { ...baseInput, selectedPaths: [] };
    const res = buildCommitPlan(input);
    expect(res).toEqual({
      ok: false,
      error: { code: "NOTHING_TO_COMMIT", detail: "No files selected." },
    });
  });

  it("returns PATH_REJECTED if selectedPath fails validation (Step 5)", () => {
    const input: PlanInput = { ...baseInput, selectedPaths: ["../escape.txt"] };
    const res = buildCommitPlan(input);
    expect(res).toEqual({
      ok: false,
      error: { code: "PATH_REJECTED", detail: "Invalid path: ../escape.txt (TRAVERSAL)" },
    });
  });

  it("returns STALE_SELECTION if selectedPath is not in files (Step 5)", () => {
    const input: PlanInput = { ...baseInput, selectedPaths: ["not-in-snapshot.ts"] };
    const res = buildCommitPlan(input);
    expect(res).toEqual({
      ok: false,
      error: {
        code: "STALE_SELECTION",
        detail: "Selected file is no longer changed: not-in-snapshot.ts",
      },
    });
  });

  it("dedupes selectedPaths and handles renames by adding validated oldPath (Step 6)", () => {
    const input: PlanInput = {
      ...baseInput,
      selectedPaths: ["renamed.ts", "renamed.ts"], // duplicate
    };
    const res = buildCommitPlan(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Both renamed.ts and old.ts should be in paths
      expect(res.value.paths).toEqual(["renamed.ts", "old.ts"]);
      expect(res.value.untrackedPaths).toEqual([]);
    }
  });

  it("populates untrackedPaths for selected untracked files (Step 6)", () => {
    const input: PlanInput = {
      ...baseInput,
      selectedPaths: ["src/file1.ts", "src/file2.ts"],
    };
    const res = buildCommitPlan(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.paths).toEqual(["src/file1.ts", "src/file2.ts"]);
      expect(res.value.untrackedPaths).toEqual(["src/file2.ts"]);
    }
  });

  describe("Strategy and unborn HEAD (Step 7)", () => {
    it("selects strategy 'only' for branch HEAD", () => {
      const res = buildCommitPlan(baseInput);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.strategy).toBe("only");
      }
    });

    it("selects strategy 'index' on unborn HEAD when no extra staged files exist", () => {
      const unbornInput: PlanInput = {
        ...baseInput,
        head: { kind: "unborn", branch: "main" },
        files: [{ path: "src/file1.ts", kind: "added", staged: true, unstaged: false }],
        selectedPaths: ["src/file1.ts"],
      };
      const res = buildCommitPlan(unbornInput);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.strategy).toBe("index");
      }
    });

    it("blocks unborn HEAD with extra staged files not in selection", () => {
      const unbornInput: PlanInput = {
        ...baseInput,
        head: { kind: "unborn", branch: "main" },
        files: [
          { path: "src/file1.ts", kind: "added", staged: true, unstaged: false },
          { path: "src/extra.ts", kind: "added", staged: true, unstaged: false }, // extra staged
        ],
        selectedPaths: ["src/file1.ts"],
      };
      const res = buildCommitPlan(unbornInput);
      expect(res).toEqual({
        ok: false,
        error: {
          code: "BLOCKED",
          detail: "Staged files outside selection must be committed or unstaged on an unborn branch.",
          paths: ["src/extra.ts"],
        },
      });
    });
  });

  describe("Push validation (Step 8)", () => {
    it("blocks push on detached HEAD", () => {
      const detachedInput: PlanInput = {
        ...baseInput,
        head: { kind: "detached", shortSha: "abcdef1" },
        push: { enabled: true, remote: "origin" },
      };
      const res = buildCommitPlan(detachedInput);
      expect(res).toEqual({
        ok: false,
        error: { code: "BLOCKED", detail: "Push is unavailable on a detached HEAD" },
      });
    });

    it("blocks push if remote is not in snapshot remotes or invalid", () => {
      const invalidRemoteInput: PlanInput = {
        ...baseInput,
        push: { enabled: true, remote: "unknown-remote" },
      };
      const res = buildCommitPlan(invalidRemoteInput);
      expect(res).toEqual({
        ok: false,
        error: { code: "BLOCKED", detail: "Invalid remote for push: unknown-remote" },
      });

      const badFormatInput: PlanInput = {
        ...baseInput,
        push: { enabled: true, remote: "-bad;remote" },
      };
      expect(buildCommitPlan(badFormatInput)).toEqual({
        ok: false,
        error: { code: "BLOCKED", detail: "Invalid remote for push: -bad;remote" },
      });
    });

    it("configures push spec with setUpstream=false when upstream exists", () => {
      const pushInput: PlanInput = {
        ...baseInput,
        push: { enabled: true, remote: "origin" },
      };
      const res = buildCommitPlan(pushInput);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.push).toEqual({
          remote: "origin",
          branch: "main",
          setUpstream: false,
        });
      }
    });

    it("configures push spec with setUpstream=true when upstream is missing or unborn", () => {
      const noUpstreamInput: PlanInput = {
        ...baseInput,
        head: { kind: "branch", name: "feature", ahead: 0, behind: 0 },
        push: { enabled: true, remote: "origin" },
      };
      const res = buildCommitPlan(noUpstreamInput);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.push).toEqual({
          remote: "origin",
          branch: "feature",
          setUpstream: true,
        });
      }
    });
  });
});
