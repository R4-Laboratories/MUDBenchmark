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

// A small prime table is enough for the concept index: a word maps to one
// stable prime, a note is the set of its word primes, and two notes share a
// concept when their prime sets intersect (the discrete GCD analogue). This is
// deliberately fast enough to run on every turn; the full geometric router is
// a separate service spike.
const PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
  73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
  157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233,
  239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317,
];

const wordPrime = (word) => PRIMES[hash(word) % PRIMES.length];

const notePrimes = (text) => {
  const seen = new Set();
  for (const raw of String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    const word = raw.trim();
    if (word.length < 4 || STOP.has(word)) continue;
    seen.add(wordPrime(word));
  }
  return [...seen].sort((a, b) => a - b);
};

const conceptScore = (note, query, room) => {
  const wanted = new Set(query);
  let shared = 0;
  for (const prime of note.primes ?? []) if (wanted.has(prime)) shared += 1;
  if (!shared) return 0;
  const sameRoom = note.room && note.room === room ? 1.5 : 0;
  const useful = /^(examine|talk|say|tell|answer|read|quest|take|open|look)\b/i.test(note.command ?? "") ? 0.5 : 0;
  return shared + sameRoom + useful;
};

const indexNote = (memory, { text, room, command, tick }) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 18) return;
  const fingerprint = hash(clean);
  const existing = (memory.notes ?? []).find((note) => note.hash === fingerprint);
  if (existing) {
    existing.tick = tick;
    existing.room = room;
    existing.command = command;
    return;
  }
  const primes = notePrimes(clean);
  if (!primes.length) return;
  memory.notes ??= [];
  memory.notes.push({
    text: clean.slice(0, 240),
    room,
    command,
    tick,
    hash: fingerprint,
    primes,
  });
  if (memory.notes.length > 60) memory.notes.splice(0, memory.notes.length - 60);
};

