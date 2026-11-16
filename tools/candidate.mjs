// A finite, seeded inventory of pacing candidates.
//
// Family A only: each candidate changes numbers inside the bands recorded in
// `world/bounds.json`. It cannot add a room, a command, a quest fact or a rule.
//
// The inventory is not random search. It is every single-group perturbation of
// the baseline at the recorded multipliers, plus a seeded selection of pairs.
// The seed decides which pairs and in what order, never which values are legal.
// Nothing here reads `tools/scenarios.mjs` or `tools/measure.mjs`: the proposer
// does not know what will judge it.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorld } from "../runtime/worlddata.mjs";

const ROOT = process.cwd();

const sha = (text) => createHash("sha256").update(text).digest("hex");
const short = (text) => sha(text).slice(0, 12);

function seedInt(seed) {
  return createHash("sha256").update(String(seed)).digest().readUInt32LE(0);
}

function next(state) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

function shuffle(list, seed) {
  const out = [...list];
  let state = seedInt(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = next(state);
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function valueOf(world, collection, id, field) {
  const entry = world[collection]?.find((candidate) => candidate.id === id);
  return entry?.[field];
}

function variant(world, group, amount) {
  const changes = [];
  for (const id of [...group.ids].sort()) {
    for (const field of group.fields) {
      const from = valueOf(world, group.collection, id, field);
      if (typeof from !== "number") continue;
      const raw = group.deltas ? from + amount : from * amount;
      const rounded = group.integer ? Math.round(raw) : raw;
      const to = Math.min(group.max, Math.max(group.min, rounded));
      if (to === from) continue;
      changes.push({ group: group.id, collection: group.collection, target: id, field, from, to });
    }
  }
  return changes;
}

function candidate(changes) {
  const sorted = [...changes].sort((a, b) =>
    a.collection.localeCompare(b.collection) || a.target.localeCompare(b.target) || a.field.localeCompare(b.field));
  return { id: `c-${short(JSON.stringify(sorted))}`, changes: sorted };
}

export function buildCandidates({ seed = "mudbench", pairs = 6 } = {}) {
  const bounds = JSON.parse(readFileSync(join(ROOT, "world/bounds.json"), "utf8"));
  const worldRaw = readFileSync(join(ROOT, "world/data/world.json"), "utf8");
  // The loaded world, not the raw file: the loader derives `maxHp` from `hp`,
  // and a candidate that moved only `hp` would respawn at the old ceiling.
  const world = loadWorld({ mode: "single" });

  const singles = [];
  for (const group of bounds.groups) {
    const amounts = group.deltas ?? group.multipliers;
    for (const amount of amounts) {
      const changes = variant(world, group, amount);
      if (changes.length) singles.push({ group: group.id, amount, changes });
    }
  }

  // Every pair of single-group variants, then a seeded, bounded selection. A
  // pair is only a combination of two legal singles; it cannot invent a value.
  const pairPool = [];
  for (let i = 0; i < singles.length; i += 1) {
    for (let j = i + 1; j < singles.length; j += 1) {
      if (singles[i].group === singles[j].group) continue;
      const merged = [...singles[i].changes, ...singles[j].changes];
      const seen = new Set();
      let overlap = false;
      for (const change of merged) {
        const key = `${change.collection}.${change.target}.${change.field}`;
        if (seen.has(key)) overlap = true;
        seen.add(key);
      }
      if (overlap || merged.length > bounds.limits.maxChanges) continue;
      pairPool.push(merged);
    }
  }

  const chosen = shuffle(pairPool, seed).slice(0, Math.max(0, pairs));
  const inventory = [...singles.map((single) => single.changes), ...chosen]
    .map(candidate)
    .filter((entry, index, all) => all.findIndex((other) => other.id === entry.id) === index);

  if (inventory.length > bounds.limits.maxCandidates) {
    throw new Error(`the inventory has ${inventory.length} candidates, above the bound of ${bounds.limits.maxCandidates}`);
  }

  const payload = {
    schema: "mudbenchmark/candidates/1",
    seed: String(seed),
    bounds: "world/bounds.json",
    boundsHash: sha(readFileSync(join(ROOT, "world/bounds.json"), "utf8")),
    world: "world/data/world.json",
    worldHash: sha(worldRaw),
    candidates: inventory,
  };
  return { ...payload, hash: sha(JSON.stringify(payload)) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
  };
  const report = buildCandidates({ seed: option("seed", "mudbench"), pairs: Number(option("pairs", 6)) });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const out = option("out", null);
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  console.error(`candidate inventory: ${report.candidates.length} from seed ${report.seed}, hash ${report.hash.slice(0, 12)}`);
}
