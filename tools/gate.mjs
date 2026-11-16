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
import { describe as renderRoom, examine } from "../runtime/view.mjs";
import { loadVerbs } from "../runtime/verbs.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadSocials } from "../runtime/socials.mjs";
import { hashPassword, verifyPassword, validName, validPassword } from "../runtime/accounts.mjs";
import { allowCommand, DEFAULT_INTERVAL_MS } from "../runtime/allowance.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests, validateQuestReferences } from "../runtime/quests.mjs";
import { guildId, validGuildName } from "../runtime/guilds.mjs";
import { DEFAULT_TURNS, trimMessages } from "../runtime/memory.mjs";
import { buildLlms } from "../runtime/llms.mjs";
import { AREA_PERIOD, armorOf, attackRoll, checkpointIdentities, initialState, nextFrom, phaseAt, releaseHeldObjects, step, upgradeState } from "../runtime/world.mjs";
import { join } from "node:path";
import { buildCandidates } from "./candidate.mjs";
import { measureCandidates } from "./measure.mjs";

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

// Every kind the app facet can decide must be asked by a command. The ratchet
// says unusedRules is zero; this is what makes that statement checkable rather
// than prose. A call site is the whole claim: if the line goes, the rule is
// unreached again.
const serverSource = readFileSync(join(root, "runtime/server.mjs"), "utf8");
const askedKinds = new Set([...serverSource.matchAll(/admit\(\{\s*kind: (\d+)/g)].map((match) => Number(match[1])));
for (const kind of [0, 1, 2, 4, 6]) {
  if (!askedKinds.has(kind)) failures.push(`the model's kind ${kind} is not asked by any command`);
}

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

// The claims ledger must be well-formed and its generated page current.
const claimsCheck = spawnSync(process.execPath, ["tools/claims.mjs", "--check"], { encoding: "utf8" });
if (claimsCheck.status !== 0) failures.push(`claims are stale: ${(claimsCheck.stderr || "").trim().split("\n")[0]}`);

// The generated command reference must match the tables.
const commandsCheck = spawnSync(process.execPath, ["tools/commands.mjs", "--check"], { encoding: "utf8" });
if (commandsCheck.status !== 0) failures.push(`docs/COMMANDS.md is stale: ${(commandsCheck.stderr || "").trim().split("\n")[0]}`);

// The web shell must actually offer account and agent handoff controls.
const web = readFileSync("runtime/web/index.html", "utf8");
if (!/id="login"/.test(web) || !/id="register"/.test(web) || !/id="agent-panel"/.test(web)) {
  failures.push("the web shell lost its login or agent panel");
}

// The world is a map, not a pile of rooms: every room has a real description,
// a detail and an ambient line, and every exit has a way back.
let worldMap = { ok: true, why: [], rooms: 0 };
{
  const world = loadWorld({ mode: "single" });
  const opposite = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };
  worldMap.rooms = Object.keys(world.rooms).length;
  for (const [id, room] of Object.entries(world.rooms)) {
    if (typeof room.text !== "string" || room.text.length < 60) { worldMap.ok = false; worldMap.why.push(`room ${id} has no real description`); }
    if (Object.keys(room.details ?? {}).length === 0) { worldMap.ok = false; worldMap.why.push(`room ${id} has no details to examine`); }
    if (!Array.isArray(room.ambient) || room.ambient.length === 0) { worldMap.ok = false; worldMap.why.push(`room ${id} has no ambient line`); }
    for (const [direction, target] of Object.entries(room.exits ?? {})) {
      const back = opposite[direction];
      if (!back || world.rooms[target]?.exits?.[back] !== Number(id)) {
        worldMap.ok = false;
        worldMap.why.push(`exit ${id} ${direction} -> ${target} has no way back`);
      }
    }
  }
  if (!examine({ room: world.rooms[1], target: "plaque" })) { worldMap.ok = false; worldMap.why.push("the Atrium plaque cannot be examined"); }
  if (!examine({ room: world.rooms[1], target: "sword", objects: world.objects })) { worldMap.ok = false; worldMap.why.push("an object cannot be examined"); }
  if (!examine({ room: world.rooms[1], target: "bard", npcs: world.npcs })) { worldMap.ok = false; worldMap.why.push("a mobile cannot be examined"); }
  if (examine({ room: world.rooms[1], target: "nothing-at-all" })) { worldMap.ok = false; worldMap.why.push("a missing thing was examined"); }
  if (!worldMap.ok) failures.push(`the world map is broken: ${worldMap.why[0]}`);
}

// The verb table must resolve its own aliases and use only known codes.
const verbTable = loadVerbs();
if (verbTable.errors.length > 0) failures.push(`verbs are invalid: ${verbTable.errors[0]}`);

// Channels and socials must resolve, and none may shadow a verb or each other.
const channelTable = loadChannels();
const socialTable = loadSocials();
const questTable = loadQuests();

// The agent contract is generated from the same tables as the game: every verb,
// room, channel and social must appear.
let llms = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const text = buildLlms({
    world,
    verbs: verbTable.verbs,
    channels: channelTable,
    socials: socialTable,
    quests: questTable.quests,
    levels: [],
    origin: "play.r4labs.org",
  });
  for (const verb of Object.keys(verbTable.verbs)) {
    if (!text.includes("`" + verb + "`")) { llms.ok = false; llms.why.push(`/llms.txt omits verb ${verb}`); }
  }
  for (const room of Object.values(world.rooms)) {
    if (!text.includes(room.name)) { llms.ok = false; llms.why.push(`/llms.txt omits room ${room.name}`); }
  }
  for (const channel of channelTable.channels) {
    if (!text.includes("`" + channel.name + "`")) { llms.ok = false; llms.why.push(`/llms.txt omits channel ${channel.name}`); }
  }
  for (const social of Object.keys(socialTable.socials)) {
    if (!text.includes("`" + social + "`")) { llms.ok = false; llms.why.push(`/llms.txt omits social ${social}`); }
  }
  for (const quest of questTable.quests) {
    if (!text.includes(`| ${quest.id} |`)) { llms.ok = false; llms.why.push(`/llms.txt omits quest ${quest.id}`); }
  }
  if (!llms.ok) failures.push(`/llms.txt is stale: ${llms.why[0]}`);
}


