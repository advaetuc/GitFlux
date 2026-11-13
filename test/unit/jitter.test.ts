import { describe, it, expect } from "vitest";
import { pickTimeInWindow } from "../../src/core/jitter";

// Simple deterministic PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pickTimeInWindow", () => {
  it("stays inside the window for 10,000 seeded draws", () => {
    // Window: 09:30 to 18:30 (570 minutes to 1110 minutes)
    const window = {
      startMinutes: 9 * 60 + 30, // 570
      endMinutes: 18 * 60 + 30, // 1110
    };

    const rng = mulberry32(12345);
    const startSec = window.startMinutes * 60;
    const endSec = window.endMinutes * 60;

    for (let i = 0; i < 10_000; i++) {
      const time = pickTimeInWindow(window, rng);
      expect(time.hour).toBeGreaterThanOrEqual(0);
      expect(time.hour).toBeLessThanOrEqual(23);
      expect(time.minute).toBeGreaterThanOrEqual(0);
      expect(time.minute).toBeLessThanOrEqual(59);
      expect(time.second).toBeGreaterThanOrEqual(0);
      expect(time.second).toBeLessThanOrEqual(59);

      const totalSec = time.hour * 3600 + time.minute * 60 + time.second;
      expect(totalSec).toBeGreaterThanOrEqual(startSec);
      expect(totalSec).toBeLessThan(endSec);
    }
  });

  it("handles boundary edges correctly", () => {
    const window = { startMinutes: 60, endMinutes: 61 };
    const minTime = pickTimeInWindow(window, () => 0.0);
    expect(minTime).toEqual({ hour: 1, minute: 0, second: 0 });

    const maxTime = pickTimeInWindow(window, () => 0.999999);
    expect(maxTime).toEqual({ hour: 1, minute: 0, second: 59 });
  });
});
