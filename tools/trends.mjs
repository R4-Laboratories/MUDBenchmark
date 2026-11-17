#!/usr/bin/env node
// Read span logs and print the telemetry trend view.
//
// This is deliberately descriptive, not a score. The questions it answers are
// "who connected, how long did model turns take, what did they do, how far did
// characters get, and what did the world look like?" Benchmark claims are built
// on top of these observations later.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { summarizeTrends, trendLines } from "../runtime/trends.mjs";

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
const summary = summarizeTrends(spans);
const out = option("out", null);
if (out) writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else if (!spans.length) {
  console.log(`No spans in ${inputs.join(", ")}.`);
} else {
  for (const line of trendLines(summary)) console.log(line);
  if (out) console.log(`wrote ${out}`);
}
