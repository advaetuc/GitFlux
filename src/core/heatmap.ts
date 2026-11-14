export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatCell {
  readonly date: string;
  readonly count: number;
  readonly level: HeatLevel;
  readonly future: boolean;
}

export interface HeatGrid {
  readonly weeks: readonly (readonly HeatCell[])[];
}

export type DayCounts = Readonly<Record<string, number>>;

/**
 * Returns UTC "YYYY-MM-DD" for given epoch seconds.
 */
export function utcDateOf(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const year = String(d.getUTCFullYear()).padStart(4, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Buckets an array of epoch seconds by their UTC "YYYY-MM-DD" date.
 */
export function bucketByUtcDay(epochSeconds: readonly number[]): DayCounts {
  const counts: Record<string, number> = {};
  for (const sec of epochSeconds) {
    const day = utcDateOf(sec);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

/**
 * Computes the heatmap level (0..4) based on commit count:
 * 0: 0, 1: 1, 2: 2-3, 3: 4-6, 4: 7+
 */
export function countToHeatLevel(count: number): HeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/**
 * Builds a 7xweeks grid of HeatCells.
 * Column 0 is `weeks - 1` weeks ago.
 * Column `weeks - 1` is current week, with today at its exact UTC weekday.
 * Row 0 is Sunday, Row 6 is Saturday.
 * Trailing days after today in the final week have `future: true`.
 */
export function buildHeatGrid(
  counts: DayCounts,
  nowEpochSeconds: number,
  weeks = 12,
): HeatGrid {
  const todayDate = new Date(nowEpochSeconds * 1000);
  const todayWeekday = todayDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const todayUtc = utcDateOf(nowEpochSeconds);

  // UTC midnight for today
  const todayUtcMidnightMs = Date.UTC(
    todayDate.getUTCFullYear(),
    todayDate.getUTCMonth(),
    todayDate.getUTCDate(),
  );

  // Sunday of current week
  const currentWeekSundayMs = todayUtcMidnightMs - todayWeekday * 86_400_000;

  // Sunday of the first week column
  const startSundayMs = currentWeekSundayMs - (weeks - 1) * 7 * 86_400_000;

  const resultWeeks: (readonly HeatCell[])[] = [];

  for (let w = 0; w < weeks; w++) {
    const weekCells: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellMs = startSundayMs + (w * 7 + d) * 86_400_000;
      const cellDateStr = utcDateOf(Math.floor(cellMs / 1000));
      const future = cellDateStr > todayUtc;
      const count = counts[cellDateStr] ?? 0;
      const level = countToHeatLevel(count);

      weekCells.push({
        date: cellDateStr,
        count,
        level,
        future,
      });
    }
    resultWeeks.push(weekCells);
  }

  return { weeks: resultWeeks };
}
