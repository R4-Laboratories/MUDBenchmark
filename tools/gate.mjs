#!/usr/bin/env node
// The gate: compute the project's numbers, compare them to the ratchet, and
// fail if anything got worse.
//
// Two kinds of number:
//   debt   may fall, never rise. Rule implementations the runtime does itself
//          while a proof of the same rule sits unused in the model.
//   credit may rise, never fall. Model modules, proved theorems, acceptance
//          vectors.
//
// A gate that only counts code is theatre. This one counts the gap between what
// is proved and what is executed, which is the number that actually matters
// here: every item in `ruleDebt` is a place where a verified rule and a running
// rule can drift apart without anything noticing.
//
// Usage: node tools/gate.mjs [--json]

import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadWorld } from "../runtime/worlddata.mjs";
import { describe as renderRoom } from "../runtime/view.mjs";
import { loadVerbs } from "../runtime/verbs.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadSocials } from "../runtime/socials.mjs";
import { hashPassword, verifyPassword, validName, validPassword } from "../runtime/accounts.mjs";
import { allowCommand, DEFAULT_INTERVAL_MS } from "../runtime/allowance.mjs";
import { AREA_PERIOD, checkpointIdentities, initialState, nextFrom, phaseAt, releaseHeldObjects, step, upgradeState } from "../runtime/world.mjs";
import { join } from "node:path";

const root = process.cwd();
const ratchet = JSON.parse(readFileSync(join(root, "world/ratchet.json"), "utf8"));

const srcDir = join(root, "world/src");
const modules = readdirSync(srcDir).filter((f) => f.endsWith(".lex.tex"));
const sources = modules.map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");

const count = (text, pattern) => (text.match(pattern) ?? []).length;

const measured = {
  modelModules: modules.length,
  provedTheorems: count(sources, /theorem\{/g),
  acceptanceVectors: count(sources, /AcceptanceVector \{request/g),
  classicalChoiceAxioms: count(sources, /Classical\.choice/g),
  ruleDebt: ratchet.ruleDebt.length,
  unusedRules: ratchet.unusedRules.length,
};

const failures = [];

for (const [key, ceiling] of Object.entries(ratchet.mustNotGrow)) {
  if (measured[key] > ceiling) {
    failures.push(`${key} is ${measured[key]}, above its ceiling of ${ceiling} — debt may only fall`);
  }
}
for (const [key, floor] of Object.entries(ratchet.mustNotFall)) {
  if (measured[key] < floor) {
    failures.push(`${key} is ${measured[key]}, below its floor of ${floor} — credit may not be withdrawn silently`);
  }
}
for (const [key, exact] of Object.entries(ratchet.mustStayZero)) {
  if (measured[key] !== exact) {
    failures.push(`${key} is ${measured[key]}, expected ${exact}`);
  }
}

// The world must be walkable in every experiment arm.
const worldProblems = [];
for (const mode of ["single", "marked", "true", "corroborated"]) {
  for (const problem of loadWorld({ mode }).errors) worldProblems.push(`${mode}: ${problem}`);
}
if (worldProblems.length > 0) {
  failures.push(`world data is invalid: ${worldProblems[0]}`);
}

// The renderer must show a notice it is cleared for and hide one it is not.
// This is the check that was missing when the world-data migration silently
// dropped every notice while the gate stayed green.
const noticeRoom = { name: "X", text: "t", exits: {}, notices: [{ level: 3, text: "SECRET-NOTICE" }] };
const shown = renderRoom({ room: noticeRoom, role: 3, cleared: (role, level) => role >= level });
const hidden = renderRoom({ room: noticeRoom, role: 0, cleared: (role, level) => role >= level });
if (!shown.includes("SECRET-NOTICE")) failures.push("the room renderer drops a notice it was cleared for");
if (hidden.includes("SECRET-NOTICE")) failures.push("the room renderer shows a notice it was not cleared for");

// The verb table must resolve its own aliases and use only known codes.
const verbTable = loadVerbs();
if (verbTable.errors.length > 0) failures.push(`verbs are invalid: ${verbTable.errors[0]}`);

// Channels and socials must resolve, and none may shadow a verb or each other.
const channelTable = loadChannels();
const socialTable = loadSocials();
if (channelTable.errors.length > 0) failures.push(`channels are invalid: ${channelTable.errors[0]}`);
if (socialTable.errors.length > 0) failures.push(`socials are invalid: ${socialTable.errors[0]}`);
for (const alias of channelTable.byAlias.keys()) {
  if (verbTable.byAlias.has(alias)) failures.push(`channel alias "${alias}" shadows a verb`);
  if (socialTable.byAlias.has(alias)) failures.push(`channel alias "${alias}" shadows a social`);
}
for (const alias of socialTable.byAlias.keys()) {
  if (verbTable.byAlias.has(alias)) failures.push(`social alias "${alias}" shadows a verb`);
}

// Accounts are hashes, not words; the reducer only sees an authenticated
// identity, never a password.
let accounts = { ok: true, why: [] };
{
  const { salt, hash } = hashPassword("correct horse");
  if (!verifyPassword("correct horse", salt, hash)) { accounts.ok = false; accounts.why.push("a correct password was refused"); }
  if (verifyPassword("wrong horse", salt, hash)) { accounts.ok = false; accounts.why.push("a wrong password was accepted"); }
  if (!validName("alice-1") || validName("a b") || !validPassword("sixsix") || validPassword("short")) {
    accounts.ok = false;
    accounts.why.push("name or password validation is wrong");
  }

  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "agent" }]);
  run([{ kind: "register", actorId: "a", key: "alice", passwordHash: hash, salt }]);
  if (state.identities.alice?.passwordHash !== hash) { accounts.ok = false; accounts.why.push("register did not write the password hash"); }
  if (state.identities.alice?.room !== undefined || state.identities.alice?.inventory !== undefined) { accounts.ok = false; accounts.why.push("register wrote session state"); }
  run([{ kind: "join", actorId: "b", name: "agent" }]);
  run([{ kind: "login", actorId: "b", key: "alice", authenticated: true }]);
  if (state.actors.find((actor) => actor.id === "b")?.level !== 1) { accounts.ok = false; accounts.why.push("login did not set progression defaults"); }
  run([{ kind: "password", actorId: "a", passwordHash: "new-hash", salt: "new-salt" }]);
  if (state.identities.alice.passwordHash !== "new-hash") { accounts.ok = false; accounts.why.push("password change did not take"); }
  if (!accounts.ok) failures.push(`accounts are broken: ${accounts.why[0]}`);
}

