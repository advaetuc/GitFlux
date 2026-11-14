import { describe, it, expect } from "vitest";
import { validateGitPath, toPosixRoot } from "../../src/core/path";

describe("validateGitPath", () => {
  it("rejects empty paths", () => {
    const res = validateGitPath("");
    expect(res).toEqual({ ok: false, error: "EMPTY" });
  });

  it("rejects paths over 4096 characters", () => {
    const longPath = "a".repeat(4097);
    const res = validateGitPath(longPath);
    expect(res).toEqual({ ok: false, error: "TOO_LONG" });
  });

  it("accepts paths up to 4096 characters", () => {
    const validLongPath = "a".repeat(4096);
    const res = validateGitPath(validLongPath);
    expect(res).toEqual({ ok: true, value: validLongPath });
  });

  it("rejects NUL characters", () => {
    const res = validateGitPath("foo\0bar.ts");
    expect(res).toEqual({ ok: false, error: "ILLEGAL_CHARACTER" });
  });

  it("rejects CR characters", () => {
    const res = validateGitPath("foo\rbar.ts");
    expect(res).toEqual({ ok: false, error: "ILLEGAL_CHARACTER" });
  });

  it("rejects LF characters", () => {
    const res = validateGitPath("foo\nbar.ts");
    expect(res).toEqual({ ok: false, error: "ILLEGAL_CHARACTER" });
  });

  it("rejects POSIX absolute paths", () => {
    const res = validateGitPath("/home/user/file.ts");
    expect(res).toEqual({ ok: false, error: "ABSOLUTE" });
  });

  it("rejects Windows backslash absolute paths", () => {
    const res = validateGitPath("\\Windows\\file.ts");
    expect(res).toEqual({ ok: false, error: "ABSOLUTE" });
  });

  it("rejects Windows drive absolute paths", () => {
    const res = validateGitPath("C:/project/file.ts");
    expect(res).toEqual({ ok: false, error: "ABSOLUTE" });
    const res2 = validateGitPath("D:\\project\\file.ts");
    expect(res2).toEqual({ ok: false, error: "ABSOLUTE" });
  });

  it("rejects traversal segments with '..'", () => {
    expect(validateGitPath("../secret.txt")).toEqual({ ok: false, error: "TRAVERSAL" });
    expect(validateGitPath("foo/../bar.ts")).toEqual({ ok: false, error: "TRAVERSAL" });
    expect(validateGitPath("foo/bar/..")).toEqual({ ok: false, error: "TRAVERSAL" });
    expect(validateGitPath("..")).toEqual({ ok: false, error: "TRAVERSAL" });
  });

  it("accepts valid relative POSIX paths", () => {
    expect(validateGitPath("src/core/path.ts")).toEqual({ ok: true, value: "src/core/path.ts" });
    expect(validateGitPath("file.txt")).toEqual({ ok: true, value: "file.txt" });
    expect(validateGitPath("foo-bar_123/sub.dir/file-name.test.ts")).toEqual({
      ok: true,
      value: "foo-bar_123/sub.dir/file-name.test.ts",
    });
  });
});

describe("toPosixRoot", () => {
  it("converts backslashes to forward slashes", () => {
    expect(toPosixRoot("C:\\Users\\me\\repo")).toBe("C:/Users/me/repo");
  });

  it("strips trailing slashes from general paths", () => {
    expect(toPosixRoot("/home/me/repo/")).toBe("/home/me/repo");
    expect(toPosixRoot("/home/me/repo///")).toBe("/home/me/repo");
    expect(toPosixRoot("C:\\Users\\me\\repo\\")).toBe("C:/Users/me/repo");
  });

  it("preserves POSIX root '/'", () => {
    expect(toPosixRoot("/")).toBe("/");
  });

  it("preserves Windows drive root 'C:/'", () => {
    expect(toPosixRoot("C:\\")).toBe("C:/");
    expect(toPosixRoot("C:\\\\\\")).toBe("C:/");
    expect(toPosixRoot("C:/")).toBe("C:/");
    expect(toPosixRoot("d:")).toBe("d:/");
  });
});