if (channelTable.errors.length > 0) failures.push(`channels are invalid: ${channelTable.errors[0]}`);
if (socialTable.errors.length > 0) failures.push(`socials are invalid: ${socialTable.errors[0]}`);
if (questTable.errors.length > 0) failures.push(`quests are invalid: ${questTable.errors[0]}`);
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
  if (state.engagements.length !== 2) { safe.ok = false; safe.why.push("an attack in an unsafe room did not engage both sides"); }
  if (!safe.ok) failures.push(`safe rooms are broken: ${safe.why[0]}`);
}

// The model's context is a bounded window, not an ever-growing transcript.
let memory = { ok: true, why: [] };
{
  const messages = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 30; i += 1) messages.push({ role: i % 2 ? "assistant" : "user", content: String(i) });
  const trimmed = trimMessages(messages, 2);
  if (trimmed.length !== 5 || trimmed[0].content !== "sys") { memory.ok = false; memory.why.push("the system prompt or the last two turns were not kept"); }
  if (trimmed.at(-1).content !== "29") { memory.ok = false; memory.why.push("the newest turn was dropped"); }
  const noSystem = trimMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }], 1);
  if (noSystem.length !== 2 || noSystem.at(-1).content !== "c") { memory.ok = false; memory.why.push("a systemless window is wrong"); }
  if (DEFAULT_TURNS !== 12) { memory.ok = false; memory.why.push("the default window is not twelve turns"); }
  if (!memory.ok) failures.push(`the memory window is broken: ${memory.why[0]}`);
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
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 2, home: 2, damage: 0 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start);
  state = step({ state, rooms: world.rooms, intents: [{ kind: "join", actorId: "gate", name: "gate" }] }).state;
  state.actors[0].room = 2;
  state = step({ state, rooms: world.rooms, intents: [{ kind: "attack", actorId: "gate", targetId: "guard" }] }).state;

  for (let i = 0; i < 100; i += 1) {
    const { state: next, events } = step({ state, rooms: world.rooms, intents: [] });
    for (const event of events) {
      if (!event.combat || event.combat.target !== "guard") continue;
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
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
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
  state.guilds.wardens = { id: "wardens", name: "Wardens", founder: "alice", created: 0, members: { alice: "leader" }, invites: [] };
  state.actors[0].guild = "wardens";
  state.actors[0].guildRank = "leader";
  state.actors[0].quests = { active: [{ id: "word", progress: {} }], completed: ["scroll"] };
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
  check(state.identities.alice.guild === "wardens" && state.identities.alice.guildRank === "leader" && state.identities.alice.quests.completed.includes("scroll"), "guild or quest progress was lost on logout");

  run([{ kind: "join", actorId: "b", name: "alice" }]);
  run([{ kind: "login", actorId: "b", key: "alice", token: null, authenticated: true }]);
  const returning = state.actors.find((actor) => actor.id === "b");
  check(returning.room === 1, "the returning character did not wake at the start");
  check(returning.level === 3 && returning.xp === 120, "level or experience was not restored on login");
  check(returning.guild === "wardens" && returning.guildRank === "leader" && returning.quests.completed.includes("scroll"), "guild or quest progress was not restored on login");
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
  check(state.identities.alice.level === 3 && state.identities.alice.quests.active.some((q) => q.id === "word"), "checkpoint lost progression");
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
  check(afterRestart.guild === "wardens" && afterRestart.quests.active.some((q) => q.id === "word"), "a restart lost guild or quest progress");
  check(state.objects.every((o) => o.holder !== "d"), "a restart restored items to a hand");

  if (!persistence.ok) failures.push(`persistence is broken: ${persistence.why[0]}`);
}

// Weapons, armour, food, flight and levels must all change the world.
let combat2 = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const levelTable = loadLevels();
  if (levelTable.errors.length > 0) { combat2.ok = false; combat2.why.push(`levels are invalid: ${levelTable.errors[0]}`); }
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 2, home: 2, damage: 0 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels, levelTable.levels);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { combat2.ok = false; combat2.why.push(why); } };

  const bare = attackRoll({ tick: 10, attackerId: "x", weaponDamage: 0, targetArmor: 0 });
  const armed = attackRoll({ tick: 10, attackerId: "x", weaponDamage: 3, targetArmor: 0 });
  if (bare.hit) check(armed.damage === bare.damage + 3, "a weapon did not add its damage");
  let armourMatters = false;
  for (let tick = 0; tick < 1000 && !armourMatters; tick += 1) {
    const open = attackRoll({ tick, attackerId: "x", weaponDamage: 0, targetArmor: 0 });
    const closed = attackRoll({ tick, attackerId: "x", weaponDamage: 0, targetArmor: 100 });
    if (open.hit && open.chance > 5 && !closed.hit) armourMatters = true;
  }
  check(armourMatters, "armour did not reduce the chance to hit");

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);
  state.actors[0].room = 9;
  state.objects.find((o) => o.id === "sword").forSale = false;
  state.objects.find((o) => o.id === "jerkin").forSale = false;
  run([{ kind: "take", actorId: "a", objectId: "sword", messages: say("take") }]);
  run([{ kind: "take", actorId: "a", objectId: "jerkin", messages: say("take") }]);
  run([{ kind: "wield", actorId: "a", objectId: "sword", messages: say("wield") }]);
  run([{ kind: "wear", actorId: "a", objectId: "jerkin", messages: say("wear") }]);
  check(state.actors[0].wielding === "sword", "wielding did not take");
  check(armorOf(state.actors[0], state.objects) === 1, "worn armour was not counted");

  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "a", objectId: "bread", messages: say("take") }]);
  state.actors[0].hp = 5;
  run([{ kind: "eat", actorId: "a", objectId: "bread", messages: say("eat") }]);
  check(state.actors[0].hp === 7, `one bite healed to ${state.actors[0].hp} instead of 7`);
  run([{ kind: "eat", actorId: "a", objectId: "bread", messages: say("eat") }]);
  check(state.actors[0].hp === 9, `two bites healed to ${state.actors[0].hp} instead of 9`);

  state.actors[0].room = 2;
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  check(state.engagements.length === 2, "a PvE attack did not engage both sides");
  run([{ kind: "flee", actorId: "a", dir: "east", to: 4, messages: { actor: "FA", others: "FO" } }]);
  check(state.engagements.length === 0 && state.actors[0].room === 4, "flee did not end the fight and move");

  state.actors[0].room = 2;
  state.actors[0].xp = 95;
  const guard = state.npcs.find((npc) => npc.id === "guard");
  guard.hp = 1;
  guard.loot = ["boar-tusk"];
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  for (let i = 0; i < 120; i += 1) run([]);
  check(state.actors[0].level === 2 && state.actors[0].xp >= 107, `a kill did not grant experience and a level (level ${state.actors[0].level}, xp ${state.actors[0].xp})`);
  check(state.actors[0].maxHp === 12, "a level did not raise maximum hit points");
  const tusk = state.objects.find((object) => object.id === "boar-tusk");
  check(tusk.room === 2 && tusk.holder === null, "mob loot did not fall in the death room");

  // PvP: a second player in an unsafe room is a target; death wakes them at the
  // start and the killer gains experience.
  run([{ kind: "join", actorId: "b", name: "bob" }]);
  run([{ kind: "login", actorId: "b", key: "bob", token: null, authenticated: true }]);
  state.actors.find((actor) => actor.id === "b").room = 2;
  state.actors.find((actor) => actor.id === "b").hp = 1;
  const torch = state.objects.find((o) => o.id === "torch");
  torch.holder = "b";
  torch.room = null;
  torch.heldRoom = 2;
  const xpBefore = state.actors[0].xp;
  run([{ kind: "attack", actorId: "a", targetId: "b" }]);
  for (let i = 0; i < 80; i += 1) run([]);
  const deadBob = state.actors.find((actor) => actor.id === "b");
  const droppedTorch = state.objects.find((object) => object.id === "torch");
  check(deadBob.room === 1 && deadBob.hp === deadBob.maxHp, "a dead player did not wake at the start");
  check(droppedTorch.holder === null && droppedTorch.room === 2, "a dead player did not drop everything where they fell");
  check(state.engagements.length === 0, "a death left an engagement open");
  check(state.actors[0].xp > xpBefore, "a PvP kill did not grant experience");

  if (!combat2.ok) failures.push(`combat 2.0 is broken: ${combat2.why[0]}`);
}

