#!/usr/bin/env node
// Read span logs and print the player-session summary.
//
// The output is aggregate: sessions, human/AI mix, playtime, quest completion,
// combat outcomes, rooms and levels. Account keys and character names remain in
// the span log and are never printed here.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { playerLines, summarizePlayers } from "../runtime/playerstats.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const files = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const inputs = files.length ? files : [process.env.TELEMETRY_LOG ?? "/tmp/mudbench-spans.jsonl"];
const spans = [];
for (const file of inputs) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const span = JSON.parse(line);
      if (span && typeof span.name === "string") spans.push(span);
    } catch {}
  }
}
const summary = summarizePlayers(spans);
const out = option("out", null);
if (out) writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else if (!spans.length) {
  console.log(`No spans in ${inputs.join(", ")}.`);
} else {
  for (const line of playerLines(summary)) console.log(line);
  if (out) console.log(`wrote ${out}`);
}
