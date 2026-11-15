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

// An LCG whose multiply is done in doubles, not in 32 bits. The product of a
// tick-derived seed and 1103515245 passes 2^53 at about tick 409,000, after
// which the low bits are all zero: every direction becomes the same and every
// blow does one damage. Math.imul keeps the multiplication exact and the
// generator alive for as long as the world runs.
export const nextFrom = (seed, bound) => ((Math.imul(seed | 0, 1103515245) + 12345) >>> 0) % bound;

// An id is opaque: the server happens to number actors, but a reducer that
// multiplies a string produces NaN damage and a fight that never lands a blow.
// Hash it to a stable integer instead of trusting its shape.
const seedOf = (value) => {
  if (typeof value === "number") return value;
  let hash = 7;
  for (const ch of String(value)) hash = (hash * 31 + ch.codePointAt(0)) % 2147483648;
  return hash;
};

const DEFAULT_CLIMATE = {
  dayLength: 720,
  weatherPeriod: 120,
  phases: [
    { id: "night", from: 0, to: 5 },
    { id: "day", from: 6, to: 23 },
  ],
  weather: [{ id: "clear", text: "The air is still." }],
};

/** The hour of the world's day, and the phase that covers it. */
export function phaseAt(tick, climate = DEFAULT_CLIMATE) {
  const hour = Math.floor(((tick % climate.dayLength) + climate.dayLength) % climate.dayLength / (climate.dayLength / 24));
  return (climate.phases.find((phase) => hour >= phase.from && hour <= phase.to) ?? { id: "day" }).id;
}