// An aggressive mobile begins the fight on its own clock, and the victim is
// engaged back.
let aggression = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const npcs = world.npcs.map((npc) => (npc.id === "vault-guardian"
    ? { ...npc, room: 2, home: 2, period: 1, jitter: 0, aggression: 100 }
    : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "alice" }]);
  state.actors[0].room = 2;
  const events = [];
  for (let i = 0; i < 8; i += 1) events.push(...run([]));
  if (state.engagements.length !== 2) { aggression.ok = false; aggression.why.push("a guardian did not engage both sides"); }
  if (!events.some((event) => /attacks you/.test(event.text ?? ""))) { aggression.ok = false; aggression.why.push("the victim was not told"); }
  if (!aggression.ok) failures.push(`aggression is broken: ${aggression.why[0]}`);
}

// Quests advance from facts, complete once, and pay once.
let quests = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  for (const problem of validateQuestReferences(questTable.quests, { rooms: world.rooms, npcs: world.npcs, objects: world.objects })) {
    quests.ok = false;
    quests.why.push(problem);
  }
  const npcs = world.npcs.filter((npc) => npc.id !== "vault-guardian");
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { quests.ok = false; quests.why.push(why); } };
  const questState = () => state.actors[0].quests;

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);

  state.actors[0].level = 2;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(!questState().active.some((entry) => entry.id === "guardian"), "a quest whose prerequisite was unearned was accepted");
  state.actors[0].level = 1;

  run([{ kind: "questAccept", actorId: "a", questId: "scroll" }]);
  check(questState().active.some((entry) => entry.id === "scroll"), "a quest was not accepted");
  run([{ kind: "move", actorId: "a", dir: "north", to: 2 }]);
  run([{ kind: "take", actorId: "a", objectId: "scroll", messages: say("take") }]);
  check(questState().completed.includes("scroll"), "a collect quest did not complete when the item was held");
  check(questState().active.length === 0, "a completed quest stayed active");
  check(state.actors[0].xp >= 15, "a quest did not pay experience");
  run([{ kind: "questAccept", actorId: "a", questId: "scroll" }]);
  check(questState().active.length === 0, "a completed quest could be accepted again");

  run([{ kind: "questAccept", actorId: "a", questId: "word" }]);
  check(questState().active.some((entry) => entry.id === "word"), "the word quest was not accepted");
  run([{ kind: "move", actorId: "a", dir: "east", to: 4 }]);
  run([{ kind: "questAnswer", actorId: "a", word: "amber" }]);
  check(questState().completed.includes("word"), "the answer objective did not complete the word quest");
  check(state.actors[0].xp >= 65, "the word quest reward was not paid");

  state.actors[0].level = 1;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(!questState().active.some((entry) => entry.id === "guardian"), "a level-locked quest was accepted");
  state.actors[0].level = 2;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(questState().active.some((entry) => entry.id === "guardian"), "a level-2 quest was refused to a level-2 actor");

  run([{ kind: "questAccept", actorId: "a", questId: "bread" }]);
  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "a", objectId: "bread", messages: say("take") }]);
  state.actors[0].room = 3;
  run([{ kind: "deliver", actorId: "a", objectId: "bread", npcId: "shopkeeper", messages: say("deliver") }]);
  check(questState().completed.includes("bread"), "a deliver quest did not complete");
  check(object("bread").eaten, "a delivered object was not consumed");

  state.npcs.push({ id: "vault-guardian", name: "a vault guardian", room: 4, home: 4, period: 1, jitter: 0, behaviour: "sentinel", hp: 1, maxHp: 8, damage: 0, armor: 0, aggression: 0, xp: 8 });
  state.actors[0].room = 4;
  run([{ kind: "attack", actorId: "a", targetId: "vault-guardian" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  check(questState().completed.includes("guardian"), "a kill quest did not complete");
  const xpAfterQuests = state.actors[0].xp;
  check(xpAfterQuests >= 155, `quest rewards totalled ${xpAfterQuests} instead of at least 155`);

  if (!quests.ok) failures.push(`quests are broken: ${quests.why[0]}`);
}

// Guilds: one name, a roster, ranks, a chat that reaches only members, and a
// membership that survives a restart.
let guilds = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { guilds.ok = false; guilds.why.push(why); } };
  const actor = (id) => state.actors.find((a) => a.id === id);
  const lines = (events) => events.filter((event) => event.onlyId !== undefined);

  if (validGuildName("x") || !validGuildName("Iron Wardens") || guildId("Iron Wardens") !== "iron-wardens") {
    guilds.ok = false;
    guilds.why.push("guild names or ids are wrong");
  }

  run([{ kind: "join", actorId: "a", name: "alice" }, { kind: "join", actorId: "b", name: "bob" }, { kind: "join", actorId: "c", name: "carol" }]);
  run([{ kind: "login", actorId: "a", key: "alice", authenticated: true }, { kind: "login", actorId: "b", key: "bob", authenticated: true }, { kind: "login", actorId: "c", key: "carol", authenticated: true }]);

  run([{ kind: "guildCreate", actorId: "a", name: "Iron Wardens", guildId: "iron-wardens" }]);
  check(state.guilds["iron-wardens"]?.members.alice === "leader", "a guild was not founded with its leader");
  check(actor("a").guild === "iron-wardens" && actor("a").guildRank === "leader", "the founder did not join the guild");
  check(state.identities.alice.guild === "iron-wardens" && state.identities.alice.guildRank === "leader", "the founder's identity did not join");

  run([{ kind: "guildCreate", actorId: "b", name: "Iron Wardens", guildId: "iron-wardens" }]);
  check(Object.keys(state.guilds).length === 1, "a duplicate guild was created");

  run([{ kind: "guildJoin", actorId: "b", guildId: "iron-wardens" }]);
  check(state.guilds["iron-wardens"].members.bob === "member" && actor("b").guildRank === "member", "a member did not join");

  const chat = lines(run([{ kind: "guildChat", actorId: "a", messages: { actor: "GA", others: "GO" } }]));
  check(chat.length === 2 && chat.some((event) => event.text === "GO"), "guild chat did not reach exactly the members");

  run([{ kind: "guildRank", actorId: "a", targetKey: "bob", rank: "officer" }]);
  check(state.guilds["iron-wardens"].members.bob === "officer" && actor("b").guildRank === "officer", "a rank was not set");

  const invited = lines(run([{ kind: "guildInvite", actorId: "a", targetKey: "carol", targetName: "carol" }]));
  check(invited.some((event) => /invites you/.test(event.text ?? "")), "an invitation was not delivered");
  run([{ kind: "guildJoin", actorId: "c", guildId: "iron-wardens" }]);
  check(Object.keys(state.guilds["iron-wardens"].members).length === 3, "the invited member did not join");

  run([{ kind: "guildLeave", actorId: "a" }]);
  check(actor("a").guild === null && state.identities.alice.guild === null, "a member did not leave");
  check(state.guilds["iron-wardens"].members.bob === "leader" && actor("b").guildRank === "leader", "the next leader was not promoted");

  checkpointIdentities(state);
  const restarted = JSON.parse(JSON.stringify(state));
  const savedActors = state.actors;
  restarted.actors = [];
  releaseHeldObjects(restarted, savedActors);
  const joined = step({ state: restarted, rooms: world.rooms, intents: [{ kind: "join", actorId: "d", name: "bob" }] });
  const result = step({ state: joined.state, rooms: world.rooms, intents: [{ kind: "login", actorId: "d", key: "bob", authenticated: true }] });
  state = result.state;
  check(actor("d")?.guild === "iron-wardens" && actor("d")?.guildRank === "leader", "a restart lost guild membership or rank");
  check(state.guilds["iron-wardens"]?.members.bob === "leader", "a restart lost the guild roster");

  run([{ kind: "guildDisband", actorId: "d" }]);
  check(!state.guilds["iron-wardens"], "the guild was not disbanded");
  check(actor("d").guild === null, "disbanding did not clear the online member");
  check(state.identities.carol.guild === null, "disbanding did not clear an offline member's identity");

  if (!guilds.ok) failures.push(`guilds are broken: ${guilds.why[0]}`);
}