// One accepted command per 250 ms, on every transport.
let allowance = { ok: true, why: [] };
{
  if (DEFAULT_INTERVAL_MS !== 250) { allowance.ok = false; allowance.why.push("the default interval is not 250 ms"); }
  if (!allowCommand(0, 1000)) { allowance.ok = false; allowance.why.push("the first command was refused"); }
  if (allowCommand(1000, 1100)) { allowance.ok = false; allowance.why.push("a command 100 ms later was accepted"); }
  if (allowCommand(1000, 1249)) { allowance.ok = false; allowance.why.push("a command 249 ms later was accepted"); }
  if (!allowCommand(1000, 1250)) { allowance.ok = false; allowance.why.push("a command 250 ms later was refused"); }
  if (!allowance.ok) failures.push(`the input allowance is broken: ${allowance.why[0]}`);
}

// A safe room refuses combat; an unsafe one begins it. The two-hour reset is
// the world's clock, not a heartbeat.
let safe = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  if (!world.rooms[1].safe || world.rooms[2].safe) { safe.ok = false; safe.why.push("the safe flags are wrong"); }
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 1, home: 1 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels);
  if (state.pulses.area.period !== AREA_PERIOD || AREA_PERIOD !== 28_800) { safe.ok = false; safe.why.push("the area reset is not two hours"); }
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  if (state.engagements.length !== 0) { safe.ok = false; safe.why.push("an attack began in a safe room"); }
  state.actors[0].room = 2;
  const guard = state.npcs.find((npc) => npc.id === "guard");
  guard.room = 2;
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  if (state.engagements.length !== 1) { safe.ok = false; safe.why.push("an attack in an unsafe room did not begin"); }
  if (!safe.ok) failures.push(`safe rooms are broken: ${safe.why[0]}`);
}

