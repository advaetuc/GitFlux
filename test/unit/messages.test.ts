import { describe, it, expect } from "vitest";
import { isWebviewToHost } from "../../src/host/messages";

describe("isWebviewToHost (§7.2)", () => {
  const validDraft = {
    repoId: "repo-1",
    revision: 1,
    paths: ["src/a.ts", "src/b.ts"],
    message: { subject: "feat: do something", body: "Detailed body" },
    when: {
      local: { year: 2024, month: 6, day: 15, hour: 10, minute: 30, second: 0 },
      offsetMinutes: 330,
    },
    push: { enabled: false, remote: "origin" },
    shell: "bash",
  };

  it("accepts valid ready message", () => {
    expect(isWebviewToHost({ type: "ready", protocolVersion: 1 })).toBe(true);
  });

  it("accepts valid selectRepo message", () => {
    expect(isWebviewToHost({ type: "selectRepo", repoId: "repo-1" })).toBe(true);
  });

  it("accepts valid initRepository message", () => {
    expect(isWebviewToHost({ type: "initRepository" })).toBe(true);
  });

  it("accepts valid cancel message", () => {
    expect(isWebviewToHost({ type: "cancel", requestId: "req-123" })).toBe(true);
  });

  it("accepts valid copy, sendToTerminal, run messages", () => {
    for (const t of ["copy", "sendToTerminal", "run"] as const) {
      expect(
        isWebviewToHost({
          type: t,
          requestId: "req-456",
          draft: validDraft,
        }),
      ).toBe(true);
    }
  });

  it("ignores unknown extra keys", () => {
    expect(
      isWebviewToHost({
        type: "ready",
        protocolVersion: 1,
        extraGarbage: "should be ignored",
        anotherUnknown: 12345,
      }),
    ).toBe(true);
  });

  describe("Rejections (never throws)", () => {
    const invalidInputs: Array<{ name: string; payload: unknown }> = [
      { name: "null", payload: null },
      { name: "undefined", payload: undefined },
      { name: "string", payload: "ready" },
      { name: "number", payload: 42 },
      { name: "boolean", payload: true },
      { name: "array", payload: [] },
      { name: "empty object", payload: {} },
      { name: "unknown type", payload: { type: "destroyEverything" } },
      { name: "ready with non-integer version", payload: { type: "ready", protocolVersion: 1.5 } },
      { name: "ready with string version", payload: { type: "ready", protocolVersion: "1" } },
      { name: "cancel with long requestId (>64)", payload: { type: "cancel", requestId: "a".repeat(65) } },
      { name: "selectRepo with non-string repoId", payload: { type: "selectRepo", repoId: 123 } },
      {
        name: "run with subject > 500",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: { ...validDraft, message: { subject: "a".repeat(501), body: "" } },
        },
      },
      {
        name: "run with body > 8192",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: { ...validDraft, message: { subject: "ok", body: "b".repeat(8193) } },
        },
      },
      {
        name: "run with paths > 20000",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: { ...validDraft, paths: Array.from({ length: 20001 }, () => "file.ts") },
        },
      },
      {
        name: "run with path > 4096 chars",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: { ...validDraft, paths: ["p".repeat(4097)] },
        },
      },
      {
        name: "run with non-integer revision",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: { ...validDraft, revision: 1.2 },
        },
      },
      {
        name: "run with invalid shell enum",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: { ...validDraft, shell: "zsh-invalid" },
        },
      },
      {
        name: "run with invalid local date",
        payload: {
          type: "run",
          requestId: "req-1",
          draft: {
            ...validDraft,
            when: {
              ...validDraft.when,
              local: { year: 2024, month: "6", day: 15, hour: 10, minute: 30, second: 0 },
            },
          },
        },
      },
    ];

    for (const testCase of invalidInputs) {
      it(`rejects ${testCase.name} without throwing`, () => {
        expect(() => isWebviewToHost(testCase.payload)).not.toThrow();
        expect(isWebviewToHost(testCase.payload)).toBe(false);
      });
    }
  });
});
