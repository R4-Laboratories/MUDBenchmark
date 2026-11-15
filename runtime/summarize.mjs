// Summarise harness runs written by harness.mjs.
// Usage: node summarize.mjs /tmp/h-flat.jsonl /tmp/h-routed.jsonl ...

import { readFileSync } from "node:fs";

for (const path of process.argv.slice(2)) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    console.log(`${path}: missing`);
    continue;
  }
  const decisions = rows.filter((r) => r.event === "decision");
  const parsed = decisions.filter((r) => r.parse_ok).length;
  const commands = decisions.map((r) => r.command);
  const moves = commands.filter((c) => /^(north|south|east|west|n|s|e|w)$/.test(c)).length;
  const says = commands.filter((c) => c.startsWith("say")).length;
  const looks = commands.filter((c) => c.startsWith("look")).length;
  const contextChars = decisions.reduce((sum, r) => sum + (r.context?.length ?? 0), 0);
  const layerSets = new Set(decisions.map((r) => (r.layers ?? []).join("+")));

  console.log(`\n${path}`);
  console.log(`  turns ${decisions.length}  parsed ${parsed}/${decisions.length}`);
  console.log(`  moves ${moves}  says ${says}  looks ${looks}`);
  console.log(`  context chars ${contextChars}  distinct layer sets ${layerSets.size}`);
  for (const set of layerSets) console.log(`    ${set}`);
  console.log(`  commands: ${commands.join(" | ")}`);
}
