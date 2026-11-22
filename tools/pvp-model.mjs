#!/usr/bin/env node
// Fixed-damage PvP model.
//
// The live server resolves violence every 12 ticks. attackRoll's damage term
// uses tick * 7 modulo 4, and 12 * 7 is divisible by 4, so each attacker's
// damage is constant for the whole duel. The hit term uses tick * 13 modulo
// 100, and 12 * 13 = 156 is not divisible by 100, so hit/miss still varies
// each round.
//
// This tool samples the real attackRoll over every start-tick phase, both
// actor-id assignments and both kit orientations. It is the PvP companion to
// tools/balance.mjs: balance.mjs increments the tick each round, while the
// live server does not, so balance.mjs understates live gear differences.
//
//   node tools/pvp-model.mjs
//   node tools/pvp-model.mjs --json

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attackRoll, maxHpForLevel } from "../runtime/world.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const world = JSON.parse(readFileSync(join(root, "world", "data", "world.json"), "utf8"));
const object = (id) => {
  const found = world.objects.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing world object ${id}`);
  return found;
};
const kit = (weapon, armorIds) => ({
  weapon: Number(object(weapon).damage ?? 0),
  armor: armorIds.reduce((sum, id) => sum + Number(object(id).armor ?? 0), 0),
  status: object(weapon).status ?? null,
});
const withWeapon = (base, weapon) => ({ ...base, weapon });
const withArmor = (base, armor) => ({ ...base, armor });

const DAWN = kit("dawn-blade", ["dawn-crown", "eclipse-plate", "ember-cloak", "shield", "boots", "gloves"]);
const EMBER_BASE = kit("ember-brand", ["helmet", "eclipse-plate", "ember-cloak", "shield", "boots", "gloves"]);
const EMBER_CURRENT = kit("ember-brand", ["red-helm", "eclipse-plate", "ember-cloak", "shield", "boots", "gloves"]);
const EMBER_BASELINE = withWeapon(EMBER_BASE, 6);
const EMBER_NEXT = withWeapon(EMBER_CURRENT, 8);
const MIRROR_5 = kit("sword", ["jerkin", "helmet", "boots", "gloves", "shield"]);
const MIRROR_10 = DAWN;

const IDS = [["1", "2"], ["2", "1"]];
const STEPS = 1000;
const ROUNDS = 80;

const duel = (start, ids, left, right, hp) => {
  let leftHp = hp;
  let rightHp = hp;
  let leftBurn = 0;
  let rightBurn = 0;
  for (let round = 1; round <= ROUNDS; round += 1) {
    // The violence pulse is every 12 ticks. The fixed damage is the point:
    // this call returns the same damage on every round of the duel.
    const tick = start + round * 12;
    const leftSwing = attackRoll({
      tick, attackerId: ids[0], weaponDamage: left.weapon, targetArmor: right.armor,
    });
    const rightSwing = attackRoll({
      tick, attackerId: ids[1], weaponDamage: right.weapon, targetArmor: left.armor,
    });
    if (leftSwing.hit) {
      rightHp -= leftSwing.damage;
      if (left.status === "burn") rightBurn = 2;
    }
    if (rightSwing.hit) {
      leftHp -= rightSwing.damage;
      if (right.status === "burn") leftBurn = 2;
    }
    if (leftHp <= 0 || rightHp <= 0) break;
    if (leftBurn > 0) { leftHp -= 1; leftBurn -= 1; }
    if (rightBurn > 0) { rightHp -= 1; rightBurn -= 1; }
    if (leftHp <= 0 || rightHp <= 0) break;
  }
  if (leftHp <= 0 && rightHp <= 0) return 0.5;
  return rightHp <= 0 ? 1 : 0;
};

const rate = (dawn, ember, hp) => {
  const orientation = [0, 0];
  let wins = 0;
  let matches = 0;
  for (let start = 0; start < STEPS; start += 1) {
    for (const ids of IDS) {
      for (let swap = 0; swap < 2; swap += 1) {
        const left = swap ? ember : dawn;
        const right = swap ? dawn : ember;
        const leftWins = duel(start, ids, left, right, hp);
        const dawnWins = swap ? 1 - leftWins : leftWins;
        wins += dawnWins;
        orientation[swap] += dawnWins;
        matches += 1;
      }
    }
  }
  return {
    dawn: wins / matches,
    ember: 1 - wins / matches,
    orientation: orientation.map((value) => value / (STEPS * IDS.length)),
    matches,
  };
};

const scenarios = [
  { name: "level 5 mirror", dawn: MIRROR_5, ember: MIRROR_5, hp: maxHpForLevel(5) },
  { name: "level 10 mirror", dawn: MIRROR_10, ember: MIRROR_10, hp: maxHpForLevel(10) },
  { name: "dawn/ember baseline (6 / 2)", dawn: DAWN, ember: EMBER_BASELINE, hp: maxHpForLevel(10) },
  { name: "dawn/ember current (7 / 3)", dawn: DAWN, ember: EMBER_CURRENT, hp: maxHpForLevel(10) },
  { name: "dawn/ember next (8 / 3)", dawn: DAWN, ember: EMBER_NEXT, hp: maxHpForLevel(10) },
];
const rows = scenarios.map((scenario) => ({ name: scenario.name, ...rate(scenario.dawn, scenario.ember, scenario.hp) }));

const output = {
  model: "fixed-damage-pvp",
  note: "violence every 12 ticks; damage is fixed per duel; hit/miss varies each round",
  dawn: { weapon: DAWN.weapon, armor: DAWN.armor },
  ember: {
    baseline: { weapon: EMBER_BASELINE.weapon, armor: EMBER_BASELINE.armor },
    current: { weapon: EMBER_CURRENT.weapon, armor: EMBER_CURRENT.armor },
    next: { weapon: EMBER_NEXT.weapon, armor: EMBER_NEXT.armor },
  },
  rows,
};
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`fixed-damage PvP model (${STEPS} start ticks x 2 ids x 2 orientations)`);
  console.log(`dawn: damage ${DAWN.weapon}, armour ${DAWN.armor}`);
  console.log(`ember current: damage ${EMBER_CURRENT.weapon}, armour ${EMBER_CURRENT.armor}`);
  console.log("");
  console.log(`${"scenario".padEnd(34)} ${"dawn".padStart(6)} ${"ember".padStart(6)}  orientation`);
  for (const row of rows) {
    console.log(`${row.name.padEnd(34)} ${`${(row.dawn * 100).toFixed(1)}%`.padStart(6)} ${`${(row.ember * 100).toFixed(1)}%`.padStart(6)}  ${row.orientation.map((value) => `${(value * 100).toFixed(1)}%`).join(" / ")}`);
  }
}
