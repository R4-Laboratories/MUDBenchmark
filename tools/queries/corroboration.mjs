#!/usr/bin/env node
// Recompute the corroboration result from harness decision logs.
// Usage: node tools/queries/corroboration.mjs single=run.jsonl corroborated=run.jsonl ...
// Each log is a harness JSONL. The first `answer` command is the one scored;
// a word other than amber is wrong.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node tools/queries/corroboration.mjs <arm>=<harness.jsonl>...");
  process.exit(2);
}
const rows = [];
for (const arg of args) {
  const [arm, file] = arg.split("=");
  if (!arm || !file) continue;
  let first = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.event !== "decision") continue;
    const command = String(entry.command ?? "");
    const match = command.match(/^answer\s+(.+)$/i);
    if (match) { first = match[1].trim().toLowerCase(); break; }
  }
  if (first !== null) rows.push({ arm, answer: first, wrong: first !== "amber" });
}
const arms = {};
for (const row of rows) {
  arms[row.arm] ??= { runs: 0, wrong: 0 };
  arms[row.arm].runs += 1;
  if (row.wrong) arms[row.arm].wrong += 1;
}
for (const [arm, value] of Object.entries(arms)) {
  console.log(`${arm}\t${value.wrong}/${value.runs}\twrong-first`);
}
console.log(JSON.stringify({ arms: rows.length, detail: arms }));