// Combat must actually resolve: an attack on a 12 hp guard kills it, round by
// round, and the damage reported sums to exactly its hit points. A duplicated
// span would double the sum, a missing round would fall short of it.
let combat = { rounds: 0, damage: 0, outcome: null, dead: false, afterDeath: 0, hpTraceOk: true };
// The generator must still produce variety when the world is old. Its multiply
// used to be done in doubles, whose low bits vanish after about tick 409,000 —
// every NPC then walked one way forever. A cheap assertion buys that back.
const oldSeed = 500000 * 31 + 4;
const oldDirs = new Set([0, 1, 2, 3].map((k) => nextFrom(oldSeed + k, 4)));
{
  const world = loadWorld({ mode: "single" });
  const guardHome = world.npcs.find((npc) => npc.id === "guard");
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 2, home: 2 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start);
  state = step({ state, rooms: world.rooms, intents: [{ kind: "join", actorId: "gate", name: "gate" }] }).state;
  state.actors[0].room = 2;
  state = step({ state, rooms: world.rooms, intents: [{ kind: "attack", actorId: "gate", targetId: "guard" }] }).state;

  for (let i = 0; i < 40; i += 1) {
    const { state: next, events } = step({ state, rooms: world.rooms, intents: [] });
    for (const event of events) {
      if (!event.combat) continue;
      // Hit points must fall by exactly the damage reported. A duplicated span
      // makes the trace jump; a missing round leaves it too high.
      combat.rounds += 1;
      combat.damage += event.combat.damage;
      combat.outcome = event.combat.outcome;
      if (combat.dead) combat.afterDeath += 1;
      if (event.combat.outcome === "killed") combat.dead = true;
      const expected = (combat.hpBefore ?? guardHome?.hp ?? 12) - event.combat.damage;
      if (event.combat.outcome === "killed" ? event.combat.hp !== 0 || expected > 0 : event.combat.hp !== expected) {
        combat.hpTraceOk = false;
      }
      combat.hpBefore = event.combat.hp;
    }
    state = next;
  }
  const guard = state.npcs.find((npc) => npc.id === "guard");
  combat.remainingHp = guard?.hp;
  combat.engagementsLeft = state.engagements.length;
  if (!guardHome) failures.push("the world has no guard to fight");
  if (oldDirs.size < 2) failures.push("the world's generator collapses at tick 500,000 — old worlds stop varying");
  if (!combat.hpTraceOk) failures.push("the combat hit-point trace does not fall by the damage each round — spans are missing or duplicated");
  if (combat.damage < (guardHome?.hp ?? 0)) failures.push(`combat dealt ${combat.damage} damage to a ${guardHome?.hp} hp guard — spans are missing`);
  if (combat.outcome !== "killed") failures.push(`40 ticks of combat never killed the guard (last outcome ${combat.outcome})`);
  if (!guard?.dead) failures.push("a guard that reached zero hit points is not dead");
  if (combat.afterDeath > 0) failures.push(`combat continued after death (${combat.afterDeath} extra rounds)`);
  if (combat.engagementsLeft !== 0) failures.push(`a finished engagement is still open (${combat.engagementsLeft})`);
}

// Item properties must actually change the world, and the area reset must put
// them back. Each step here is a state change a player can reach.
let items = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { items.ok = false; items.why.push(why); } };

  run([{ kind: "join", actorId: "gate", name: "gate" }]);
  state.actors[0].room = 2;

  run([{ kind: "open", actorId: "gate", objectId: "chest", messages: say("open") }]);
  run([{ kind: "takeFrom", actorId: "gate", objectId: "copper", containerId: "chest", messages: say("takeFrom") }]);
  check(object("copper").holder === "gate", "a coin could not be taken from an open chest");

  run([{ kind: "put", actorId: "gate", objectId: "copper", containerId: "chest", messages: say("put") }]);
  check(object("copper").inside === "chest", "a coin could not be put back in an open chest");

  run([{ kind: "close", actorId: "gate", objectId: "chest", messages: say("close") }]);
  run([{ kind: "takeFrom", actorId: "gate", objectId: "copper", containerId: "chest", messages: say("takeFrom") }]);
  check(object("copper").inside === "chest", "a closed chest gave up its contents");

  run([{ kind: "wear", actorId: "gate", objectId: "cloak", messages: say("wear") }]);
  check(!object("cloak").worn, "a cloak in another room could be worn from a distance");

  state.actors[0].room = 1;
  run([{ kind: "take", actorId: "gate", objectId: "cloak", messages: say("take") }]);
  run([{ kind: "wear", actorId: "gate", objectId: "cloak", messages: say("wear") }]);
  check(object("cloak").worn, "a carried cloak could not be worn");
  run([{ kind: "remove", actorId: "gate", objectId: "cloak", messages: say("remove") }]);
  check(!object("cloak").worn, "a worn cloak could not be removed");
  run([{ kind: "drop", actorId: "gate", objectId: "cloak", messages: say("drop") }]);

  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "gate", objectId: "bread", messages: say("take") }]);
  run([{ kind: "eat", actorId: "gate", objectId: "bread", messages: say("eat") }]);
  check(object("bread").bites === 1 && !object("bread").eaten, "one bite finished a two-bite loaf");
  run([{ kind: "eat", actorId: "gate", objectId: "bread", messages: say("eat") }]);
  check(object("bread").eaten, "a finished loaf is still in the world");

  // The old MUD reset: force the two-hour pulse and require everything home.
  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(!object("bread").eaten && object("bread").room === 5, "the area reset did not restore the eaten loaf");
  check(object("chest").inside === null && object("copper").inside === "chest", "the area reset did not return the coin to the chest");
  check(object("chest").open === false, "the area reset left the chest open");
  check(object("cloak").room === 1 && !object("cloak").worn, "the area reset did not return the cloak");
  if (!items.ok) failures.push(`item properties are broken: ${items.why[0]}`);
}

