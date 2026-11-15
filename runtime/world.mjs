// The world as data: tick, NPCs, actors.
//
// `step` is the whole world: state + intents + rooms in, next state and events
// out. It performs no I/O and reads no clock, so a recorded intent trace replays
// to the same state — which is the only thing that makes a run auditable.
//
// Actors live here, not in the server. The server keeps transports and nothing
// else; if a player's room were in the server's Map, the engine's state and the
// world's state would be two different objects and no replay could be trusted.

import { createHash } from "node:crypto";
import { advance, due as pulseDue, makePulse } from "./generated/Pulses.mjs";

export const TICK_MS = 250;

export const PULSES = {
  mobile: 4,
  area: 240,
};

export const CHECKPOINT = 240;

const nextFrom = (seed, bound) => ((seed * 1103515245 + 12345) % 2147483648) % bound;

export function initialState(rooms) {
  return {
    tick: 0,
    npcs: [
      { id: "rat", name: "a rat", room: 2, home: 2 },
      { id: "moth", name: "a moth", room: 5, home: 5 },
    ].filter((npc) => rooms[npc.room] !== undefined),
    actors: [],
    identities: {},
    // Countdowns, generated from Pulses.lex.tex. Starting at zero makes the
    // first tick fire, then every period after it.
    pulses: {
      mobile: makePulse({ period: 4, remaining: 4 }),
      area: makePulse({ period: 240, remaining: 240 }),
    },
  };
}

export function due(tick) {
  return {
    mobile: tick % PULSES.mobile === 0,
    area: tick % PULSES.area === 0,
    checkpoint: tick % CHECKPOINT === 0,
  };
}

/** A stable digest of the whole world, for comparing a replay against a trace. */
export function digestState(state) {
  const canonical = JSON.stringify({
    tick: state.tick,
    npcs: [...state.npcs].sort((a, b) => a.id.localeCompare(b.id)),
    actors: [...state.actors].sort((a, b) => a.id - b.id),
    identities: Object.fromEntries(
      Object.keys(state.identities ?? {}).sort().map((k) => [k, state.identities[k]]),
    ),
    pulses: state.pulses,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Advance one tick.
 *
 * Intents: {kind:"join"|"leave"|"move"|"say"}. Events are room broadcasts
 * ({room, text, exceptId}) or personal ({onlyId, text}).
 */
export function step({ state, rooms, intents }) {
  const events = [];
  const next = {
    tick: state.tick + 1,
    npcs: state.npcs.map((n) => ({ ...n })),
    actors: state.actors.map((a) => ({ ...a, visited: [...a.visited] })),
    identities: { ...state.identities },
    pulses: { mobile: { ...state.pulses.mobile }, area: { ...state.pulses.area } },
  };
  // Advance first, then fire on zero and reload in the same tick. Firing before
  // advancing costs an extra tick per period; the model's `advance` is the
  // countdown and the loop only decides when to read it.
  next.pulses.mobile = advance(next.pulses.mobile);
  const mobileDue = pulseDue(next.pulses.mobile);
  if (mobileDue) next.pulses.mobile = advance(next.pulses.mobile);

  next.pulses.area = advance(next.pulses.area);
  const areaDue = pulseDue(next.pulses.area);
  if (areaDue) next.pulses.area = advance(next.pulses.area);
  const find = (id) => next.actors.find((a) => a.id === id);

  for (const intent of intents) {
    if (intent.kind === "join") {
      if (!find(intent.actorId)) {
        next.actors.push({ id: intent.actorId, name: intent.name, room: 1, visited: [1], key: null, role: 0 });
      }
      continue;
    }

    if (intent.kind === "login") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      const known = next.identities[intent.key];
      const hash = intent.token
        ? createHash("sha256").update(intent.token, "utf8").digest("hex")
        : null;

      // A name belongs to whoever holds its key. Without a matching key the
      // login is refused, so a name cannot be taken by typing it.
      if (known && known.tokenHash !== hash) {
        events.push({ onlyId: actor.id, text: "That name is taken, and the key does not match.\r\n" });
        continue;
      }

      actor.key = intent.key;
      if (known) {
        actor.visited = [...known.visited];
        actor.name = known.name;
        actor.room = intent.respawn ? 1 : known.room;
        actor.role = known.role ?? 0;
        if (!actor.visited.includes(actor.room)) actor.visited.push(actor.room);
      } else {
        actor.name = intent.key;
        next.identities[intent.key] = {
          name: actor.name,
          room: actor.room,
          visited: [...actor.visited],
          // A role is granted once, at creation, and travels with the identity.
          role: intent.role ?? 0,
          tokenHash: hash,
        };
        actor.role = intent.role ?? 0;
      }
      continue;
    }

    if (intent.kind === "leave") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      if (actor.key) {
        // Merge, never replace: the token hash and the role must survive a
        // disconnect, or the returning player cannot sign in again.
        next.identities[actor.key] = {
          ...next.identities[actor.key],
          name: actor.name,
          room: actor.room,
          visited: [...actor.visited],
          role: actor.role,
        };
      }
      events.push({ room: actor.room, text: `${actor.name} vanishes.`, exceptId: actor.id });
      next.actors = next.actors.filter((a) => a.id !== intent.actorId);
      continue;
    }

    const actor = find(intent.actorId);
    if (!actor) continue;

    if (intent.kind === "move") {
      if (rooms[actor.room]?.exits?.[intent.dir] !== intent.to) continue;
      const from = actor.room;
      events.push({ room: from, text: `${actor.name} leaves ${intent.dir}.`, exceptId: actor.id });
      actor.room = intent.to;
      if (!actor.visited.includes(actor.room)) actor.visited.push(actor.room);
      events.push({ room: intent.to, text: `${actor.name} arrives.`, exceptId: actor.id });
      continue;
    }

    if (intent.kind === "say") {
      events.push({ room: actor.room, text: `${actor.name} says: ${intent.text}`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You say: ${intent.text}` });
    }
  }

  if (mobileDue) {
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

  if (areaDue) {
    for (const npc of next.npcs) npc.room = npc.home;
    for (const room of Object.keys(rooms)) {
      events.push({ room: Number(room), text: "A bell rings somewhere below." });
    }
  }

  return { state: next, events, checkpoint: next.tick % CHECKPOINT === 0 };
}
