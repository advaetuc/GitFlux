import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitStatus, GitErrorCodes } from "../../src/host/gitStatus";

describe("gitStatus mapping (AM-10)", () => {
  const dtsPath = resolve(__dirname, "../../src/host/vendor/git.d.ts");
  const dtsContent = readFileSync(dtsPath, "utf8");

  it("matches Status enum from git.d.ts member-by-member and value-by-value", () => {
    const statusMatch = dtsContent.match(/export const enum Status \{([\s\S]*?)\}/);
    expect(statusMatch).not.toBeNull();
    if (!statusMatch) return;

    const body = statusMatch[1];
    expect(body).toBeDefined();
    if (!body) return;

    const lines = body
      .split("\n")
      .map((l) => l.trim().replace(/,$/, ""))
      .filter((l) => l.length > 0 && !l.startsWith("/"));

    const expected: Record<string, number> = {};
    let currentVal = 0;
    for (const line of lines) {
      const parts = line.split("=").map((p) => p.trim());
      if (parts.length === 2 && parts[1] !== undefined) {
        currentVal = parseInt(parts[1], 10);
      }
      const key = parts[0];
      if (key) {
        expected[key] = currentVal;
        currentVal++;
      }
    }

    expect(GitStatus).toEqual(expected);
    expect(Object.keys(GitStatus)).toEqual(Object.keys(expected));
  });

  it("matches GitErrorCodes enum from git.d.ts", () => {
    const errorCodeMatch = dtsContent.match(/export (?:const )?enum GitErrorCodes \{([\s\S]*?)\}/);
    expect(errorCodeMatch).not.toBeNull();
    if (!errorCodeMatch) return;

    const body = errorCodeMatch[1];
    expect(body).toBeDefined();
    if (!body) return;

    const lines = body
      .split("\n")
      .map((l) => l.trim().replace(/,$/, ""))
      .filter((l) => l.length > 0 && !l.startsWith("/"));

    const expected: Record<string, string> = {};
    for (const line of lines) {
      const parts = line.split("=").map((p) => p.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        const key = parts[0];
        const val = parts[1].replace(/['"]/g, "");
        expected[key] = val;
      }
    }

    expect(GitErrorCodes).toEqual(expected);
    expect(Object.keys(GitErrorCodes)).toEqual(Object.keys(expected));
  });
});