// Time and weather must move, and the night must change behaviour: a speaker
// sleeps when the world is dark and talks when it is light.
let climate = { ok: true, why: [], changes: 0, nightTalk: 0, dayTalk: 0 };
{
  const world = loadWorld({ mode: "single" });
  const hour = world.climate.dayLength / 24;
  const at = (h) => phaseAt(Math.round(h * hour), world.climate);
  if (at(0) !== "night" || at(9) !== "day" || at(18) !== "dusk") {
    climate.ok = false;
    climate.why.push(`phases are wrong: 00=${at(0)}, 09=${at(9)}, 18=${at(18)}`);
  }

  const speaker = { id: "gate-speaker", name: "a gate speaker", room: 1, home: 1, period: 1, jitter: 0, behaviour: "speaker", phrases: ["gate speaks"], hp: 1 };
  const npcs = world.npcs.filter((n) => n.id !== "bard").concat(speaker);
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate);

  for (let i = 0; i < world.climate.weatherPeriod + 2; i += 1) {
    const result = step({ state, rooms: world.rooms, intents: [] });
    state = result.state;
    for (const event of result.events) {
      if (event.weather) {
        climate.changes += 1;
        if (event.weather.from === event.weather.to) {
          climate.ok = false;
          climate.why.push("the weather changed to the state it was already in");
        }
      }
    }
  }
  if (climate.changes === 0) {
    climate.ok = false;
    climate.why.push("the weather never changed");
  }

  const countSpeaker = (from) => {
    let local = { ...state, tick: from, npcs: state.npcs.map((n) => ({ ...n, clock: { period: 1, remaining: 1 } })) };
    let spoken = 0;
    for (let i = 0; i < 6; i += 1) {
      const result = step({ state: local, rooms: world.rooms, intents: [] });
      local = result.state;
      spoken += result.events.filter((event) => event.source === speaker.id).length;
    }
    return spoken;
  };
  climate.nightTalk = countSpeaker(0);
  climate.dayTalk = countSpeaker(Math.round(12 * hour));
  if (climate.nightTalk !== 0) {
    climate.ok = false;
    climate.why.push("a speaker talked through the night");
  }
  if (climate.dayTalk === 0) {
    climate.ok = false;
    climate.why.push("a speaker stayed silent by day");
  }
  if (!climate.ok) failures.push(`climate is broken: ${climate.why[0]}`);
}

