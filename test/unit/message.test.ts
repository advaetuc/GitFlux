import { describe, it, expect } from "vitest";
import { normalizeMessage } from "../../src/core/message";

describe("normalizeMessage", () => {
  it("rejects empty subject", () => {
    expect(normalizeMessage("", "body")).toEqual({ ok: false, error: "EMPTY_SUBJECT" });
    expect(normalizeMessage("   \t  ", "body")).toEqual({ ok: false, error: "EMPTY_SUBJECT" });
  });

  it("rejects multiline subject", () => {
    expect(normalizeMessage("feat: line1\nline2", "body")).toEqual({
      ok: false,
      error: "SUBJECT_MULTILINE",
    });
    expect(normalizeMessage("feat: line1\rline2", "body")).toEqual({
      ok: false,
      error: "SUBJECT_MULTILINE",
    });
  });

  it("rejects NUL characters in subject or body", () => {
    expect(normalizeMessage("feat: null\0byte", "")).toEqual({
      ok: false,
      error: "NUL_CHARACTER",
    });
    expect(normalizeMessage("feat: normal", "body with \0 null")).toEqual({
      ok: false,
      error: "NUL_CHARACTER",
    });
  });

  it("rejects subject longer than 500 characters", () => {
    const longSub = "a".repeat(501);
    expect(normalizeMessage(longSub, "")).toEqual({ ok: false, error: "TOO_LONG" });
  });

  it("accepts subject exactly 500 characters", () => {
    const sub500 = "a".repeat(500);
    const res = normalizeMessage(sub500, "");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.paragraphs[0]).toBe(sub500);
    }
  });

  it("collapses soft wraps inside a body paragraph to a single space", () => {
    const res = normalizeMessage(
      "feat: add feature",
      "Line one of paragraph.\nLine two of paragraph.\n  Line three with extra space.  ",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.paragraphs).toEqual([
        "feat: add feature",
        "Line one of paragraph. Line two of paragraph. Line three with extra space.",
      ]);
    }
  });

  it("splits body paragraphs on blank lines and filters empty ones", () => {
    const body = `
Paragraph 1 line 1
Paragraph 1 line 2

Paragraph 2 alone


Paragraph 3 after multiple blank lines
`;
    const res = normalizeMessage("chore: clean up", body);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.paragraphs).toEqual([
        "chore: clean up",
        "Paragraph 1 line 1 Paragraph 1 line 2",
        "Paragraph 2 alone",
        "Paragraph 3 after multiple blank lines",
      ]);
    }
  });

  it("handles subject-only message with empty body", () => {
    const res = normalizeMessage("fix: simple bug", "   \n\n   ");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.paragraphs).toEqual(["fix: simple bug"]);
    }
  });

  it("rejects total message exceeding 8192 characters (vector 18)", () => {
    const sub = "a".repeat(100);
    // joined by \n\n: sub (100) + \n\n (2) + body = 8192 => body length = 8090
    const body8090 = "b".repeat(8090);
    const okRes = normalizeMessage(sub, body8090);
    expect(okRes.ok).toBe(true);

    // 8193 characters => rejected
    const body8091 = "b".repeat(8091);
    const failRes = normalizeMessage(sub, body8091);
    expect(failRes).toEqual({ ok: false, error: "TOO_LONG" });
  });
});
