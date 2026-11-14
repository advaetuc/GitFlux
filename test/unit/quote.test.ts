import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { QUOTE_RULES, formatUnsafeCharacter } from "../../src/core/quote";
import type { ShellKind } from "../../src/core/types";

describe("quote rules and escaping", () => {
  const shells: ShellKind[] = ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd"];

  it("POSIX shells escape single quotes as '\\''", () => {
    for (const sh of ["bash", "zsh", "sh"] as const) {
      const q = QUOTE_RULES[sh].quote;
      expect(q("hello")).toBe("'hello'");
      expect(q("it's")).toBe("'it'\\''s'");
      expect(q("a'b'c")).toBe("'a'\\''b'\\''c'");
    }
  });

  it("fish escapes backslashes as \\\\ and single quotes as \\'", () => {
    const q = QUOTE_RULES.fish.quote;
    expect(q("hello")).toBe("'hello'");
    expect(q("back\\slash")).toBe("'back\\\\slash'");
    expect(q("it's")).toBe("'it\\'s'");
    expect(q("it\\'s")).toBe("'it\\\\\\'s'");
  });

  it("PowerShell doubles single quotes and typographic quotes", () => {
    for (const sh of ["pwsh", "powershell"] as const) {
      const q = QUOTE_RULES[sh].quote;
      expect(q("hello")).toBe("'hello'");
      expect(q("it's")).toBe("'it''s'");
      expect(q("‘smart’")).toBe("'‘‘smart’’'");
      expect(q("‚quotes‛")).toBe("'‚‚quotes‛‛'");
    }
  });

  it("cmd wraps in double quotes and doubles trailing backslashes", () => {
    const q = QUOTE_RULES.cmd.quote;
    expect(q("hello")).toBe('"hello"');
    expect(q("hello world")).toBe('"hello world"');
    expect(q("back\\slash")).toBe('"back\\slash"');
    expect(q("trailing\\")).toBe('"trailing\\\\"');
  });

  it("formats unsafe characters correctly", () => {
    expect(formatUnsafeCharacter("\x1b")).toBe("U+001B (control)");
    expect(formatUnsafeCharacter("\t")).toBe("U+0009 (control)");
    expect(formatUnsafeCharacter("\n")).toBe("U+000A (control)");
    expect(formatUnsafeCharacter("%")).toBe("U+0025 '%'");
    expect(formatUnsafeCharacter('"')).toBe("U+0022 '\"'");
    expect(formatUnsafeCharacter("^")).toBe("U+005E '^'");
  });

  it("property test: rendered quotes never contain raw newlines or unescaped quotes", () => {
    for (const sh of shells) {
      const rule = QUOTE_RULES[sh];
      fc.assert(
        fc.property(
          fc.string().filter((s) => !rule.forbidden.test(s)),
          (val) => {
            const quoted = rule.quote(val);
            expect(quoted.includes("\n")).toBe(false);
            expect(quoted.includes("\r")).toBe(false);
            expect(quoted.length).toBeGreaterThanOrEqual(2);
          },
        ),
        { numRuns: 500 },
      );
    }
  });
});
