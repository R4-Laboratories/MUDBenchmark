#!/usr/bin/env node
// One improvement tick.
//
// The tick does not change code. It picks the highest-value item from the rule
// debt, prints exactly what would have to move, and exits. An unattended agent
// should be handed a task, not a licence: the decision about what to mechanize
// next belongs to a person or to a reviewed issue, and the tick's job is to
// make that decision cheap by naming the smallest next step.
//
// Usage: node tools/tick.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ratchet = JSON.parse(readFileSync(join(process.cwd(), "world/ratchet.json"), "utf8"));

if (ratchet.ruleDebt.length === 0) {
  console.log("no rule debt: every proved rule is the rule the runtime obeys");
  process.exit(0);
}

const next = ratchet.ruleDebt[0];

console.log(`tick: ${next.id} — ${next.rule}`);
console.log(`  model   ${next.model}`);
console.log(`  runtime ${next.runtime}`);
console.log(`  why     ${next.why}`);
console.log("");
console.log("To close it:");
console.log(`  1. make the runtime ask the model for this decision (an app-facet request,`);
console.log("     cached at boot if it is per-role or otherwise finite)");
console.log(`  2. prove or reuse the rule in the model, and add a vector that exercises it`);
console.log(`  3. delete the runtime's own implementation and lower ruleDebt to ${ratchet.ruleDebt.length - 1}`);
