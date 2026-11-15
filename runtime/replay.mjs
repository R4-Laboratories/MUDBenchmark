// Replay a recorded run and compare the whole world state, tick by tick.
//
// The trace carries, per tick, the intents that were applied and a digest of the
// resulting state. Replaying means re-running `step` with the same intents from
// the same initial state and checking every digest. If a run replays clean, the
// world is a function of its inputs — which is what makes it auditable.
//
// Usage: node replay.mjs /tmp/mudbench-trace.jsonl

import { readFileSync } from "node:fs";
import { step, initialState, digestState } from "./world.mjs";

const path = process.argv[2] ?? "/tmp/mudbench-trace.jsonl";
const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const rooms = lines[0]?.rooms;
if (!rooms) {
  console.error("trace has no room table on its first line");
  process.exit(2);
}

let state = lines[0].baseline ?? initialState(rooms);
let checked = 0;
let mismatched = 0;

for (const line of lines) {
  if (typeof line.tick !== "number") continue;
  while (state.tick < line.tick - 1) {
    state = step({ state, rooms, intents: [] }).state;
  }
  const result = step({ state, rooms, intents: line.intents ?? [] });
  state = result.state;

  if (line.hash) {
    checked += 1;
    const theirs = digestState(state);
    if (theirs !== line.hash) {
      mismatched += 1;
      if (mismatched <= 3) console.log(`mismatch at tick ${line.tick}: replay ${theirs.slice(0, 12)} trace ${line.hash.slice(0, 12)}`);
    }
  }
}

console.log(`replayed to tick ${state.tick}, ${state.actors.length} actors in state, checked ${checked} ticks, ${mismatched} mismatched`);
process.exit(mismatched === 0 ? 0 : 1);