// A checkpoint written by an older release must still load. This is the exact
// failure a real deployment found: v0.4.0 crashed on a v0.3.0 save because the
// violence pulse did not exist when the save was written.
let resume = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const base = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const saved = JSON.parse(JSON.stringify(base));
  saved.tick = 12345;
  saved.identities = { old: { name: "old", room: 1, visited: [1], role: 0, tokenHash: null } };
  delete saved.pulses.violence;
  delete saved.climate;
  delete saved.weather;
  delete saved.engagements;
  delete saved.cycle;
  saved.objects = saved.objects.filter((o) => o.id !== "chest");
  saved.mail = [{ id: "mail-old", from: "alice", fromKey: "alice", toKey: "bob", text: "old letter", tick: 7, read: false }];
  const savedCoin = saved.objects.find((o) => o.id === "coin");
  savedCoin.flags = ["takeable"];
  const cloak = saved.objects.find((o) => o.id === "cloak");
  delete cloak.inside;
  delete cloak.worn;
  delete cloak.open;

  const upgraded = upgradeState(saved, base);
  if (upgraded.tick !== 12345) { resume.ok = false; resume.why.push("the tick was not preserved"); }
  if (!upgraded.pulses.violence) { resume.ok = false; resume.why.push("the violence pulse was not restored"); }
  if (upgraded.pulses.area.period !== AREA_PERIOD) { resume.ok = false; resume.why.push("the area pulse did not migrate to two hours"); }
  if (!upgraded.climate?.weather?.length) { resume.ok = false; resume.why.push("the climate was not restored"); }
  if (!upgraded.mail?.some((letter) => letter.id === "mail-old")) { resume.ok = false; resume.why.push("mail was lost on resume"); }
  if (!Array.isArray(upgraded.channels) || upgraded.channels.length === 0) { resume.ok = false; resume.why.push("channels were not restored"); }
  if (upgraded.identities.old?.level !== 1 || upgraded.identities.old?.xp !== 0 || upgraded.identities.old?.guild !== null) { resume.ok = false; resume.why.push("an old identity did not gain the progression fields"); }
  if ("inventory" in (upgraded.identities.old ?? {}) || "room" in (upgraded.identities.old ?? {})) { resume.ok = false; resume.why.push("an old identity kept session state"); }
  if (!Array.isArray(upgraded.engagements)) { resume.ok = false; resume.why.push("engagements were not restored"); }
  const chest = upgraded.objects.find((o) => o.id === "chest");
  if (!chest || chest.home === undefined) { resume.ok = false; resume.why.push("a newly added object is missing after resume"); }
  const restoredCoin = upgraded.objects.find((o) => o.id === "coin");
  if (!(restoredCoin.flags ?? []).includes("coin")) { resume.ok = false; resume.why.push("an object lost a flag the new model gave it"); }
  const restoredCloak = upgraded.objects.find((o) => o.id === "cloak");
  if (restoredCloak.worn !== false || restoredCloak.inside !== null) { resume.ok = false; resume.why.push("an old object kept an undefined property"); }

  const dropped = JSON.parse(JSON.stringify(upgraded));
  dropped.actors = [{ id: "lost", room: 3, name: "lost" }];
  const heldCoin = dropped.objects.find((o) => o.id === "coin");
  heldCoin.holder = "lost";
  heldCoin.room = null;
  const heldScroll = dropped.objects.find((o) => o.id === "scroll");
  heldScroll.holder = "lost";
  heldScroll.room = null;
  releaseHeldObjects(dropped, dropped.actors);
  if (heldCoin.holder !== null || heldCoin.room !== 3) { resume.ok = false; resume.why.push("a vanished player's coin was not released where they stood"); }
  if (heldScroll.holder !== null || heldScroll.room !== 3) { resume.ok = false; resume.why.push("a vanished player's scroll was not released where they stood"); }

  try {
    let state = upgraded;
    for (let i = 0; i < 10; i += 1) state = step({ state, rooms: world.rooms, intents: [] }).state;
  } catch (error) {
    resume.ok = false;
    resume.why.push(`stepping an upgraded save threw: ${error.message}`);
  }
  if (!resume.ok) failures.push(`resuming an old world is broken: ${resume.why[0]}`);
}

// A shop must sell only what it offers, take only what it is owed, and put the
// stock back when the area resets.
let shop = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { shop.ok = false; shop.why.push(why); } };
  const shopHere = world.shops.find((s) => s.room === 3);
  if (!shopHere) { shop.ok = false; shop.why.push("the world has no shop"); }

  run([{ kind: "join", actorId: "gate", name: "gate" }]);
  state.actors[0].room = 3;

  // Shoplifting: taking the lamp must not work.
  run([{ kind: "take", actorId: "gate", objectId: "lamp", messages: say("take") }]);
  check(object("lamp").room === 3 && object("lamp").forSale, "the lamp walked out of the shop for free");

  // Buying without money must not work.
  run([{ kind: "buy", actorId: "gate", objectId: "lamp", room: 3, coinIds: [], messages: say("buy") }]);
  check(object("lamp").forSale, "the shop sold a lamp to someone with no coins");

  // Find the silver coin and buy: 10 paid for an 8 coin lamp, no change.
  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "gate", objectId: "coin", messages: say("take") }]);
  check(object("coin").holder === "gate", "the silver coin could not be picked up");
  state.actors[0].room = 3;
  run([{ kind: "buy", actorId: "gate", objectId: "lamp", room: 3, coinIds: ["coin"], messages: say("buy") }]);
  check(object("lamp").holder === "gate" && !object("lamp").forSale, "the lamp was not bought");
  check(object("coin").room === 3, "the shop did not take the coins");

  // Selling: a 6-value cloak pays 3 copper, minted for the sale.
  state.actors[0].room = 1;
  run([{ kind: "take", actorId: "gate", objectId: "cloak", messages: say("take") }]);
  state.actors[0].room = 3;
  run([{ kind: "sell", actorId: "gate", objectId: "cloak", room: 3, messages: say("sell") }]);
  const minted = state.objects.filter((o) => o.ephemeral && o.holder === "gate");
  check(object("cloak").eaten, "a sold cloak is still in the world");
  check(minted.length === 3 && minted.every((c) => c.value === 1), `selling a 6-value cloak paid ${minted.length} coins`);

  // Reset: every object goes home, stock returns, sold things return, minted
  // coins are swept up.
  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(object("lamp").room === 3 && object("lamp").forSale, "the reset did not return the lamp to the shop");
  check(object("torch").room === 3 && object("torch").forSale, "the reset did not return the torch to the shelf");
  check(!object("cloak").eaten && object("cloak").room === 1, "the reset did not return the sold cloak");
  check(state.objects.every((o) => !o.ephemeral), "the reset left minted coins in the world");
  if (!shop.ok) failures.push(`the shop is broken: ${shop.why[0]}`);
}