const retrieveNotes = (memory, query, room, limit = 3) => {
  if (!memory?.notes?.length || !query) return [];
  const primes = notePrimes(query);
  if (!primes.length) return [];
  return memory.notes
    .map((note) => ({ note, score: conceptScore(note, primes, room) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.note.tick ?? 0) - (a.note.tick ?? 0))
    .slice(0, limit)
    .map((entry) => entry.note);
};

const PRIVATE_LINE = /(\btells you\b|^You tell\b|^You mail\b|^A letter from\b|^Password\b|^Account\b|^Signed in\b|^Welcome\b|^No such name\b|^That name\b|^That account\b|^You must sign in\b|^Goodbye\b|^#)/i;

/** Public text only: speech in the room and observations, never tells/mail. */
export function publicMemoryText(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !PRIVATE_LINE.test(line.trim()))
    .join("\n")
    .trim();
}

const indexSocial = (memory, { text, room, tick }) => {
  const lines = publicMemoryText(text).split("\n");
  memory.social ??= [];
  for (const line of lines) {
    const match = line.trim().match(/^([A-Za-z][\w' -]{0,40}) says:\s*(.+)$/);
    if (!match) continue;
    const speaker = match[1].trim();
    if (/^you$/i.test(speaker)) continue;
    const said = match[2].trim().slice(0, 180);
    if (!said) continue;
    const existing = memory.social.find((entry) => entry.speaker === speaker && entry.text === said);
    if (existing) {
      existing.tick = tick;
      existing.room = room;
      continue;
    }
    memory.social.push({ speaker, text: said, room, tick });
  }
  if (memory.social.length > 20) memory.social.splice(0, memory.social.length - 20);
};

export const emptyMemory = () => ({
  version: VERSION,
  rooms: {},
  lastRoom: null,
  visits: 0,
  notes: [],
  social: [],
  trail: [],
  map: {},
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

/** Record a room visit, its exits and its place in the recent route. */
export function noteRoom(memory, room, exits = []) {
  if (!memory || !room) return memory;
  const entry = memory.rooms[room] ?? (memory.rooms[room] = {
    visits: 0,
    firstTick: 0,
    lastTick: 0,
    commands: {},
  });
  for (const exit of Array.isArray(exits) ? exits : []) {
    const dir = typeof exit === "string" ? exit : exit?.dir;
    const target = typeof exit === "string" ? null : exit?.room ?? null;
    if (!dir) continue;
    entry.exits ??= {};
    entry.exits[dir] = target;
  }
  if (entry.exits) {
    memory.map ??= {};
    memory.map[room] = { ...(memory.map[room] ?? {}), ...entry.exits };
  }
  if (memory.lastRoom !== room) {
    entry.visits += 1;
    memory.lastRoom = room;
    memory.visits += 1;
    memory.trail ??= [];
    memory.trail.push(room);
    if (memory.trail.length > 60) memory.trail.splice(0, memory.trail.length - 60);
  }
  return memory;
}

/** Seed the route graph from a published room table without marking visits. */
export function seedMap(memory, rooms = []) {
  if (!memory) return memory;
  memory.map ??= {};
  for (const room of Array.isArray(rooms) ? rooms : []) {
    if (!room?.name) continue;
    const exits = {};
    for (const exit of room.exits ?? []) {
      if (exit?.dir && exit?.room) exits[exit.dir] = exit.room;
    }
    if (Object.keys(exits).length) memory.map[room.name] = { ...(memory.map[room.name] ?? {}), ...exits };
  }
  return memory;
}

/** Record the result of the command issued in `room` on the previous turn. */
export function rememberResult(memory, { room, command, observation, tick = 0, at = Date.now(), exits = [] } = {}) {
  if (!memory || !room || !command) return memory;
  const entry = noteRoom(memory, room, exits).rooms[room];
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
  const safeObservation = publicMemoryText(observation);
  indexNote(memory, { text: safeObservation, room, command, tick });
  indexSocial(memory, { text: safeObservation, room, tick });
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
export function memoryPrompt(memory, { room = null, exits = [], limit = 8, query = "" } = {}) {
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
  const voices = (memory.social ?? []).slice(-4);
  if (voices.length) {
    lines.push(`Voices: ${voices.map((entry) => `${entry.speaker}${entry.room ? ` (${entry.room})` : ""}: "${entry.text}"`).join(" | ")}`);
  }
  const known = retrieveNotes(memory, query, room, 3);
  if (known.length) {
    lines.push(`Known: ${known.map((note) => note.text).join(" | ")}`);
  }
  const names = Object.keys(memory.rooms);
  if (names.length) {
    const recent = Object.entries(memory.rooms)
      .sort((a, b) => (b[1].lastTick ?? 0) - (a[1].lastTick ?? 0))
      .slice(0, 6)
      .map(([name]) => name);
    lines.push(`Rooms seen: ${names.length}. Recent: ${recent.join(", ")}.`);
  }
  const route = (memory.trail ?? []).slice(-6);
  if (route.length) lines.push(`Route: ${route.join(" → ")}.`);
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
/** Shortest known route as an array of directions, or [] when unknown. */
export function pathTo(memory, from, to) {
  if (!memory || !from || !to) return [];
  if (from === to) return [];
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length) {
    const [room, path] = queue.shift();
    const exits = memory.map?.[room] ?? memory.rooms?.[room]?.exits ?? {};
    for (const [dir, target] of Object.entries(exits)) {
      if (!target || seen.has(target)) continue;
      const next = [...path, dir];
      if (target === to) return next;
      if (memory.map?.[target] || memory.rooms?.[target]) {
        seen.add(target);
        queue.push([target, next]);
      }
    }
  }
  return [];
}

export function nextStep(memory, from, to) {
  return pathTo(memory, from, to)[0] ?? null;
}

/** The nearest target with a known route, or null when none is known. */
export function nearestTarget(memory, from, targets = []) {
  let best = null;
  for (const target of Array.isArray(targets) ? targets : []) {
    if (from === target) return { target, path: [] };
    const path = pathTo(memory, from, target);
    if (!path.length) continue;
    if (!best || path.length < best.path.length) best = { target, path };
  }
  return best;
}

export function routeHint(memory, from, to) {
  if (!from || !to) return "";
  const path = pathTo(memory, from, to);
  if (path.length) return `Toward ${to}: ${path[0]} (${path.length} move${path.length === 1 ? "" : "s"}).`;
  if (from === to) return `You are at ${to}.`;
  return `No known route to ${to}; explore a new exit.`;
}

export function loopWarning(recent = [], trail = []) {
  const list = Array.isArray(recent) ? recent : [];
  const route = Array.isArray(trail) ? trail : [];
  if (list.length >= 3 && list.slice(-3).every((command) => command === list.at(-1))) {
    return `LOOP: you repeated "${list.at(-1)}" three times. Break the pattern; move or try a different action.`;
  }
  if (list.length >= 4 && list.at(-1) === list.at(-3) && list.at(-2) === list.at(-4)) {
    return `LOOP: you are cycling "${list.at(-2)}" and "${list.at(-1)}". Break the cycle.`;
  }
  if (route.length >= 4 && route.at(-1) === route.at(-3) && route.at(-2) === route.at(-4)) {
    return `ROUTE LOOP: you are cycling ${route.at(-2)} and ${route.at(-1)}. Take an exit you have not tried.`;
  }
  if (route.length >= 6 && route.at(-1) === route.at(-4) && route.at(-2) === route.at(-5) && route.at(-3) === route.at(-6)) {
    return `ROUTE LOOP: you are circling ${route.at(-3)} → ${route.at(-2)} → ${route.at(-1)}. Take a different exit.`;
  }
  return "";
}

/** Pick a different, safe command after an observation loop. */
export function breakLoop(recent = [], exits = [], memory = null) {
  const list = Array.isArray(recent) ? recent : [];
  const last = list.at(-1) ?? "";
  if (/^(attack|cast|flee|say|tell|global|talk|drop|give|buy|sell|train|study|recite)\b/i.test(last)) return null;
  const doors = (Array.isArray(exits) ? exits : [])
    .map((exit) => (typeof exit === "string" ? { dir: exit, room: null } : { dir: exit?.dir, room: exit?.room ?? null }))
    .filter((exit) => exit.dir);
  const unseen = memory
    ? doors.find((exit) => exit.room && !memory.rooms?.[exit.room])
    : null;
  if (unseen) return unseen.dir;
  const fresh = doors.find((exit) => !list.slice(-6).includes(exit.dir));
  if (fresh) return fresh.dir;
  if (last !== "look") return "look";
  return "wait";
}

export function shouldBreakLoop(memory, { room, command, recent = [] } = {}) {
  if (!memory || !room || !command) return false;
  if (/^(attack|cast|flee|say|tell|global|talk|drop|give|buy|sell|train|study|recite)\b/i.test(command)) return false;
  const entry = memory.rooms?.[room]?.commands?.[command];
  if (entry && entry.stale >= 2) return true;
  return Boolean(loopWarning(recent, memory.trail ?? []));
}
