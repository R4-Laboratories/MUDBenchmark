// The harness's context window and its optional long-term stores.
//
// A model call has a bounded window; this keeps it bounded. A memory backend
// can store what happened for a later recall, but storing is not the same as
// unlimited context: the provider still sees only what is sent this turn.

export const DEFAULT_TURNS = 12;

/** Keep the system prompt and the last `maxTurns` user/assistant pairs. */
export function trimMessages(messages, maxTurns = DEFAULT_TURNS) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const system = messages[0]?.role === "system" ? [messages[0]] : [];
  const rest = messages.slice(system.length);
  const keep = Math.max(1, Number(maxTurns) || DEFAULT_TURNS) * 2;
  return [...system, ...rest.slice(-keep)];
}

/**
 * Archive text in prime-router's corpus. `/api/corpus` indexes and saves the
 * manifold; it does not answer queries. Used only when the harness is not
 * already using prime-router as its provider (which archives its own turns).
 */
export function primeRouterMemory({ base = "http://127.0.0.1:8000", identity = "mudbench" } = {}) {
  return {
    remember(text) {
      fetch(`${base}/api/corpus`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ corpus: `${identity}: ${text}` }),
      }).catch(() => {});
    },
  };
}
