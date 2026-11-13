import { describe, it, expect } from "vitest";
import { resolveTimestamp, localOffsetMinutesAt } from "../../src/core/timestamp";
import type { LocalDateTime } from "../../src/core/types";

describe("resolveTimestamp", () => {
  it("rejects non-integer offsets and offsets out of range (-720..+840)", () => {
    const dt: LocalDateTime = { year: 2024, month: 6, day: 15, hour: 10, minute: 30, second: 0 };
    expect(resolveTimestamp(dt, 5.5)).toEqual({ ok: false, error: "INVALID_OFFSET" });
    expect(resolveTimestamp(dt, -721)).toEqual({ ok: false, error: "INVALID_OFFSET" });
    expect(resolveTimestamp(dt, 841)).toEqual({ ok: false, error: "INVALID_OFFSET" });
  });

  it("accepts boundary offsets: -720 (-12:00), +330 (+05:30), +345 (+05:45), +840 (+14:00)", () => {
    const dt: LocalDateTime = { year: 2024, month: 6, day: 15, hour: 10, minute: 30, second: 0 };

    const rNeg12 = resolveTimestamp(dt, -720);
    expect(rNeg12.ok).toBe(true);
    if (rNeg12.ok) {
      expect(rNeg12.value.iso).toBe("2024-06-15T10:30:00-1200");
    }

    const rIndia = resolveTimestamp(dt, 330);
    expect(rIndia.ok).toBe(true);
    if (rIndia.ok) {
      expect(rIndia.value.iso).toBe("2024-06-15T10:30:00+0530");
    }

    const rNepal = resolveTimestamp(dt, 345);
    expect(rNepal.ok).toBe(true);
    if (rNepal.ok) {
      expect(rNepal.value.iso).toBe("2024-06-15T10:30:00+0545");
    }

    const rKiribati = resolveTimestamp(dt, 840);
    expect(rKiribati.ok).toBe(true);
    if (rKiribati.ok) {
      expect(rKiribati.value.iso).toBe("2024-06-15T10:30:00+1400");
    }
  });

  it("handles leap year Feb 29 acceptance and Feb 30 rejection", () => {
    const leapDay: LocalDateTime = { year: 2024, month: 2, day: 29, hour: 12, minute: 0, second: 0 };
    expect(resolveTimestamp(leapDay, 0).ok).toBe(true);

    const nonLeapFeb29: LocalDateTime = { year: 2023, month: 2, day: 29, hour: 12, minute: 0, second: 0 };
    expect(resolveTimestamp(nonLeapFeb29, 0)).toEqual({ ok: false, error: "INVALID_DATE" });

    const feb30: LocalDateTime = { year: 2024, month: 2, day: 30, hour: 12, minute: 0, second: 0 };
    expect(resolveTimestamp(feb30, 0)).toEqual({ ok: false, error: "INVALID_DATE" });
  });

  it("rejects 1970-01-01 and accepts 1970-01-02", () => {
    const jan1: LocalDateTime = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
    expect(resolveTimestamp(jan1, 0)).toEqual({ ok: false, error: "OUT_OF_RANGE" });

    const jan2: LocalDateTime = { year: 1970, month: 1, day: 2, hour: 0, minute: 0, second: 0 };
    const res = resolveTimestamp(jan2, 0);
    expect(res.ok).toBe(true);
  });

  it("accepts 2099-12-31 and rejects 2100", () => {
    const end2099: LocalDateTime = { year: 2099, month: 12, day: 31, hour: 23, minute: 59, second: 59 };
    expect(resolveTimestamp(end2099, 0).ok).toBe(true);

    const year2100: LocalDateTime = { year: 2100, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
    expect(resolveTimestamp(year2100, 0)).toEqual({ ok: false, error: "OUT_OF_RANGE" });
  });

  it("formats ISO exactly matching regex /^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d[+-]\\d{4}$/", () => {
    const isoRegex = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d{4}$/;
    const dt: LocalDateTime = { year: 2026, month: 3, day: 2, hour: 10, minute: 41, second: 7 };
    const res = resolveTimestamp(dt, 330);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.iso).toMatch(isoRegex);
      expect(res.value.iso).toBe("2026-03-02T10:41:07+0530");
    }
  });

  it("calculates epochSeconds correctly via Date.UTC - offsetMinutes", () => {
    const dt: LocalDateTime = { year: 2026, month: 3, day: 2, hour: 10, minute: 41, second: 7 };
    const offset = 330; // +05:30
    const res = resolveTimestamp(dt, offset);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const expectedEpoch = Math.floor(
        (Date.UTC(2026, 2, 2, 10, 41, 7) - 330 * 60_000) / 1000,
      );
      expect(res.value.epochSeconds).toBe(expectedEpoch);
    }
  });

  it("rejects invalid time components", () => {
    const dt = (h: number, m: number, s: number): LocalDateTime => ({
      year: 2024,
      month: 6,
      day: 15,
      hour: h,
      minute: m,
      second: s,
    });
    expect(resolveTimestamp(dt(24, 0, 0), 0)).toEqual({ ok: false, error: "INVALID_TIME" });
    expect(resolveTimestamp(dt(0, 60, 0), 0)).toEqual({ ok: false, error: "INVALID_TIME" });
    expect(resolveTimestamp(dt(0, 0, 60), 0)).toEqual({ ok: false, error: "INVALID_TIME" });
    expect(resolveTimestamp(dt(-1, 0, 0), 0)).toEqual({ ok: false, error: "INVALID_TIME" });
  });

  it("localOffsetMinutesAt returns offset for valid local time", () => {
    const dt: LocalDateTime = { year: 2024, month: 6, day: 15, hour: 12, minute: 0, second: 0 };
    const res = localOffsetMinutesAt(dt);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.value).toBe("number");
      expect(Number.isInteger(res.value)).toBe(true);
    }
  });
});
