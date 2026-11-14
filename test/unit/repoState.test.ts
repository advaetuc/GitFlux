import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    file: (f: string) => ({ fsPath: f, scheme: "file" }),
  },
}));
import {
  buildChangedFiles,
  buildHeadState,
  detectBlockers,
  buildRepoSnapshot,
  resetRevisions,
  getNextRevision,
} from "../../src/host/repoState";
import { GitStatus } from "../../src/host/gitStatus";
import type { Repository, RepositoryState, Branch, Submodule, Commit, Change } from "../../src/host/vendor/git";
import type { Uri } from "vscode";

describe("repoState (Phase 2)", () => {
  beforeEach(() => {
    resetRevisions();
  });

  const mockUri = (fsPath: string): Uri => ({ fsPath } as unknown as Uri);

  const mockRepo = (overrides?: Partial<Repository>): Repository => {
    const defaultState: RepositoryState = {
      HEAD: {
        name: "main",
        commit: "1234567890abcdef",
        upstream: { name: "origin/main", remote: "origin" },
        ahead: 1,
        behind: 0,
      } as Branch,
      indexChanges: [],
      workingTreeChanges: [],
      mergeChanges: [],
      remotes: [{ name: "origin", fetchUrl: "", pushUrl: "", isReadOnly: false }],
      submodules: [],
      rebaseCommit: undefined,
    } as unknown as RepositoryState;

    return {
      rootUri: mockUri("/workspace/repo"),
      state: defaultState,
      getCommit: () =>
        Promise.resolve({
          hash: "1234567890abcdef",
          message: "init",
          parents: [],
          commitDate: new Date("2024-06-15T12:00:00Z"),
        } as Commit),
      ...overrides,
    } as unknown as Repository;
  };

  it("increments revision monotonically per repo", () => {
    expect(getNextRevision("repo1")).toBe(1);
    expect(getNextRevision("repo1")).toBe(2);
    expect(getNextRevision("repo2")).toBe(1);
    expect(getNextRevision("repo1")).toBe(3);
  });

  it("merges indexChanges and workingTreeChanges into ChangedFile", () => {
    const repo = mockRepo({
      state: {
        ...mockRepo().state,
        indexChanges: [
          {
            uri: mockUri("/workspace/repo/staged.ts"),
            status: GitStatus.INDEX_MODIFIED,
          } as unknown as Change,
          {
            uri: mockUri("/workspace/repo/both.ts"),
            status: GitStatus.INDEX_MODIFIED,
          } as unknown as Change,
        ],
        workingTreeChanges: [
          {
            uri: mockUri("/workspace/repo/both.ts"),
            status: GitStatus.MODIFIED,
          } as unknown as Change,
          {
            uri: mockUri("/workspace/repo/untracked.ts"),
            status: GitStatus.UNTRACKED,
          } as unknown as Change,
          {
            uri: mockUri("/workspace/repo/ignored.ts"),
            status: GitStatus.IGNORED,
          } as unknown as Change,
        ],
      } as unknown as RepositoryState,
    });

    const files = buildChangedFiles(repo);
    expect(files).toHaveLength(3); // ignored.ts was skipped

    const stagedOnly = files.find((f) => f.path === "staged.ts");
    expect(stagedOnly).toEqual({
      path: "staged.ts",
      kind: "modified",
      staged: true,
      unstaged: false,
    });

    const partiallyStaged = files.find((f) => f.path === "both.ts");
    expect(partiallyStaged).toEqual({
      path: "both.ts",
      kind: "modified",
      staged: true,
      unstaged: true,
    });

    const untracked = files.find((f) => f.path === "untracked.ts");
    expect(untracked).toEqual({
      path: "untracked.ts",
      kind: "untracked",
      staged: false,
      unstaged: true,
    });
  });

  it("marks submodule files with kind 'submodule'", () => {
    const repo = mockRepo({
      state: {
        ...mockRepo().state,
        submodules: [{ path: "sub/lib" } as unknown as Submodule],
        workingTreeChanges: [
          {
            uri: mockUri("/workspace/repo/sub/lib"),
            status: GitStatus.MODIFIED,
          } as unknown as Change,
        ],
      } as unknown as RepositoryState,
    });

    const files = buildChangedFiles(repo);
    expect(files[0]?.kind).toBe("submodule");
  });

  it("records oldPath for renamed files", () => {
    const repo = mockRepo({
      state: {
        ...mockRepo().state,
        indexChanges: [
          {
            uri: mockUri("/workspace/repo/new_name.ts"),
            originalUri: mockUri("/workspace/repo/old_name.ts"),
            status: GitStatus.INDEX_RENAMED,
          } as unknown as Change,
        ],
      } as unknown as RepositoryState,
    });

    const files = buildChangedFiles(repo);
    expect(files[0]?.kind).toBe("renamed");
    expect(files[0]?.oldPath).toBe("old_name.ts");
  });

  it("uses renameUri for new path and originalUri for oldPath when renameUri is present", () => {
    const repo = mockRepo({
      state: {
        ...mockRepo().state,
        indexChanges: [
          {
            uri: mockUri("/workspace/repo/old_target.ts"),
            originalUri: mockUri("/workspace/repo/old_target.ts"),
            renameUri: mockUri("/workspace/repo/new_destination.ts"),
            status: GitStatus.INDEX_RENAMED,
          } as unknown as Change,
        ],
      } as unknown as RepositoryState,
    });

    const files = buildChangedFiles(repo);
    expect(files[0]?.kind).toBe("renamed");
    expect(files[0]?.path).toBe("new_destination.ts");
    expect(files[0]?.oldPath).toBe("old_target.ts");
  });

  describe("detectBlockers", () => {
    it("detects UNMERGED_FILES from mergeChanges", () => {
      const repo = mockRepo({
        state: {
          ...mockRepo().state,
          mergeChanges: [{ uri: mockUri("/workspace/repo/conflict.ts") } as unknown as Change],
        } as unknown as RepositoryState,
      });
      const blockers = detectBlockers(repo);
      expect(blockers).toContain("UNMERGED_FILES");
    });

    it("detects REBASE when rebaseCommit is present", () => {
      const repo = mockRepo({
        state: {
          ...mockRepo().state,
          rebaseCommit: { hash: "abc1234" } as unknown as Commit,
        } as unknown as RepositoryState,
      });
      const blockers = detectBlockers(repo);
      expect(blockers).toContain("REBASE");
    });
  });

  describe("buildHeadState", () => {
    it("builds branch head state", () => {
      const repo = mockRepo();
      expect(buildHeadState(repo)).toEqual({
        kind: "branch",
        name: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
      });
    });

    it("builds unborn head state when commit is undefined", () => {
      const repo = mockRepo({
        state: {
          ...mockRepo().state,
          HEAD: { name: "main", commit: undefined } as unknown as Branch,
        } as unknown as RepositoryState,
      });
      expect(buildHeadState(repo)).toEqual({
        kind: "unborn",
        branch: "main",
      });
    });

    it("builds detached head state with 7-char sha", () => {
      const repo = mockRepo({
        state: {
          ...mockRepo().state,
          HEAD: { name: undefined, commit: "abcdef0123456789" } as unknown as Branch,
        } as unknown as RepositoryState,
      });
      expect(buildHeadState(repo)).toEqual({
        kind: "detached",
        shortSha: "abcdef0",
      });
    });
  });

  it("builds full RepoSnapshot", async () => {
    const repo = mockRepo();
    const snapshot = await buildRepoSnapshot(repo, "repo-id-1");
    expect(snapshot.repoId).toBe("repo-id-1");
    expect(snapshot.revision).toBe(1);
    expect(snapshot.name).toBe("repo");
    expect(snapshot.headCommitEpochSeconds).toBe(1718452800);
    expect(snapshot.remotes).toEqual(["origin"]);
  });
});
