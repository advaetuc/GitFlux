import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderShell } from "../../src/core/shellRender";
import type { CommitPlan, GitPath, ShellKind } from "../../src/core/types";

function isShellAvailable(sh: string): boolean {
  const check = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(check, [sh], { stdio: "ignore" });
  return res.status === 0;
}

function createFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitflux-matrix-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Matrix Runner"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "matrix@example.com"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "tracked.txt"), "base content\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir, stdio: "ignore" });
  // Modify tracked file so there is a change to commit
  writeFileSync(join(dir, "tracked.txt"), "modified content\n", "utf8");
  return dir;
}

function runCommandInShell(shell: ShellKind, cmd: string, cwd: string) {
  let file: string;
  let args: string[];
  let options: Record<string, unknown> = { cwd, encoding: "utf8" };

  switch (shell) {
    case "bash":
      file = "bash";
      args = ["-c", cmd];
      break;
    case "zsh":
      file = "zsh";
      args = ["-c", cmd];
      break;
    case "sh":
      file = "sh";
      args = ["-c", cmd];
      break;
    case "fish":
      file = "fish";
      args = ["-c", cmd];
      break;
    case "pwsh":
      file = "pwsh";
      args = ["-NoProfile", "-NonInteractive", "-Command", cmd];
      break;
    case "powershell":
      file = "powershell.exe";
      args = ["-NoProfile", "-NonInteractive", "-Command", cmd];
      break;
    case "cmd":
      file = "cmd.exe";
      args = ["/d", "/s", "/c", `"${cmd}"`];
      options = { ...options, windowsVerbatimArguments: true };
      break;
  }

  const res = spawnSync(file, args, options);
  const outStr = typeof res.stdout === "string" ? res.stdout : "";
  const errStr = typeof res.stderr === "string" ? res.stderr : "";
  return {
    status: res.status ?? 1,
    stdout: outStr,
    stderr: errStr,
  };
}

