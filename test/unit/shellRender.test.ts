import { describe, it, expect } from "vitest";
import { renderShell } from "../../src/core/shellRender";
import type { CommitPlan, GitPath, RemoteName, BranchName, ShellKind } from "../../src/core/types";

describe("renderShell", () => {
  const basePlan: CommitPlan = {
    repoRoot: "/home/me/repo",
    paths: ["src/a.ts" as GitPath],
    untrackedPaths: [],
    strategy: "only",
    message: { paragraphs: ["fix: handle empty input", "Covers the null case."] },
    timestamp: {
      iso: "2026-03-02T10:41:07+0530",
      epochSeconds: 1772428267,
      offsetMinutes: 330,
    },
  };

  it("renders bash strategy only matching blueprint §8.3 example", () => {
    const planWithUntracked: CommitPlan = {
      ...basePlan,
      paths: ["src/a.ts" as GitPath, "new file.ts" as GitPath],
      untrackedPaths: ["new file.ts" as GitPath],
    };

    const res = renderShell(planWithUntracked, "bash", { includeRepoDir: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine).toBe(
        "git -C '/home/me/repo' --literal-pathspecs add -- 'new file.ts' && " +
          "GIT_AUTHOR_DATE='2026-03-02T10:41:07+0530' GIT_COMMITTER_DATE='2026-03-02T10:41:07+0530' " +
          "git -C '/home/me/repo' --literal-pathspecs commit --only --cleanup=whitespace -m 'fix: handle empty input' -m 'Covers the null case.' -- 'src/a.ts' 'new file.ts'",
      );
    }
  });

  it("omits -C when includeRepoDir is false", () => {
    const res = renderShell(basePlan, "bash", { includeRepoDir: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine).toBe(
        "GIT_AUTHOR_DATE='2026-03-02T10:41:07+0530' GIT_COMMITTER_DATE='2026-03-02T10:41:07+0530' " +
          "git --literal-pathspecs commit --only --cleanup=whitespace -m 'fix: handle empty input' -m 'Covers the null case.' -- 'src/a.ts'",
      );
    }
  });

  it("renders fish using env prefix", () => {
    const res = renderShell(basePlan, "fish", { includeRepoDir: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine.startsWith("env GIT_AUTHOR_DATE='2026-03-02T10:41:07+0530'")).toBe(true);
    }
  });

  it("renders pwsh using try/finally block and LastExitCode chaining", () => {
    const planWithUntracked: CommitPlan = {
      ...basePlan,
      paths: ["src/a.ts" as GitPath, "new.ts" as GitPath],
      untrackedPaths: ["new.ts" as GitPath],
    };
    const res = renderShell(planWithUntracked, "pwsh", { includeRepoDir: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine).toContain("; if ($LASTEXITCODE -eq 0) {");
      expect(res.value.singleLine).toContain("try { $env:GIT_AUTHOR_DATE=");
      expect(res.value.singleLine).toContain("finally { Remove-Item Env:GIT_AUTHOR_DATE,Env:GIT_COMMITTER_DATE");
    }
  });

  it("renders cmd using AM-14 canonical chain with unconditional cleanup", () => {
    const planWithPush: CommitPlan = {
      ...basePlan,
      push: {
        remote: "origin" as RemoteName,
        branch: "main" as BranchName,
        setUpstream: false,
      },
    };
    const res = renderShell(planWithPush, "cmd", { includeRepoDir: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine.startsWith("(")).toBe(true);
      expect(res.value.singleLine.endsWith('& set "GIT_AUTHOR_DATE=" & set "GIT_COMMITTER_DATE="')).toBe(true);
      expect(res.value.singleLine).toContain('set "GIT_AUTHOR_DATE=2026-03-02T10:41:07+0530"');
      expect(res.value.singleLine).toContain('git -C "/home/me/repo" push "origin" "main"');
    }
  });

  it("renders index strategy on unborn HEAD", () => {
    const indexPlan: CommitPlan = {
      ...basePlan,
      strategy: "index",
      paths: ["file1.ts" as GitPath, "file2.ts" as GitPath],
      untrackedPaths: ["file1.ts" as GitPath, "file2.ts" as GitPath],
    };
    const res = renderShell(indexPlan, "bash", { includeRepoDir: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine).toBe(
        "git --literal-pathspecs add -- 'file1.ts' 'file2.ts' && " +
          "GIT_AUTHOR_DATE='2026-03-02T10:41:07+0530' GIT_COMMITTER_DATE='2026-03-02T10:41:07+0530' " +
          "git --literal-pathspecs commit --cleanup=whitespace -m 'fix: handle empty input' -m 'Covers the null case.'",
      );
    }
  });

  it("includes -u when push.setUpstream is true", () => {
    const pushPlan: CommitPlan = {
      ...basePlan,
      push: {
        remote: "origin" as RemoteName,
        branch: "feat" as BranchName,
        setUpstream: true,
      },
    };
    const res = renderShell(pushPlan, "bash", { includeRepoDir: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.singleLine).toContain("git push -u 'origin' 'feat'");
    }
  });

  describe("Rejection of §13.1 Hostile Vectors", () => {
    it("vector 2: say \"hi\" rejected on pwsh, powershell, cmd; accepted on POSIX/fish", () => {
      const plan: CommitPlan = {
        ...basePlan,
        message: { paragraphs: ['say "hi"'] },
      };
      expect(renderShell(plan, "bash", { includeRepoDir: false }).ok).toBe(true);
      expect(renderShell(plan, "fish", { includeRepoDir: false }).ok).toBe(true);
      expect(renderShell(plan, "pwsh", { includeRepoDir: false })).toEqual({
        ok: false,
        error: { code: "UNSAFE_CHARACTER", shell: "pwsh", field: "message", character: "U+0022 '\"'" },
      });
      expect(renderShell(plan, "powershell", { includeRepoDir: false })).toEqual({
        ok: false,
        error: { code: "UNSAFE_CHARACTER", shell: "powershell", field: "message", character: "U+0022 '\"'" },
      });
      expect(renderShell(plan, "cmd", { includeRepoDir: false })).toEqual({
        ok: false,
        error: { code: "UNSAFE_CHARACTER", shell: "cmd", field: "message", character: "U+0022 '\"'" },
      });
    });

    it("vector 9: 100% and %PATH% rejected on cmd; accepted on others", () => {
      const plan: CommitPlan = {
        ...basePlan,
        message: { paragraphs: ["100% done", "%PATH%"] },
      };
      expect(renderShell(plan, "bash", { includeRepoDir: false }).ok).toBe(true);
      expect(renderShell(plan, "cmd", { includeRepoDir: false })).toEqual({
        ok: false,
        error: { code: "UNSAFE_CHARACTER", shell: "cmd", field: "message", character: "U+0025 '%'" },
      });
    });

    it("vector 10 & 11: ^& and wow! rejected on cmd; accepted on others", () => {
      const planHat: CommitPlan = {
        ...basePlan,
        message: { paragraphs: ["^&"] },
      };
      expect(renderShell(planHat, "cmd", { includeRepoDir: false })).toEqual({
        ok: false,
        error: { code: "UNSAFE_CHARACTER", shell: "cmd", field: "message", character: "U+005E '^'" },
      });
      const planExcl: CommitPlan = {
        ...basePlan,
        message: { paragraphs: ["wow!"] },
      };
      expect(renderShell(planExcl, "cmd", { includeRepoDir: false })).toEqual({
        ok: false,
        error: { code: "UNSAFE_CHARACTER", shell: "cmd", field: "message", character: "U+0021 '!'" },
      });
    });

    it("vector 16: TAB, ESC rejected in all shells", () => {
      for (const sh of ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd"] as const) {
        const planTab: CommitPlan = {
          ...basePlan,
          message: { paragraphs: ["tab\there"] },
        };
        const res = renderShell(planTab, sh, { includeRepoDir: false });
        expect(res).toEqual({
          ok: false,
          error: { code: "UNSAFE_CHARACTER", shell: sh, field: "message", character: "U+0009 (control)" },
        });

        const planEsc: CommitPlan = {
          ...basePlan,
          paths: ["file\x1b.ts" as GitPath],
        };
        const resEsc = renderShell(planEsc, sh, { includeRepoDir: false });
        expect(resEsc).toEqual({
          ok: false,
          error: { code: "UNSAFE_CHARACTER", shell: sh, field: "path", character: "U+001B (control)" },
        });
      }
    });

    it("vector 17: bidi control character U+202E rejected in all shells", () => {
      const planBidi: CommitPlan = {
        ...basePlan,
        message: { paragraphs: ["text\u202Ehidden"] },
      };
      for (const sh of ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd"] as const) {
        const res = renderShell(planBidi, sh, { includeRepoDir: false });
        expect(res).toEqual({
          ok: false,
          error: { code: "UNSAFE_CHARACTER", shell: sh, field: "message", character: "U+202E (control)" },
        });
      }
    });
  });

  describe("Length limits", () => {
    it("returns COMMAND_TOO_LONG when cmd exceeds 8000 characters", () => {
      const longMsg = "a".repeat(8000);
      const plan: CommitPlan = {
        ...basePlan,
        message: { paragraphs: [longMsg] },
      };
      const res = renderShell(plan, "cmd", { includeRepoDir: false });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("COMMAND_TOO_LONG");
        if (res.error.code === "COMMAND_TOO_LONG") {
          expect(res.error.limit).toBe(8000);
        }
      }
    });

    it("returns COMMAND_TOO_LONG when bash exceeds 32000 characters", () => {
      const paths = Array.from({ length: 1500 }, (_, i) => `path/to/nested/very/long/file_${String(i)}.ts` as GitPath);
      const plan: CommitPlan = {
        ...basePlan,
        paths,
      };
      const res = renderShell(plan, "bash", { includeRepoDir: false });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("COMMAND_TOO_LONG");
        if (res.error.code === "COMMAND_TOO_LONG") {
          expect(res.error.limit).toBe(32000);
        }
      }
    });
  });

  describe("Property test: rendered output is always single line and deterministic", () => {
    it("never contains newlines", () => {
      const shells: ShellKind[] = ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd"];
      for (const sh of shells) {
        const res = renderShell(basePlan, sh, { includeRepoDir: true });
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.singleLine.includes("\n")).toBe(false);
          expect(res.value.singleLine.includes("\r")).toBe(false);
        }
      }
    });
  });
});
