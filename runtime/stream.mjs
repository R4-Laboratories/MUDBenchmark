// The public, read-only projection of a live run.
//
// Only the actor that started the stream can publish events. The server filters
// text once more before it reaches spectators, so a client bug cannot publish a
// private tell or a session line. The stream is opt-in: `stream on` is the
// consent, and `stream off` or a disconnect clears it.

export const STREAM_EVENT_KINDS = ["meta", "decision", "state", "stats", "command", "text", "room", "status", "highlight"];
export const PVP_STREAM_DELAY = 60;
export const MAX_STREAM_DELAY = 300;

// A streamer may choose a delay; PvP raises the floor to 60 seconds. This is a
// server-side rule: a client cannot opt out of the PvP delay.
export function streamDelay(configured, pvp = false) {
  const requested = Math.min(MAX_STREAM_DELAY, Math.max(0, Number(configured) || 0));
  return Math.max(requested, pvp ? PVP_STREAM_DELAY : 0);
}

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
  /^Signing in as\b/i,
  /^Character .+ created\.$/i,
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

const integer = (value) => (Number.isInteger(value) ? value : null);
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const short = (value, max) => {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

export function normalizeStreamEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind ?? "");
  if (!STREAM_EVENT_KINDS.includes(kind)) return null;
  const text = typeof value.text === "string" ? value.text : "";
  if (kind === "meta") {
    return {
      kind,
      provider: short(value.provider, 40),
      model: short(value.model, 80),
      goal: short(value.goal, 40),
      character: short(value.character, 24),
      tick: integer(value.tick),
    };
  }
  if (kind === "state") {
    return {
      kind,
      hp: finite(value.hp),
      maxHp: finite(value.maxHp),
      mana: finite(value.mana),
      maxMana: finite(value.maxMana),
      level: finite(value.level),
      xp: finite(value.xp),
      nextXp: finite(value.nextXp),
      room: short(value.room, 60),
      zone: short(value.zone, 40),
      quest: short(value.quest, 120),
      tick: integer(value.tick),
      turn: integer(value.turn),
    };
  }
  if (kind === "stats") {
    return {
      kind,
      turn: integer(value.turn),
      commands: finite(value.commands),
      latencyMs: finite(value.latencyMs),
      tokensIn: finite(value.tokensIn),
      tokensOut: finite(value.tokensOut),
      provider: short(value.provider, 40),
      model: short(value.model, 80),
      timeouts: finite(value.timeouts),
      invalid: finite(value.invalid),
      loops: finite(value.loops),
      tick: integer(value.tick),
    };
  }
  if (kind === "decision") {
    const publicText = publicStreamText(text).slice(0, 500);
    if (!publicText) return null;
    return {
      kind,
      text: publicText,
      command: short(value.command, 120),
      room: short(value.room, 60),
      turn: integer(value.turn),
      tick: integer(value.tick),
    };
  }
  if (kind === "text" || kind === "highlight") {
    const publicText = publicStreamText(text).slice(0, kind === "text" ? 4000 : 2000);
    if (!publicText) return null;
    return { kind, text: publicText, turn: integer(value.turn), tick: integer(value.tick) };
  }
  const trimmed = text.trim().slice(0, kind === "command" ? 240 : 500);
  if (!trimmed) return null;
  return { kind, text: trimmed, turn: integer(value.turn), tick: integer(value.tick) };
}
