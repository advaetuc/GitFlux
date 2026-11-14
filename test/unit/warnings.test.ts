import { describe, it, expect } from "vitest";
import {
  planWarnings,
  formatUtcDayShiftWarning,
  classifyEmail,
} from "../../src/core/warnings";
import type {
  CommitPlan,
  GitPath,
  HeadState,
  ChangedFile,
  RemoteName,
  BranchName,
} from "../../src/core/types";

describe("planWarnings (AM-04)", () => {
  const basePlan: CommitPlan = {
    repoRoot: "/workspace/repo",
    paths: ["src/file.ts" as GitPath],
    untrackedPaths: [],
    strategy: "only",
    message: { paragraphs: ["feat: short subject"] },
    timestamp: {
      iso: "2024-06-15T12:00:00+0000",
      epochSeconds: 1718452800,
      offsetMinutes: 0,
    },
  };

  const baseHead: HeadState = {
    kind: "branch",
    name: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
  };

  const baseFiles: ChangedFile[] = [
    { path: "src/file.ts", kind: "modified", staged: false, unstaged: true },
  ];

  it("warns FUTURE_DATE when timestamp.epochSeconds > now + 300", () => {
    // timestamp is 1718452800. now is 1718452400 (diff is 400s > 300s)
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718452400,
    });
    expect(warnings).toContain("FUTURE_DATE");
  });

  it("does not warn FUTURE_DATE when timestamp is within 300s of now", () => {
    // diff is 200s <= 300s
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718452600,
    });
    expect(warnings).not.toContain("FUTURE_DATE");
  });

  it("warns BEFORE_PARENT when timestamp < headCommitEpochSeconds", () => {
    // timestamp is 1718452800. parent is 1718453000
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718453000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("BEFORE_PARENT");
  });

  it("warns SUBJECT_OVER_72 when subject exceeds 72 characters", () => {
    const longSubjectPlan: CommitPlan = {
      ...basePlan,
      message: { paragraphs: ["a".repeat(73)] },
    };
    const warnings = planWarnings({
      plan: longSubjectPlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("SUBJECT_OVER_72");
  });

  it("warns BEHIND_UPSTREAM when branch is behind upstream and push is enabled", () => {
    const behindHead: HeadState = {
      ...baseHead,
      behind: 2,
    };
    const planWithPush: CommitPlan = {
      ...basePlan,
      push: { remote: "origin" as RemoteName, branch: "main" as BranchName, setUpstream: false },
    };
    const warnings = planWarnings({
      plan: planWithPush,
      head: behindHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("BEHIND_UPSTREAM");
  });

  it("warns DETACHED_HEAD when HEAD is detached", () => {
    const detachedHead: HeadState = {
      kind: "detached",
      shortSha: "1234567",
    };
    const warnings = planWarnings({
      plan: basePlan,
      head: detachedHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("DETACHED_HEAD");
  });

  it("warns PARTIALLY_STAGED when a selected file has staged && unstaged", () => {
    const partiallyStagedFiles: ChangedFile[] = [
      { path: "src/file.ts", kind: "modified", staged: true, unstaged: true },
    ];
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: partiallyStagedFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718500000,
    });
    expect(warnings).toContain("PARTIALLY_STAGED");
  });

  it("returns no warnings when all checks pass cleanly", () => {
    const warnings = planWarnings({
      plan: basePlan,
      head: baseHead,
      files: baseFiles,
      headCommitEpochSeconds: 1718400000,
      nowEpochSeconds: 1718452800,
    });
    expect(warnings).toEqual([]);
  });

  describe("UTC_DAY_SHIFT and formatUtcDayShiftWarning", () => {
    const shiftCases = [
      {
        name: "offset -720 (-12:00) with UTC shift to next day",
        local: { year: 2026, month: 3, day: 2, hour: 20, minute: 0, second: 0 },
        offsetMinutes: -720,
        epochSeconds: 1772524800, // 2026-03-03 08:00:00 UTC
        expectedShift: true,
        expectedUtc: "2026-03-03",
      },
      {
        name: "offset -720 (-12:00) without UTC shift (same day)",
        local: { year: 2026, month: 3, day: 2, hour: 4, minute: 0, second: 0 },
        offsetMinutes: -720,
        epochSeconds: 1772467200, // 2026-03-02 16:00:00 UTC
        expectedShift: false,
        expectedUtc: "2026-03-02",
      },
      {
        name: "offset +330 (+05:30) with UTC shift to previous day",
        local: { year: 2026, month: 3, day: 2, hour: 2, minute: 0, second: 0 },
        offsetMinutes: 330,
        epochSeconds: 1772397000, // 2026-03-01 20:30:00 UTC
        expectedShift: true,
        expectedUtc: "2026-03-01",
      },
      {
        name: "offset +330 (+05:30) without UTC shift (same day)",
        local: { year: 2026, month: 3, day: 2, hour: 14, minute: 0, second: 0 },
        offsetMinutes: 330,
        epochSeconds: 1772440200, // 2026-03-02 08:30:00 UTC
        expectedShift: false,
        expectedUtc: "2026-03-02",
      },
      {
        name: "offset +840 (+14:00) with UTC shift to previous day",
        local: { year: 2026, month: 3, day: 2, hour: 6, minute: 0, second: 0 },
        offsetMinutes: 840,
        epochSeconds: 1772380800, // 2026-03-01 16:00:00 UTC
        expectedShift: true,
        expectedUtc: "2026-03-01",
      },
      {
        name: "offset +840 (+14:00) without UTC shift (same day)",
        local: { year: 2026, month: 3, day: 2, hour: 20, minute: 0, second: 0 },
        offsetMinutes: 840,
        epochSeconds: 1772431200, // 2026-03-02 06:00:00 UTC
        expectedShift: false,
        expectedUtc: "2026-03-02",
      },
    ];

    for (const tc of shiftCases) {
      it(`evaluates ${tc.name}`, () => {
        const plan: CommitPlan = {
          ...basePlan,
          timestamp: {
            iso: "2026-03-02T...±...",
            epochSeconds: tc.epochSeconds,
            offsetMinutes: tc.offsetMinutes,
          },
        };

        // Test with localDateStr
        const warningsWithStr = planWarnings({
          plan,
          head: baseHead,
          files: baseFiles,
          headCommitEpochSeconds: 1000,
          nowEpochSeconds: tc.epochSeconds,
          localDateStr: "2026-03-02",
        });

        if (tc.expectedShift) {
          expect(warningsWithStr).toContain("UTC_DAY_SHIFT");
          expect(formatUtcDayShiftWarning(tc.epochSeconds)).toBe(
            `GitHub will show this on ${tc.expectedUtc} (UTC).`,
          );
        } else {
          expect(warningsWithStr).not.toContain("UTC_DAY_SHIFT");
        }

        // Test with whenLocal
        const warningsWithLocal = planWarnings({
          plan,
          head: baseHead,
          files: baseFiles,
          headCommitEpochSeconds: 1000,
          nowEpochSeconds: tc.epochSeconds,
          whenLocal: tc.local,
        });

        if (tc.expectedShift) {
          expect(warningsWithLocal).toContain("UTC_DAY_SHIFT");
        } else {
          expect(warningsWithLocal).not.toContain("UTC_DAY_SHIFT");
        }
      });
    }
  });

  describe("classifyEmail", () => {
    it("identifies missing emails", () => {
      expect(classifyEmail(undefined)).toBe("missing");
      expect(classifyEmail("")).toBe("missing");
      expect(classifyEmail("   ")).toBe("missing");
    });

    it("identifies generic and local host emails", () => {
      expect(classifyEmail("user")).toBe("generic");
      expect(classifyEmail("user@localhost")).toBe("generic");
      expect(classifyEmail("user@internal-server")).toBe("generic");
      expect(classifyEmail("user@myhost.local")).toBe("generic");
      expect(classifyEmail("user@workstation.localdomain")).toBe("generic");
      expect(classifyEmail("user@build.(none)")).toBe("generic");
      expect(classifyEmail("root@sub.host.local")).toBe("generic");
    });

    it("identifies valid emails", () => {
      expect(classifyEmail("user@example.com")).toBe("ok");
      expect(classifyEmail("advaet@users.noreply.github.com")).toBe("ok");
      expect(classifyEmail("dev.team@company.org")).toBe("ok");
      expect(classifyEmail("test@domain.co.uk")).toBe("ok");
    });
  });
});
