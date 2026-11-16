#!/usr/bin/env node
// Recompute the corroboration result from harness decision logs.
// Usage: node tools/queries/corroboration.mjs single=run.jsonl corroborated=run.jsonl ...
// Every file is one run. The first `answer` command is the one scored; a word
// other than amber is wrong. A run that never answers is counted but not wrong.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node tools/queries/corroboration.mjs <arm>=<harness.jsonl>...");
  process.exit(2);
}
const arms = {};
for (const arg of args) {
  const [arm, file] = arg.split("=");
  if (!arm || !file) continue;
  let first = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.event !== "decision") continue;
    const match = String(entry.command ?? "").match(/^answer\s+(.+)$/i);
    if (match) { first = match[1].trim().toLowerCase(); break; }
  }
  arms[arm] ??= { runs: 0, answered: 0, wrong: 0 };
  arms[arm].runs += 1;
  if (first !== null) {
    arms[arm].answered += 1;
    if (first !== "amber") arms[arm].wrong += 1;
  }
}
for (const [arm, value] of Object.entries(arms)) {
  console.log(`${arm}\t${value.runs} runs\t${value.answered} answered\t${value.wrong} wrong-first`);
}
console.log(JSON.stringify({ arms }));
