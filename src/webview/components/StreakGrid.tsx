import { buildHeatGrid, type DayCounts } from "../../core/heatmap";
import type { LocalDateTime } from "../../core/types";

export interface StreakGridProps {
  readonly dayCounts?: DayCounts | undefined;
  readonly local: LocalDateTime;
  readonly onSelectDate: (date: string) => void;
  readonly nowEpochSeconds?: number | undefined;
}

export function StreakGrid({
  dayCounts,
  local,
  onSelectDate,
  nowEpochSeconds,
}: StreakGridProps) {
  if (!dayCounts) {
    return null;
  }

  const now = nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const grid = buildHeatGrid(dayCounts, now, 12);
  const selectedDateStr = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;

  const allCells = grid.weeks.flatMap((w) => w);

  return (
    <div class="form-section">
      <div class="heat-grid-header">
        <span>Activity (Past 12 Weeks)</span>
      </div>
      <div class="heat-grid-container">
        <div class="heat-grid" role="grid" aria-label="Contribution Activity Heatmap">
          {allCells.map((cell) => {
            const isSelected = cell.date === selectedDateStr;
            const countText = `${cell.date} (UTC), ${String(cell.count)} ${cell.count === 1 ? "commit" : "commits"}`;
            const cellClass = `heat-cell level-${String(cell.level)}${isSelected ? " heat-cell-selected" : ""}`;

            return (
              <button
                key={cell.date}
                type="button"
                class={cellClass}
                disabled={cell.future}
                title={countText}
                aria-label={countText}
                onClick={() => {
                  if (!cell.future) {
                    onSelectDate(cell.date);
                  }
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
