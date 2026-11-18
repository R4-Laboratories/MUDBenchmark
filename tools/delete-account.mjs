#!/usr/bin/env node
// Delete a disposable, bare Prism account and its pinned log.
//
//   node tools/delete-account.mjs --state ~/.mudbench/state/world.json \
//     --identities ~/.mudbench/state/identities.json \
//     --key sha256:<64 hex> --confirm
//
// Stop the world before applying. The default is a dry run; both files are
// archived before an atomic state write.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { saveStateFile } from "../runtime/state.mjs";
import { deletePrismIdentity } from "../runtime/account-delete.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const statePath = option("state", join(process.env.HOME ?? ".", ".mudbench", "state", "world.json"));
const storePath = option("identities", join(process.env.HOME ?? ".", ".mudbench", "state", "identities.json"));
const key = option("key", null);
if (!key) {
  console.error("usage: delete-account --key <prism id> [--state <world.json>] [--identities <identities.json>] [--confirm]");
  process.exit(2);
}
if (!existsSync(statePath) || !existsSync(storePath)) {
  console.error("delete-account: state or identity store is missing");
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const store = JSON.parse(readFileSync(storePath, "utf8"));
const result = deletePrismIdentity(state, store, key);
if (!result.ok) {
  console.error(`delete-account: ${result.why}`);
  process.exit(1);
}
console.log(`would delete ${key}; account ${result.removed.account ? "yes" : "no"}; pin ${result.removed.pinned ? "yes" : "no"}`);
if (!args.includes("--confirm")) {
  console.log("dry run: pass --confirm to write the deletion");
  process.exit(0);
}
const archive = option("backup-dir", join(dirname(statePath), "archive"));
mkdirSync(archive, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
copyFileSync(statePath, join(archive, `world-before-delete-account-${stamp}.json`));
copyFileSync(storePath, join(archive, `identities-before-delete-account-${stamp}.json`));
saveStateFile(statePath, state);
const temporary = `${storePath}.tmp`;
writeFileSync(temporary, `${JSON.stringify(store)}\n`);
renameSync(temporary, storePath);
console.log(`deleted ${key}; accounts ${result.counts.accounts}, pinned ${result.counts.pinned}; backup ${archive}`);
