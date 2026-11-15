// Replay a recorded run and compare the whole world state, tick by tick.
//
// Two inputs are accepted:
//   a trace file written by the server (baseline + per-tick intents and hashes)
//   a span stream, whose `world.baseline` and `world.tick` spans carry the same
//   information — which is the form SAFETY-MODEL.md §3 asks for: a run
//   reconstructible from the record alone.
//
// Usage: node replay.mjs /tmp/mudbench-spans.jsonl

import { readFileSync } from "node:fs";
import { step, digestState } from "./world.mjs";

const path = process.argv[2] ?? "/tmp/mudbench-spans.jsonl";
const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const isSpans = lines[0]?.name !== undefined;

let rooms;
let state;
let ticks;

if (isSpans) {
  const start = lines.map((l) => l.name).lastIndexOf("world.baseline");
  if (start < 0) {
    console.error("no world.baseline span in this stream");
    process.exit(2);
  }
  const base = lines[start];
  state = JSON.parse(base["world.state"]);
  rooms = JSON.parse(base["world.rooms"]);
  ticks = lines.slice(start + 1).filter((l) => l.name === "world.tick");
} else {
  const base = lines[0];
  if (!base.rooms) {
    console.error("trace has no room table on its first line");
    process.exit(2);
  }
  rooms = base.rooms;
  state = base.baseline;
  // The baseline line carries a tick too; counting it as a tick replays the run
  // one step out of phase.
  ticks = lines.slice(1).filter((l) => typeof l.tick === "number");
}

let checked = 0;
let mismatched = 0;

for (const entry of ticks) {
  // The trace stores intents as an array; the span stores them as JSON text.
  const intents = entry.intents ?? JSON.parse(entry["world.intents"] ?? "[]");
  const expected = entry["state.hash"] ?? entry.hash;
  const next = step({ state, rooms, intents });
  state = next.state;
  if (!expected) continue;
  checked += 1;
  const actual = digestState(state);
  if (actual !== expected) {
    mismatched += 1;
    if (mismatched <= 3) {
      console.log(`mismatch at tick ${state.tick}: replay ${actual.slice(0, 12)} record ${expected.slice(0, 12)}`);
    }
  }
}

console.log(`replayed to tick ${state.tick}, ${state.actors.length} actors, from ${isSpans ? "spans" : "trace"}, ${checked} ticks checked, ${mismatched} mismatched`);
process.exit(mismatched === 0 ? 0 : 1);
