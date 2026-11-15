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
import { initialState, nextFrom, phaseAt, step, upgradeState } from "../runtime/world.mjs";
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
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 1, home: 1 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start);
  state = step({ state, rooms: world.rooms, intents: [{ kind: "join", actorId: "gate", name: "gate" }] }).state;
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

  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "gate", objectId: "bread", messages: say("take") }]);
  run([{ kind: "eat", actorId: "gate", objectId: "bread", messages: say("eat") }]);
  check(object("bread").bites === 1 && !object("bread").eaten, "one bite finished a two-bite loaf");
  run([{ kind: "eat", actorId: "gate", objectId: "bread", messages: say("eat") }]);
  check(object("bread").eaten, "a finished loaf is still in the world");

  // The old MUD reset: walk the clock to the area pulse and require everything
  // to be home, including what was eaten.
  for (let i = 0; i < 260; i += 1) run([]);
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
  const base = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate);
  const saved = JSON.parse(JSON.stringify(base));
  saved.tick = 12345;
  delete saved.pulses.violence;
  delete saved.climate;
  delete saved.weather;
  delete saved.engagements;
  delete saved.cycle;
  saved.objects = saved.objects.filter((o) => o.id !== "chest");
  const cloak = saved.objects.find((o) => o.id === "cloak");
  delete cloak.inside;
  delete cloak.worn;
  delete cloak.open;

  const upgraded = upgradeState(saved, base);
  if (upgraded.tick !== 12345) { resume.ok = false; resume.why.push("the tick was not preserved"); }
  if (!upgraded.pulses.violence) { resume.ok = false; resume.why.push("the violence pulse was not restored"); }
  if (!upgraded.climate?.weather?.length) { resume.ok = false; resume.why.push("the climate was not restored"); }
  if (!Array.isArray(upgraded.engagements)) { resume.ok = false; resume.why.push("engagements were not restored"); }
  const chest = upgraded.objects.find((o) => o.id === "chest");
  if (!chest || chest.home === undefined) { resume.ok = false; resume.why.push("a newly added object is missing after resume"); }
  const restoredCloak = upgraded.objects.find((o) => o.id === "cloak");
  if (restoredCloak.worn !== false || restoredCloak.inside !== null) { resume.ok = false; resume.why.push("an old object kept an undefined property"); }

  try {
    let state = upgraded;
    for (let i = 0; i < 10; i += 1) state = step({ state, rooms: world.rooms, intents: [] }).state;
  } catch (error) {
    resume.ok = false;
    resume.why.push(`stepping an upgraded save threw: ${error.message}`);
  }
  if (!resume.ok) failures.push(`resuming an old world is broken: ${resume.why[0]}`);
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
  console.log(`${"combat".padEnd(26)}  ${(combat.outcome === "killed" ? `${combat.rounds} rounds` : "BROKEN").padStart(5)}   == kills`);
  console.log(`${"resume".padEnd(26)}  ${(resume.ok ? "1 save" : "BROKEN").padStart(5)}   == old checkpoint loads`);
  console.log(`${"climate".padEnd(26)}  ${(climate.ok ? `${climate.changes} changes` : "BROKEN").padStart(5)}   == day, night, weather`);
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