// Communication must cross the right boundaries: a say stays in the room, a
// tell reaches one person, a channel reaches everyone, mail waits for an
// absent identity, and a social gives each listener exactly one line.
let comms = { ok: true, why: [], said: 0, told: 0, mailed: 0, gestured: 0 };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const check = (condition, why) => { if (!condition) { comms.ok = false; comms.why.push(why); } };
  const lines = (events) => events.filter((event) => event.onlyId !== undefined);

  run([
    { kind: "join", actorId: "a", name: "alice" },
    { kind: "join", actorId: "b", name: "bob" },
    { kind: "join", actorId: "c", name: "carol" },
  ]);
  run([
    { kind: "login", actorId: "a", key: "alice", token: null, role: 3 },
    { kind: "login", actorId: "b", key: "bob", token: null, role: 0 },
    { kind: "login", actorId: "c", key: "carol", token: null, role: 0 },
  ]);
  run([{ kind: "move", actorId: "b", dir: "north", to: 2 }]);

  comms.said = lines(run([{ kind: "say", actorId: "a", text: "hello", messages: { actor: "A", others: "O" } }])).length;
  check(comms.said === 1, "a say did not stay in its room");

  const gossip = lines(run([{ kind: "channel", actorId: "a", channelId: "gossip", messages: { actor: "CA", others: "CO" } }]));
  check(gossip.length === 3, `gossip reached ${gossip.length} of 3 awake actors`);
  const global = lines(run([{ kind: "channel", actorId: "a", channelId: "global", messages: { actor: "GA", others: "GO" } }]));
  check(global.length === 3, `global reached ${global.length} of 3 awake actors`);

  const wizard = lines(run([{ kind: "channel", actorId: "a", channelId: "wizards", messages: { actor: "WA", others: "WO" } }]));
  check(wizard.length === 3, "a role-3 actor could not use the wizards channel");
  const refused = lines(run([{ kind: "channel", actorId: "c", channelId: "wizards", messages: { actor: "WA", others: "WO" } }]));
  check(refused.length === 0, "a role-0 actor spoke on the wizards channel");

  const told = lines(run([{ kind: "tell", actorId: "a", targetId: "b", messages: { actor: "TA", target: "TB" } }]));
  comms.told = told.length;
  check(told.length === 2 && told.some((e) => e.text === "TB"), "a tell did not reach exactly its target");

  const mailed = lines(run([{ kind: "mail", actorId: "a", toKey: "bob", text: "first", messages: { actor: "MA", target: "MB" } }]));
  comms.mailed = mailed.length;
  check(mailed.length === 2, "mail to someone online did not reach them");
  check(state.mail.filter((l) => l.read).length === 1, "mail delivered online was not marked read");

  run([{ kind: "leave", actorId: "b" }]);
  const queued = lines(run([{ kind: "mail", actorId: "a", toKey: "bob", text: "second", messages: { actor: "MA", target: "MB" } }]));
  check(queued.length === 1, "mail to an absent identity was delivered to nobody or to the room");
  check(state.mail.some((l) => l.text === "second" && !l.read), "mail to an absent identity was not stored");

  run([{ kind: "join", actorId: "b2", name: "bob" }]);
  const delivered = lines(run([{ kind: "login", actorId: "b2", key: "bob", token: null }]));
  check(delivered.some((e) => e.text.includes("second")), "a letter did not arrive on login");

  run([{ kind: "move", actorId: "b2", dir: "north", to: 2 }]);
  run([{ kind: "move", actorId: "a", dir: "north", to: 2 }]);
  const wave = lines(run([{ kind: "social", actorId: "a", targetId: "b2", messages: {
    actor: "WA", others: "WO", target: "WT", targeted: "WYOU", targetOthers: "WTO", self: "WS", selfOthers: "WSO",
  } }]));
  comms.gestured = wave.length;
  check(wave.length === 2, `a targeted social produced ${wave.length} lines for two people`);
  check(wave.some((e) => e.text === "WYOU") && wave.some((e) => e.text === "WT"), "the target and the actor did not get different lines");

  const shrug = lines(run([{ kind: "social", actorId: "a", targetId: null, messages: {
    actor: "UA", others: "UO", target: "UT", targeted: "UYOU", targetOthers: "UTO", self: "US", selfOthers: "USO",
  } }]));
  check(shrug.length === 2 && shrug.some((e) => e.text === "UO"), "an untargeted social did not reach the room once");

  if (!comms.ok) failures.push(`communication is broken: ${comms.why[0]}`);
}

