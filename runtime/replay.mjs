// Replay the pulse substrate from a recorded trace.
//
// Scope, stated plainly: this replays the tick and the NPCs, which are pure
// functions of the tick number. It does not replay players, because a player's
// room lives in the server's Map rather than in the world state — so a run
// cannot yet be reconstructed end to end. That is a gap in the world model, not
// in this tool.
//
// Usage: node replay.mjs /tmp/mudbench-trace.jsonl

import { readFileSync } from "node:fs";
import { step, initialState } from "./world.mjs";

const path = process.argv[2] ?? "/tmp/mudbench-trace.jsonl";
const ROOMS = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
// Movement needs the real exits; the server writes them into the trace's first
// line so this tool does not carry a second copy of the map.
const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const exits = lines[0]?.exits ?? null;
if (!exits) {
  console.log("trace has no room table on its first line");
  process.exit(2);
}
const rooms = exits;

let state = initialState(rooms);
let checked = 0;
let mismatched = 0;

for (const line of lines) {
  if (!line.tick) continue;
  while (state.tick < line.tick) {
    state = step({ state, rooms, intents: [], actors: new Map() }).state;
  }
  if (!line.npcs) continue;
  const mine = state.npcs.map((n) => `${n.id}@${n.room}`).sort().join(",");
  const theirs = line.npcs.map((n) => `${n.id}@${n.room}`).sort().join(",");
  checked += 1;
  if (mine !== theirs) {
    mismatched += 1;
    if (mismatched <= 3) console.log(`mismatch at tick ${line.tick}: replay ${mine} / trace ${theirs}`);
  }
}

console.log(`replayed to tick ${state.tick}, checked ${checked} checkpoints, ${mismatched} mismatched`);
process.exit(mismatched === 0 ? 0 : 1);
