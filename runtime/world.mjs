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

// Two hours at 250 ms. The world reset is a world event, not a heartbeat:
// objects and mobiles return home, characters keep their progress.
export const AREA_PERIOD = 28_800;

export const PULSES = {
  mobile: 4,
  area: AREA_PERIOD,
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

export function initialState(rooms, npcs = [], objects = [], start = 1, climate = DEFAULT_CLIMATE, channels = []) {
  return {
    tick: 0,
    cycle: 0,
    start,
    climate,
    weather: 0,
    channels,
    mail: [],
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
      forSale: object.forSale ?? false,
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
      area: makePulse({ period: AREA_PERIOD, remaining: AREA_PERIOD }),
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
    channels: state.channels ?? [],
    mail: (state.mail ?? []).map((letter) => ({ ...letter })),
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
/**
 * A saved world outlives the model that wrote it. When a release adds a pulse,
 * a climate, an item property or a mobile, the checkpoint on disk is older than
 * the code reading it. This upgrades a saved state to the shape the current
 * world expects: every clock the base has is present, every object the base has
 * is present, and anything new starts from its home rather than from undefined.
 */
export function upgradeState(saved, base) {
  if (!saved || typeof saved !== "object") return base;

  const pulses = {};
  for (const [name, pulse] of Object.entries(base.pulses)) {
    const old = saved.pulses?.[name];
    const usable = old && Number.isInteger(old.period) && old.period > 0 && Number.isInteger(old.remaining);
    pulses[name] = usable
      ? { period: old.period, remaining: Math.min(Math.max(old.remaining, 0), old.period) }
      : { ...pulse };
  }

  // A save carries its old pulse periods. The reset is a world setting, not a
  // saved one: move the area pulse to the current period without losing where
  // it was in its countdown.
  if (pulses.area) {
    pulses.area.period = AREA_PERIOD;
    pulses.area.remaining = Math.min(pulses.area.remaining, AREA_PERIOD);
  }

  const climate = saved.climate?.weather?.length ? saved.climate : base.climate;
  const weather = Number.isInteger(saved.weather) && climate.weather[saved.weather] ? saved.weather : 0;

  // Objects and mobiles are matched by id. The base supplies every field the
  // current model knows, and the save overrides only what it actually held.
  const savedObjects = new Map((saved.objects ?? []).map((o) => [o.id, o]));
  const objects = base.objects.map((o) => {
    const old = savedObjects.get(o.id);
    if (!old) return { ...o };
    // Flags are additive across releases: a save written before coins existed
    // must not erase the `coin` flag the current model gives an object. The
    // deployment after this fix found exactly that — the shop could not see a
    // silver coin because the save's older flag list had replaced the new one.
    return { ...o, ...old, flags: [...new Set([...(o.flags ?? []), ...(old.flags ?? [])])] };
  });
  const savedNpcs = new Map((saved.npcs ?? []).map((n) => [n.id, n]));
  const npcs = base.npcs.map((n) => {
    const old = savedNpcs.get(n.id);
    if (!old) return { ...n };
    const maxHp = old.maxHp ?? old.hp ?? n.maxHp;
    return { ...n, ...old, hp: old.hp ?? maxHp, maxHp, dead: old.dead ?? false };
  });

  // Only progression survives this release. Room, visited set and inventory
  // are session state; old saves are stripped of them here.
  const identities = Object.fromEntries(Object.entries(saved.identities ?? base.identities ?? {}).map(([key, identity]) => {
    const { inventory, worn, room, visited, ...rest } = identity;
    return [key, {
      ...rest,
      level: identity.level ?? 1,
      xp: identity.xp ?? 0,
      guild: identity.guild ?? null,
      quests: identity.quests ?? { active: [], completed: [] },
    }];
  }));

  return {
    ...base,
    ...saved,
    identities,
    climate,
    weather,
    start: saved.start ?? base.start,
    cycle: saved.cycle ?? base.cycle,
    engagements: Array.isArray(saved.engagements) ? saved.engagements : [],
    channels: base.channels,
    mail: Array.isArray(saved.mail) ? saved.mail : [],
    pulses,
    npcs,
    objects,
    actors: saved.actors ?? base.actors,
  };
}

/**
 * A restart does not restore players, so anything they were carrying would be
 * held by an actor who no longer exists and could never be reached again. Put
 * it on the floor of the room they logged out in, which is what the old MUDs
 * did and what a player expects after a deploy.
 */
export function releaseHeldObjects(state, actors = []) {
  const roomOf = new Map(actors.map((actor) => [actor.id, actor.room]));
  for (const object of state.objects) {
    if (object.holder === null || object.holder === undefined) continue;
    // A restart drops the actor; the object falls where they stood, or goes
    // home if even that record is gone. Nothing is restored to a hand.
    object.room = roomOf.has(object.holder) ? roomOf.get(object.holder) : (object.home ?? state.start);
    object.holder = null;
    object.inside = null;
    object.worn = false;
  }
  return state;
}

/**
 * Before a checkpoint, write every online actor's hands into their identity.
 * A crash then loses at most the ticks since the last checkpoint, and a clean
 * logout and a hard restart restore the same inventory.
 */
export function checkpointIdentities(state) {
  for (const actor of state.actors ?? []) {
    if (!actor.key) continue;
    const identity = state.identities[actor.key] ?? {};
    const { inventory, worn, room, visited, ...rest } = identity;
    state.identities[actor.key] = {
      ...rest,
      name: actor.name,
      role: actor.role ?? 0,
      level: actor.level ?? 1,
      xp: actor.xp ?? 0,
      guild: actor.guild ?? null,
      quests: actor.quests ?? { active: [], completed: [] },
    };
  }
  return state;
}

export function step({ state, rooms, intents }) {
  const events = [];
  const next = {
    tick: state.tick + 1,
    cycle: state.cycle ?? 0,
    start: state.start ?? 1,
    climate: state.climate,
    weather: state.weather,
    channels: state.channels ?? [],
    mail: (state.mail ?? []).map((letter) => ({ ...letter })),
    engagements: (state.engagements ?? []).map((e) => ({ ...e })),
    npcs: state.npcs.map((n) => ({ ...n, clock: { ...n.clock } })),
    actors: state.actors.map((a) => ({
      ...a,
      visited: [...a.visited],
      quests: {
        active: [...(a.quests?.active ?? [])],
        completed: [...(a.quests?.completed ?? [])],
      },
    })),
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
        next.actors.push({
          id: intent.actorId,
          name: intent.name,
          room: next.start,
          visited: [next.start],
          key: null,
          role: 0,
          hp: 10,
          maxHp: 10,
          level: 1,
          xp: 0,
          guild: null,
          quests: { active: [], completed: [] },
        });
      }
      continue;
    }

    if (intent.kind === "register") {
      if (next.identities[intent.key]) continue;
      const actor = find(intent.actorId);
      if (!actor) continue;
      actor.key = intent.key;
      actor.name = intent.key;
      actor.room = next.start;
      actor.visited = [next.start];
      actor.role = 0;
      actor.level = 1;
      actor.xp = 0;
      actor.guild = null;
      actor.quests = { active: [], completed: [] };
      next.identities[intent.key] = {
        name: actor.name,
        role: 0,
        passwordHash: intent.passwordHash,
        salt: intent.salt,
        tokenHash: null,
        level: 1,
        xp: 0,
        guild: null,
        quests: { active: [], completed: [] },
      };
      events.push({ onlyId: actor.id, text: `Welcome, ${actor.name}.\r\n` });
      continue;
    }

    if (intent.kind === "password") {
      const actor = find(intent.actorId);
      if (!actor?.key || !next.identities[actor.key]) continue;
      next.identities[actor.key] = {
        ...next.identities[actor.key],
        passwordHash: intent.passwordHash,
        salt: intent.salt,
      };
      events.push({ onlyId: actor.id, text: "Password changed.\r\n" });
      continue;
    }

    if (intent.kind === "login") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      if (next.actors.some((other) => other.id !== actor.id && other.key === intent.key)) {
        events.push({ onlyId: actor.id, text: "That name is already signed in.\r\n" });
        continue;
      }
      const known = next.identities[intent.key];
      const hash = intent.token
        ? createHash("sha256").update(intent.token, "utf8").digest("hex")
        : null;

      // The server has already verified a password or a legacy key. An intent
      // that did not come through that door still has to present the token.
      if (!intent.authenticated && known && known.tokenHash !== hash) {
        events.push({ onlyId: actor.id, text: "That name is taken, and the key does not match.\r\n" });
        continue;
      }

      actor.key = intent.key;
      if (known) {
        actor.name = known.name ?? intent.key;
        // No position persistence: every login begins at the safe start.
        actor.room = next.start;
        actor.visited = [next.start];
        actor.role = known.role ?? 0;
        actor.level = known.level ?? 1;
        actor.xp = known.xp ?? 0;
        actor.guild = known.guild ?? null;
        actor.quests = {
          active: [...(known.quests?.active ?? [])],
          completed: [...(known.quests?.completed ?? [])],
        };
        // Do not restore inventory: what the character carried was dropped
        // where they logged out and belongs to the world until the reset.
        next.identities[intent.key] = {
          ...known,
          name: actor.name,
          role: actor.role,
          level: actor.level,
          xp: actor.xp,
          guild: actor.guild,
          quests: actor.quests,
        };
      } else {
        actor.name = intent.key;
        actor.room = next.start;
        actor.visited = [next.start];
        actor.role = intent.role ?? 0;
        actor.level = 1;
        actor.xp = 0;
        actor.guild = null;
        actor.quests = { active: [], completed: [] };
        next.identities[intent.key] = {
          name: actor.name,
          role: actor.role,
          tokenHash: hash,
          level: 1,
          xp: 0,
          guild: null,
          quests: { active: [], completed: [] },
        };
      }
      for (const letter of next.mail) {
        if (letter.toKey !== actor.key || letter.read) continue;
        letter.read = true;
        events.push({ onlyId: actor.id, text: `A letter from ${letter.from}, sent at tick ${letter.tick}: ${letter.text}` });
      }
      continue;
    }

    if (intent.kind === "leave") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      // Items are mortal: they fall where the character stood and belong to
      // the world until the two-hour reset. Only progression is written down.
      for (const object of next.objects) {
        if (object.holder !== actor.id) continue;
        object.holder = null;
        object.room = actor.room;
        object.inside = null;
        object.worn = false;
      }
      if (actor.key) {
        const identity = next.identities[actor.key] ?? {};
        const { inventory, worn, room, visited, ...rest } = identity;
        next.identities[actor.key] = {
          ...rest,
          name: actor.name,
          role: actor.role ?? 0,
          level: actor.level ?? 1,
          xp: actor.xp ?? 0,
          guild: actor.guild ?? null,
          quests: actor.quests ?? { active: [], completed: [] },
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
      if (rooms[actor.room]?.safe) continue;
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
        if (object.forSale) continue;
        object.holder = actor.id;
        object.room = null;
        object.worn = false;
        events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: intent.messages.actor });
        continue;
      }

      if (object.holder !== actor.id) continue;

      if (intent.kind === "drop") {
        object.holder = null;
        object.room = actor.room;
        object.worn = false;
        events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: intent.messages.actor });
        continue;
      }

      const recipient = find(intent.toId);
      if (!recipient || recipient.room !== actor.room) continue;
      object.holder = recipient.id;
      object.worn = false;
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
      object.worn = false;
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
      object.worn = false;
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

    if (intent.kind === "buy") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || !object.forSale || object.room !== intent.room) continue;
      const coins = (intent.coinIds ?? [])
        .map((coinId) => next.objects.find((o) => o.id === coinId))
        .filter((coin) => coin && coin.holder === actor.id && (coin.flags ?? []).includes("coin"));
      const paid = coins.reduce((sum, coin) => sum + coin.value, 0);
      if (paid < object.price) continue;
      // The shop keeps the change: the selection is greedy, not exact.
      for (const coin of coins) {
        coin.holder = null;
        coin.room = intent.room;
      }
      object.forSale = false;
      object.holder = actor.id;
      object.room = null;
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "sell") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || object.holder !== actor.id || object.eaten) continue;
      if ((object.flags ?? []).includes("coin") || !Number.isInteger(object.value)) continue;
      const payment = Math.floor(object.value / 2);
      if (payment < 1) continue;
      object.eaten = true;
      object.holder = null;
      object.room = null;
      // The shop pays in copper, minted for the sale and swept up by the reset.
      for (let i = 0; i < payment; i += 1) {
        next.objects.push({
          id: `coin-${next.tick}-${intent.objectId}-${i}`,
          name: "a copper coin",
          flags: ["takeable", "coin"],
          value: 1,
          holder: actor.id,
          room: null,
          inside: null,
          home: null,
          homeInside: null,
          worn: false,
          open: false,
          lit: false,
          eaten: false,
          forSale: false,
          ephemeral: true,
          maxBites: 0,
          bites: 0,
        });
      }
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "say") {
      events.push({ room: actor.room, text: intent.messages?.others ?? `${actor.name} says: ${intent.text}`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages?.actor ?? `You say: ${intent.text}` });
      continue;
    }

    // Channels cross rooms; a role is the only lock. Everyone awake is tuned
    // in, and the speaker reads a different line from the listeners.
    if (intent.kind === "channel") {
      const channel = (next.channels ?? []).find((c) => c.id === intent.channelId);
      if (!channel) continue;
      if ((actor.role ?? 0) < channel.minRole) continue;
      for (const listener of next.actors) {
        if (listener.id === actor.id) {
          events.push({ onlyId: listener.id, text: intent.messages.actor });
        } else {
          events.push({ onlyId: listener.id, text: intent.messages.others });
        }
      }
      continue;
    }

    if (intent.kind === "tell") {
      const target = next.actors.find((a) => a.id === intent.targetId);
      if (!target || target.id === actor.id) continue;
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      events.push({ onlyId: target.id, text: intent.messages.target });
      continue;
    }

    // Mail is a tell that waits. It is stored against the identity key, not the
    // actor, so a letter reaches someone who was not there when it was written.
    if (intent.kind === "mail") {
      const online = next.actors.find((a) => a.key === intent.toKey && a.id !== actor.id);
      const letter = {
        id: `mail-${next.tick}-${intent.actorId}-${next.mail.length}`,
        from: actor.name,
        fromKey: actor.key,
        toKey: intent.toKey,
        text: intent.text,
        tick: next.tick,
        read: Boolean(online),
      };
      next.mail.push(letter);
      while (next.mail.length > 100) next.mail.shift();
      if (online) events.push({ onlyId: online.id, text: intent.messages.target });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    // Socials have no state change: only the room's account of a gesture. Each
    // listener gets exactly one line, so the target does not hear the room's
    // third-person line and a private one at the same time.
    if (intent.kind === "social") {
      const target = intent.targetId === null ? null : next.actors.find((a) => a.id === intent.targetId);
      if (intent.targetId !== null && !target) continue;
      for (const listener of next.actors) {
        if (listener.room !== actor.room) continue;
        let line;
        if (target === null) line = listener.id === actor.id ? intent.messages.actor : intent.messages.others;
        else if (listener.id === actor.id) line = target.id === actor.id ? intent.messages.self : intent.messages.target;
        else if (listener.id === target.id) line = intent.messages.targeted;
        else line = target.id === actor.id ? intent.messages.selfOthers : intent.messages.targetOthers;
        events.push({ onlyId: listener.id, text: line });
      }
      continue;
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
    const contested = next.engagements.filter((engagement) => {
      const attacker = next.actors.find((a) => a.id === engagement.attackerId);
      return attacker && !rooms[attacker.room]?.safe;
    });
    next.engagements = contested;
    const living = contested.filter((engagement) => {
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
    next.objects = next.objects.filter((object) => !object.ephemeral);
    for (const object of next.objects) {
      object.holder = null;
      object.room = object.home;
      object.inside = object.homeInside;
      object.worn = false;
      object.open = object.openAtStart ?? object.open;
      object.lit = false;
      object.eaten = false;
      object.bites = object.maxBites;
      object.forSale = object.home !== null && (object.price ?? 0) > 0;
    }
    for (const room of Object.keys(rooms)) {
      events.push({ room: Number(room), text: "The world shudders. Everything returns to where it began." });
    }
  }

  return { state: next, events, checkpoint: next.tick % CHECKPOINT === 0 };
}