// Duels are consensual in the Ring, and death there takes no goods.
let duels = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { duels.ok = false; duels.why.push(why); } };
  run([{ kind: "join", actorId: "a", name: "alice" }, { kind: "join", actorId: "b", name: "bob" }, { kind: "join", actorId: "c", name: "carol" }]);
  run([{ kind: "login", actorId: "a", key: "alice", authenticated: true }, { kind: "login", actorId: "b", key: "bob", authenticated: true }, { kind: "login", actorId: "c", key: "carol", authenticated: true }]);
  state.actors.forEach((actor) => { actor.room = 33; });

  run([{ kind: "duelChallenge", actorId: "a", targetId: "b" }]);
  check(state.duels.some((duel) => duel.state === "pending"), "a challenge did not become pending");
  run([{ kind: "duelAccept", actorId: "b" }]);
  check(state.duels.some((duel) => duel.state === "active"), "a challenge was not accepted");
  check(state.engagements.length === 2, "an accepted duel did not engage both sides");

  const torch = state.objects.find((object) => object.id === "torch");
  state.objects.find((object) => object.id === "torch").holder = "b";
  state.objects.find((object) => object.id === "torch").room = null;
  state.objects.find((object) => object.id === "torch").heldRoom = 33;
  state.actors.find((actor) => actor.id === "b").hp = 1;
  run([{ kind: "attack", actorId: "a", targetId: "b" }]);
  for (let i = 0; i < 120; i += 1) run([]);
  const fallen = state.actors.find((actor) => actor.id === "b");
  const kept = state.objects.find((object) => object.id === "torch");
  check(fallen.room === 1, "a defeated duellist did not wake at the start");
  check(kept.holder === "b", "the Ring took the defeated duellist's goods");

  state.actors.forEach((actor) => { actor.room = 33; });
  const before = state.engagements.length;
  run([{ kind: "attack", actorId: "a", targetId: "c" }]);
  check(state.engagements.length === before, "an arena attack began without a duel");

  run([{ kind: "duelChallenge", actorId: "a", targetId: "c" }]);
  run([{ kind: "duelDecline", actorId: "c" }]);
  check(!state.duels.some((duel) => duel.state === "pending" && duel.targetId === "c"), "a decline left the challenge pending");

  if (!duels.ok) failures.push(`duels are broken: ${duels.why[0]}`);
}

