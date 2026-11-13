import { describe, it, expect } from "vitest";
import {
  sanitizeStderr,
  classifyGitError,
  buildGitEnv,
  runGit,
  parseVerifyOutput,
  mapPushError,
  runUnderMutex,
} from "../../src/host/runner";
import { GitErrorCodes } from "../../src/host/gitStatus";

describe("runner sanitization & classification", () => {
  it("strips ANSI escape sequences and truncates to 4 KB", () => {
    const ansiString = "\x1B[31mError occurred\x1B[0m: \x1B[1mfailed\x1B[0m";
    expect(sanitizeStderr(ansiString)).toBe("Error occurred: failed");

    const hugeString = "a".repeat(5000);
    const sanitized = sanitizeStderr(hugeString);
    expect(sanitized).toHaveLength(4096);
  });

  it("classifies nothing to commit", () => {
    expect(classifyGitError("nothing to commit, working tree clean").code).toBe("NOTHING_TO_COMMIT");
    expect(classifyGitError("no changes added to commit").code).toBe("NOTHING_TO_COMMIT");
  });

  it("classifies identity missing", () => {
    expect(classifyGitError("fatal: unable to auto-detect email address").code).toBe("IDENTITY_MISSING");
    expect(classifyGitError("*** Please tell me who you are.").code).toBe("IDENTITY_MISSING");
  });

  it("classifies index.lock contention", () => {
    expect(classifyGitError("fatal: Unable to create '.git/index.lock': File exists.").code).toBe("INDEX_LOCKED");
  });

  it("classifies signing failed and offers sendToTerminal fallback", () => {
    const res = classifyGitError("error: gpg failed to sign the data");
    expect(res.code).toBe("SIGNING_FAILED");
    expect(res.fallback).toBe("sendToTerminal");
  });

  it("classifies hook rejection", () => {
    expect(classifyGitError("pre-commit hook failed (add --no-verify to bypass)").code).toBe("HOOK_REJECTED");
    expect(classifyGitError("commit-msg hook rejected").code).toBe("HOOK_REJECTED");
  });

  it("classifies generic git failure", () => {
    expect(classifyGitError("fatal: some unknown git error").code).toBe("GIT_FAILED");
  });
});

describe("buildGitEnv", () => {
  it("sanitizes environment variables per §8.2", () => {
    process.env["GIT_DIR"] = "/fake/git";
    process.env["GIT_WORK_TREE"] = "/fake/wt";
    process.env["GIT_INDEX_FILE"] = "/fake/idx";
    process.env["GIT_AUTHOR_NAME"] = "Attacker";
    process.env["GIT_COMMITTER_NAME"] = "Attacker";

    const env = buildGitEnv({ GIT_AUTHOR_DATE: "2026-03-02T10:41:07+0530" });

    expect(env["GIT_DIR"]).toBeUndefined();
    expect(env["GIT_WORK_TREE"]).toBeUndefined();
    expect(env["GIT_INDEX_FILE"]).toBeUndefined();
    expect(env["GIT_AUTHOR_NAME"]).toBeUndefined();
    expect(env["GIT_COMMITTER_NAME"]).toBeUndefined();

    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["LC_MESSAGES"]).toBe("C");
    expect(env["GIT_AUTHOR_DATE"]).toBe("2026-03-02T10:41:07+0530");

    delete process.env["GIT_DIR"];
    delete process.env["GIT_WORK_TREE"];
    delete process.env["GIT_INDEX_FILE"];
    delete process.env["GIT_AUTHOR_NAME"];
    delete process.env["GIT_COMMITTER_NAME"];
  });
});

describe("runGit security guard", () => {
  it("refuses git.path ending in .cmd or .bat", async () => {
    const res = await runGit("C:\\Git\\bin\\git.cmd", ["status"], { cwd: "." });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("Refused to run batch script wrapper (.cmd/.bat)");

    const resBat = await runGit("/path/to/git.bat", ["status"], { cwd: "." });
    expect(resBat.ok).toBe(false);
    expect(resBat.stderr).toContain("Refused to run batch script wrapper (.cmd/.bat)");
  });
});

describe("mapPushError", () => {
  it("maps PushRejected", () => {
    expect(mapPushError({ gitErrorCode: GitErrorCodes.PushRejected })).toEqual({
      code: "PUSH_REJECTED",
    });
  });

  it("maps AuthenticationFailed with fallback", () => {
    expect(mapPushError({ gitErrorCode: GitErrorCodes.AuthenticationFailed })).toEqual({
      code: "AUTH_FAILED",
      fallback: "sendToTerminal",
    });
  });

  it("maps RemoteConnectionError", () => {
    expect(mapPushError({ gitErrorCode: GitErrorCodes.RemoteConnectionError })).toEqual({
      code: "NETWORK",
    });
  });
});

describe("parseVerifyOutput", () => {
  it("parses valid verify output correctly", () => {
    const raw = "7f7f03a3a9358b252a7a2c6b0e5880d9ddf8b852\x001772428267 +0530\x001772428267 +0530\n";
    const res = parseVerifyOutput(raw);
    expect(res).toBeDefined();
    expect(res?.sha).toBe("7f7f03a3a9358b252a7a2c6b0e5880d9ddf8b852");
    expect(res?.author).toEqual({ epoch: 1772428267, offset: "+0530" });
    expect(res?.committer).toEqual({ epoch: 1772428267, offset: "+0530" });
  });

  it("returns undefined for malformed verify output", () => {
    expect(parseVerifyOutput("not-valid")).toBeUndefined();
    expect(parseVerifyOutput("sha\x00bad\x00bad")).toBeUndefined();
  });
});

describe("runUnderMutex", () => {
  it("serializes concurrent operations per repo", async () => {
    const order: number[] = [];

    const op1 = runUnderMutex("repoA", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });

    const op2 = runUnderMutex("repoA", () => {
      order.push(2);
      return Promise.resolve();
    });

    await Promise.all([op1, op2]);
    expect(order).toEqual([1, 2]);
  });
});