describe("Shell-Matrix Hostile Vectors (§13.1 & AM-15, AM-18)", () => {
  const shells: ShellKind[] = ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd"];

  const testTimestamp = {
    iso: "2026-03-02T10:41:07+0530",
    epochSeconds: 1772428267,
    offsetMinutes: 330,
  };

  const vectors: Array<{
    id: number;
    name: string;
    message: [string, ...string[]];
    expectedRejectedShells?: ShellKind[];
    extraCheck?: (repoDir: string) => void;
  }> = [
    { id: 1, name: "it's", message: ["it's"] },
    { id: 2, name: 'say "hi"', message: ['say "hi"'], expectedRejectedShells: ["pwsh", "powershell", "cmd"] },
    { id: 3, name: "$(git config canary.hit 1)", message: ["$(git config canary.hit 1)"] },
    { id: 4, name: "`git config canary.hit 1`", message: ["`git config canary.hit 1`"] },
    { id: 5, name: "a; git config canary.hit 1", message: ["a; git config canary.hit 1"] },
    { id: 6, name: "a && git config canary.hit 1", message: ["a && git config canary.hit 1"] },
    {
      id: 7,
      name: "a | cat and a > canary",
      message: ["a | cat", "a > canary"],
      extraCheck: (dir) => {
        expect(existsSync(join(dir, "canary"))).toBe(false);
      },
    },
    { id: 8, name: "-n and --amend", message: ["-n", "--amend"] },
    { id: 9, name: "100% and %PATH%", message: ["100%", "%PATH%"], expectedRejectedShells: ["cmd"] },
    { id: 10, name: "wow!!", message: ["wow!!"], expectedRejectedShells: ["cmd"] },
    { id: 11, name: "^&", message: ["^&"], expectedRejectedShells: ["cmd"] },
    { id: 12, name: "‘smart’ ’quotes’", message: ["‘smart’ ’quotes’"] },
    { id: 13, name: "日本語 🙂", message: ["日本語 🙂"] },
    { id: 14, name: "back\\slash and trailing \\", message: ["back\\slash", "trailing\\"] },
    { id: 15, name: "# not a comment", message: ["# not a comment"] },
  ];

  beforeAll(() => {
    const required = process.env.REQUIRE_SHELLS;
    if (required) {
      const list = required.split(",").map((s) => s.trim()).filter(Boolean);
      for (const s of list) {
        const bin = s === "powershell" ? "powershell.exe" : s === "cmd" ? "cmd.exe" : s;
        expect(isShellAvailable(bin), `Required shell "${s}" is not available on PATH`).toBe(true);
      }
    }
  });

  afterAll(() => {
    const summary = shells.map((sh) => {
      const bin = sh === "powershell" ? "powershell.exe" : sh === "cmd" ? "cmd.exe" : sh;
      const available = isShellAvailable(bin);
      return {
        shell: sh,
        available: available ? "YES" : "NO",
        executed: available ? 18 : 0,
        skipped: available ? 0 : 18,
      };
    });
    console.log("\n--- Shell Matrix Summary ---");
    console.table(summary);
  });

  for (const sh of shells) {
    const available = isShellAvailable(sh === "powershell" ? "powershell.exe" : sh === "cmd" ? "cmd.exe" : sh);

    describe.skipIf(!available)(`Shell: ${sh} (available: ${available ? "YES" : "NO"})`, () => {
      for (const vec of vectors) {
        it(`vector ${String(vec.id)}: ${vec.name}`, () => {
          const shouldReject = vec.expectedRejectedShells?.includes(sh) ?? false;
          const repoDir = createFixtureRepo();

          try {
            const plan: CommitPlan = {
              repoRoot: repoDir,
              paths: ["tracked.txt" as GitPath],
              untrackedPaths: [],
              strategy: "only",
              message: { paragraphs: vec.message },
              timestamp: testTimestamp,
            };

            const renderRes = renderShell(plan, sh, { includeRepoDir: true });

            if (shouldReject) {
              expect(renderRes.ok).toBe(false);
              return;
            }

            expect(renderRes.ok).toBe(true);
            if (!renderRes.ok) return;

            // Execute in the real shell
            const out = runCommandInShell(sh, renderRes.value.singleLine, repoDir);
            expect(out.status, `Shell command failed: ${out.stderr}`).toBe(0);

            // Canary Assertion 1: git config canary.hit
            const canaryCheck = spawnSync("git", ["config", "--get", "canary.hit"], {
              cwd: repoDir,
              encoding: "utf8",
            });
            expect(canaryCheck.stdout.trim(), "CANARY HIT detected in git config!").toBe("");

            // Canary Assertion 2: canary file
            expect(existsSync(join(repoDir, "canary")), "CANARY HIT: file 'canary' was created!").toBe(false);

            if (vec.extraCheck) {
              vec.extraCheck(repoDir);
            }

            // Message Round-trip Expectation (AM-18):
            // git log -1 --format=%B with trailing whitespace trimmed equals paragraphs.join("\n\n")
            const logMsg = execFileSync("git", ["log", "-1", "--format=%B"], {
              cwd: repoDir,
              encoding: "utf8",
            }).trimEnd();
            expect(logMsg).toBe(vec.message.join("\n\n"));

            // Date Expectation (AM-18):
            // git log -1 --format=%ad%x7c%cd --date=raw shows <epoch> <±HHMM> for both
            const rawDates = execFileSync("git", ["log", "-1", "--format=%ad%x7c%cd", "--date=raw"], {
              cwd: repoDir,
              encoding: "utf8",
            }).trim();
            const expectedDate = `${String(testTimestamp.epochSeconds)} +0530`;
            expect(rawDates).toBe(`${expectedDate}|${expectedDate}`);
          } finally {
            rmSync(repoDir, { recursive: true, force: true });
          }
        });
      }

      // Vector 16 & 17: rejection tests
      it("vector 16: control characters rejected by renderShell", () => {
        const planEsc: CommitPlan = {
          repoRoot: "/test",
          paths: ["tracked.txt" as GitPath],
          untrackedPaths: [],
          strategy: "only",
          message: { paragraphs: ["a\x1bb"] },
          timestamp: testTimestamp,
        };
        const res = renderShell(planEsc, sh, { includeRepoDir: true });
        expect(res.ok).toBe(false);
      });

      it("vector 17: bidi control U+202E rejected by renderShell", () => {
        const planBidi: CommitPlan = {
          repoRoot: "/test",
          paths: ["tracked.txt" as GitPath],
          untrackedPaths: [],
          strategy: "only",
          message: { paragraphs: ["a\u202Eb"] },
          timestamp: testTimestamp,
        };
        const res = renderShell(planBidi, sh, { includeRepoDir: true });
        expect(res.ok).toBe(false);
      });

      // Vector 20: literal pathspec with hostile filename
      it("vector 20: literal pathspec with spaces, quotes, and special characters", () => {
        const repoDir = createFixtureRepo();
        try {
          const hostileName = "sp ace_quote'd.txt";
          writeFileSync(join(repoDir, hostileName), "special file content\n", "utf8");

          const plan: CommitPlan = {
            repoRoot: repoDir,
            paths: [hostileName as GitPath],
            untrackedPaths: [hostileName as GitPath],
            strategy: "only",
            message: { paragraphs: ["commit special file"] },
            timestamp: testTimestamp,
          };

          const renderRes = renderShell(plan, sh, { includeRepoDir: true });
          expect(renderRes.ok).toBe(true);
          if (!renderRes.ok) return;

          const out = runCommandInShell(sh, renderRes.value.singleLine, repoDir);
          expect(out.status, `Failed to commit hostile path: ${out.stderr}`).toBe(0);

          // Verify file was committed
          const committedFiles = execFileSync("git", ["diff", "--name-only", "HEAD~1", "HEAD"], {
            cwd: repoDir,
            encoding: "utf8",
          }).trim();
          expect(committedFiles).toBe(hostileName);
        } finally {
          rmSync(repoDir, { recursive: true, force: true });
        }
      });
    });
  }
});
