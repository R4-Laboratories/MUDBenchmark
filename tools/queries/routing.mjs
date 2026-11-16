#!/usr/bin/env node
// Average prompt tokens by router mode and turn index.
// Usage: node tools/queries/routing.mjs <arm>=<harness.jsonl>...

import { readFileSync } from "node:fs";

const buckets = new Map();
for (const arg of process.argv.slice(2)) {
  const [, file] = arg.split("=");
  if (!file) continue;
  let turn = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.event !== "decision") continue;
    turn += 1;
    const tokens = Number(entry.usage?.prompt_tokens);
    if (!Number.isFinite(tokens)) continue;
    const mode = entry.router ?? "flat";
    const key = `${mode}:${turn}`;
    const bucket = buckets.get(key) ?? { mode, turn, total: 0, count: 0 };
    bucket.total += tokens;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
}
for (const bucket of [...buckets.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.turn - b.turn)) {
  console.log(`${bucket.mode}\t${bucket.turn}\t${Math.round(bucket.total / bucket.count)}`);
}