export function initialState(rooms, npcs = [], objects = [], start = 1, climate = DEFAULT_CLIMATE) {
  return {
    tick: 0,
    cycle: 0,
    start,
    climate,
    weather: 0,
    engagements: [],
    npcs: npcs
      .filter((npc) => rooms[npc.room] !== undefined)
      .map((npc) => ({
        ...npc,
        clock: makePulse({ period: npc.period, remaining: npc.period }),
      })),
    actors: [],
    objects: objects.map((object) => ({
      ...object,
      holder: null,
      room: object.inside ? null : object.room,
      inside: object.inside ?? null,
      home: object.inside ? null : object.room,
      homeInside: object.inside ?? null,
      worn: false,
      open: object.open ?? false,
      openAtStart: object.open ?? false,
      lit: object.lit ?? false,
      eaten: false,
      maxBites: object.bites ?? 0,
    })),
    identities: {},
    // Countdowns, generated from Pulses.lex.tex. Starting at zero makes the
    // first tick fire, then every period after it.
    pulses: {
      mobile: makePulse({ period: 4, remaining: 4 }),
      violence: makePulse({ period: 4, remaining: 4 }),
      area: makePulse({ period: 240, remaining: 240 }),
      weather: makePulse({ period: climate.weatherPeriod, remaining: climate.weatherPeriod }),
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
    cycle: state.cycle ?? 0,
    start: state.start ?? 1,
    climate: state.climate,
    weather: state.weather,
    engagements: (state.engagements ?? []).map((e) => ({ ...e })),
    objects: [...state.objects].sort((a, b) => a.id.localeCompare(b.id)),
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
    cycle: state.cycle ?? 0,
    start: state.start ?? 1,
    climate: state.climate,
    weather: state.weather,
    engagements: (state.engagements ?? []).map((e) => ({ ...e })),
    npcs: state.npcs.map((n) => ({ ...n, clock: { ...n.clock } })),
    actors: state.actors.map((a) => ({ ...a, visited: [...a.visited] })),
    objects: state.objects.map((o) => ({ ...o })),
    identities: { ...state.identities },
    // Clone every pulse generically: a hand-written list silently dropped the
    // violence clock when it was added.
    pulses: Object.fromEntries(Object.entries(state.pulses).map(([name, pulse]) => [name, { ...pulse }])),
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

  // Weather moves on its own slow clock. It never repeats the state it is
  // already in, so a change is always a change.
  next.pulses.weather = advance(next.pulses.weather);
  const weatherDue = pulseDue(next.pulses.weather);
  if (weatherDue) next.pulses.weather = advance(next.pulses.weather);
  if (weatherDue && next.climate.weather.length > 1) {
    const from = next.climate.weather[next.weather].id;
    let pick = nextFrom(next.tick, next.climate.weather.length - 1);
    if (pick >= next.weather) pick += 1;
    next.weather = pick;
    const to = next.climate.weather[pick];
    for (const room of Object.keys(rooms)) {
      events.push({ room: Number(room), text: to.text, weather: { from, to: to.id } });
    }
  }
  const find = (id) => next.actors.find((a) => a.id === id);

  for (const intent of intents) {
    if (intent.kind === "join") {
      if (!find(intent.actorId)) {
        next.actors.push({ id: intent.actorId, name: intent.name, room: next.start, visited: [next.start], key: null, role: 0, hp: 10, maxHp: 10 });
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

    // Objects, as the old codebases had them: a thing has a place, or a holder,
    // never both, and moving it is the only operation that changes that.
    if (intent.kind === "attack") {
      const target = next.npcs.find((n) => n.id === intent.targetId)
        ?? next.actors.find((a) => a.id === intent.targetId);
      if (!target || target.dead || target.room !== actor.room) continue;
      if (next.engagements.some((e) => e.attackerId === actor.id && e.targetId === target.id)) continue;
      next.engagements.push({ attackerId: actor.id, targetId: target.id });
      events.push({ room: actor.room, text: `${actor.name} attacks ${target.name}!`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You attack ${target.name}.` });
      continue;
    }

    if (intent.kind === "take" || intent.kind === "drop" || intent.kind === "give") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object) continue;

      if (intent.kind === "take") {
        if (object.holder !== null || object.room !== actor.room) continue;
        if ((object.flags ?? []).includes("fixed")) continue;
        object.holder = actor.id;
        object.room = null;
        events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: intent.messages.actor });
        continue;
      }

      if (object.holder !== actor.id) continue;

      if (intent.kind === "drop") {
        object.holder = null;
        object.room = actor.room;
        events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: intent.messages.actor });
        continue;
      }

      const recipient = find(intent.toId);
      if (!recipient || recipient.room !== actor.room) continue;
      object.holder = recipient.id;
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      events.push({ onlyId: recipient.id, text: intent.messages.target });
      continue;
    }

    // Containers, wear, food and light. Each verb has one state change and one
    // place to record it; the words are the table's business.
    if (intent.kind === "put") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      const container = next.objects.find((o) => o.id === intent.containerId);
      if (!object || !container || object.holder !== actor.id) continue;
      if (!(container.flags ?? []).includes("container")) continue;
      const reachable = container.holder === actor.id || container.room === actor.room;
      if (!reachable || container.eaten) continue;
      if (!container.open) continue;
      const held = next.objects.filter((o) => o.inside === container.id && !o.eaten).length;
      if (held >= container.capacity) continue;
      object.inside = container.id;
      object.holder = null;
      object.room = null;
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "takeFrom") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      const container = next.objects.find((o) => o.id === intent.containerId);
      if (!object || !container || object.inside !== container.id || object.eaten) continue;
      const reachable = container.holder === actor.id || container.room === actor.room;
      if (!reachable || !container.open) continue;
      object.inside = null;
      object.holder = actor.id;
      object.room = null;
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "open" || intent.kind === "close") {
      const container = next.objects.find((o) => o.id === intent.objectId);
      if (!container || container.eaten) continue;
      if (!(container.flags ?? []).includes("container")) continue;
      if (container.holder !== actor.id && container.room !== actor.room) continue;
      container.open = intent.kind === "open";
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "wear" || intent.kind === "remove") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || object.holder !== actor.id || object.eaten) continue;
      if (!(object.flags ?? []).includes("wearable")) continue;
      object.worn = intent.kind === "wear";
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "eat") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || object.holder !== actor.id || object.eaten) continue;
      if (!(object.flags ?? []).includes("food")) continue;
      object.bites = (object.bites ?? 1) - 1;
      if (object.bites <= 0) {
        object.eaten = true;
        object.holder = null;
        object.room = null;
      }
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "light" || intent.kind === "extinguish") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || object.eaten) continue;
      if (!(object.flags ?? []).includes("light")) continue;
      if (object.holder !== actor.id && object.room !== actor.room) continue;
      object.lit = intent.kind === "light";
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "say") {
      events.push({ room: actor.room, text: `${actor.name} says: ${intent.text}`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You say: ${intent.text}` });
    }
  }

  // Hierarchical clocks: every NPC runs its own countdown, so a rat on a slow
  // clock does not move when the world ticks — it moves when *its* clock does.
  // Jitter is drawn from the tick and the id, so a replay wanders identically.
  // Violence: one round per engagement, on its own pulse, deterministic from
  // the tick so a replay fights identically.
  next.pulses.violence = advance(next.pulses.violence);
  const violenceDue = pulseDue(next.pulses.violence);
  if (violenceDue) next.pulses.violence = advance(next.pulses.violence);

  for (const npc of next.npcs) {
    npc.clock = advance(npc.clock);
    if (!pulseDue(npc.clock)) continue;

    const period = npc.period + nextFrom(next.tick * 31 + npc.id.length, (npc.jitter ?? 0) + 1);
    npc.clock = { period, remaining: period };

    const behaviour = npc.behaviour ?? "wander";

    // A sentinel never leaves, but its clock still runs; that is a behaviour,
    // not an absence of one.
    if (behaviour === "sentinel") continue;

    if (behaviour === "speaker") {
      if (phaseAt(next.tick, next.climate) === "night") continue;
      const phrases = npc.phrases ?? [];
      if (phrases.length === 0) continue;
      const line = phrases[nextFrom(next.tick + npc.id.length, phrases.length)];
      events.push({ room: npc.room, text: line, source: npc.id });
      continue;
    }

    const exits = Object.keys(rooms[npc.room]?.exits ?? {});
    if (exits.length === 0) continue;
    const dir = exits[nextFrom(next.tick + npc.id.length, exits.length)];
    const to = rooms[npc.room].exits[dir];
    const from = npc.room;
    npc.room = to;
    events.push({ room: from, text: `${npc.name} scuttles ${dir}.`, source: npc.id });
    events.push({ room: to, text: `${npc.name} arrives.`, source: npc.id });
  }

  if (violenceDue) {
    const living = next.engagements.filter((engagement) => {
      const attacker = next.actors.find((a) => a.id === engagement.attackerId);
      const target = next.actors.find((a) => a.id === engagement.targetId)
        ?? next.npcs.find((n) => n.id === engagement.targetId);
      return attacker && target && !target.dead && target.hp > 0;
    });

    for (const engagement of living) {
      const attacker = next.actors.find((a) => a.id === engagement.attackerId);
      const target = next.actors.find((a) => a.id === engagement.targetId)
        ?? next.npcs.find((n) => n.id === engagement.targetId);

      const damage = 1 + nextFrom(next.tick * 7 + seedOf(engagement.attackerId), 4);
      target.hp -= damage;
      const killed = target.hp <= 0;
      const detail = {
        attacker: attacker.id,
        target: target.id,
        damage,
        hp: Math.max(0, target.hp),
        outcome: killed ? "killed" : "hit",
        room: attacker.room,
      };

      // One combat event per round: the room broadcast carries the record, the
      // actor's own line does not, or every hit is counted twice.
      events.push({ room: attacker.room, text: `${attacker.name} strikes ${target.name} for ${damage}.`, exceptId: attacker.id, combat: detail });
      events.push({ onlyId: attacker.id, text: `You strike ${target.name} for ${damage}.` });

      if (killed) {
        if (next.npcs.includes(target)) {
          target.dead = true;
          target.room = null;
          events.push({ room: attacker.room, text: `${target.name} dies.` });
        } else {
          target.hp = target.maxHp ?? 10;
          target.room = next.start;
          if (!target.visited.includes(next.start)) target.visited.push(next.start);
          events.push({ onlyId: target.id, text: "You die, and wake at the start." });
        }
        next.engagements = next.engagements.filter((e) => e !== engagement);
      }
    }
  }

  if (areaDue) {
    // The old MUD reset: the world returns to its starting arrangement and the
    // cycle advances, so a long session is a series of games, not one drift.
    next.cycle += 1;
    // The old MUD reset brings the dead back as well as moving the living.
    for (const npc of next.npcs) {
      npc.room = npc.home;
      npc.dead = false;
      npc.hp = npc.maxHp;
    }
    next.engagements = [];
    for (const object of next.objects) {
      object.holder = null;
      object.room = object.home;
      object.inside = object.homeInside;
      object.worn = false;
      object.open = object.openAtStart ?? object.open;
      object.lit = false;
      object.eaten = false;
      object.bites = object.maxBites;
    }
    for (const room of Object.keys(rooms)) {
      events.push({ room: Number(room), text: "A bell rings somewhere below." });
    }
  }

  return { state: next, events, checkpoint: next.tick % CHECKPOINT === 0 };
}
