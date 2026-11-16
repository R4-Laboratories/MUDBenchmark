// Publish one admitted pacing candidate.
//
// The publisher owns exactly one file: `world/data/generated/pacing.json`. It
// refuses to write anything else. It re-measures the inventory itself rather
// than trusting a report, composes the candidate onto the current overlay so
// tuning accumulates instead of being reset, runs the full gate with the file
// applied, and only then offers a branch and a PR.
//
// The default is a dry run: write, gate, print, restore. `--write` leaves the
// file for inspection. `--push` creates a `loop/...` branch and opens a PR with
// auto-merge enabled; it never pushes to main.
//
// Usage:
//   node tools/publish.mjs --candidates c.json --result r.json [--dry-run]
//   node tools/publish.mjs --candidates c.json --result r.json --write
//   GH_TOKEN=... node tools/publish.mjs --candidates c.json --result r.json --push

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { measureCandidates } from "./measure.mjs";

const ROOT = process.cwd();
const GENERATED = join(ROOT, "world/data/generated/pacing.json");
const WORLD = join(ROOT, "world/data/world.json");
const sha = (text) => createHash("sha256").update(text).digest("hex");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const mode = args.includes("--push") ? "push" : args.includes("--write") ? "write" : "dry-run";

function stop(message) {
  console.error(`publish refused: ${message}`);
  process.exit(1);
}

const candidatesPath = option("candidates", null);
const resultPath = option("result", null);
if (!candidatesPath || !resultPath) {
  console.error("usage: node tools/publish.mjs --candidates <c.json> --result <r.json> [--dry-run|--write|--push]");
  process.exit(2);
}

const candidates = JSON.parse(readFileSync(candidatesPath, "utf8"));
const provided = JSON.parse(readFileSync(resultPath, "utf8"));
const worldText = readFileSync(WORLD, "utf8");
if (candidates.worldHash !== sha(worldText)) {
  stop("the inventory is bound to a different world");
}

// Measure again. A report is evidence, not an instruction; a stale or edited
// report must not be able to name a winner the current world did not admit.
const fresh = measureCandidates(candidates);
if (fresh.hash !== provided.hash) {
  stop("the result is not a fresh measurement of this inventory");
}
if (!fresh.winner) {
  stop("the inventory settled: no candidate dominates the current world");
}
if (provided.winner?.id !== fresh.winner.id) {
  stop(`the report names ${provided.winner?.id ?? "no winner"}, but a fresh measurement names ${fresh.winner.id}`);
}

const winner = candidates.candidates.find((entry) => entry.id === fresh.winner.id);
if (!winner) stop(`the winner ${fresh.winner.id} is absent from the inventory`);

// Compose onto the current overlay. The generated file always stores absolute
// values against the raw world, so `from` is the raw value even when a previous
// candidate already moved the field. Applying a candidate twice is therefore
// impossible: the second write replaces the absolute value.
const raw = JSON.parse(worldText);
const current = existsSync(GENERATED) ? JSON.parse(readFileSync(GENERATED, "utf8")) : { changes: [] };
if (current.schema && current.schema !== "mudbenchmark/pacing/1") {
  stop(`the existing pacing file has schema ${current.schema}`);
}
const overlay = new Map();
for (const change of current.changes ?? []) {
  overlay.set(`${change.collection}.${change.target}.${change.field}`, { ...change });
}
for (const change of winner.changes) {
  if (change.field === "maxHp") continue; // the loader derives it from hp
  const entry = raw[change.collection]?.find((candidate) => candidate.id === change.target);
  if (!entry) stop(`the winner names ${change.target}, which is not in the world`);
  const key = `${change.collection}.${change.target}.${change.field}`;
  const from = entry[change.field];
  if (typeof from !== "number") stop(`${change.target}.${change.field} is not a number in the world`);
  if (change.to === from) overlay.delete(key);
  else overlay.set(key, {
    group: change.group,
    collection: change.collection,
    target: change.target,
    field: change.field,
    from,
    to: change.to,
  });
}
const changes = [...overlay.values()].sort((a, b) =>
  a.collection.localeCompare(b.collection) || a.target.localeCompare(b.target) || a.field.localeCompare(b.field));

