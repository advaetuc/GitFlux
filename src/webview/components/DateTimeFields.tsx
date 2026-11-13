import type { LocalDateTime } from "../../core/types";

export interface DateTimeFieldsProps {
  readonly local: LocalDateTime;
  readonly offsetMinutes: number;
  readonly offsetMode: "local" | "fixed";
  readonly workingHours: { readonly start: string; readonly end: string };
  readonly onSetDate: (year: number, month: number, day: number) => void;
  readonly onSetTime: (hour: number, minute: number, second: number) => void;
  readonly onSetOffsetMode: (mode: "local" | "fixed", offsetMinutes?: number) => void;
  readonly onSetOffsetMinutes: (offsetMinutes: number) => void;
  readonly onRandomWorkingHours: () => void;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

// Generate fixed offsets in 15-minute steps from -12:00 to +14:00
const FIXED_OFFSETS: number[] = [];
for (let m = -720; m <= 840; m += 15) {
  FIXED_OFFSETS.push(m);
}

export function DateTimeFields({
  local,
  offsetMinutes,
  offsetMode,
  workingHours,
  onSetDate,
  onSetTime,
  onSetOffsetMode,
  onSetOffsetMinutes,
  onRandomWorkingHours,
}: DateTimeFieldsProps) {
  const dateStr = `${String(local.year)}-${pad2(local.month)}-${pad2(local.day)}`;
  const timeStr = `${pad2(local.hour)}:${pad2(local.minute)}:${pad2(local.second)}`;
  const localLabel = `Local (${formatOffset(offsetMinutes)})`;

  return (
    <div class="form-section">
      <div class="section-label">
        <span>Date & Time</span>
        <button
          type="button"
          class="btn"
          title={`Pick random time within working hours (${workingHours.start} - ${workingHours.end})`}
          onClick={() => {
            onRandomWorkingHours();
          }}
        >
          <span class="codicon codicon-clock"></span>
          <span>Random working hours</span>
        </button>
      </div>

      <div class="row">
        <input
          type="date"
          value={dateStr}
          onChange={(e) => {
            const val = (e.target as HTMLInputElement).value;
            const parts = val.split("-");
            if (parts.length === 3) {
              const y = parseInt(parts[0] ?? "", 10);
              const m = parseInt(parts[1] ?? "", 10);
              const d = parseInt(parts[2] ?? "", 10);
              if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                onSetDate(y, m, d);
              }
            }
          }}
        />

        <input
          type="time"
          step="1"
          value={timeStr}
          onChange={(e) => {
            const val = (e.target as HTMLInputElement).value;
            const parts = val.split(":");
            if (parts.length >= 2) {
              const h = parseInt(parts[0] ?? "", 10);
              const m = parseInt(parts[1] ?? "", 10);
              const s = parts.length >= 3 ? parseInt(parts[2] ?? "", 10) : 0;
              if (!isNaN(h) && !isNaN(m)) {
                onSetTime(h, m, isNaN(s) ? 0 : s);
              }
            }
          }}
        />
      </div>

      <div class="row">
        <select
          value={offsetMode === "local" ? "local" : String(offsetMinutes)}
          onChange={(e) => {
            const val = (e.target as HTMLSelectElement).value;
            if (val === "local") {
              onSetOffsetMode("local");
            } else {
              const mins = parseInt(val, 10);
              if (!isNaN(mins)) {
                onSetOffsetMinutes(mins);
              }
            }
          }}
        >
          <option value="local">{localLabel}</option>
          {FIXED_OFFSETS.map((m) => (
            <option key={m} value={String(m)}>
              UTC {formatOffset(m)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
