#!/usr/bin/env node
// Deterministic combat balance sampler.
//
//   node tools/balance.mjs
//
// It does not change the world. It samples the same attackRoll the server uses
// so a tuning change can be judged against representative fights instead of a
// single anecdote.

import { attackRoll } from "../runtime/world.mjs";

const scenarios = [
  { name: "novice / rat", player: { hp: 10, damage: 0, armor: 0 }, enemy: { hp: 3, damage: 2, armor: 0 }, status: null },
  { name: "novice / boar", player: { hp: 10, damage: 0, armor: 0 }, enemy: { hp: 12, damage: 2, armor: 0 }, status: null },
  { name: "level 5 sword+jerkin / ghoul", player: { hp: 18, damage: 3, armor: 1 }, enemy: { hp: 20, damage: 3, armor: 1 }, status: null },
  { name: "level 5 spark / ghoul", player: { hp: 18, damage: 0, armor: 0, spell: 6 }, enemy: { hp: 20, damage: 3, armor: 1 }, status: "burn" },
  { name: "level 8 greatsword+plate / warden", player: { hp: 24, damage: 5, armor: 4 }, enemy: { hp: 30, damage: 4, armor: 2 }, status: null },
  { name: "level 8 ember brand / warden", player: { hp: 24, damage: 6, armor: 4 }, enemy: { hp: 30, damage: 4, armor: 2 }, status: "burn" },
  { name: "level 8 fen staff / warden", player: { hp: 24, damage: 5, armor: 4 }, enemy: { hp: 30, damage: 4, armor: 2 }, status: "chill" },
];

const simulate = (scenario, seed) => {
  const p = { ...scenario.player };
  const e = { ...scenario.enemy };
  let rounds = 0;
  let effects = [];
  while (p.hp > 0 && e.hp > 0 && rounds < 100) {
    rounds += 1;
    const tick = seed * 101 + rounds;
    const hit = attackRoll({ tick, attackerId: `p${seed}`, weaponDamage: p.damage, targetArmor: e.armor - (effects.includes("chill") ? 1 : 0) });
    if (hit.hit) e.hp -= hit.damage;
    if (scenario.status && hit.hit) {
      if (!effects.includes(scenario.status)) effects.push(scenario.status);
    }
    if (scenario.player.spell && p.hp > 0) {
      // A spell replaces the weapon swing in this sampler; approximate one
      // cast per round with its scaling power.
      e.hp -= Math.max(1, Math.floor(scenario.player.spell / 2));
      if (!effects.includes("burn")) effects.push("burn");
    }
    if (e.hp <= 0) break;
    const enemyHit = attackRoll({ tick: tick + 5000, attackerId: `e${seed}`, npcDamage: e.damage, targetArmor: p.armor });
    if (enemyHit.hit) p.hp -= enemyHit.damage;
    if (p.hp <= 0) break;
    for (const effect of effects) {
      if (effect === "burn" || effect === "bleed") e.hp = Math.max(1, e.hp - 1);
    }
    effects = effects.filter((effect) => effect !== "chill" || rounds < 3);
  }
  return { win: e.hp <= 0 && p.hp > 0, rounds, hp: Math.max(0, p.hp) };
};

const results = [];
for (const scenario of scenarios) {
  let wins = 0;
  let rounds = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    const result = simulate(scenario, seed);
    if (result.win) wins += 1;
    rounds += result.rounds;
  }
  results.push({ name: scenario.name, win_rate: wins / 200, avg_rounds: rounds / 200 });
}
for (const row of results) {
  console.log(`${row.name.padEnd(38)} win ${(row.win_rate * 100).toFixed(0).padStart(3)}%  rounds ${row.avg_rounds.toFixed(1)}`);
}
