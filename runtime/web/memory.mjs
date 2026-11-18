// Persistent, compact memory for one AI character.
//
// This is the injection layer the game can guarantee: every room the character
// has seen, what it tried there, whether the result changed, and which exits
// are still unexplored. The model gets this back as a short MEMORY block each
// turn instead of relying on a two-turn chat history. Storage lives in the
// browser under the character's public persona key; the game never needs the
// model's private thoughts to reconstruct it.

const VERSION = 1;
const MAX_ROOMS = 80;
const MAX_COMMANDS = 24;
const STOP = new Set([
  "the", "and", "you", "your", "with", "that", "this", "from", "into", "over",
  "under", "have", "here", "there", "they", "them", "their", "what", "when",
  "where", "which", "while", "will", "would", "could", "should", "about",
  "after", "before", "again", "around", "through", "toward", "towards",
  "some", "more", "most", "very", "just", "only", "also", "than", "then",
]);

export const emptyMemory = () => ({
  version: VERSION,
  rooms: {},
  lastRoom: null,
  visits: 0,
  updated: null,
});

const hash = (text) => {
  let value = 2166136261;
  const source = String(text ?? "");
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};

const trimRoom = (room) => {
  const entries = Object.entries(room.commands ?? {});
  if (entries.length > MAX_COMMANDS) {
    entries.sort((a, b) => (b[1].lastTick ?? 0) - (a[1].lastTick ?? 0));
    for (const [command] of entries.slice(MAX_COMMANDS)) delete room.commands[command];
  }
};

/** Record the result of the command issued in `room` on the previous turn. */
export function rememberResult(memory, { room, command, observation, tick = 0, at = Date.now() } = {}) {
  if (!memory || !room || !command) return memory;
  const entry = memory.rooms[room] ?? (memory.rooms[room] = {
    visits: 0,
    firstTick: tick,
    lastTick: tick,
    commands: {},
  });
  if (memory.lastRoom !== room) {
    entry.visits += 1;
    memory.lastRoom = room;
    memory.visits += 1;
  }
  entry.lastTick = tick;
  memory.updated = at;
  const known = entry.commands[command] ?? (entry.commands[command] = {
    count: 0,
    stale: 0,
    lastHash: null,
    lastTick: tick,
  });
  known.count += 1;
  known.lastTick = tick;
  const digest = hash(observation);
  if (known.lastHash !== null && known.lastHash === digest) known.stale += 1;
  known.lastHash = digest;
  trimRoom(entry);

  const rooms = Object.entries(memory.rooms);
  if (rooms.length > MAX_ROOMS) {
    rooms.sort((a, b) => (b[1].lastTick ?? 0) - (a[1].lastTick ?? 0));
    for (const [name] of rooms.slice(MAX_ROOMS)) delete memory.rooms[name];
  }
  return memory;
}

/** The small block injected into the model prompt. */
export function memoryPrompt(memory, { room = null, exits = [], limit = 8 } = {}) {
  if (!memory) return "";
  const lines = [];
  const current = room ? memory.rooms[room] : null;
  if (room && current) {
    lines.push(`Current room: ${room}, seen ${current.visits} time${current.visits === 1 ? "" : "s"}.`);
    const tried = Object.entries(current.commands)
      .sort((a, b) => (b[1].count ?? 0) - (a[1].count ?? 0))
      .slice(0, limit)
      .map(([command, entry]) => `${command} ×${entry.count}${entry.stale ? ` (stale ${entry.stale})` : ""}`);
    if (tried.length) lines.push(`Tried here: ${tried.join(", ")}.`);
  } else if (room) {
    lines.push(`Current room: ${room}, not seen before in this run.`);
  }
  const names = Object.keys(memory.rooms);
  if (names.length) {
    const recent = Object.entries(memory.rooms)
      .sort((a, b) => (b[1].lastTick ?? 0) - (a[1].lastTick ?? 0))
      .slice(0, 6)
      .map(([name]) => name);
    lines.push(`Rooms seen: ${names.length}. Recent: ${recent.join(", ")}.`);
  }
  const unexplored = (Array.isArray(exits) ? exits : [])
    .filter((exit) => exit?.room && !memory.rooms[exit.room])
    .map((exit) => `${exit.dir} → ${exit.room}`);
  if (unexplored.length) lines.push(`Unexplored exits: ${unexplored.join(", ")}.`);
  const stale = current ? Object.entries(current.commands).filter(([, entry]) => (entry.stale ?? 0) > 0) : [];
  if (stale.length) {
    lines.push("STALE: a command marked stale has already returned the same text; do not repeat it. Move or try a different action.");
  }
  return lines.join("\n");
}

/** A compact warning when the recent command cycle is repeating. */
export function loopWarning(recent = []) {
  const list = Array.isArray(recent) ? recent : [];
  if (list.length >= 3 && list.slice(-3).every((command) => command === list.at(-1))) {
    return `LOOP: you repeated "${list.at(-1)}" three times. Break the pattern; move or try a different action.`;
  }
  if (list.length >= 4 && list.at(-1) === list.at(-3) && list.at(-2) === list.at(-4)) {
    return `LOOP: you are cycling "${list.at(-2)}" and "${list.at(-1)}". Break the cycle.`;
  }
  return "";
}

/** Pick a different, safe command after an observation loop. */
export function breakLoop(recent = [], exits = []) {
  const list = Array.isArray(recent) ? recent : [];
  const last = list.at(-1) ?? "";
  if (/^(attack|cast|flee|say|tell|global|talk|drop|give|buy|sell|train|study|recite)\b/i.test(last)) return null;
  const dirs = (Array.isArray(exits) ? exits : [])
    .map((exit) => (typeof exit === "string" ? exit : exit?.dir))
    .filter(Boolean);
  const fresh = dirs.find((dir) => !list.slice(-6).includes(dir));
  if (fresh) return fresh;
  if (last !== "look") return "look";
  return "wait";
}

export function shouldBreakLoop(memory, { room, command, recent = [] } = {}) {
  if (!memory || !room || !command) return false;
  if (/^(attack|cast|flee|say|tell|global|talk|drop|give|buy|sell|train|study|recite)\b/i.test(command)) return false;
  const entry = memory.rooms?.[room]?.commands?.[command];
  if (entry && entry.stale >= 2) return true;
  return Boolean(loopWarning(recent));
}
