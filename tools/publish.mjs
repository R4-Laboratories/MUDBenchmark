// Publish one admitted pacing candidate.
//
// The publisher owns exactly one file: `world/data/generated/pacing.json`. It
// refuses to write anything else. It re-measures the inventory itself rather
// than trusting a report, composes the candidate onto the current overlay so
// tuning accumulates instead of being reset, runs the full gate with the file
// applied, and only then offers a branch and a PR.
//
// The default is a dry run: write, gate, print, restore. `--write` leaves the
// file for inspection. `--commit` commits the generated file and pushes it to
// main, which is the lexlean-r4 engine tick: the gate ran in this job, on this
// exact tree. `--push` is the PR fallback and needs a token that can open pull
// requests; it never pushes to main.
//
// Usage:
//   node tools/publish.mjs --candidates c.json --result r.json [--dry-run]
//   node tools/publish.mjs --candidates c.json --result r.json --write
//   node tools/publish.mjs --candidates c.json --result r.json --commit
//   GH_TOKEN=... node tools/publish.mjs --candidates c.json --result r.json --push

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { measureCandidates } from "./measure.mjs";
import { admissionAdmits } from "./admission.mjs";

const ROOT = process.cwd();
const GENERATED = join(ROOT, "world/data/generated/pacing.json");
const WORLD = join(ROOT, "world/data/world.json");
const sha = (text) => createHash("sha256").update(text).digest("hex");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const mode = args.includes("--commit") ? "commit"
  : args.includes("--push") ? "push"
  : args.includes("--write") ? "write"
  : "dry-run";

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

// The tick is only valid on the tip of main. A stale checkout would measure a
// world that no longer exists, and a push would either fail or land a change
// nobody measured. Check before spending the run.
if (mode === "commit" || mode === "push") {
  const remote = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { cwd: ROOT, encoding: "utf8" })
    .split(/\s+/)[0];
  const local = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (remote !== local) stop("this checkout is not the tip of main; fetch and re-run");
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

// The admission policy, before anything is written. The five obligations are
// independent facts: the candidate's identity binds the inventory, the report
// and the world; it is no worse on every measured component; it is better on at
// least one; every change is inside its bound; and the gate must still complete.
const bounds = JSON.parse(readFileSync(join(ROOT, "world/bounds.json"), "utf8"));
const boundsOk = fresh.winner.changes.every((change) => {
  const group = bounds.groups.find((entry) => entry.id === change.group);
  return Boolean(group)
    && group.collection === change.collection
    && group.ids.includes(change.target)
    && group.fields.includes(change.field)
    && Number.isInteger(change.to)
    && change.to >= group.min
    && change.to <= group.max;
});
const measured = fresh.results.find((entry) => entry.id === fresh.winner.id);
const baseline = fresh.baseline?.components ?? {};
const components = measured?.components ?? {};
const keys = Object.keys(baseline);
const fidelity = keys.length > 0 && keys.every((key) => components[key] >= baseline[key] - 1e-9);
const benefit = keys.some((key) => components[key] > baseline[key] + 1e-9);
const identity = Boolean(candidates.hash)
  && candidates.hash === provided.candidates
  && fresh.hash === provided.hash
  && fresh.winner.id === provided.winner?.id
  && candidates.worldHash === sha(worldText);
const admission = { identity, fidelity, benefit, bounds: boundsOk, checks: false };
const missing = Object.entries(admission).filter(([key, value]) => key !== "checks" && !value).map(([key]) => key);
if (missing.length) stop(`the admission policy refused this candidate: ${missing.join(", ")}`);

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

// The gate completed. Record the admission inside the one generated file; the
// loader ignores the record, and the file now carries its own identity claim.
const admissionReceipt = existsSync(join(ROOT, "world/admission-receipt.json"))
  ? JSON.parse(readFileSync(join(ROOT, "world/admission-receipt.json"), "utf8"))
  : null;
const admissionRecord = {
  policy: "mudbenchmark/admission/1",
  ...admission,
  checks: true,
  candidate: winner.id,
  report: fresh.hash,
  worldHash: candidates.worldHash,
  kernel: admissionReceipt?.kernel ?? null,
};
if (!admissionAdmits(admissionRecord)) {
  restore();
  stop("the admission policy refused the completed candidate");
}
const finalText = `${JSON.stringify({ ...generated, admission: admissionRecord }, null, 2)}\n`;
writeFileSync(GENERATED, finalText);

if (mode === "dry-run") {
  restore();
  process.stdout.write(finalText);
  console.error(`dry run: ${winner.id} admitted and passed the gate; the file was restored`);
  process.exit(0);
}

if (mode === "write") {
  process.stdout.write(finalText);
  console.error(`wrote ${GENERATED}; ${changes.length} change(s) from ${winner.id}`);
  process.exit(0);
}

const lines = changes.map((change) => `- ${change.target} ${change.field} ${change.from} → ${change.to}`);
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const unexpected = status.filter((line) => !line.endsWith("world/data/generated/pacing.json"));
if (unexpected.length) {
  restore();
  stop(`the working tree has changes outside the generated file: ${unexpected[0]}`);
}
const git = (...argv) => execFileSync("git", argv, { cwd: ROOT, encoding: "utf8" });

// --- commit: the r4-engine tick -------------------------------------------
if (mode === "commit") {
  git("add", "world/data/generated/pacing.json");
  git("commit", "-m", `Pacing candidate ${winner.id}\n\n${lines.join("\n")}`);
  const sha = git("rev-parse", "HEAD").trim();
  try {
    git("push", "origin", "HEAD:main");
  } catch (error) {
    console.error((error.stderr || error.stdout || "").trim());
    stop("the push to main was refused. main's required checks are not satisfied by a direct push; see docs/SELF-IMPROVEMENT.md for the two no-app settings.");
  }
  console.error(`pushed ${sha.slice(0, 12)} to main: ${winner.id}, ${changes.length} change(s)`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `committed=true\nsha=${sha}\n`);
  }
  process.exit(0);
}

// --- push: the PR fallback ------------------------------------------------
if (!process.env.GH_TOKEN) stop("--push needs GH_TOKEN (a token that can open pull requests)");

const branch = `loop/${winner.id}-${fresh.hash.slice(0, 6)}`;
const existing = execFileSync("gh", ["pr", "list", "--state", "open", "--json", "headRefName", "--jq", ".[].headRefName"], {
  cwd: ROOT,
  encoding: "utf8",
}).split("\n").map((line) => line.trim()).filter((line) => line.startsWith("loop/"));
if (existing.length) {
  restore();
  stop(`a loop pull request is already open: ${existing[0]}`);
}

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
