// Small, pure moderation rules. The server owns the clock; the reducer and
// the gate only need the shape, so the rate limit is testable without sockets.

export const CHAT_WINDOW_MS = 10_000;
export const CHAT_LIMIT = 8;
export const REPORT_REASON_MAX = 500;
export const REPORT_INTERVAL_MS = 30_000;

/** Return the trimmed window and whether one more line is allowed. */
export function chatAllowed(history = [], now = Date.now()) {
  const recent = history.filter((time) => Number.isFinite(time) && now - time < CHAT_WINDOW_MS);
  if (recent.length >= CHAT_LIMIT) return { allowed: false, recent };
  return { allowed: true, recent: [...recent, now] };
}

/** A report is one per identity per interval, across reconnects. */
export function reportAllowed(lastAt, now = Date.now()) {
  return !Number.isFinite(lastAt) || now - lastAt >= REPORT_INTERVAL_MS;
}

/**
 * The durable shape of a player report. The server appends this to a local
 * JSONL file; it never becomes world state or a public span field.
 */
export function reportRecord({ at, tick, reporter, reporterName, target, targetName, reason }) {
  const clean = String(reason ?? "").trim().slice(0, REPORT_REASON_MAX);
  if (!at || !reporter || !target || !clean) return null;
  return { at, tick, reporter, reporterName, target, targetName, reason: clean };
}
