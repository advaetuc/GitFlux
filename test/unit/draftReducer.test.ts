import { describe, it, expect } from "vitest";
import {
  draftReducer,
  initialState,
} from "../../src/webview/draftReducer";
import type { HostEnv, RepoSnapshot } from "../../src/shared/protocol";

describe("draftReducer (Phase 3)", () => {
  const sampleEnv: HostEnv = {
    platform: "darwin",
    detectedShell: "zsh",
    shellSetting: "auto",
    includeRepoDirInCopy: true,
    sendToTerminalAvailable: true,
    workingHours: { start: "09:30", end: "18:30" },
    pushDefaultEnabled: true,
    autoRun: false,
    gitVersionOk: true,
  };

  const sampleSnapshot: RepoSnapshot = {
    repoId: "/workspace/repo",
    name: "repo",
    repoRoot: "/workspace/repo",
    revision: 1,
    head: { kind: "branch", name: "main", upstream: "origin/main", ahead: 0, behind: 0 },
    remotes: ["origin"],
    blockers: [],
    files: [
      { path: "src/a.ts", kind: "modified", staged: true, unstaged: false },
      { path: "src/b.ts", kind: "modified", staged: false, unstaged: true },
    ],
  };

  it("initializes state from INIT action", () => {
    const state = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [{ repoId: "/workspace/repo", name: "repo" }],
      activeRepoId: "/workspace/repo",
      snapshot: sampleSnapshot,
    });

    expect(state.activeRepoId).toBe("/workspace/repo");
    expect(state.snapshot).toEqual(sampleSnapshot);
    expect(state.draft.push.enabled).toBe(true);
    expect(state.draft.push.remote).toBe("origin");
  });

  it("clears selected paths when repo is switched", () => {
    const s1 = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [
        { repoId: "/workspace/repo1", name: "repo1" },
        { repoId: "/workspace/repo2", name: "repo2" },
      ],
      activeRepoId: "/workspace/repo1",
      snapshot: sampleSnapshot,
    });

    const s2 = draftReducer(s1, {
      type: "TOGGLE_PATH",
      path: "src/a.ts",
    });
    expect(s2.draft.paths).toContain("src/a.ts");

    const s3 = draftReducer(s2, {
      type: "SET_REPO",
      repoId: "/workspace/repo2",
    });
    expect(s3.activeRepoId).toBe("/workspace/repo2");
    expect(s3.draft.paths).toEqual([]);
  });

  it("drops selected paths no longer present when a new snapshot arrives and sets notice", () => {
    const s1 = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [{ repoId: "/workspace/repo", name: "repo" }],
      activeRepoId: "/workspace/repo",
      snapshot: sampleSnapshot,
    });

    const s2 = draftReducer(s1, {
      type: "TOGGLE_PATH",
      path: "src/a.ts",
    });
    expect(s2.draft.paths).toEqual(["src/a.ts"]);

    // New snapshot where src/a.ts is no longer changed
    const newSnapshot: RepoSnapshot = {
      ...sampleSnapshot,
      revision: 2,
      files: [{ path: "src/b.ts", kind: "modified", staged: false, unstaged: true }],
    };

    const s3 = draftReducer(s2, {
      type: "SNAPSHOT",
      snapshot: newSnapshot,
    });

    expect(s3.draft.paths).toEqual([]);
    expect(s3.stalePathsNotice).toMatch(/1 file no longer changed/i);
  });

  it("handles prefix chips: replaces recognized prefix or prepends", () => {
    let s = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [{ repoId: "/workspace/repo", name: "repo" }],
      activeRepoId: "/workspace/repo",
      snapshot: sampleSnapshot,
    });

    // Empty subject -> prepends
    s = draftReducer(s, { type: "APPLY_PREFIX_CHIP", prefix: "feat:" });
    expect(s.draft.message.subject).toBe("feat: ");

    // Type description
    s = draftReducer(s, { type: "SET_SUBJECT", subject: "feat: add user authentication" });

    // Switch to fix: -> replaces prefix
    s = draftReducer(s, { type: "APPLY_PREFIX_CHIP", prefix: "fix:" });
    expect(s.draft.message.subject).toBe("fix: add user authentication");

    // Switch to docs: -> replaces prefix
    s = draftReducer(s, { type: "APPLY_PREFIX_CHIP", prefix: "docs:" });
    expect(s.draft.message.subject).toBe("docs: add user authentication");
  });

  it("selects all paths and deselects all paths", () => {
    let s = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [{ repoId: "/workspace/repo", name: "repo" }],
      activeRepoId: "/workspace/repo",
      snapshot: sampleSnapshot,
    });

    s = draftReducer(s, { type: "SELECT_ALL_PATHS", select: true });
    expect(s.draft.paths).toEqual(["src/a.ts", "src/b.ts"]);

    s = draftReducer(s, { type: "SELECT_ALL_PATHS", select: false });
    expect(s.draft.paths).toEqual([]);
  });

  it("recomputes local offset when date changes in local mode", () => {
    let s = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [{ repoId: "/workspace/repo", name: "repo" }],
      activeRepoId: "/workspace/repo",
      snapshot: sampleSnapshot,
    });

    // Default is local mode
    expect(s.offsetMode).toBe("local");

    // Change date to Jan 15
    s = draftReducer(s, { type: "SET_DATE", year: 2024, month: 1, day: 15 });
    expect(s.draft.when.local.month).toBe(1);
    expect(typeof s.draft.when.offsetMinutes).toBe("number");
  });

  it("picks random time within working hours", () => {
    let s = draftReducer(initialState, {
      type: "INIT",
      env: sampleEnv,
      repos: [{ repoId: "/workspace/repo", name: "repo" }],
      activeRepoId: "/workspace/repo",
      snapshot: sampleSnapshot,
    });

    s = draftReducer(s, { type: "RANDOM_WORKING_HOURS" });
    const { hour, minute } = s.draft.when.local;
    const totalMinutes = hour * 60 + minute;
    // Working hours: 09:30 (570 min) to 18:30 (1110 min)
    expect(totalMinutes).toBeGreaterThanOrEqual(570);
    expect(totalMinutes).toBeLessThanOrEqual(1110);
  });
});
