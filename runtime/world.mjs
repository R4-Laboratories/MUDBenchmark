// The pulse substrate.
//
// A classic MUD is not request/response: the world advances on a fixed clock and
// most of what happens was never asked for by a player. From SMAUG's notes:
// "Everything which happens without players issuing orders for it to happen,
// happens here."
//
// This module is the pure part of that: `step` takes the state, the intents
// gathered since the last tick and the room table, and returns the next state and
// the events to deliver. It performs no I/O, so a tick can be replayed.
//
// Periods are counted in ticks and are part of the state's meaning, not of the
// wall clock. The runtime decides when to call `step`; it never decides what is
// due.

export const TICK_MS = 250;

export const PULSES = {
  mobile: 4, // NPC movement, about once a second
  area: 240, // area reset, about a minute
};

export const CHECKPOINT = 240;

/** Deterministic, so a replay of the same ticks wanders the same way. */
const nextFrom = (seed, bound) => ((seed * 1103515245 + 12345) % 2147483648) % bound;

export function initialState(rooms) {
  return {
    tick: 0,
    npcs: [
      { id: "rat", name: "a rat", room: 2, home: 2 },
      { id: "moth", name: "a moth", room: 5, home: 5 },
    ].filter((npc) => rooms[npc.room] !== undefined),
  };
}

export function due(tick) {
  return {
    mobile: tick % PULSES.mobile === 0,
    area: tick % PULSES.area === 0,
    checkpoint: tick % CHECKPOINT === 0,
  };
}

/**
 * Advance one tick.
 *
 * @param {{ state: object, rooms: object, intents: Array, actors: Map }} input
 * @returns {{ state: object, events: Array<{room: number, text: string, except?: object}> }}
 */
export function step({ state, rooms, intents, actors }) {
  const events = [];
  const next = {
    tick: state.tick + 1,
    npcs: state.npcs.map((npc) => ({ ...npc })),
  };
  const pulses = due(next.tick);

  // Intents first: a player who typed a command this tick acts this tick.
  for (const intent of intents) {
    const actor = actors.get(intent.actorId);
    if (!actor) continue;

    if (intent.kind === "move") {
      const from = actor.room;
      if (rooms[from]?.exits?.[intent.dir] !== intent.to) continue; // topology moved
      events.push({ room: from, text: `${actor.name} leaves ${intent.dir}.`, except: actor });
      actor.room = intent.to;
      events.push({ room: intent.to, text: `${actor.name} arrives.`, except: actor });
      continue;
    }

    if (intent.kind === "say") {
      events.push({ room: actor.room, text: `${actor.name} says: ${intent.text}`, except: actor });
      events.push({ room: actor.room, text: `You say: ${intent.text}`, only: actor });
    }
  }

  if (pulses.mobile) {
    for (const npc of next.npcs) {
      const exits = Object.keys(rooms[npc.room]?.exits ?? {});
      if (exits.length === 0) continue;
      const dir = exits[nextFrom(next.tick + npc.id.length, exits.length)];
      const to = rooms[npc.room].exits[dir];
      const from = npc.room;
      npc.room = to;
      events.push({ room: from, text: `${npc.name} scuttles ${dir}.` });
      events.push({ room: to, text: `${npc.name} arrives.` });
    }
  }

  if (pulses.area) {
    for (const npc of next.npcs) npc.room = npc.home;
    for (const room of Object.keys(rooms)) {
      events.push({ room: Number(room), text: "A bell rings somewhere below." });
    }
  }

  return { state: next, events, checkpoint: pulses.checkpoint };
}
