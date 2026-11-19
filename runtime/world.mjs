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
import { levelForXp, nextLevelXp } from "./levels.mjs";
import { applyQuestEvent, emptyProgress, normalizeQuestState, questById, questMet } from "./quests.mjs";
import { GUILD_HALL, GUILD_VAULT_CAPACITY, RANKS, guildId, guildLevelFor, guildVaultHolder, isGuildVaultHolder, rankAtLeast, removeMember, successor, validGuildName, perksFor } from "./guilds.mjs";
import { armorOf, slotOf, weaponOf } from "./equipment.mjs";
import { maxManaFor, spellById, spellPower } from "./magic.mjs";

export { armorOf } from "./equipment.mjs";

export const TICK_MS = 250;

// Two hours at 250 ms. The world reset is a world event, not a heartbeat:
// objects and mobiles return home, characters keep their progress.
export const AREA_PERIOD = 28_800;

export const PULSES = {
  mobile: 4,
  // One combat round every three seconds. Old MUDs did not resolve a fight in
  // a second; the input allowance stays at 250 ms, but steel is slower.
  violence: 12,
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

const DEFAULT_LEVELS = [0, 100, 300, 700, 1500, 3000, 6000, 10000, 15000, 22000, 30000];

/**
 * One attack: a hit chance of 57 minus armour, then 1..4 plus the weapon.
 * AberMUD's shape, deterministic from the tick and the attacker's id so a
 * replay fights identically.
 */
export function attackRoll({ tick, attackerId, weaponDamage = 0, targetArmor = 0, npcDamage = null }) {
  const chance = Math.max(5, 57 - targetArmor);
  const roll = nextFrom(tick * 13 + seedOf(attackerId), 100);
  if (roll >= chance) return { hit: false, damage: 0, chance };
  // A mobile's Damage is its whole blow, not a bonus on a player's base; a
  // training dummy with Damage 0 hits for nothing.
  const damage = npcDamage !== null
    ? (npcDamage <= 0 ? 0 : 1 + nextFrom(tick * 7 + seedOf(attackerId), npcDamage))
    : 1 + nextFrom(tick * 7 + seedOf(attackerId), 4) + weaponDamage;
  return { hit: true, damage, chance };
}

/** The armour a character is wearing, from the objects currently on them. */
function awardXp(state, actor, amount, events) {
  actor.xp = (actor.xp ?? 0) + amount;
  const level = levelForXp(state.levels ?? DEFAULT_LEVELS, actor.xp);
  if (level > (actor.level ?? 1)) {
    actor.level = level;
    actor.maxHp = 10 + (level - 1) * 2;
    actor.hp = actor.maxHp;
    events.push({ onlyId: actor.id, text: `You have reached level ${level}.\r\n` });
    events.push({ room: actor.room, text: `${actor.name} has reached level ${level}.`, exceptId: actor.id });
  }
}

const STATUS = {
  burn: { id: "burn", name: "burning", damage: 1, rounds: 2 },
  bleed: { id: "bleed", name: "bleeding", damage: 1, rounds: 3 },
  chill: { id: "chill", name: "chilled", damage: 0, rounds: 2, armor: 1 },
};

function addStatus(target, id) {
  const definition = STATUS[id];
  if (!definition || !target) return null;
  target.effects ??= [];
  const existing = target.effects.find((effect) => effect.id === id);
  if (existing) {
    existing.rounds = Math.max(existing.rounds ?? 0, definition.rounds);
    return existing;
  }
  const effect = { ...definition };
  target.effects.push(effect);
  return effect;
}

function statusArmorPenalty(target) {
  return (target?.effects ?? []).filter((effect) => effect.id === "chill").length;
}

function tickStatuses(next, events) {
  for (const target of [...next.actors, ...next.npcs]) {
    if (!target.effects?.length || target.dead) continue;
    const room = target.room;
    for (const effect of [...target.effects]) {
      if (effect.damage > 0) {
        const current = target.hp ?? 0;
        const damage = Math.min(effect.damage, Math.max(0, current - 1));
        if (damage > 0) {
          target.hp = current - damage;
          if (next.actors.includes(target)) {
            events.push({ onlyId: target.id, text: `You take ${damage} from ${effect.name}.\r\n` });
          }
          if (room != null) events.push({ room, text: `${target.name} suffers from ${effect.name}.`, exceptId: target.id });
        }
      }
      effect.rounds = (effect.rounds ?? 1) - 1;
      if (effect.rounds <= 0) {
        target.effects = target.effects.filter((entry) => entry !== effect);
        if (next.actors.includes(target)) events.push({ onlyId: target.id, text: `The ${effect.name} fades.\r\n` });
      }
    }
  }
}

function applySpell(state, actor, spell, target, events) {
  const focus = weaponOf(actor, state.objects)?.damage ?? 0;
  const power = spellPower(actor, focus);
  if (spell.effect === "damage" && target) {
    const damage = 1 + nextFrom(state.tick * 7 + actor.room, spell.damage ?? 4) + power;
    target.hp = (target.hp ?? 0) - damage;
    if (spell.status) addStatus(target, spell.status);
    events.push({ room: actor.room, text: `${actor.name} speaks a word; ${target.name} is struck by a spark.`, exceptId: actor.id });
    events.push({ onlyId: actor.id, text: `Your spark strikes ${target.name} for ${damage}.` });
    if (target.hp <= 0) {
      target.dead = true;
      target.hp = 0;
      events.push({ room: actor.room, text: `${target.name} falls.` });
      awardXp(state, actor, target.xp ?? spell.xp ?? 0, events);
    }
  } else if (spell.effect === "heal") {
    const amount = spell.heal + Math.floor((actor.level ?? 1) / 2) + Math.floor(focus / 2);
    actor.hp = Math.min(actor.maxHp, (actor.hp ?? 0) + amount);
    actor.effects = (actor.effects ?? []).filter((effect) => effect.id === "chill");
    events.push({ onlyId: actor.id, text: `You mend ${amount} health; bleeding and burning are cleansed.\r\n` });
  } else if (spell.effect === "shield") {
    const ward = (spell.armor ?? 0) + Math.floor((actor.level ?? 1) / 5) + Math.floor(focus / 3);
    actor.armorBonus = (actor.armorBonus ?? 0) + ward;
    actor.buffUntil = state.tick + (spell.ticks ?? 120);
    events.push({ onlyId: actor.id, text: "A shield settles around you.\r\n" });
  } else if (spell.effect === "recall") {
    actor.room = state.start;
    actor.visited = [...new Set([...(actor.visited ?? []), state.start])];
    events.push({ onlyId: actor.id, text: "The guild's road folds; you are back in the Atrium.\r\n" });
  } else if (spell.effect === "light") {
    events.push({ onlyId: actor.id, text: "A cold light follows you.\r\n" });
  } else if (spell.effect === "detect") {
    events.push({ onlyId: actor.id, text: "You read the room for what it is hiding.\r\n" });
  }
  events.push({ onlyId: actor.id, text: `You cast ${spell.name}.\r\n` });
}

function advanceQuests(state, actor, event, events) {
  if (!state.quests?.length) return;
  const current = normalizeQuestState(actor.quests, state.quests);
  if (current.active.length === 0) { actor.quests = current; return; }
  const active = [];
  let changed = false;
  for (const entry of current.active) {
    const quest = questById(state.quests, entry.id);
    if (!quest) { changed = true; continue; }
    const before = JSON.stringify(entry.progress);
    const progress = applyQuestEvent(quest, entry.progress, event, actor, state.objects);
    if (JSON.stringify(progress) !== before) changed = true;
    if (questMet(quest, progress, actor, state.objects)) {
      awardXp(state, actor, quest.rewards?.xp ?? 0, events);
      const reward = quest.rewards?.object ? state.objects.find((object) => object.id === quest.rewards.object) : null;
      if (reward && !reward.eaten) {
        reward.holder = actor.id;
        reward.room = null;
        reward.inside = null;
        reward.worn = false;
      }
      current.completed.push(quest.id);
      actor.questCycles = { ...(actor.questCycles ?? {}), [quest.id]: state.cycle ?? 0 };
      if (quest.rewards?.guildXp && actor.guild && state.guilds?.[actor.guild]) {
        const guild = state.guilds[actor.guild];
        guild.xp = (guild.xp ?? 0) + quest.rewards.guildXp;
        const level = guildLevelFor(guild.xp);
        if (level > (guild.level ?? 1)) {
          guild.level = level;
          guild.perks = perksFor(level);
          events.push({ room: actor.room, text: `${guild.name} reaches guild level ${level}.` });
        }
      }
      events.push({
        onlyId: actor.id,
        text: `Quest complete: ${quest.name}.\r\n${quest.complete ?? ""}\r\n`,
        quest: { action: "complete", id: quest.id, name: quest.name },
      });
      changed = true;
    } else {
      active.push({ id: entry.id, progress });
    }
  }
  if (changed) actor.quests = { active, completed: current.completed };
}

const DEFAULT_CLIMATE = {
  dayLength: 7200,
  weatherPeriod: 2400,
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

export function initialState(rooms, npcs = [], objects = [], start = 1, climate = DEFAULT_CLIMATE, channels = [], levels = DEFAULT_LEVELS, quests = []) {
  return {
    tick: 0,
    cycle: 0,
    start,
    climate,
    weather: 0,
    channels,
    levels,
    quests,
    guilds: {},
    duels: [],
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
      heldRoom: null,
      worn: false,
      open: object.open ?? false,
      openAtStart: object.open ?? false,
      lit: object.lit ?? false,
      eaten: false,
      maxBites: object.bites ?? 0,
    })),
    identities: {},
    accounts: {},
    // Countdowns, generated from Pulses.lex.tex. Starting at zero makes the
    // first tick fire, then every period after it.
    pulses: {
      mobile: makePulse({ period: 4, remaining: 4 }),
      violence: makePulse({ period: 12, remaining: 12 }),
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
    levels: state.levels,
    quests: state.quests ?? [],
    guilds: Object.fromEntries(Object.entries(state.guilds ?? {}).map(([id, guild]) => [id, {
      ...guild,
      members: { ...(guild.members ?? {}) },
      invites: [...(guild.invites ?? [])],
      vault: [...(guild.vault ?? [])],
    }])),
    duels: (state.duels ?? []).map((duel) => ({ ...duel })),
    mail: (state.mail ?? []).map((letter) => ({ ...letter })),
    engagements: (state.engagements ?? []).map((e) => ({ ...e })),
    objects: [...state.objects].sort((a, b) => a.id.localeCompare(b.id)),
    npcs: [...state.npcs].sort((a, b) => a.id.localeCompare(b.id)),
    actors: [...state.actors].sort((a, b) => a.id - b.id),
    identities: Object.fromEntries(
      Object.keys(state.identities ?? {}).sort().map((k) => [k, state.identities[k]]),
    ),
    accounts: Object.fromEntries(
      Object.keys(state.accounts ?? {}).sort().map((k) => [k, state.accounts[k]]),
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

  // Accounts and characters are separate from this release. An account is the
  // Prism id (or a legacy name) and owns one or more characters; a character is
  // the in-game name and owns the progression, guild and quest keys. An old
  // save has one identity that is both, so it migrates to one account and one
  // character. A claimed legacy name becomes the Prism account's character,
  // not a second copy.
  const guilds = saved.guilds && typeof saved.guilds === "object" ? saved.guilds : {};
  const normalizeCharacter = (name, identity, owner) => {
    const { inventory, worn, room, visited, passwordHash, salt, tokenHash, prism, claimedFrom, retired, mergedInto, characters, ...rest } = identity;
    return {
      ...rest,
      kind: "character",
      owner,
      name,
      ignored: Array.isArray(identity.ignored) ? [...identity.ignored] : [],
      title: typeof identity.title === "string" ? identity.title : null,
      memory: { facts: { ...(identity.memory?.facts ?? {}) } },
      level: identity.level ?? 1,
      xp: identity.xp ?? 0,
      guild: guilds[identity.guild] ? identity.guild : null,
      guildRank: guilds[identity.guild]?.members?.[name] ?? null,
      quests: identity.quests ?? { active: [], completed: [] },
    };
  };
  let accounts;
  let identities;
  if (saved.accounts && typeof saved.accounts === "object") {
    accounts = Object.fromEntries(Object.entries(saved.accounts).map(([key, account]) => [key, {
      ...account,
      kind: account.kind ?? (account.prism ? "prism" : "legacy"),
      characters: [...(account.characters ?? [])],
    }]));
    identities = Object.fromEntries(Object.entries(saved.identities ?? {}).map(([key, identity]) => [key,
      normalizeCharacter(identity.name ?? key, identity, identity.owner ?? key),
    ]));
  } else {
    accounts = {};
    identities = {};
    // Prism accounts first, so a claimed name becomes the Prism character.
    for (const [key, identity] of Object.entries(saved.identities ?? {})) {
      const kind = identity.kind ?? (identity.prism ? "prism" : "legacy");
      if (kind !== "prism") continue;
      const name = identity.name ?? key;
      accounts[key] = {
        kind: "prism",
        name: key,
        characters: [name],
        claimedFrom: identity.claimedFrom ?? null,
        passwordHash: null,
        salt: null,
        tokenHash: null,
        retired: identity.retired ?? false,
        mergedInto: identity.mergedInto ?? null,
      };
      if (!identities[name]) identities[name] = normalizeCharacter(name, identity, key);
    }
    for (const [key, identity] of Object.entries(saved.identities ?? {})) {
      const kind = identity.kind ?? (identity.prism ? "prism" : "legacy");
      if (kind !== "legacy") continue;
      const retired = identity.retired === true || Boolean(identity.mergedInto);
      accounts[key] = {
        kind: "legacy",
        name: key,
        characters: retired ? [] : [key],
        passwordHash: retired ? null : (identity.passwordHash ?? null),
        salt: retired ? null : (identity.salt ?? null),
        tokenHash: retired ? null : (identity.tokenHash ?? null),
        retired,
        mergedInto: identity.mergedInto ?? null,
      };
      if (!retired && !identities[key]) identities[key] = normalizeCharacter(key, identity, key);
    }
  }

  return {
    ...base,
    ...saved,
    identities,
    accounts,
    climate,
    weather,
    start: saved.start ?? base.start,
    cycle: saved.cycle ?? base.cycle,
    engagements: Array.isArray(saved.engagements) ? saved.engagements : [],
    channels: base.channels,
    levels: base.levels,
    quests: base.quests,
    guilds: Object.fromEntries(Object.entries(saved.guilds ?? {}).map(([id, guild]) => [id, {
      ...guild,
      vault: Array.isArray(guild.vault) ? [...guild.vault] : [],
    }])),
    duels: [],
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
    if (isGuildVaultHolder(object.holder)) continue;
    // A restart drops the actor; the object falls where they stood, or goes
    // home if even that record is gone. Nothing is restored to a hand.
    object.room = roomOf.has(object.holder) ? roomOf.get(object.holder) : (object.heldRoom ?? state.start);
    object.holder = null;
    object.inside = null;
    object.heldRoom = null;
    object.worn = false;
  }
  return state;
}

/**
 * Before a checkpoint, write every online actor's progression into their
 * identity and record the last checkpointed room for held objects.
 */
export function checkpointIdentities(state) {
  for (const actor of state.actors ?? []) {
    if (!actor.key) continue;
    const identity = state.identities[actor.key] ?? {};
    const { inventory, worn, room, visited, ...rest } = identity;
    for (const object of state.objects) {
      if (object.holder === actor.id) object.heldRoom = actor.room;
    }
    state.identities[actor.key] = {
      ...rest,
      kind: "character",
      owner: rest.owner ?? actor.account ?? actor.key,
      name: actor.name,
      role: actor.role ?? 0,
      level: actor.level ?? 1,
      xp: actor.xp ?? 0,
      guild: actor.guild ?? null,
      guildRank: actor.guildRank ?? null,
      quests: actor.quests ?? { active: [], completed: [] },
      ignored: [...(actor.ignored ?? [])],
      title: actor.title ?? null,
      memory: { facts: { ...(actor.memory?.facts ?? {}) } },
      spellbook: [...(actor.spellbook ?? [])],
      maxMana: actor.maxMana ?? maxManaFor(actor),
      questCycles: { ...(actor.questCycles ?? {}) },
    };
  }
  return state;
}

/** A disbanded guild leaves its vault goods in the shared hall. */
function releaseGuildVault(state, guild) {
  for (const id of guild.vault ?? []) {
    const object = state.objects.find((entry) => entry.id === id);
    if (!object || object.holder !== guildVaultHolder(guild.id)) continue;
    object.holder = null;
    object.room = GUILD_HALL;
    object.inside = null;
    object.heldRoom = null;
    object.worn = false;
  }
  guild.vault = [];
}

export function step({ state, rooms, intents, actions = [] }) {
  const events = [];
  const next = {
    tick: state.tick + 1,
    cycle: state.cycle ?? 0,
    start: state.start ?? 1,
    climate: state.climate,
    weather: state.weather,
    channels: state.channels ?? [],
    levels: state.levels,
    quests: state.quests ?? [],
    guilds: Object.fromEntries(Object.entries(state.guilds ?? {}).map(([id, guild]) => [id, {
      ...guild,
      members: { ...(guild.members ?? {}) },
      invites: [...(guild.invites ?? [])],
    }])),
    duels: (state.duels ?? []).map((duel) => ({ ...duel })),
    mail: (state.mail ?? []).map((letter) => ({ ...letter })),
    engagements: (state.engagements ?? []).map((e) => ({ ...e })),
    npcs: state.npcs.map((n) => ({ ...n, clock: { ...n.clock }, effects: (n.effects ?? []).map((effect) => ({ ...effect })) })),
    actors: state.actors.map((a) => ({
      ...a,
      visited: [...a.visited],
      effects: (a.effects ?? []).map((effect) => ({ ...effect })),
      memory: { facts: { ...(a.memory?.facts ?? {}) } },
      quests: normalizeQuestState(a.quests, state.quests ?? []),
    })),
    objects: state.objects.map((o) => ({ ...o })),
    identities: { ...state.identities },
    accounts: Object.fromEntries(Object.entries(state.accounts ?? {}).map(([key, account]) => [key, { ...account, characters: [...(account.characters ?? [])] }])),
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
    if (intent.kind === "action") {
      const actor = find(intent.actorId);
      const action = actions.find((entry) => entry.id === intent.actionId);
      if (!actor || !action) continue;
      if (actor.room !== action.room) continue;
      if (action.requires?.spell && !(actor.spellbook ?? []).includes(action.requires.spell)) continue;
      if (action.requires?.item && !next.objects.some((object) => object.id === action.requires.item && object.holder === actor.id && !object.eaten)) continue;
      for (const effect of action.effects ?? []) {
        if (effect.kind === "revealExit") {
          const found = new Set(actor.found ?? []);
          found.add(`${action.room}:${effect.dir}`);
          actor.found = [...found];
        } else if (effect.kind === "open" || effect.kind === "close") {
          const object = next.objects.find((entry) => entry.id === effect.object);
          if (object) object.open = effect.kind === "open";
        } else if (effect.kind === "grantItem") {
          const object = next.objects.find((entry) => entry.id === effect.object);
          if (object) {
            object.holder = actor.id;
            object.room = null;
            object.inside = null;
            object.worn = false;
          }
        } else if (effect.kind === "teleport") {
          actor.room = effect.room;
          actor.visited = [...new Set([...(actor.visited ?? []), effect.room])];
        } else if (effect.kind === "damage") {
          actor.hp = Math.max(0, (actor.hp ?? 0) - effect.amount);
        } else if (effect.kind === "heal") {
          actor.hp = Math.min(actor.maxHp, (actor.hp ?? 0) + effect.amount);
        } else if (effect.kind === "message") {
          events.push({ onlyId: actor.id, text: `${effect.text}\r\n` });
        }
      }
      if (intent.messages?.others) events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      if (intent.messages?.actor) events.push({ onlyId: actor.id, text: `${intent.messages.actor}\r\n` });
      continue;
    }

    if (intent.kind === "join") {
      if (!find(intent.actorId)) {
        next.actors.push({
          id: intent.actorId,
          name: intent.name,
          room: next.start,
          visited: [next.start],
          key: null,
          account: null,
          role: 0,
          hp: 10,
          maxHp: 10,
          level: 1,
          xp: 0,
          guild: null,
          guildRank: null,
          quests: { active: [], completed: [] },
          wielding: null,
          mana: 5, maxMana: 5, spellbook: [], armorBonus: 0, buffUntil: null, questCycles: {},
        });
      }
      continue;
    }

    if (intent.kind === "ownAccount") {
      let account = next.accounts[intent.accountKey];
      if (!account) {
        account = {
          kind: "prism", name: intent.accountKey, characters: [], claimedFrom: null,
          passwordHash: null, salt: null, tokenHash: null,
          retired: false, mergedInto: null,
        };
        next.accounts[intent.accountKey] = account;
      }
      if (account.kind !== "prism" || account.retired) continue;
      // A persona has one owner. A second human cannot adopt it.
      if (account.owner && account.owner !== intent.owner) continue;
      account.owner = intent.owner;
      account.ai = true;
      account.ownerDevice = intent.device ?? null;
      account.ownerAudience = intent.audience ?? null;
      continue;
    }

    if (intent.kind === "retireAccount") {
      const account = next.accounts[intent.accountKey];
      if (!account || account.kind !== "prism" || account.owner !== intent.owner) continue;
      account.retired = true;
      account.retiredAt = intent.at ?? next.tick;
      // Keep the characters as tombstones, but free their names so a new
      // persona can use them. The suffix is not a valid new character name.
      const suffix = `~${intent.accountKey.slice(-8)}`;
      const tombstones = [];
      for (const name of account.characters ?? []) {
        const character = next.identities[name];
        if (!character) continue;
        const tombstone = `${name}${suffix}`;
        next.identities[tombstone] = { ...character, name: tombstone, retired: true, retiredFrom: name };
        delete next.identities[name];
        tombstones.push(tombstone);
      }
      account.characters = tombstones;
      // A retired persona loses every delegation it held. The human keeps the
      // character and its progression; only the delegate is cleared.
      for (const [name, character] of Object.entries(next.identities)) {
        if (character.delegate !== intent.accountKey || character.owner === intent.accountKey) continue;
        const { delegate, delegatedAt, delegatedBy, ...rest } = character;
        next.identities[name] = { ...rest };
      }
      continue;
    }

    if (intent.kind === "register") {
      if (next.identities[intent.key]) continue;
      const actor = find(intent.actorId);
      if (!actor) continue;
      actor.key = intent.key;
      actor.account = intent.key;
      actor.name = intent.key;
      actor.room = next.start;
      actor.visited = [next.start];
      actor.role = 0;
      actor.level = 1;
      actor.xp = 0;
      actor.guild = null;
      actor.guildRank = null;
      actor.quests = { active: [], completed: [] };
      actor.maxHp = 10;
      actor.hp = 10;
      actor.wielding = null;
      actor.mana = 5;
      actor.maxMana = 5;
      actor.spellbook = [];
      actor.armorBonus = 0;
      actor.buffUntil = null;
      actor.questCycles = {};
      next.accounts[intent.key] = {
        kind: "legacy",
        name: intent.key,
        characters: [intent.key],
        passwordHash: intent.passwordHash,
        salt: intent.salt,
        tokenHash: null,
        retired: false,
        mergedInto: null,
        lastSeenTick: next.tick,
      };
      next.identities[intent.key] = {
        kind: "character",
        owner: intent.key,
        name: actor.name,
        role: 0,
        level: 1,
        xp: 0,
        guild: null,
        guildRank: null,
        quests: { active: [], completed: [] },
        spellbook: [], maxMana: 5, questCycles: {},
      };
      continue;
    }

    if (intent.kind === "password") {
      const actor = find(intent.actorId);
      const accountKey = actor?.account ?? actor?.key;
      if (!accountKey || !next.accounts[accountKey]) continue;
      // A Prism account has no password; only a legacy account can change one.
      if (next.accounts[accountKey].kind === "prism") continue;
      next.accounts[accountKey] = {
        ...next.accounts[accountKey],
        passwordHash: intent.passwordHash,
        salt: intent.salt,
      };
      events.push({ onlyId: actor.id, text: "Password changed.\r\n" });
      continue;
    }

    if (intent.kind === "questAccept" || intent.kind === "questAbandon") {
      const actor = find(intent.actorId);
      if (!actor?.key) continue;
      const quest = questById(next.quests, intent.questId);
      if (intent.kind === "questAccept") {
        if (!quest || (actor.level ?? 1) < quest.level) continue;
        const stateQ = normalizeQuestState(actor.quests, next.quests);
        if (!(quest.requires ?? []).every((id) => stateQ.completed.includes(id))) continue;
        const repeatable = quest.repeat === "reset" && (actor.questCycles?.[quest.id] ?? -1) < (next.cycle ?? 0);
        if ((stateQ.completed.includes(quest.id) && !repeatable) || stateQ.active.some((entry) => entry.id === quest.id)) continue;
        if (quest.scope === "guild") {
          const guild = next.guilds[actor.guild];
          const activeGuild = stateQ.active.filter((entry) => questById(next.quests, entry.id)?.scope === "guild").length;
          const limit = guild?.perks?.includes("guild-quest-2") ? 2 : 1;
          if (activeGuild >= limit) continue;
        }
        stateQ.completed = stateQ.completed.filter((id) => id !== quest.id);
        stateQ.active.push({ id: quest.id, progress: emptyProgress() });
        actor.quests = stateQ;
        events.push({ onlyId: actor.id, text: `Quest accepted: ${quest.name}.\r\n`, quest: { action: "accept", id: quest.id, name: quest.name } });
        advanceQuests(next, actor, { kind: "visit", room: actor.room }, events);
        advanceQuests(next, actor, { kind: "collect" }, events);
      } else {
        const stateQ = normalizeQuestState(actor.quests, next.quests);
        const remaining = stateQ.active.filter((entry) => entry.id !== intent.questId);
        if (remaining.length !== stateQ.active.length) {
          actor.quests = { ...stateQ, active: remaining };
          events.push({ onlyId: actor.id, text: `Quest abandoned: ${quest?.name ?? intent.questId}.\r\n`, quest: { action: "abandon", id: intent.questId, name: quest?.name ?? intent.questId } });
        }
      }
      continue;
    }

    if (intent.kind === "questAnswer") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      advanceQuests(next, actor, { kind: "answer", word: intent.word }, events);
      continue;
    }

    if (intent.kind === "deliver") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      const object = next.objects.find((o) => o.id === intent.objectId);
      const npc = next.npcs.find((n) => n.id === intent.npcId && n.room === actor.room && !n.dead);
      if (!object || object.holder !== actor.id || object.eaten || !npc) continue;
      object.eaten = true;
      object.holder = null;
      object.room = null;
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      advanceQuests(next, actor, { kind: "deliver", npc: npc.id, object: object.id }, events);
      continue;
    }

    if (intent.kind === "ignore" || intent.kind === "unignore") {
      const actor = find(intent.actorId);
      if (!actor?.key || typeof intent.targetKey !== "string" || intent.targetKey === actor.key) continue;
      const target = next.identities[intent.targetKey];
      if (!target) continue;
      const ignored = new Set(actor.ignored ?? []);
      if (intent.kind === "ignore") {
        ignored.add(intent.targetKey);
        actor.ignored = [...ignored];
        events.push({ onlyId: actor.id, text: intent.messages?.added ?? `You ignore ${target.name}.\r\n` });
      } else {
        ignored.delete(intent.targetKey);
        actor.ignored = [...ignored];
        events.push({ onlyId: actor.id, text: intent.messages?.removed ?? `You are no longer ignoring ${target.name}.\r\n` });
      }
      next.identities[actor.key] = { ...next.identities[actor.key], ignored: actor.ignored };
      continue;
    }

    if (intent.kind === "setTitle") {
      const actor = find(intent.actorId);
      if (!actor?.key) continue;
      actor.title = typeof intent.title === "string" && intent.title.trim() ? intent.title.trim() : null;
      next.identities[actor.key] = { ...next.identities[actor.key], title: actor.title };
      events.push({ onlyId: actor.id, text: actor.title ? `Title set: ${actor.title}.\r\n` : "Title cleared.\r\n" });
      continue;
    }

    if (intent.kind === "learnFact") {
      const actor = find(intent.actorId);
      if (!actor?.key || !intent.fact?.id) continue;
      actor.memory ??= { facts: {} };
      actor.memory.facts[intent.fact.id] = {
        id: intent.fact.id,
        word: intent.fact.word,
        text: intent.fact.text,
        source: intent.fact.npc,
        tick: next.tick,
      };
      next.identities[actor.key] = { ...next.identities[actor.key], memory: actor.memory };
      events.push({ onlyId: actor.id, text: `You will remember the word: ${intent.fact.word.toUpperCase()}.\r\n` });
      advanceQuests(next, actor, { kind: "collect" }, events);
      continue;
    }

    if (intent.kind === "talk") {
      const actor = find(intent.actorId);
      const npc = next.npcs.find((entry) => entry.id === intent.npcId && entry.room === actor?.room && !entry.dead);
      if (!actor || !npc) continue;
      advanceQuests(next, actor, { kind: "talk", npc: npc.id }, events);
      continue;
    }

    if (intent.kind === "guildCreate") {
      const actor = find(intent.actorId);
      if (!actor?.key || actor.guild) continue;
      if (!validGuildName(intent.name) || !intent.guildId || next.guilds[intent.guildId]) continue;
      next.guilds[intent.guildId] = {
        id: intent.guildId,
        name: intent.name.trim(),
        founder: actor.key,
        created: next.tick,
        members: { [actor.key]: "leader" },
        invites: [],
      };
      actor.guild = intent.guildId;
      actor.guildRank = "leader";
      next.identities[actor.key] = { ...next.identities[actor.key], guild: actor.guild, guildRank: "leader" };
      events.push({ onlyId: actor.id, text: `Guild ${intent.name.trim()} founded.\r\n`, guild: { action: "create", id: intent.guildId, name: intent.name.trim() } });
      continue;
    }

    if (intent.kind === "guildDeposit" || intent.kind === "guildWithdraw") {
      const actor = find(intent.actorId);
      const guild = next.guilds[actor?.guild];
      if (!actor || !guild || actor.room !== GUILD_HALL) continue;
      const vault = Array.isArray(guild.vault) ? guild.vault : (guild.vault = []);
      if (intent.kind === "guildDeposit") {
        const object = next.objects.find((entry) => entry.id === intent.objectId);
        if (!object || object.holder !== actor.id || object.eaten) continue;
        if (vault.length >= GUILD_VAULT_CAPACITY) continue;
        if (actor.wielding === object.id) actor.wielding = null;
        object.holder = guildVaultHolder(guild.id);
        object.room = null;
        object.inside = null;
        object.heldRoom = null;
        object.worn = false;
        if (!vault.includes(object.id)) vault.push(object.id);
        events.push({ onlyId: actor.id, text: `You deposit ${object.name} in the guild vault.\r\n`, guild: { action: "deposit", id: guild.id, name: guild.name, object: object.id } });
        events.push({ room: actor.room, text: `${actor.name} stores something in the guild vault.`, exceptId: actor.id });
      } else {
        const object = next.objects.find((entry) => entry.id === intent.objectId && entry.holder === guildVaultHolder(guild.id));
        if (!object) continue;
        object.holder = actor.id;
        object.room = null;
        object.inside = null;
        object.heldRoom = actor.room;
        object.worn = false;
        guild.vault = vault.filter((id) => id !== object.id);
        events.push({ onlyId: actor.id, text: `You withdraw ${object.name} from the guild vault.\r\n`, guild: { action: "withdraw", id: guild.id, name: guild.name, object: object.id } });
        events.push({ room: actor.room, text: `${actor.name} takes something from the guild vault.`, exceptId: actor.id });
      }
      continue;
    }

    if (intent.kind === "guildJoin") {
      const actor = find(intent.actorId);
      if (!actor?.key || actor.guild) continue;
      const guild = next.guilds[intent.guildId];
      if (!guild) continue;
      const rank = guild.ranks?.[0] ?? "member";
      guild.members[actor.key] = rank;
      guild.invites = (guild.invites ?? []).filter((key) => key !== actor.key);
      actor.guild = guild.id;
      actor.guildRank = rank;
      actor.maxMana = maxManaFor(actor);
      next.identities[actor.key] = { ...next.identities[actor.key], guild: guild.id, guildRank: rank };
      events.push({ onlyId: actor.id, text: `You join ${guild.name}.\r\n`, guild: { action: "join", id: guild.id, name: guild.name } });
      for (const member of next.actors) {
        if (member.id === actor.id || member.guild !== guild.id) continue;
        events.push({ onlyId: member.id, text: `${actor.name} joins ${guild.name}.\r\n` });
      }
      continue;
    }

    if (intent.kind === "guildAdvance") {
      const actor = find(intent.actorId);
      const guild = next.guilds[intent.guildId];
      if (!actor?.key || !guild || guild.id !== "mages" || actor.guild !== guild.id) continue;
      const ranks = guild.ranks ?? ["apprentice", "adept", "magician", "archmage"];
      if (ranks.indexOf(intent.rank) !== ranks.indexOf(actor.guildRank) + 1) continue;
      actor.guildRank = intent.rank;
      guild.members[actor.key] = intent.rank;
      next.identities[actor.key] = { ...next.identities[actor.key], guildRank: intent.rank };
      events.push({ onlyId: actor.id, text: `The archmage names you ${intent.rank}.\r\n`, guild: { action: "advance", id: guild.id, name: guild.name } });
      continue;
    }

    if (intent.kind === "guildLeave") {
      const actor = find(intent.actorId);
      if (!actor?.key) continue;
      const guild = next.guilds[actor.guild];
      if (!guild) { actor.guild = null; actor.guildRank = null; continue; }
      const wasLeader = guild.members[actor.key] === "leader";
      removeMember(guild, actor.key);
      actor.guild = null;
      actor.guildRank = null;
      next.identities[actor.key] = { ...next.identities[actor.key], guild: null, guildRank: null };
      if (Object.keys(guild.members).length === 0) {
        releaseGuildVault(next, guild);
        delete next.guilds[guild.id];
        events.push({ onlyId: actor.id, text: `You leave ${guild.name}. It has no members left.\r\n`, guild: { action: "disband", id: guild.id, name: guild.name } });
      } else {
        events.push({ onlyId: actor.id, text: `You leave ${guild.name}.\r\n`, guild: { action: "leave", id: guild.id, name: guild.name } });
        if (wasLeader) {
          const heir = successor(guild.members, actor.key);
          if (heir) {
            guild.members[heir] = "leader";
            const online = next.actors.find((member) => member.key === heir);
            if (online) {
              online.guildRank = "leader";
              events.push({
                onlyId: online.id,
                text: `You are now the leader of ${guild.name}.\r\n`,
                guild: { action: "promote", id: guild.id, name: guild.name },
              });
            }
            next.identities[heir] = { ...next.identities[heir], guild: guild.id, guildRank: "leader" };
          }
        }
        for (const member of next.actors) {
          if (member.id === actor.id || member.guild !== guild.id) continue;
          events.push({ onlyId: member.id, text: `${actor.name} leaves ${guild.name}.\r\n` });
        }
      }
      continue;
    }

    if (intent.kind === "guildRank") {
      const actor = find(intent.actorId);
      const guild = next.guilds[actor?.guild];
      if (!guild || guild.members[actor.key] !== "leader") continue;
      const targetKey = intent.targetKey;
      const rank = intent.rank;
      if (!targetKey || targetKey === actor.key || !guild.members[targetKey] || !RANKS.includes(rank)) continue;
      if (rank === "leader") {
        guild.members[actor.key] = "officer";
        guild.members[targetKey] = "leader";
        actor.guildRank = "officer";
        next.identities[actor.key] = { ...next.identities[actor.key], guildRank: "officer" };
      } else {
        guild.members[targetKey] = rank;
      }
      const online = next.actors.find((member) => member.key === targetKey);
      if (online) online.guildRank = rank === "leader" ? "leader" : rank;
      next.identities[targetKey] = { ...next.identities[targetKey], guild: guild.id, guildRank: rank };
      events.push({ onlyId: actor.id, text: `${targetKey} is now ${rank} of ${guild.name}.\r\n`, guild: { action: "rank", id: guild.id, name: guild.name } });
      if (online) events.push({ onlyId: online.id, text: `You are now ${rank} of ${guild.name}.\r\n` });
      continue;
    }

    if (intent.kind === "guildDisband") {
      const actor = find(intent.actorId);
      const guild = next.guilds[actor?.guild];
      if (!guild || guild.members[actor.key] !== "leader") continue;
      const memberKeys = new Set(Object.keys(guild.members));
      for (const key of memberKeys) {
        if (next.identities[key]) next.identities[key] = { ...next.identities[key], guild: null, guildRank: null };
        const online = next.actors.find((member) => member.key === key);
        if (online) { online.guild = null; online.guildRank = null; }
      }
      releaseGuildVault(next, guild);
      delete next.guilds[guild.id];
      events.push({ onlyId: actor.id, text: `${guild.name} is disbanded.\r\n`, guild: { action: "disband", id: guild.id, name: guild.name } });
      for (const member of next.actors) {
        if (member.id !== actor.id && member.key && memberKeys.has(member.key)) events.push({ onlyId: member.id, text: `${guild.name} is disbanded.\r\n` });
      }
      continue;
    }

    if (intent.kind === "guildInvite") {
      const actor = find(intent.actorId);
      const guild = next.guilds[actor?.guild];
      if (!guild || !rankAtLeast(guild.members[actor.key] ?? "member", "officer")) continue;
      const targetKey = intent.targetKey;
      if (!targetKey || guild.members[targetKey]) continue;
      guild.invites = [...new Set([...(guild.invites ?? []), targetKey])];
      events.push({ onlyId: actor.id, text: `You invite ${intent.targetName ?? targetKey} to ${guild.name}.\r\n`, guild: { action: "invite", id: guild.id, name: guild.name } });
      const online = next.actors.find((member) => member.key === targetKey);
      if (online) events.push({ onlyId: online.id, text: `${actor.name} invites you to ${guild.name}.\r\n` });
      continue;
    }

    if (intent.kind === "guildChat") {
      const actor = find(intent.actorId);
      const guild = next.guilds[actor?.guild];
      if (!guild) continue;
      for (const member of next.actors) {
        if (member.guild !== guild.id) continue;
        if (member.id !== actor.id && (member.ignored ?? []).includes(actor.key)) continue;
        events.push({ onlyId: member.id, text: member.id === actor.id ? intent.messages.actor : intent.messages.others });
      }
      continue;
    }

    if (intent.kind === "duelChallenge") {
      const actor = find(intent.actorId);
      const target = next.actors.find((a) => a.id === intent.targetId);
      if (!actor || !target || target.id === actor.id) continue;
      if (!rooms[actor.room]?.arena || target.room !== actor.room) continue;
      if (next.duels.some((duel) => [duel.challengerId, duel.targetId].includes(actor.id) || [duel.challengerId, duel.targetId].includes(target.id))) continue;
      next.duels.push({ challengerId: actor.id, targetId: target.id, state: "pending", tick: next.tick });
      events.push({ room: actor.room, text: `${actor.name} challenges ${target.name} to a duel.`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You challenge ${target.name}. They must accept or decline.\r\n` });
      events.push({ onlyId: target.id, text: `${actor.name} challenges you. Type duel accept, or duel decline.\r\n` });
      continue;
    }

    if (intent.kind === "duelAccept" || intent.kind === "duelDecline") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      const duel = next.duels.find((entry) => entry.state === "pending" && entry.targetId === actor.id);
      if (!duel) continue;
      next.duels = next.duels.filter((entry) => entry !== duel);
      const challenger = next.actors.find((a) => a.id === duel.challengerId);
      if (!challenger || challenger.room !== actor.room || !rooms[actor.room]?.arena) continue;
      if (intent.kind === "duelDecline") {
        events.push({ room: actor.room, text: `${actor.name} declines ${challenger.name}'s challenge.`, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: `You decline ${challenger.name}'s challenge.\r\n` });
        events.push({ onlyId: challenger.id, text: `${actor.name} declines your challenge.\r\n` });
      } else {
        next.duels.push({ challengerId: challenger.id, targetId: actor.id, state: "active", tick: next.tick });
        next.engagements.push({ attackerId: challenger.id, targetId: actor.id });
        next.engagements.push({ attackerId: actor.id, targetId: challenger.id });
        events.push({ room: actor.room, text: `The duel between ${challenger.name} and ${actor.name} begins!`, duel: { action: "begin", a: challenger.id, b: actor.id } });
        events.push({ onlyId: challenger.id, text: "The Ring is yours. Fight.\r\n" });
        events.push({ onlyId: actor.id, text: "The Ring is yours. Fight.\r\n" });
      }
      continue;
    }

    if (intent.kind === "login") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      if (!intent.authenticated) continue;
      const accountKey = intent.account ?? intent.key;
      let account = next.accounts[accountKey];
      let known = next.identities[intent.key];
      // Direct reducer callers (the gate's older fixtures) may not have an
      // account yet. The server always passes one; create a legacy account
      // here so the reducer's own tests stay honest.
      if (!account && !intent.prism) {
        account = {
          kind: "legacy", name: accountKey, characters: [intent.key],
          passwordHash: null, salt: null, tokenHash: null,
          retired: false, mergedInto: null,
        };
        next.accounts[accountKey] = account;
      }
      if (known && !known.owner && accountKey === intent.key) {
        known = { ...known, kind: "character", owner: accountKey };
        next.identities[intent.key] = known;
        if (!account.characters.includes(intent.key)) {
          account.characters = [...account.characters, intent.key];
        }
      }
      if (!known && account && !intent.prism) {
        known = {
          kind: "character", owner: accountKey, name: intent.name ?? intent.key,
          role: intent.role ?? 0, level: 1, xp: 0, guild: null, guildRank: null,
          quests: { active: [], completed: [] },
        };
        next.identities[intent.key] = known;
      }
      if (!account || !known || account.retired) {
        events.push({ onlyId: actor.id, text: "That account is not available.\r\n" });
        continue;
      }
      account.lastSeenTick = next.tick;
      const owns = known.owner === accountKey;
      const delegated = known.delegate === accountKey && known.owner !== accountKey;
      if ((!owns && !delegated) || (owns && !account.characters.includes(intent.key))) {
        events.push({ onlyId: actor.id, text: "That character is not on this account.\r\n" });
        continue;
      }
      if (next.actors.some((other) => other.id !== actor.id && other.key === intent.key)) {
        events.push({ onlyId: actor.id, text: "That character is already signed in.\r\n" });
        continue;
      }

      actor.key = intent.key;
      actor.account = accountKey;
      actor.name = known.name ?? intent.key;
      // No position persistence: every login begins at the safe start.
      actor.room = next.start;
      actor.visited = [next.start];
      actor.role = known.role ?? 0;
      actor.level = known.level ?? 1;
      actor.xp = known.xp ?? 0;
      actor.maxHp = 10 + (actor.level - 1) * 2;
      actor.hp = actor.maxHp;
      actor.wielding = null;
      actor.maxMana = known.maxMana ?? maxManaFor(known);
      actor.mana = actor.maxMana;
      actor.spellbook = [...(known.spellbook ?? [])];
      actor.armorBonus = 0;
      actor.buffUntil = null;
      actor.questCycles = { ...(known.questCycles ?? {}) };
      actor.ignored = [...(known.ignored ?? [])];
      actor.title = known.title ?? null;
      actor.memory = { facts: { ...(known.memory?.facts ?? {}) } };
      actor.guild = next.guilds[known.guild] ? known.guild : null;
      actor.guildRank = actor.guild ? (next.guilds[actor.guild].members[actor.key] ?? null) : null;
      actor.quests = {
        active: [...(known.quests?.active ?? [])],
        completed: [...(known.quests?.completed ?? [])],
      };
      // Do not restore inventory: what the character carried was dropped
      // where they logged out and belongs to the world until the reset.
      next.identities[intent.key] = {
        ...known,
        kind: "character",
        owner: known.owner ?? accountKey,
        name: actor.name,
        role: actor.role,
        level: actor.level,
        xp: actor.xp,
        guild: actor.guild,
        guildRank: actor.guildRank,
        quests: actor.quests,
        ignored: actor.ignored,
        title: actor.title,
        memory: actor.memory,
      };
      advanceQuests(next, actor, { kind: "visit", room: actor.room }, events);
      for (const letter of next.mail) {
        if (letter.toKey !== actor.key || letter.read) continue;
        if ((actor.ignored ?? []).includes(letter.fromKey)) { letter.read = true; continue; }
        letter.read = true;
        events.push({ onlyId: actor.id, text: `A letter from ${letter.from}, sent at tick ${letter.tick}: ${letter.text}` });
      }
      continue;
    }

    if (intent.kind === "createCharacter") {
      let account = next.accounts[intent.accountKey];
      if (!account) {
        account = {
          kind: "prism", name: intent.accountKey, characters: [], claimedFrom: null,
          passwordHash: null, salt: null, tokenHash: null,
          retired: false, mergedInto: null,
        };
        next.accounts[intent.accountKey] = account;
      }
      if (account.kind !== "prism") continue;
      if (next.identities[intent.name] || next.accounts[intent.name]) continue;
      if (account.characters.includes(intent.name)) continue;
      account.characters = [...account.characters, intent.name];
      next.identities[intent.name] = {
        kind: "character", owner: intent.accountKey, name: intent.name,
        role: 0, level: 1, xp: 0, guild: null, guildRank: null,
        quests: { active: [], completed: [] },
      };
      continue;
    }

    if (intent.kind === "handoffCharacter") {
      const character = next.identities[intent.characterKey];
      const account = next.accounts[intent.persona];
      if (!character || character.owner !== intent.owner || character.retired) continue;
      if (!account || account.kind !== "prism" || account.owner !== intent.owner || account.ai !== true || account.retired) continue;
      if (character.delegate && character.delegate !== intent.persona) continue;
      next.identities[intent.characterKey] = {
        ...character,
        delegate: intent.persona,
        delegatedAt: intent.at ?? next.tick,
        delegatedBy: intent.owner,
      };
      continue;
    }

    if (intent.kind === "revokeHandoff") {
      const character = next.identities[intent.characterKey];
      if (!character || character.owner !== intent.owner || character.delegate !== intent.persona) continue;
      const { delegate, delegatedAt, delegatedBy, ...rest } = character;
      next.identities[intent.characterKey] = { ...rest };
      continue;
    }

    // X1: one-time adoption of a legacy name by a Prism account. The old
    // character is not merged into another; it becomes another character on
    // the Prism account, keeping its own progression, guild and quests.
    if (intent.kind === "claimLegacy") {
      const actor = find(intent.actorId);
      if (!actor?.account) continue;
      const account = next.accounts[actor.account];
      const legacyAccount = next.accounts[intent.legacyKey];
      const character = next.identities[intent.legacyKey];
      if (!account || account.kind !== "prism" || account.claimedFrom) continue;
      if (!legacyAccount || legacyAccount.kind !== "legacy" || legacyAccount.retired) continue;
      if (!character || character.owner !== intent.legacyKey) continue;
      if (account.characters.includes(intent.legacyKey)) continue;
      if (next.actors.some((candidate) => candidate.id !== actor.id && candidate.key === intent.legacyKey)) continue;

      next.identities[intent.legacyKey] = { ...character, kind: "character", owner: actor.account };
      account.characters = [...account.characters, intent.legacyKey];
      account.claimedFrom = intent.legacyKey;
      legacyAccount.retired = true;
      legacyAccount.mergedInto = actor.account;
      legacyAccount.characters = [];
      legacyAccount.passwordHash = null;
      legacyAccount.salt = null;
      legacyAccount.tokenHash = null;
      events.push({ onlyId: actor.id, text: `${intent.legacyKey} is now on this account. Type play ${intent.legacyKey} to enter as them.\r\n` });
      continue;
    }

    // R4: an owner-authorized rebind for a legacy account with no credential.
    // A token gives the account an ordinary login without moving the
    // character. A Prism target moves the character and retires the legacy
    // account with a tombstone, exactly like `claimLegacy`, but without a
    // credential to prove. The policy is in runtime/rebind.mjs; this block
    // repeats the checks because the intent queue is the last gate.
    if (intent.kind === "rebindLegacy") {
      const legacyAccount = next.accounts[intent.legacyKey];
      const character = next.identities[intent.legacyKey];
      if (!legacyAccount || legacyAccount.kind !== "legacy") continue;
      if (legacyAccount.retired || legacyAccount.mergedInto) continue;
      if (legacyAccount.passwordHash || legacyAccount.tokenHash) continue;
      if (!character || character.owner !== intent.legacyKey || character.retired) continue;
      // A live actor still points at the old account. Refuse rather than
      // moving the record out from under a character in the world.
      if (next.actors.some((candidate) => candidate.key === intent.legacyKey)) continue;
      const at = intent.at ?? next.tick;

      if (intent.mode === "token") {
        if (typeof intent.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(intent.tokenHash)) continue;
        legacyAccount.tokenHash = intent.tokenHash;
        legacyAccount.rebound = { mode: "token", at, by: "owner" };
        continue;
      }

      if (intent.mode === "prism") {
        const target = next.accounts[intent.prism];
        if (!target || target.kind !== "prism" || target.retired) continue;
        if ((target.characters ?? []).includes(intent.legacyKey)) continue;
        next.identities[intent.legacyKey] = { ...character, kind: "character", owner: intent.prism };
        target.characters = [...(target.characters ?? []), intent.legacyKey];
        legacyAccount.retired = true;
        legacyAccount.mergedInto = intent.prism;
        legacyAccount.characters = [];
        legacyAccount.passwordHash = null;
        legacyAccount.salt = null;
        legacyAccount.tokenHash = null;
        legacyAccount.rebound = { mode: "prism", to: intent.prism, at, by: "owner" };
        continue;
      }
    }

    if (intent.kind === "leave") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      actor.wielding = null;
      if (next.duels.some((duel) => [duel.challengerId, duel.targetId].includes(actor.id))) {
        next.duels = next.duels.filter((duel) => ![duel.challengerId, duel.targetId].includes(actor.id));
        next.engagements = next.engagements.filter((e) => e.attackerId !== actor.id && e.targetId !== actor.id);
        events.push({ room: actor.room, text: `${actor.name} leaves the Ring. The duel ends.`, exceptId: actor.id });
      }
      // Items are mortal: they fall where the character stood and belong to
      // the world until the two-hour reset. Only progression is written down.
      for (const object of next.objects) {
        if (object.holder !== actor.id) continue;
        object.holder = null;
        object.room = actor.room;
        object.inside = null;
        object.heldRoom = null;
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
          guildRank: actor.guildRank ?? null,
          quests: actor.quests ?? { active: [], completed: [] },
        };
      }
      events.push({ room: actor.room, text: `${actor.name} vanishes.`, exceptId: actor.id });
      next.actors = next.actors.filter((a) => a.id !== intent.actorId);
      continue;
    }

    const actor = find(intent.actorId);
    if (!actor) continue;

    if (intent.kind === "search") {
      const actor = find(intent.actorId);
      if (!actor) continue;
      const found = new Set(actor.found ?? []);
      for (const dir of intent.dirs ?? []) found.add(`${intent.room}:${dir}`);
      actor.found = [...found];
      continue;
    }

    if (intent.kind === "move") {
      const room = rooms[actor.room];
      const found = (actor.found ?? []).includes(`${actor.room}:${intent.dir}`);
      const target = room?.exits?.[intent.dir] ?? (found ? room?.secretExits?.[intent.dir] : undefined);
      if (target !== intent.to) continue;
      const from = actor.room;
      if (next.duels.some((duel) => [duel.challengerId, duel.targetId].includes(actor.id))) {
        next.duels = next.duels.filter((duel) => ![duel.challengerId, duel.targetId].includes(actor.id));
        next.engagements = next.engagements.filter((e) => e.attackerId !== actor.id && e.targetId !== actor.id);
        events.push({ room: from, text: `${actor.name} leaves the Ring. The duel ends.`, exceptId: actor.id });
      }
      events.push({ room: from, text: `${actor.name} leaves ${intent.dir}.`, exceptId: actor.id });
      actor.room = intent.to;
      if (!actor.visited.includes(actor.room)) actor.visited.push(actor.room);
      events.push({ room: intent.to, text: `${actor.name} arrives.`, exceptId: actor.id });
      advanceQuests(next, actor, { kind: "visit", room: actor.room }, events);
      continue;
    }

    // Objects, as the old codebases had them: a thing has a place, or a holder,
    // never both, and moving it is the only operation that changes that.
    if (intent.kind === "attack") {
      if (rooms[actor.room]?.safe) continue;
      const target = next.npcs.find((n) => n.id === intent.targetId)
        ?? next.actors.find((a) => a.id === intent.targetId);
      if (!target || target.dead || target.room !== actor.room) continue;
      if (rooms[actor.room]?.arena) {
        const duel = next.duels.some((entry) => entry.state === "active" &&
          ((entry.challengerId === actor.id && entry.targetId === target.id) ||
           (entry.challengerId === target.id && entry.targetId === actor.id)));
        if (!duel) continue;
      }
      if (next.engagements.some((e) => e.attackerId === actor.id && e.targetId === target.id)) continue;
      next.engagements.push({ attackerId: actor.id, targetId: target.id });
      // A fight is two-way: the target engages the attacker on the same round.
      if (!next.engagements.some((e) => e.attackerId === target.id && e.targetId === actor.id)) {
        next.engagements.push({ attackerId: target.id, targetId: actor.id });
      }
      events.push({ room: actor.room, text: `${actor.name} attacks ${target.name}!`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You attack ${target.name}.` });
      continue;
    }

    if (intent.kind === "wield") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || object.holder !== actor.id || object.eaten) continue;
      if (!(object.flags ?? []).includes("weapon")) continue;
      if (object.twoHanded) {
        for (const other of next.objects) {
          if (other.holder === actor.id && other.worn && slotOf(other) === "offhand") other.worn = false;
        }
      }
      object.slot = "mainhand";
      actor.wielding = object.id;
      events.push({ room: actor.room, text: `${actor.name} wields ${object.name}.`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You wield ${object.name}.` });
      continue;
    }

    if (intent.kind === "unwield") {
      if (!actor.wielding) continue;
      actor.wielding = null;
      events.push({ room: actor.room, text: `${actor.name} lowers their weapon.`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: "You lower your weapon." });
      continue;
    }

    if (intent.kind === "train") {
      if (!actor?.key) continue;
      const spell = spellById(intent.spellId);
      if (!spell || actor.guild !== "mages" || (actor.level ?? 1) < spell.level) continue;
      const book = actor.spellbook ?? [];
      if (book.includes(spell.id)) continue;
      const cost = Number.isInteger(intent.cost) ? intent.cost : 0;
      const coins = (intent.coinIds ?? [])
        .map((coinId) => next.objects.find((object) => object.id === coinId))
        .filter((coin) => coin && coin.holder === actor.id && (coin.flags ?? []).includes("coin") && !coin.eaten);
      const paid = coins.reduce((sum, coin) => sum + coin.value, 0);
      if (paid < cost) continue;
      for (const coin of coins) {
        coin.holder = null;
        coin.room = actor.room;
      }
      actor.spellbook = [...book, spell.id];
      actor.maxMana = maxManaFor(actor);
      events.push({ onlyId: actor.id, text: `You learn ${spell.name}.\r\n` });
      continue;
    }

    if (intent.kind === "cast") {
      const spell = spellById(intent.spellId);
      if (!spell || !(actor.spellbook ?? []).includes(spell.id)) continue;
      const mana = actor.mana ?? maxManaFor(actor);
      if (mana < spell.mana) continue;
      const target = intent.targetId
        ? (next.npcs.find((npc) => npc.id === intent.targetId) ?? next.actors.find((entry) => entry.id === intent.targetId))
        : null;
      if (spell.target === "npc" && !target) continue;
      if (target && target.room !== actor.room) continue;
      actor.mana = mana - spell.mana;
      actor.maxMana = maxManaFor(actor);
      applySpell(next, actor, spell, target, events);
      continue;
    }

    if (intent.kind === "study" || intent.kind === "recite") {
      const object = next.objects.find((entry) => entry.id === intent.objectId);
      if (!object || object.holder !== actor.id || object.eaten) continue;
      const spell = spellById(object.spell ?? intent.spellId);
      if (!spell) continue;
      if (intent.kind === "study") {
        if (actor.guild !== "mages" || (actor.level ?? 1) < spell.level) continue;
        if ((actor.spellbook ?? []).includes(spell.id)) continue;
        actor.spellbook = [...(actor.spellbook ?? []), spell.id];
        actor.maxMana = maxManaFor(actor);
        object.eaten = true;
        object.holder = null;
        object.room = null;
        events.push({ onlyId: actor.id, text: `You study the scroll and learn ${spell.name}.\r\n` });
        continue;
      }
      const target = intent.targetId
        ? (next.npcs.find((npc) => npc.id === intent.targetId) ?? next.actors.find((entry) => entry.id === intent.targetId))
        : null;
      if (spell.target === "npc" && !target) continue;
      if (target && target.room !== actor.room) continue;
      object.eaten = true;
      object.holder = null;
      object.room = null;
      applySpell(next, actor, spell, target, events);
      events.push({ onlyId: actor.id, text: `The scroll crumbles as ${spell.name} takes hold.\r\n` });
      continue;
    }

    // Flee ends every engagement the actor is part of and takes one exit.
    if (intent.kind === "flee") {
      if (rooms[actor.room]?.exits?.[intent.dir] !== intent.to) continue;
      next.engagements = next.engagements.filter((e) => e.attackerId !== actor.id && e.targetId !== actor.id);
      const from = actor.room;
      events.push({ room: from, text: `${actor.name} flees ${intent.dir}.`, exceptId: actor.id });
      actor.room = intent.to;
      if (!actor.visited.includes(actor.room)) actor.visited.push(actor.room);
      events.push({ room: intent.to, text: `${actor.name} arrives.`, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: `You flee ${intent.dir}.` });
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
        object.heldRoom = actor.room;
        object.worn = false;
        events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: intent.messages.actor });
        continue;
      }

      if (object.holder !== actor.id) continue;

      if (intent.kind === "drop") {
        if (actor.wielding === object.id) actor.wielding = null;
        object.holder = null;
        object.room = actor.room;
        object.heldRoom = null;
        object.worn = false;
        events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
        events.push({ onlyId: actor.id, text: intent.messages.actor });
        continue;
      }

      const recipient = find(intent.toId);
      if (!recipient || recipient.room !== actor.room) continue;
      if (actor.wielding === object.id) actor.wielding = null;
      object.holder = recipient.id;
      object.heldRoom = recipient.room;
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
      if (actor.wielding === object.id) actor.wielding = null;
      object.inside = container.id;
      object.holder = null;
      object.room = null;
      object.heldRoom = null;
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
      object.heldRoom = actor.room;
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
      if (intent.kind === "wear") {
        const slot = slotOf(object);
        for (const other of next.objects) {
          if (other.id !== object.id && other.holder === actor.id && other.worn && slotOf(other) === slot) {
            other.worn = false;
          }
        }
        object.slot = slot;
        object.worn = true;
        if (slot === "mainhand") actor.wielding = object.id;
      } else {
        object.worn = false;
        if (actor.wielding === object.id) actor.wielding = null;
      }
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      continue;
    }

    if (intent.kind === "eat") {
      const object = next.objects.find((o) => o.id === intent.objectId);
      if (!object || object.holder !== actor.id || object.eaten) continue;
      if (!(object.flags ?? []).includes("food")) continue;
      object.bites = (object.bites ?? 1) - 1;
      const before = actor.hp;
      if (object.heal) actor.hp = Math.min(actor.maxHp ?? 10, actor.hp + object.heal);
      if (object.bites <= 0) {
        object.eaten = true;
        object.holder = null;
        object.room = null;
      }
      events.push({ room: actor.room, text: intent.messages.others, exceptId: actor.id });
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      if (actor.hp > before) events.push({ onlyId: actor.id, text: "You feel better.\r\n" });
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
      object.heldRoom = intent.room;
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
      events.push({ room: actor.room, text: intent.messages?.others ?? `${actor.name} says: ${intent.text}`, exceptId: actor.id, fromKey: actor.key });
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
        if (listener.id !== actor.id && (listener.ignored ?? []).includes(actor.key)) continue;
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
      if ((target.ignored ?? []).includes(actor.key)) {
        events.push({ onlyId: actor.id, text: "They are not listening.\r\n" });
        continue;
      }
      events.push({ onlyId: actor.id, text: intent.messages.actor });
      events.push({ onlyId: target.id, text: intent.messages.target });
      continue;
    }

    // Mail is a tell that waits. It is stored against the identity key, not the
    // actor, so a letter reaches someone who was not there when it was written.
    if (intent.kind === "mail") {
      if ((next.identities[intent.toKey]?.ignored ?? []).includes(actor.key)) {
        events.push({ onlyId: actor.id, text: "They are not accepting letters.\r\n" });
        continue;
      }
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
        if (listener.id !== actor.id && (listener.ignored ?? []).includes(actor.key)) continue;
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

  // Carrying something is a fact, not an event: after every intent, check the
  // collect objectives for actors who have active quests.
  for (const actor of next.actors) {
    if ((actor.quests?.active ?? []).length) advanceQuests(next, actor, { kind: "collect" }, events);
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

    // Aggression: a mobile whose clock comes round may begin a fight with
    // someone in its room. The victim is engaged back, so the fight is mutual.
    if (!npc.dead && (npc.aggression ?? 0) > 0 && !rooms[npc.room]?.safe) {
      const victim = next.actors.find((actor) => actor.room === npc.room);
      const engaged = next.engagements.some((e) =>
        (e.attackerId === npc.id && e.targetId === victim?.id) ||
        (e.attackerId === victim?.id && e.targetId === npc.id));
      if (victim && !engaged && nextFrom(next.tick * 17 + seedOf(npc.id), 100) < npc.aggression) {
        next.engagements.push({ attackerId: npc.id, targetId: victim.id });
        next.engagements.push({ attackerId: victim.id, targetId: npc.id });
        events.push({ room: npc.room, text: `${npc.name} attacks ${victim.name}!`, exceptId: victim.id });
        events.push({ onlyId: victim.id, text: `${npc.name} attacks you!\r\n` });
      }
    }

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

    // A wanderer stays in its zone; old MUD mobiles did not stroll into town.
    const exits = Object.entries(rooms[npc.room]?.exits ?? {})
      .filter(([, target]) => !npc.zone || !rooms[target]?.zone || rooms[target].zone === npc.zone)
      .map(([dir]) => dir);
    if (exits.length === 0) continue;
    const dir = exits[nextFrom(next.tick + npc.id.length, exits.length)];
    const to = rooms[npc.room].exits[dir];
    const from = npc.room;
    npc.room = to;
    events.push({ room: from, text: `${npc.name} scuttles ${dir}.`, source: npc.id });
    events.push({ room: to, text: `${npc.name} arrives.`, source: npc.id });
  }

  if (violenceDue) {
    const attackerOf = (engagement) => next.actors.find((a) => a.id === engagement.attackerId)
      ?? next.npcs.find((n) => n.id === engagement.attackerId);
    const targetOf = (engagement) => next.actors.find((a) => a.id === engagement.targetId)
      ?? next.npcs.find((n) => n.id === engagement.targetId);

    const contested = next.engagements.filter((engagement) => {
      const attacker = attackerOf(engagement);
      const target = targetOf(engagement);
      return attacker && target && !attacker.dead && target.room === attacker.room && rooms[attacker.room] && !rooms[attacker.room].safe && !target.dead && target.hp > 0;
    });
    next.engagements = contested;

    for (const engagement of contested) {
      const attacker = attackerOf(engagement);
      const target = targetOf(engagement);
      // A snapshot can contain the reciprocal of a fight that has just ended.
      if (!attacker || !target || attacker.dead || target.dead || target.hp <= 0) continue;
      const weapon = next.actors.includes(attacker) ? weaponOf(attacker, next.objects) : null;
      const weaponDamage = weapon?.damage ?? 0;
      const npcDamage = next.npcs.includes(attacker) ? (attacker.damage ?? 0) : null;
      const targetArmor = (next.actors.includes(target) ? armorOf(target, next.objects) : (target.armor ?? 0)) - statusArmorPenalty(target);
      const roll = attackRoll({ tick: next.tick, attackerId: attacker.id, weaponDamage, npcDamage, targetArmor });
      if (roll.hit) {
        target.hp -= roll.damage;
        const status = weapon?.status ?? attacker.status ?? null;
        if (status) addStatus(target, status);
      }
      const killed = roll.hit && target.hp <= 0;
      const detail = {
        attacker: attacker.id,
        target: target.id,
        weapon: weapon?.id ?? null,
        damage: roll.damage,
        hp: Math.max(0, target.hp),
        outcome: !roll.hit ? "miss" : killed ? "killed" : "hit",
        chance: roll.chance,
        room: attacker.room,
      };

      // One combat event per round: the room broadcast carries the record, the
      // actor's own line does not, or every hit is counted twice.
      if (roll.hit) {
        events.push({ room: attacker.room, text: `${attacker.name} strikes ${target.name} for ${roll.damage}.`, exceptId: attacker.id, combat: detail });
        events.push({ onlyId: attacker.id, text: `You strike ${target.name} for ${roll.damage}.` });
      } else {
        events.push({ room: attacker.room, text: `${attacker.name} misses ${target.name}.`, exceptId: attacker.id, combat: detail });
        events.push({ onlyId: attacker.id, text: `You miss ${target.name}.` });
      }

      if (killed) {
        if (next.npcs.includes(target)) {
          const deathRoom = target.room;
          target.dead = true;
          target.room = null;
          for (const lootId of target.loot ?? []) {
            const loot = next.objects.find((object) => object.id === lootId);
            if (!loot || loot.eaten || loot.holder !== null) continue;
            loot.room = deathRoom;
            loot.inside = null;
            loot.heldRoom = null;
            events.push({ room: deathRoom, text: `${loot.name} falls from ${target.name}.` });
          }
          events.push({ room: attacker.room, text: `${target.name} dies.` });
          if (next.actors.includes(attacker)) {
            awardXp(next, attacker, target.xp ?? Math.max(1, target.maxHp ?? 1), events);
            advanceQuests(next, attacker, { kind: "kill", npc: target.id }, events);
          }
        } else {
          // A dead character drops what they carry where they fell and wakes
          // at the start with their progress intact. The Ring is different:
          // a duel takes no goods.
          const deathRoom = target.room;
          if (!rooms[deathRoom]?.arena) {
            for (const object of next.objects) {
              if (object.holder !== target.id) continue;
              object.holder = null;
              object.room = deathRoom;
              object.inside = null;
              object.heldRoom = null;
              object.worn = false;
            }
            target.wielding = null;
          }
          target.hp = target.maxHp ?? 10;
          target.effects = [];
          target.room = next.start;
          if (!target.visited.includes(next.start)) target.visited.push(next.start);
          const inRing = rooms[deathRoom]?.arena === true;
          events.push({ onlyId: target.id, text: inRing ? "You fall. The Ring takes no goods.\r\n" : "You die, and wake at the start.\r\n" });
          events.push({ room: deathRoom, text: inRing ? `${target.name} falls in the Ring.` : `${target.name} is dead.`, exceptId: target.id });
          next.duels = next.duels.filter((duel) => ![duel.challengerId, duel.targetId].includes(target.id));
          if (next.actors.includes(attacker)) {
            awardXp(next, attacker, Math.max(1, (target.level ?? 1) * 10), events);
          }
        }
        next.engagements = next.engagements.filter((e) => e !== engagement && e.attackerId !== target.id && e.targetId !== target.id);
      }
    }
  }

  if (violenceDue) tickStatuses(next, events);

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
    next.duels = [];
    for (const actor of next.actors) { actor.wielding = null; actor.effects = []; }
    next.objects = next.objects.filter((object) => !object.ephemeral);
    const vaultContainers = new Set(next.objects.filter((object) => isGuildVaultHolder(object.holder)).map((object) => object.id));
    for (const object of next.objects) {
      if (isGuildVaultHolder(object.holder) || vaultContainers.has(object.inside)) continue;
      object.holder = null;
      object.room = object.home;
      object.inside = object.homeInside;
      object.heldRoom = null;
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

  for (const actor of next.actors) {
    if (actor.buffUntil && next.tick >= actor.buffUntil) {
      actor.buffUntil = null;
      actor.armorBonus = 0;
      events.push({ onlyId: actor.id, text: "Your ward fades.\r\n" });
    }
    if (actor.mana !== undefined && next.tick % 20 === 0) {
      actor.mana = Math.min(actor.maxMana ?? maxManaFor(actor), actor.mana + 1);
    }
  }

  return { state: next, events, checkpoint: next.tick % CHECKPOINT === 0 };
}
