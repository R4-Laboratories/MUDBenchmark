// The public, read-only projection of a live run.
//
// Only the actor that started the stream can publish events. The server filters
// text once more before it reaches spectators, so a client bug cannot publish a
// private tell or a session line. The stream is opt-in: `stream on` is the
// consent, and `stream off` or a disconnect clears it.

export const STREAM_EVENT_KINDS = ["command", "text", "room", "status", "highlight"];

// Lines that must never cross the public boundary. The list is deliberately
// conservative: a missing line is a privacy bug, a filtered public line is a
// display annoyance.
const PRIVATE = [
  /\btells you\b/i,
  /^You tell\b/i,
  /^You mail\b/i,
  /^A letter from\b/i,
  /^Password\b/i,
  /^Account\b/i,
  /^Signed in\b/i,
  /^Welcome\b/i,
  /^No such name\b/i,
  /^That name\b/i,
  /^That account\b/i,
  /^You must sign in\b/i,
  /^Goodbye\b/i,
  /^Slow down\b/i,
  /^Confirm your session\b/i,
  /^The session\b/i,
  /^#/,
  /^Usage:/i,
  /^You have been signed in elsewhere/i,
  /^This account moved/i,
  /^Another run is live/i,
  /^Public stream/i,
  /^The identity kernel\b/i,
];

export function publicStreamText(text) {
  const lines = String(text).split(/\r?\n/);
  return lines
    .filter((line) => !PRIVATE.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .trim();
}

export function normalizeStreamEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind ?? "");
  if (!STREAM_EVENT_KINDS.includes(kind)) return null;
  const text = typeof value.text === "string" ? value.text : "";
  if (kind === "text" || kind === "highlight") {
    const publicText = publicStreamText(text).slice(0, kind === "text" ? 4000 : 2000);
    if (!publicText) return null;
    return { kind, text: publicText, turn: integer(value.turn), tick: integer(value.tick) };
  }
  const trimmed = text.trim().slice(0, kind === "command" ? 240 : 500);
  if (!trimmed) return null;
  return { kind, text: trimmed, turn: integer(value.turn), tick: integer(value.tick) };
}

function integer(value) {
  return Number.isInteger(value) ? value : null;
}