const generated = {
  schema: "mudbenchmark/pacing/1",
  candidate: winner.id,
  report: fresh.hash,
  worldHash: candidates.worldHash,
  changes,
};
const text = `${JSON.stringify(generated, null, 2)}\n`;

const previous = existsSync(GENERATED) ? readFileSync(GENERATED, "utf8") : null;
const restore = () => {
  if (previous === null) rmSync(GENERATED, { force: true });
  else writeFileSync(GENERATED, previous);
};

mkdirSync(dirname(GENERATED), { recursive: true });
writeFileSync(GENERATED, text);

// The gate runs with the candidate applied. A red gate restores the old file;
// a candidate that cannot pass the world it is about to join is not published.
let gate;
try {
  gate = execFileSync(process.execPath, ["tools/gate.mjs"], { cwd: ROOT, encoding: "utf8" });
} catch (error) {
  restore();
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  stop("the gate failed with the candidate applied");
}
process.stderr.write(gate);

if (mode === "dry-run") {
  restore();
  process.stdout.write(text);
  console.error(`dry run: ${winner.id} passed the gate; the file was restored`);
  process.exit(0);
}

if (mode === "write") {
  process.stdout.write(text);
  console.error(`wrote ${GENERATED}; ${changes.length} change(s) from ${winner.id}`);
  process.exit(0);
}

// --- push -----------------------------------------------------------------
if (!process.env.GH_TOKEN) stop("--push needs GH_TOKEN (the GitHub App installation token)");

const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const unexpected = status.filter((line) => !line.endsWith("world/data/generated/pacing.json"));
if (unexpected.length) {
  restore();
  stop(`the working tree has changes outside the generated file: ${unexpected[0]}`);
}

const branch = `loop/${winner.id}-${fresh.hash.slice(0, 6)}`;
const existing = execFileSync("gh", ["pr", "list", "--state", "open", "--json", "headRefName", "--jq", ".[].headRefName"], {
  cwd: ROOT,
  encoding: "utf8",
}).split("\n").map((line) => line.trim()).filter((line) => line.startsWith("loop/"));
if (existing.length) {
  restore();
  stop(`a loop pull request is already open: ${existing[0]}`);
}

const lines = changes.map((change) => `- ${change.target} ${change.field} ${change.from} → ${change.to}`);
const body = [
  `Admitted by the hidden playthrough corpus.`,
  "",
  `- Candidate: ${winner.id}`,
  `- Measure report: ${fresh.hash}`,
  `- World: ${candidates.worldHash}`,
  `- Bounds: ${candidates.boundsHash}`,
  "",
  "Changes:",
  ...lines,
  "",
  "The gate ran with this file applied before the branch was created.",
].join("\n");

const git = (...argv) => execFileSync("git", argv, { cwd: ROOT, encoding: "utf8" });
git("checkout", "-b", branch);
git("add", "world/data/generated/pacing.json");
git("commit", "-m", `Pacing candidate ${winner.id}\n\n${lines.join("\n")}`);
git("push", "origin", "HEAD");

const url = execFileSync("gh", [
  "pr", "create",
  "--base", "main",
  "--head", branch,
  "--title", `Pacing candidate ${winner.id}`,
  "--body", body,
], { cwd: ROOT, encoding: "utf8" }).trim();

try {
  execFileSync("gh", ["pr", "merge", "--auto", "--merge", url], { cwd: ROOT, encoding: "utf8" });
} catch (error) {
  // Auto-merge is already switched on by the repository's workflow; a refusal
  // here means the pull request can merge immediately, which is not a failure.
  console.error(`auto-merge was not enabled by the publisher: ${(error.stderr || error.stdout || "").trim()}`);
}

console.log(url);
