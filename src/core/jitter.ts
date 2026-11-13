import type { LocalDateTime, TimeWindow } from "./types";

/**
 * Picks a random time (hour, minute, second) uniformly within a given TimeWindow.
 * rng is injected (returns [0, 1)) for deterministic testing.
 */
export function pickTimeInWindow(
  window: TimeWindow,
  rng: () => number,
): Pick<LocalDateTime, "hour" | "minute" | "second"> {
  const startSec = Math.max(0, window.startMinutes * 60);
  const endSec = Math.min(24 * 3600 - 1, window.endMinutes * 60);

  const span = Math.max(1, endSec - startSec);
  const pickedSec = Math.floor(startSec + rng() * span);

  const hour = Math.floor(pickedSec / 3600);
  const minute = Math.floor((pickedSec % 3600) / 60);
  const second = pickedSec % 60;

  return { hour, minute, second };
}
