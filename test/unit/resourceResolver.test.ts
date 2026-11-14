import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => {
  class MockUri {
    constructor(
      public readonly scheme: string,
      public readonly fsPath: string,
    ) {}
    static file(path: string) {
      return new MockUri("file", path);
    }
  }
  return {
    Uri: MockUri,
    window: {
      activeTextEditor: undefined,
    },
  };
});

import * as vscode from "vscode";
import { extractUrisFromArgs, resolveSelection } from "../../src/host/resourceResolver";
import type { API as GitAPI, Repository } from "../../src/host/vendor/git";

describe("resourceResolver (AM-17)", () => {
  const repo1 = {
    rootUri: { fsPath: "/workspace/repo1" },
  } as Repository;

  const repo2 = {
    rootUri: { fsPath: "/workspace/repo2" },
  } as Repository;

  const mockApi = {
    repositories: [repo1, repo2],
    getRepository: (uri: { fsPath: string }) => {
      if (uri.fsPath.startsWith("/workspace/repo1")) return repo1;
      if (uri.fsPath.startsWith("/workspace/repo2")) return repo2;
      return null;
    },
  } as unknown as GitAPI;

  it("extracts URI from Explorer single select", () => {
    const clicked = vscode.Uri.file("/workspace/repo1/src/index.ts");
    const uris = extractUrisFromArgs([clicked]);
    expect(uris).toEqual([clicked]);
  });

  it("extracts URIs from Explorer multi-select", () => {
    const clicked = vscode.Uri.file("/workspace/repo1/src/index.ts");
    const selected = [
      vscode.Uri.file("/workspace/repo1/src/index.ts"),
      vscode.Uri.file("/workspace/repo1/src/app.ts"),
    ];
    const uris = extractUrisFromArgs([clicked, selected]);
    expect(uris).toEqual(selected);
  });

  it("extracts URIs from SCM resourceState context", () => {
    const state1 = { resourceUri: vscode.Uri.file("/workspace/repo1/file1.ts") };
    const state2 = { resourceUri: vscode.Uri.file("/workspace/repo1/file2.ts") };
    const uris = extractUrisFromArgs([state1, state2]);
    expect(uris).toEqual([state1.resourceUri, state2.resourceUri]);
  });

  it("drops non-file URIs", () => {
    const gitUri = { scheme: "git", fsPath: "/workspace/repo1/commit.diff" } as vscode.Uri;
    const fileUri = vscode.Uri.file("/workspace/repo1/src/real.ts");
    const res = resolveSelection(mockApi, [gitUri, fileUri]);
    expect(res.paths).toEqual(["src/real.ts"]);
    expect(res.droppedCount).toBe(1);
  });

  it("groups by first repo root and counts other repos as dropped", () => {
    const file1 = vscode.Uri.file("/workspace/repo1/src/a.ts");
    const file2 = vscode.Uri.file("/workspace/repo2/src/b.ts"); // different repo
    const res = resolveSelection(mockApi, [file1, file2]);
    expect(res.repo).toBe(repo1);
    expect(res.paths).toEqual(["src/a.ts"]);
    expect(res.droppedCount).toBe(1);
  });

  it("handles unknown arguments safely without throwing", () => {
    const res = resolveSelection(mockApi, [null, 123, "random string", {}]);
    expect(res.paths).toEqual([]);
    expect(res.droppedCount).toBe(0);
  });

  it("expands folder to changed files under prefix", () => {
    // Mock folder path
    const folderUri = vscode.Uri.file("/workspace/repo1/src");
    // With changed files in repo
    const changedFiles = ["src/a.ts", "src/nested/b.ts", "other/c.ts"];
    const res = resolveSelection(mockApi, [folderUri], changedFiles);
    expect(res.paths).toEqual(["src/a.ts", "src/nested/b.ts"]);
    expect(res.paths).not.toContain("other/c.ts");
  });

  it("normalizes /tmp vs /private/tmp symlink prefixes on macOS", () => {
    const tmpRepo = {
      rootUri: { fsPath: "/private/tmp/smoke-repo" },
    } as Repository;

    const tmpApi = {
      repositories: [tmpRepo],
      getRepository: (uri: { fsPath: string }) => {
        if (uri.fsPath.startsWith("/private/tmp/smoke-repo")) return tmpRepo;
        return null;
      },
    } as unknown as GitAPI;

    // Selected file has /tmp/smoke-repo/file.txt (without /private)
    const fileUri = vscode.Uri.file("/tmp/smoke-repo/file.txt");
    const res = resolveSelection(tmpApi, [fileUri]);
    expect(res.repo).toBe(tmpRepo);
    expect(res.paths).toEqual(["file.txt"]);
    expect(res.droppedCount).toBe(0);
  });
});
