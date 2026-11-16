#!/usr/bin/env node
// Count first-answer-wrong runs whose own prompt contained the recall of the
// true word. Usage: node tools/queries/recall.mjs <label>=<harness.jsonl>...

import { readFileSync } from "node:fs";

let runs = 0;
let recalled = 0;
let wrong = 0;
for (const arg of process.argv.slice(2)) {
  const [, file] = arg.split("=");
  if (!file) continue;
  let first = null;
  let sawRecall = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.event !== "decision") continue;
    if (/word you found in the Vault/i.test(String(entry.recall ?? ""))) sawRecall = true;
    const match = String(entry.command ?? "").match(/^answer\s+(.+)$/i);
    if (match) { first = match[1].trim().toLowerCase(); break; }
  }
  if (first === null) continue;
  runs += 1;
  if (sawRecall) recalled += 1;
  if (first !== "amber") wrong += 1;
}
console.log(JSON.stringify({ runs, recalled, wrong, seed: "recall layer; three identities; two sessions" }));
