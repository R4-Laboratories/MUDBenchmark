// The input allowance. One accepted command per interval, shared by every
// transport, so a human typing and a model generating play on the same clock.

export const DEFAULT_INTERVAL_MS = 250;

/** True when a command arriving at `now` is allowed after `lastAt`. */
export function allowCommand(lastAt, now, interval = DEFAULT_INTERVAL_MS) {
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true;
  return now - lastAt >= interval;
}