// Generated code must match the model it claims to come from.
const drift = spawnSync(process.execPath, ["tools/mechanize.mjs", "--check"], { encoding: "utf8" });
const driftOk = drift.status === 0;
if (!driftOk) {
  failures.push(`mechanized code drifted from the model: ${(drift.stderr || drift.stdout || "").trim().split("\n")[0]}`);
}

// The candidate loop: a finite, seeded inventory measured on hidden
// playthroughs. The gate proves the three properties the loop claims: the same
// seed gives the same inventory, a value outside a band is refused by name, and
// a winner is a candidate the measure actually admitted.
let loop = { ok: true, why: [], count: 0, admitted: 0, winner: null };
{
  const first = buildCandidates({ seed: "gate" });
  const second = buildCandidates({ seed: "gate" });
  if (first.hash !== second.hash) loop.why.push("the same seed produced two different inventories");
  if (first.candidates.length === 0) loop.why.push("the inventory is empty");
  loop.count = first.candidates.length;

  const report = measureCandidates(first);
  loop.admitted = report.results.filter((result) => result.status === "admitted").length;
  loop.winner = report.winner?.id ?? null;
  if (report.results.some((result) => !["admitted", "refused"].includes(result.status))) {
    loop.why.push("a candidate has no verdict");
  }
  if (report.winner && !report.results.some((result) => result.id === report.winner.id && result.status === "admitted")) {
    loop.why.push("the winner is not an admitted candidate");
  }

  const planted = JSON.parse(JSON.stringify(first));
  planted.candidates = [
    { id: "planted-band", changes: [{ group: "hostile-hp", collection: "npcs", target: "boar", field: "hp", from: 12, to: 9999 }] },
    { id: "planted-target", changes: [{ group: "hostile-hp", collection: "npcs", target: "wolf", field: "hp", from: 16, to: 17 }] },
    { id: "planted-stale", changes: [{ group: "hostile-hp", collection: "npcs", target: "boar", field: "hp", from: 1, to: 13 }] },
  ];
  const refused = measureCandidates(planted).results;
  for (const id of ["planted-band", "planted-target", "planted-stale"]) {
    if (refused.find((result) => result.id === id)?.status !== "refused") loop.why.push(`${id} was not refused`);
  }
  if (!(refused.find((result) => result.id === "planted-band")?.reason ?? "").includes("outside")) {
    loop.why.push("the out-of-band refusal did not name the band");
  }

  const stale = JSON.parse(JSON.stringify(first));
  stale.worldHash = "0".repeat(64);
  const staleResults = measureCandidates(stale).results;
  if (staleResults.some((result) => result.status !== "refused")) {
    loop.why.push("a report bound to another world was measured anyway");
  }

  if (loop.why.length) {
    loop.ok = false;
    failures.push(`the candidate loop is broken: ${loop.why[0]}`);
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ measured, ratchet, loop, failures }, null, 2)}\n`);
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
  console.log(`${"loop".padEnd(26)}  ${(loop.ok ? String(loop.count) : "BROKEN").padStart(5)}   == ${loop.ok ? `${loop.admitted} admitted, bounded` : "no verdict"}`);
  console.log(`${"llms".padEnd(26)}  ${(llms.ok ? "verbs, rooms" : "STALE").padStart(5)}   == generated contract`);
  console.log(`${"claims".padEnd(26)}  ${(claimsCheck.status === 0 ? "levels ok" : "STALE").padStart(5)}   == build, open, some-true`);
  console.log(`${"commandsDoc".padEnd(26)}  ${(commandsCheck.status === 0 ? "current" : "STALE").padStart(5)}   == generated reference`);
  console.log(`${"worldMap".padEnd(26)}  ${(worldMap.ok ? `${worldMap.rooms} rooms` : "BROKEN").padStart(5)}   == exits, details, examine`);
  console.log(`${"worldArms".padEnd(26)}  ${(worldProblems.length === 0 ? "4 ok" : "BROKEN").padStart(5)}   == walkable`);
  console.log(`${"renderer".padEnd(26)}  ${(shown.includes("SECRET-NOTICE") && !hidden.includes("SECRET-NOTICE") ? "2 ok" : "BROKEN").padStart(5)}   == hides/shows`);
  console.log(`${"accounts".padEnd(26)}  ${(accounts.ok ? "hash, register" : "BROKEN").padStart(5)}   == names and passwords`);
  console.log(`${"allowance".padEnd(26)}  ${(allowance.ok ? "250 ms" : "BROKEN").padStart(5)}   == one command`);
  console.log(`${"memory".padEnd(26)}  ${(memory.ok ? `${DEFAULT_TURNS} turns` : "BROKEN").padStart(5)}   == rolling window`);
  console.log(`${"safe".padEnd(26)}  ${(safe.ok ? "2 rooms" : "BROKEN").padStart(5)}   == no combat`);
  console.log(`${"duels".padEnd(26)}  ${(duels.ok ? "Ring rules" : "BROKEN").padStart(5)}   == consent and no loot`);
  console.log(`${"guilds".padEnd(26)}  ${(guilds.ok ? "create, rank, chat" : "BROKEN").padStart(5)}   == roster and chat`);
  console.log(`${"quests".padEnd(26)}  ${(quests.ok ? "accept, advance, pay" : "BROKEN").padStart(5)}   == facts, once`);
  console.log(`${"aggression".padEnd(26)}  ${(aggression.ok ? "1 duel" : "BROKEN").padStart(5)}   == mobs start fights`);
  console.log(`${"combat2".padEnd(26)}  ${(combat2.ok ? "weapons, armour, xp" : "BROKEN").padStart(5)}   == fight and grow`);
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
