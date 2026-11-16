// Measure a candidate inventory against the hidden scenario corpus, and admit
// one only if it is no worse on every component and better on at least one.
//
// This is the evaluating half of the loop. It never writes to `world/data`:
// it returns a hash-bound report, and a separate publisher (S2) would be the
// only thing allowed to turn an admitted candidate into a branch.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorld } from "../runtime/worlddata.mjs";
import { loadQuests } from "../runtime/quests.mjs";
import { SCENARIOS, runScenario } from "./scenarios.mjs";

const ROOT = process.cwd();
const sha = (text) => createHash("sha256").update(text).digest("hex");

// What "better" means. Each is a target band, not an extreme: a hunt that ends
// in one round is as wrong as one that never ends, and a temple with no life is
// as wrong as a zoo. A candidate may move a number toward its band and never
// away from it.
const BANDS = {
  huntRounds: { target: 6, width: 8 },
  huntDamage: { target: 4, width: 8 },
  livelinessMoves: { target: 45, width: 40 },
};

function band(value, { target, width }) {
  return Math.max(0, Math.min(1, 1 - Math.abs(value - target) / width));
}

function valueOf(world, collection, id, field) {
  return world[collection]?.find((entry) => entry.id === id)?.[field];
}

function validate(candidate, bounds, world) {
  if (!Array.isArray(candidate.changes)) return "no changes array";
  if (candidate.changes.length === 0) return "no changes";
  if (candidate.changes.length > bounds.limits.maxChanges) {
    return `${candidate.changes.length} changes, above the bound of ${bounds.limits.maxChanges}`;
  }
  const seen = new Set();
  for (const change of candidate.changes) {
    const group = bounds.groups.find((entry) => entry.id === change.group);
    if (!group) return `${change.group} is not a bounded group`;
    if (change.collection !== group.collection) return `${change.target} is not in ${group.collection}`;
    if (!group.ids.includes(change.target)) return `${change.target} is not a ${group.id} target`;
    if (!group.fields.includes(change.field)) return `${change.field} is not a ${group.id} field`;
    if (!Number.isInteger(change.to)) return `${change.target}.${change.field} is not an integer`;
    if (change.to < group.min || change.to > group.max) {
      return `${change.target}.${change.field} ${change.to} is outside ${group.min}..${group.max}`;
    }
    const current = valueOf(world, change.collection, change.target, change.field);
    if (change.from !== current) {
      return `${change.target}.${change.field} says it changes ${change.from}, but the world has ${current}`;
    }
    const key = `${change.collection}.${change.target}.${change.field}`;
    if (seen.has(key)) return `${change.target}.${change.field} is changed twice`;
    seen.add(key);
  }
  return null;
}

function apply(world, changes) {
  const copy = JSON.parse(JSON.stringify(world));
  for (const change of changes) {
    const entry = copy[change.collection].find((candidate) => candidate.id === change.target);
    if (entry) entry[change.field] = change.to;
  }
  return copy;
}

function runAll(world, quests) {
  const metrics = {};
  for (const scenario of SCENARIOS) {
    metrics[scenario.id] = runScenario({ world, quests, scenario }).metrics;
  }
  return metrics;
}

function hardFailures(metrics) {
  const failures = [];
  if (!metrics.opening.bought) failures.push("the opening tour could not buy stew");
  if (!metrics.opening.hasBread) failures.push("the opening tour lost the bread");
  if (!metrics.opening.survived) failures.push("the opening tour died");
  if (metrics.quests.completed !== 2) failures.push(`the quest tour completed ${metrics.quests.completed} of 2`);
  if (!metrics.hunt.killed) failures.push("the hunt did not kill the boar");
  if (!metrics.hunt.survived) failures.push("the hunt died");
  if (!metrics.liveliness.survived) failures.push("the liveliness watch died");
  return failures;
}

function componentsOf(metrics) {
  return {
    opening: metrics.opening.bought && metrics.opening.hasBread && metrics.opening.survived ? 1 : 0,
    quests: metrics.quests.completed / 2,
    huntRounds: band(metrics.hunt.rounds, BANDS.huntRounds),
    huntDamage: band(metrics.hunt.damage, BANDS.huntDamage),
    livelinessMoves: band(metrics.liveliness.moves, BANDS.livelinessMoves),
  };
}

