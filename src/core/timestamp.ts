import type { GitTimestamp, LocalDateTime, Result, TimestampError } from "./types";

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

/**
 * Pure arithmetic timestamp resolver.
 * Computes epoch seconds = Date.UTC(components) - offsetMinutes * 60_000.
 * Never reads the machine timezone.
 * Enforces offset range -720..+840 minutes and date range 1970-01-02..2099-12-31.
 */
export function resolveTimestamp(
  local: LocalDateTime,
  offsetMinutes: number,
): Result<GitTimestamp, TimestampError> {
  // Validate offset: must be integer and within -720..+840
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < -720 || offsetMinutes > 840) {
    return { ok: false, error: "INVALID_OFFSET" };
  }

  // Validate time components
  const { year, month, day, hour, minute, second } = local;
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(second) ||
    second < 0 ||
    second > 59
  ) {
    return { ok: false, error: "INVALID_TIME" };
  }

  // Validate month and day
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: "INVALID_DATE" };
  }

  const maxDays = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > maxDays) {
    return { ok: false, error: "INVALID_DATE" };
  }

  // Validate year range (1970..2099)
  if (!Number.isInteger(year) || year < 1970 || year > 2099) {
    return { ok: false, error: "OUT_OF_RANGE" };
  }

  // Blueprint §10: Date outside 1970-01-02 … 2099-12-31 is OUT_OF_RANGE
  if (year === 1970 && month === 1 && day === 1) {
    return { ok: false, error: "OUT_OF_RANGE" };
  }

  // Calculate epoch
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const epochMs = utcMs - offsetMinutes * 60_000;
  const epochSeconds = Math.floor(epochMs / 1000);

  // Format ISO: YYYY-MM-DDTHH:MM:SS±HHMM
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offHours = Math.floor(absOffset / 60);
  const offMins = absOffset % 60;
  const offsetStr = `${sign}${pad2(offHours)}${pad2(offMins)}`;

  const iso = `${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${offsetStr}`;

  return {
    ok: true,
    value: {
      iso,
      epochSeconds,
      offsetMinutes,
    },
  };
}

/**
 * Webview-only helper (uses the browser/host local zone, DST-aware).
 * Returns DST_GAP when the wall-clock time does not exist locally (spring-forward).
 * Ambiguous times (fall-back) resolve to the earlier occurrence.
 */
export function localOffsetMinutesAt(local: LocalDateTime): Result<number, "DST_GAP"> {
  const d = new Date(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);

  // Check if wall-clock shifted due to DST spring-forward gap
  if (d.getHours() !== local.hour || d.getMinutes() !== local.minute) {
    return { ok: false, error: "DST_GAP" };
  }

  // In JS Date, getTimezoneOffset() returns positive minutes west of UTC, so negate it
  const offsetEast = -d.getTimezoneOffset();
  return { ok: true, value: offsetEast };
}
