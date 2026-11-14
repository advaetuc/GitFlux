import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  utcDateOf,
  bucketByUtcDay,
  countToHeatLevel,
  buildHeatGrid,
} from "../../src/core/heatmap";

describe("heatmap pure core module", () => {
  it("maps 23:59:59Z and 00:00:00Z to consecutive UTC dates", () => {
    // 2026-03-02 23:59:59 UTC -> epoch 1772495999
    // 2026-03-03 00:00:00 UTC -> epoch 1772496000
    const t1 = 1772495999;
    const t2 = 1772496000;

    const d1 = utcDateOf(t1);
    const d2 = utcDateOf(t2);

    expect(d1).toBe("2026-03-02");
    expect(d2).toBe("2026-03-03");
  });

  it("produces a 12 x 7 grid with Sunday at row 0, today in the final column at exact weekday, and trailing days marked future", () => {
    // Wednesday, 2026-03-04 12:00:00 UTC -> epoch 1772625600
    // Wednesday is weekday index 3 (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
    const nowEpoch = 1772625600;
    const todayUtc = utcDateOf(nowEpoch);
    expect(todayUtc).toBe("2026-03-04");

    const grid = buildHeatGrid({}, nowEpoch, 12);
    expect(grid.weeks).toHaveLength(12);

    for (let w = 0; w < 12; w++) {
      const week = grid.weeks[w];
      expect(week).toBeDefined();
      expect(week).toHaveLength(7);

      // Verify row 0 is Sunday and consecutive days
      for (let d = 0; d < 7; d++) {
        const cell = week?.[d];
        expect(cell).toBeDefined();
        if (!cell) continue;

        // Parse date to check day of week in UTC
        const parsed = new Date(cell.date + "T00:00:00Z");
        expect(parsed.getUTCDay()).toBe(d);

        if (w < 11) {
          // All cells in prior weeks must not be future
          expect(cell.future).toBe(false);
        } else {
          // Last week: row 3 is today, row > 3 is future
          if (d <= 3) {
            expect(cell.future).toBe(false);
          } else {
            expect(cell.future).toBe(true);
          }
        }
      }
    }

    // Verify today's cell specifically in the last column
    const todayCell = grid.weeks[11]?.[3];
    expect(todayCell?.date).toBe("2026-03-04");
    expect(todayCell?.future).toBe(false);

    // Verify Sunday of first column is 11 weeks before current Sunday
    // Current Sunday was 2026-03-01
    // 11 weeks (77 days) earlier was 2025-12-14
    const firstCell = grid.weeks[0]?.[0];
    expect(firstCell?.date).toBe("2025-12-14");
  });

  it("calculates level thresholds at exact boundaries (0, 1, 2, 3, 4, 6, 7)", () => {
    // 0: 0
    expect(countToHeatLevel(0)).toBe(0);
    expect(countToHeatLevel(-1)).toBe(0);

    // 1: 1
    expect(countToHeatLevel(1)).toBe(1);

    // 2: 2-3
    expect(countToHeatLevel(2)).toBe(2);
    expect(countToHeatLevel(3)).toBe(2);

    // 3: 4-6
    expect(countToHeatLevel(4)).toBe(3);
    expect(countToHeatLevel(5)).toBe(3);
    expect(countToHeatLevel(6)).toBe(3);

    // 4: 7+
    expect(countToHeatLevel(7)).toBe(4);
    expect(countToHeatLevel(100)).toBe(4);
  });

  it("empty input produces all level 0", () => {
    const nowEpoch = 1772625600;
    const grid = buildHeatGrid({}, nowEpoch);
    for (const week of grid.weeks) {
      for (const cell of week) {
        expect(cell.count).toBe(0);
        expect(cell.level).toBe(0);
      }
    }
  });

  it("fast-check property test: total summed counts in grid equal count of inputs within grid UTC window", () => {
    const fixedNow = 1772625600; // 2026-03-04
    const grid = buildHeatGrid({}, fixedNow, 12);
    const windowStart = grid.weeks[0]?.[0]?.date ?? "";
    const windowEnd = grid.weeks[11]?.[6]?.date ?? "";

    expect(windowStart).not.toBe("");
    expect(windowEnd).not.toBe("");

    fc.assert(
      fc.property(
        fc.array(
          // Epoch seconds ranging across 1 year before and after
          fc.integer({ min: fixedNow - 365 * 86400, max: fixedNow + 365 * 86400 }),
          { maxLength: 50 },
        ),
        (epochTimestamps) => {
          const counts = bucketByUtcDay(epochTimestamps);
          const populatedGrid = buildHeatGrid(counts, fixedNow, 12);

          let totalSum = 0;
          for (const week of populatedGrid.weeks) {
            for (const cell of week) {
              totalSum += cell.count;
            }
          }

          // Count timestamps that fell within [windowStart, windowEnd]
          let expectedInWindow = 0;
          for (const ts of epochTimestamps) {
            const dateStr = utcDateOf(ts);
            if (dateStr >= windowStart && dateStr <= windowEnd) {
              expectedInWindow++;
            }
          }

          expect(totalSum).toBe(expectedInWindow);
        },
      ),
      { numRuns: 100 },
    );
  });
});
