import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  Uri: {
    file: (f: string) => ({ fsPath: f, scheme: "file" }),
  },
}));

import { parseGitVersion, isGitVersionSupported, resolveRepository } from "../../src/host/gitApi";
import type { API as GitAPI, Repository } from "../../src/host/vendor/git";
import type { Uri } from "vscode";

describe("gitApi version check", () => {
  it("parses valid git version output", () => {
    expect(parseGitVersion("git version 2.26.0")).toEqual({ major: 2, minor: 26, patch: 0 });
    expect(parseGitVersion("git version 2.54.0 (Apple Git-157)")).toEqual({ major: 2, minor: 54, patch: 0 });
    expect(parseGitVersion("git version 3.0.1.windows.1")).toEqual({ major: 3, minor: 0, patch: 1 });
  });

  it("returns undefined for unparseable output", () => {
    expect(parseGitVersion("unknown output")).toBeUndefined();
    expect(parseGitVersion("")).toBeUndefined();
  });

  it("enforces minimum Git version 2.26.0", () => {
    expect(isGitVersionSupported("git version 2.26.0")).toBe(true);
    expect(isGitVersionSupported("git version 2.26.1")).toBe(true);
    expect(isGitVersionSupported("git version 2.54.0")).toBe(true);
    expect(isGitVersionSupported("git version 3.0.0")).toBe(true);

    expect(isGitVersionSupported("git version 2.25.9")).toBe(false);
    expect(isGitVersionSupported("git version 2.17.0")).toBe(false);
    expect(isGitVersionSupported("git version 1.9.5")).toBe(false);
    expect(isGitVersionSupported("invalid")).toBe(false);
  });
});

describe("resolveRepository closest-root", () => {
  it("resolves nested repos to the closest root", () => {
    const rootRepo = {
      rootUri: { fsPath: "/workspace/parent" },
    } as Repository;

    const subRepo = {
      rootUri: { fsPath: "/workspace/parent/submodule" },
    } as Repository;

    const mockApi = {
      repositories: [rootRepo, subRepo],
      getRepository: (uri: { fsPath: string }) => {
        if (uri.fsPath.startsWith("/workspace/parent/submodule")) return subRepo;
        if (uri.fsPath.startsWith("/workspace/parent")) return rootRepo;
        return null;
      },
    } as unknown as GitAPI;

    // File in root repo
    const r1 = resolveRepository(mockApi, { fsPath: "/workspace/parent/src/index.ts" } as unknown as Uri);
    expect(r1).toBe(rootRepo);

    // File in submodule
    const r2 = resolveRepository(mockApi, { fsPath: "/workspace/parent/submodule/lib/foo.ts" } as unknown as Uri);
    expect(r2).toBe(subRepo);
  });
});
