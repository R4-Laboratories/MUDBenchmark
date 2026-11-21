#!/usr/bin/env node
// Deterministic combat balance sampler.
//
//   node tools/balance.mjs
//   node tools/balance.mjs --json
//
// It reads the real world data and samples the same attackRoll the server
// uses. It does not change the world. Scenarios name gear and mobiles, so a
// tuning change is judged against the content players actually meet.

import { attackRoll, maxHpForLevel } from "../runtime/world.mjs";
import { loadWorld } from "../runtime/worlddata.mjs";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const seeds = Number([...args].find((arg) => arg.startsWith("--seeds="))?.split("=")[1] ?? 400);

const world = loadWorld({ mode: "single" });
const objectById = new Map(world.objects.map((object) => [object.id, object]));
const npcById = new Map(world.npcs.map((npc) => [npc.id, npc]));
const failures = [];
for (const id of ["rat", "boar", "ghoul", "warden", "star-hound", "sundial-knight", "eclipse-regent"]) {
  if (!npcById.has(id)) failures.push(`missing mobile ${id}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const gearStats = (ids = []) => {
  let armor = 0;
  let damage = 0;
  let status = null;
  for (const id of ids) {
    const object = objectById.get(id);
    if (!object) continue;
    armor += Number.isFinite(object.armor) ? object.armor : 0;
    if ((object.flags ?? []).includes("weapon")) {
      damage = object.damage ?? 0;
      status = object.status ?? null;
    }
  }
  return { armor, damage, status };
};

const scenarios = [
  { band: "early", name: "novice / rat", level: 1, gear: [], enemy: "rat" },
  { band: "early", name: "novice / boar", level: 1, gear: [], enemy: "boar" },
  { band: "mid", name: "level 5 sword+jerkin / ghoul", level: 5, gear: ["sword", "jerkin"], enemy: "ghoul" },
  { band: "mid", name: "level 5 spark / ghoul", level: 5, gear: [], spells: ["spark"], guild: "mages", enemy: "ghoul" },
  { band: "high", name: "level 8 greatsword+plate / warden", level: 8, gear: ["greatsword", "helmet", "jerkin", "boots", "gloves", "ember-cloak", "salt-ward", "shield"], enemy: "warden" },
  { band: "high", name: "level 9 ember brand / star hound", level: 9, gear: ["ember-brand", "helmet", "jerkin", "boots", "gloves", "ember-cloak", "salt-ward", "shield"], enemy: "star-hound" },
  { band: "high", name: "level 9 ember brand / sundial knight", level: 9, gear: ["ember-brand", "helmet", "jerkin", "boots", "gloves", "ember-cloak", "salt-ward", "shield"], enemy: "sundial-knight" },
  { band: "capstone", name: "level 9 ember brand / eclipse regent", level: 9, gear: ["ember-brand", "helmet", "jerkin", "boots", "gloves", "ember-cloak", "salt-ward", "shield"], enemy: "eclipse-regent" },
  { band: "capstone", name: "level 10 ember brand + spells / regent", level: 10, gear: ["ember-brand", "helmet", "jerkin", "boots", "gloves", "ember-cloak", "salt-ward", "shield"], spells: ["spark", "mend", "shield"], guild: "mages", enemy: "eclipse-regent" },
  { band: "capstone", name: "level 10 dawn blade+plate / regent", level: 10, gear: ["dawn-blade", "dawn-crown", "jerkin", "boots", "gloves", "ember-cloak", "eclipse-ward", "shield"], enemy: "eclipse-regent" },
];

const STATUS_ROUNDS = { burn: 2, bleed: 3, chill: 2 };
const addEffect = (list, id) => {
  if (!STATUS_ROUNDS[id]) return;
  const current = list.find((effect) => effect.id === id);
  if (current) current.rounds = Math.max(current.rounds, STATUS_ROUNDS[id]);
  else list.push({ id, rounds: STATUS_ROUNDS[id] });
};

const simulate = (scenario, seed) => {
  const enemyDefinition = npcById.get(scenario.enemy);
  const gear = gearStats(scenario.gear);
  const maxHp = maxHpForLevel(scenario.level);
  const player = {
    hp: maxHp,
    maxHp,
    armor: gear.armor,
    damage: gear.damage,
    status: gear.status,
    mana: 3 + scenario.level * 2 + (scenario.guild === "mages" ? 4 : 0),
    maxMana: 3 + scenario.level * 2 + (scenario.guild === "mages" ? 4 : 0),
    spells: new Set(scenario.spells ?? []),
    shield: 0,
    effects: [],
  };
  const enemy = {
    hp: enemyDefinition.maxHp ?? enemyDefinition.hp,
    maxHp: enemyDefinition.maxHp ?? enemyDefinition.hp,
    damage: enemyDefinition.damage ?? 0,
    armor: enemyDefinition.armor ?? 0,
    status: enemyDefinition.status ?? null,
    effects: [],
  };
  const focus = gear.damage;
  const power = Math.floor(scenario.level / 3) + Math.floor(focus / 2);
  let rounds = 0;
  let castShield = false;

  while (player.hp > 0 && enemy.hp > 0 && rounds < 80) {
    rounds += 1;
    const tick = seed * 997 + rounds;

    if (player.spells.has("shield") && !castShield && player.mana >= 5) {
      player.shield = 2 + Math.floor(scenario.level / 5) + Math.floor(focus / 3);
      player.mana -= 5;
      castShield = true;
    }

    const hurt = player.hp <= Math.floor(player.maxHp * 0.45);
    if (hurt && player.spells.has("mend") && player.mana >= 4) {
      const heal = 4 + Math.floor(scenario.level / 2) + Math.floor(focus / 2);
      player.hp = Math.min(player.maxHp, player.hp + heal);
      player.effects = player.effects.filter((effect) => effect.id === "chill");
      player.mana -= 4;
    } else if (player.spells.has("spark") && player.mana >= 3 && (player.damage < 7 || enemy.hp > 20)) {
      const damage = 1 + ((tick * 7 + 1) % 4) + power;
      enemy.hp -= damage;
      addEffect(enemy.effects, "burn");
      player.mana -= 3;
    } else {
      const swing = attackRoll({ tick, attackerId: `p${seed}`, weaponDamage: player.damage, targetArmor: Math.max(0, enemy.armor - enemy.effects.filter((effect) => effect.id === "chill").length) });
      if (swing.hit) {
        enemy.hp -= swing.damage;
        if (player.status) addEffect(enemy.effects, player.status);
      }
    }

    if (enemy.hp <= 0) break;

    const enemySwing = attackRoll({ tick: tick + 5000, attackerId: `e${seed}`, npcDamage: enemy.damage, targetArmor: Math.max(0, player.armor + player.shield - player.effects.filter((effect) => effect.id === "chill").length) });
    if (enemySwing.hit) {
      player.hp -= enemySwing.damage;
      if (enemy.status) addEffect(player.effects, enemy.status);
    }
    if (player.hp <= 0) break;

    for (const effect of enemy.effects) {
      if ((effect.id === "burn" || effect.id === "bleed") && enemy.hp > 1) enemy.hp -= 1;
    }
    for (const effect of player.effects) {
      if ((effect.id === "burn" || effect.id === "bleed") && player.hp > 1) player.hp -= 1;
    }
    for (const effect of [...enemy.effects, ...player.effects]) effect.rounds -= 1;
    enemy.effects = enemy.effects.filter((effect) => effect.rounds > 0);
    player.effects = player.effects.filter((effect) => effect.rounds > 0);

    if (rounds % 2 === 0) player.mana = Math.min(player.maxMana, player.mana + 1);
  }

  return { win: enemy.hp <= 0 && player.hp > 0, rounds, hp: Math.max(0, player.hp), enemyHp: Math.max(0, enemy.hp) };
};

const rows = [];
for (const scenario of scenarios) {
  let wins = 0;
  let rounds = 0;
  let hp = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const result = simulate(scenario, seed);
    if (result.win) wins += 1;
    rounds += result.rounds;
    hp += result.hp;
  }
  rows.push({
    band: scenario.band,
    name: scenario.name,
    win: wins / seeds,
    rounds: rounds / seeds,
    hp: hp / seeds,
    spell: Boolean(scenario.spells?.length),
  });
}

if (asJson) {
  console.log(JSON.stringify({ seeds, rows }, null, 2));
} else {
  console.log(`combat balance — ${seeds} deterministic seeds per fight\n`);
  console.log(`${"scenario".padEnd(44)} ${"win".padStart(4)}  ${"rounds".padStart(6)}  ${"hp".padStart(4)}`);
  for (const row of rows) {
    console.log(`${row.name.padEnd(44)} ${`${(row.win * 100).toFixed(0)}%`.padStart(4)}  ${row.rounds.toFixed(1).padStart(6)}  ${row.hp.toFixed(0).padStart(4)}`);
  }
  console.log("");
  for (const band of ["early", "mid", "high", "capstone"]) {
    const bandRows = rows.filter((row) => row.band === band);
    if (!bandRows.length) continue;
    const low = Math.min(...bandRows.map((row) => row.win));
    const high = Math.max(...bandRows.map((row) => row.win));
    console.log(`${band.padEnd(9)} ${bandRows.length} fights, win ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%`);
  }
  const impossible = rows.filter((row) => row.win === 0);
  const trivial = rows.filter((row) => row.win === 1 && row.band !== "early" && !row.spell);
  if (impossible.length) console.log(`\nwarning: no sampled win — ${impossible.map((row) => row.name).join(", ")}`);
  if (trivial.length) console.log(`warning: always wins — ${trivial.map((row) => row.name).join(", ")}`);
  if (rows.some((row) => row.spell)) console.log("note: spell fights start with a full mana pool; sustained play is lower.");
}
