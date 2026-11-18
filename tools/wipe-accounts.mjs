#!/usr/bin/env node
// Archive and wipe every player account, character and pinned Prism log.
//
//   node tools/wipe-accounts.mjs --state <world.json> --identities <identities.json>
//   node tools/wipe-accounts.mjs ... --yes
//
// Without --yes it only prints the counts. With --yes it writes an archive,
// replaces both files atomically, and clears the rotation backups that could
// otherwise restore the old accounts. Stop the world service first.

import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { wipePlayers } from "../runtime/account-wipe.mjs";

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const statePath = option("state");
const identitiesPath = option("identities");
const archiveRoot = option("archive", statePath ? join(dirname(statePath), "archive") : null);
const yes = args.includes("--yes");

if (!statePath || !identitiesPath) {
  console.error("usage: wipe-accounts --state <world.json> --identities <identities.json> [--archive <dir>] [--yes]");
  process.exit(2);
}

const state = JSON.parse(readFileSync(statePath, "utf8"));
const store = JSON.parse(readFileSync(identitiesPath, "utf8"));
const probe = wipePlayers(structuredClone(state), structuredClone(store));

if (!yes) {
  console.log(`accounts ${probe.before.accounts} · characters ${probe.before.identities} · pinned ${probe.before.pinned}`);
  console.log(`actors ${probe.before.actors} · guild members ${probe.before.guildMembers} · mail ${probe.before.mail} · duels ${probe.before.duels}`);
  console.log("Dry run only; pass --yes to archive and wipe.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = join(archiveRoot, `account-wipe-${stamp}`);
mkdirSync(archive, { recursive: true });

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const archived = [];
for (const file of [statePath, identitiesPath]) {
  const target = join(archive, basename(file));
  copyFileSync(file, target);
  archived.push({ file: basename(file), sha256: sha256(file) });
}
// Rotation backups are part of the old data set; move them out of the live
// directory so a restore cannot silently bring back deleted accounts.
for (const base of [statePath, identitiesPath]) {
  for (let index = 1; index < 100; index += 1) {
    const file = `${base}.${index}`;
    if (!existsSync(file)) continue;
    copyFileSync(file, join(archive, basename(file)));
    rmSync(file, { force: true });
  }
}

const result = wipePlayers(state, store);

const atomicWrite = (file, data) => {
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, file);
};
atomicWrite(statePath, state);
atomicWrite(identitiesPath, store);
// Keep the first backup slot clean as well.
copyFileSync(statePath, `${statePath}.1`);
copyFileSync(identitiesPath, `${identitiesPath}.1`);

const manifest = {
  schema: "mudbenchmark/account-wipe/1",
  at: new Date().toISOString(),
  before: result.before,
  after: result.after,
  archived,
  files: {
    state: { path: statePath, sha256: sha256(statePath) },
    identities: { path: identitiesPath, sha256: sha256(identitiesPath) },
  },
};
writeFileSync(join(archive, "wipe.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`archived ${archive}`);
console.log(`accounts ${result.before.accounts} → ${result.after.accounts} · characters ${result.before.identities} → ${result.after.identities} · pinned ${result.before.pinned} → ${result.after.pinned}`);
console.log("wipe complete");