const total = (components) =>
  Object.values(components).reduce((sum, value) => sum + value, 0) / Object.keys(components).length;

export function measureCandidates(report) {
  const boundsText = readFileSync(join(ROOT, "world/bounds.json"), "utf8");
  const bounds = JSON.parse(boundsText);
  const worldText = readFileSync(join(ROOT, "world/data/world.json"), "utf8");
  const world = loadWorld({ mode: "single" });
  const questTable = loadQuests();
  if (questTable.errors.length) throw new Error(questTable.errors.join("; "));

  const baselineMetrics = runAll(world, questTable.quests);
  const baselineComponents = componentsOf(baselineMetrics);
  const baselineTotal = total(baselineComponents);

  // A report is bound to the world and bounds it was built from. Re-measuring a
  // stale report against a newer world would admit a change nobody proposed.
  const stale =
    (report.worldHash && report.worldHash !== sha(worldText)) ||
    (report.boundsHash && report.boundsHash !== sha(boundsText));

  const results = [];
  if (stale) {
    for (const candidate of report.candidates ?? []) {
      results.push({
        id: candidate.id,
        changes: candidate.changes ?? [],
        status: "refused",
        reason: "the candidate report is bound to a different world or bounds file",
      });
    }
    const payload = {
      schema: "mudbenchmark/measure/1",
      candidates: report.hash ?? null,
      baseline: { metrics: baselineMetrics, components: baselineComponents, total: baselineTotal },
      results,
      winner: null,
      settled: true,
    };
    return { ...payload, hash: sha(JSON.stringify(payload)) };
  }

  for (const candidate of report.candidates ?? []) {
    const refusal = validate(candidate, bounds, world);
    if (refusal) {
      results.push({ id: candidate.id, changes: candidate.changes ?? [], status: "refused", reason: refusal });
      continue;
    }

    const metrics = runAll(apply(world, candidate.changes), questTable.quests);
    const components = componentsOf(metrics);
    const broken = hardFailures(metrics);
    if (broken.length) {
      results.push({ id: candidate.id, changes: candidate.changes, status: "refused", reason: broken[0], metrics, components, total: total(components) });
      continue;
    }

    const keys = Object.keys(baselineComponents);
    const worse = keys.filter((key) => components[key] < baselineComponents[key] - 1e-9);
    const better = keys.filter((key) => components[key] > baselineComponents[key] + 1e-9);
    const score = total(components);
    if (worse.length) {
      results.push({ id: candidate.id, changes: candidate.changes, status: "refused", reason: `worse on ${worse.join(", ")}`, metrics, components, total: score });
    } else if (!better.length) {
      results.push({ id: candidate.id, changes: candidate.changes, status: "refused", reason: "no component improved on the baseline", metrics, components, total: score });
    } else {
      results.push({ id: candidate.id, changes: candidate.changes, status: "admitted", reason: `better on ${better.join(", ")}`, metrics, components, total: score });
    }
  }

  const admitted = results.filter((result) => result.status === "admitted");
  admitted.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const winner = admitted[0] ?? null;

  const payload = {
    schema: "mudbenchmark/measure/1",
    candidates: report.hash,
    baseline: { metrics: baselineMetrics, components: baselineComponents, total: baselineTotal },
    results,
    winner: winner ? { id: winner.id, changes: winner.changes, total: winner.total, reason: winner.reason } : null,
    settled: winner === null,
  };
  return { ...payload, hash: sha(JSON.stringify(payload)) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
  };
  const path = option("candidates", null);
  if (!path) {
    console.error("usage: node tools/measure.mjs --candidates <report.json> [--out <result.json>]");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(path, "utf8"));
  const result = measureCandidates(report);
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const out = option("out", null);
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);

  const admitted = result.results.filter((entry) => entry.status === "admitted").length;
  console.error(`measured ${result.results.length}: ${admitted} admitted, ${result.results.length - admitted} refused`);
  console.error(result.winner
    ? `winner ${result.winner.id}: ${result.winner.reason} (${result.winner.total.toFixed(3)})`
    : "settled: no candidate is better on every component");
}
