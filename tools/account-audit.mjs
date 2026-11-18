#!/usr/bin/env node
// Read-only account inventory.
//
//   node tools/account-audit.mjs --state ~/.mudbench/state/world.json
//   node tools/account-audit.mjs --state ... --json
//
// It never prints credential hashes and never changes the state.

import { readFileSync } from "node:fs";
import { auditAccounts } from "../runtime/account-audit.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const file = option("state", null);
if (!file) {
  console.error("usage: account-audit --state <world.json> [--json]");
  process.exit(2);
}
const audit = auditAccounts(JSON.parse(readFileSync(file, "utf8")), {
  inactiveDays: Number(option("inactive-days", 90)),
});
if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
} else {
  console.log(`accounts ${audit.counts.accounts} · characters ${audit.counts.characters}`);
  console.log(`legacy ${audit.counts.legacy} · prism ${audit.counts.prism} · retired ${audit.counts.retired}`);
  console.log(`password ${audit.counts.password} · token ${audit.counts.token} · credentialless ${audit.counts.credentialless}`);
  console.log(`inactive >${audit.inactiveDays}d ${audit.counts.inactive}`);
  if (audit.credentialless.length) console.log(`credentialless: ${audit.credentialless.join(", ")}`);
  if (audit.inactive.length) console.log(`inactive: ${audit.inactive.join(", ")}`);
}