// A character must survive a logout and a restart with the same room, the same
// hands and the same things inside the bag. The area reset must not take them.
let persistence = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { persistence.ok = false; persistence.why.push(why); } };

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);
  state.actors[0].level = 3;
  state.actors[0].xp = 120;
  state.actors[0].guild = "wardens";
  state.actors[0].quests = { active: ["slate"], completed: ["first"] };
  run([{ kind: "take", actorId: "a", objectId: "satchel", messages: say("take") }]);
  run([{ kind: "take", actorId: "a", objectId: "cloak", messages: say("take") }]);
  run([{ kind: "put", actorId: "a", objectId: "cloak", containerId: "satchel", messages: say("put") }]);
  run([{ kind: "move", actorId: "a", dir: "north", to: 2 }]);
  run([{ kind: "take", actorId: "a", objectId: "scroll", messages: say("take") }]);
  run([{ kind: "leave", actorId: "a" }]);

  check(object("satchel").holder === null && object("satchel").room === 2, "a bag was not left where the character stood");
  check(object("scroll").holder === null && object("scroll").room === 2, "a carried scroll was not left where the character stood");
  check(object("cloak").inside === "satchel", "a bag lost what was inside it on logout");
  check(state.identities.alice.inventory === undefined, "the identity recorded an inventory it should not keep");
  check(state.identities.alice.level === 3 && state.identities.alice.xp === 120, "progression was not written on logout");
  check(state.identities.alice.guild === "wardens" && state.identities.alice.quests.completed.includes("first"), "guild or quest progress was lost on logout");

  run([{ kind: "join", actorId: "b", name: "alice" }]);
  run([{ kind: "login", actorId: "b", key: "alice", token: null, authenticated: true }]);
  const returning = state.actors.find((actor) => actor.id === "b");
  check(returning.room === 1, "the returning character did not wake at the start");
  check(returning.level === 3 && returning.xp === 120, "level or experience was not restored on login");
  check(returning.guild === "wardens" && returning.quests.completed.includes("first"), "guild or quest progress was not restored on login");
  check(state.objects.every((o) => o.holder !== "b"), "items were restored to a hand across logout");
  check(object("satchel").room === 2 && object("scroll").room === 2, "logout items did not stay in the world");

  run([{ kind: "join", actorId: "c", name: "alice" }]);
  const second = run([{ kind: "login", actorId: "c", key: "alice", token: null, authenticated: true }]);
  check(second.some((event) => /already signed in/.test(event.text)), "a second sign-in with the same name was allowed");

  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(object("satchel").room === 1 && object("cloak").room === 1, "the reset did not return the dropped bag and cloak home");
  check(object("scroll").room === 2, "the reset did not return the dropped scroll home");
  check(object("cloak").inside === null, "the reset left an item inside a bag");

  checkpointIdentities(state);
  check(state.identities.alice.level === 3 && state.identities.alice.quests.active.includes("slate"), "checkpoint lost progression");
  check(!("room" in state.identities.alice) && !("visited" in state.identities.alice), "checkpoint wrote session state");
  const restarted = JSON.parse(JSON.stringify(state));
  const savedActors = state.actors;
  restarted.actors = [];
  releaseHeldObjects(restarted, savedActors);
  const joined = step({ state: restarted, rooms: world.rooms, intents: [{ kind: "join", actorId: "d", name: "alice" }] });
  const result = step({ state: joined.state, rooms: world.rooms, intents: [{ kind: "login", actorId: "d", key: "alice", token: null, authenticated: true }] });
  state = result.state;
  const afterRestart = state.actors.find((actor) => actor.id === "d");
  check(afterRestart.room === 1, "a restart did not start the character at the start room");
  check(afterRestart.level === 3 && afterRestart.xp === 120, "a restart lost level or experience");
  check(afterRestart.guild === "wardens" && afterRestart.quests.active.includes("slate"), "a restart lost guild or quest progress");
  check(state.objects.every((o) => o.holder !== "d"), "a restart restored items to a hand");

  if (!persistence.ok) failures.push(`persistence is broken: ${persistence.why[0]}`);
}

