// Small, pure moderation rules. The server owns the clock; the reducer and
// the gate only need the shape, so the rate limit is testable without sockets.

export const CHAT_WINDOW_MS = 10_000;
export const CHAT_LIMIT = 8;

/** Return the trimmed window and whether one more line is allowed. */
export function chatAllowed(history = [], now = Date.now()) {
  const recent = history.filter((time) => Number.isFinite(time) && now - time < CHAT_WINDOW_MS);
  if (recent.length >= CHAT_LIMIT) return { allowed: false, recent };
  return { allowed: true, recent: [...recent, now] };
}