// Generated code must match the model it claims to come from.
const drift = spawnSync(process.execPath, ["tools/mechanize.mjs", "--check"], { encoding: "utf8" });
const driftOk = drift.status === 0;
if (!driftOk) {
  failures.push(`mechanized code drifted from the model: ${(drift.stderr || drift.stdout || "").trim().split("\n")[0]}`);
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ measured, ratchet, failures }, null, 2)}\n`);
} else {
  console.log("metric                      value   bound");
  console.log("--------------------------  -----   -----");
  for (const [key, ceiling] of Object.entries(ratchet.mustNotGrow)) {
    console.log(`${key.padEnd(26)}  ${String(measured[key]).padStart(5)}   <= ${ceiling}`);
  }
  for (const [key, floor] of Object.entries(ratchet.mustNotFall)) {
    console.log(`${key.padEnd(26)}  ${String(measured[key]).padStart(5)}   >= ${floor}`);
  }
  for (const [key, exact] of Object.entries(ratchet.mustStayZero)) {
    console.log(`${key.padEnd(26)}  ${String(measured[key]).padStart(5)}   == ${exact}`);
  }
  console.log(`${"mechanizedDrift".padEnd(26)}  ${(driftOk ? "clean" : "DRIFT").padStart(5)}   == clean`);
  console.log(`${"worldArms".padEnd(26)}  ${(worldProblems.length === 0 ? "4 ok" : "BROKEN").padStart(5)}   == walkable`);
  console.log(`${"renderer".padEnd(26)}  ${(shown.includes("SECRET-NOTICE") && !hidden.includes("SECRET-NOTICE") ? "2 ok" : "BROKEN").padStart(5)}   == hides/shows`);
  console.log(`${"accounts".padEnd(26)}  ${(accounts.ok ? "hash, register" : "BROKEN").padStart(5)}   == names and passwords`);
  console.log(`${"allowance".padEnd(26)}  ${(allowance.ok ? "250 ms" : "BROKEN").padStart(5)}   == one command`);
  console.log(`${"safe".padEnd(26)}  ${(safe.ok ? "2 rooms" : "BROKEN").padStart(5)}   == no combat`);
  console.log(`${"combat".padEnd(26)}  ${(combat.outcome === "killed" ? `${combat.rounds} rounds` : "BROKEN").padStart(5)}   == kills`);
  console.log(`${"resume".padEnd(26)}  ${(resume.ok ? "1 save" : "BROKEN").padStart(5)}   == old checkpoint loads`);
  console.log(`${"climate".padEnd(26)}  ${(climate.ok ? `${climate.changes} changes` : "BROKEN").padStart(5)}   == day, night, weather`);
  console.log(`${"persistence".padEnd(26)}  ${(persistence.ok ? "progress, no hands" : "BROKEN").padStart(5)}   == survives logout/restart`);
  console.log(`${"commsTable".padEnd(26)}  ${(verbTable.errors.length + channelTable.errors.length + socialTable.errors.length === 0 ? `${channelTable.byAlias.size + socialTable.byAlias.size} keys` : "BROKEN").padStart(5)}   == resolves`);
  console.log(`${"comms".padEnd(26)}  ${(comms.ok ? `${comms.said}/${comms.told}/${comms.mailed}/${comms.gestured} ok` : "BROKEN").padStart(5)}   == say, tell, mail, social`);
  console.log(`${"shop".padEnd(26)}  ${(shop.ok ? "buy, sell, reset" : "BROKEN").padStart(5)}   == honest trade`);
  console.log(`${"items".padEnd(26)}  ${(items.ok ? "5 ok" : "BROKEN").padStart(5)}   == containers, wear, food, reset`);
  console.log(`${"generator@500k".padEnd(26)}  ${(oldDirs.size >= 2 ? `${oldDirs.size} dirs` : "BROKEN").padStart(5)}   == still varies`);
  console.log(`${"verbTable".padEnd(26)}  ${(verbTable.errors.length === 0 ? `${verbTable.byAlias.size} keys` : "BROKEN").padStart(5)}   == resolvable`);
  console.log("");
  if (failures.length === 0) {
    console.log("gate: passed");
  } else {
    console.log("gate: FAILED");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
}

process.exit(failures.length === 0 ? 0 : 1);
