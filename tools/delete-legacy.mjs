#!/usr/bin/env node
// Delete one bare legacy account from a stopped world state.
//
// This is the baseline-cleanup path, not a player command. It runs offline
// against `world.json` and refuses unless the account is a legacy account with
// exactly one character, that character is owned by it, the character is not
// online, and there is no progression or external reference (mail, guild,
// duel or held object) that a delete would orphan.
//
//   systemctl --user stop mudbench-world.service
//   node tools/delete-legacy.mjs --state ~/.mudbench/state/world.json --name casey --confirm
//   systemctl --user start mudbench-world.service
//
// The state file is copied to `archive/` first, and `saveStateFile` rotates the
// normal backups and writes atomically.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { saveStateFile } from "../runtime/state.mjs";

export function deleteLegacy(state, name) {
  const account = state.accounts?.[name];
  const identity = state.identities?.[name];
  const refuse = (why) => ({ ok: false, why });

  if (!account) return refuse("no such account");
  if (account.kind !== "legacy") return refuse("not a legacy account");
  if (account.retired || account.mergedInto) return refuse("the account is already retired or moved");
  if ((state.actors ?? []).some((actor) => actor.key === name || actor.name === name)) {
    return refuse("the character is online");
  }
  const characters = account.characters ?? [];
  if (characters.length !== 1 || characters[0] !== name) {
    return refuse("the account does not have exactly one character with its own name");
  }
  if (!identity || identity.owner !== name) return refuse("the character is not owned by the account");
  if ((identity.level ?? 1) !== 1 || (identity.xp ?? 0) !== 0) {
    return refuse("the character has progression");
  }
  if (identity.guild || identity.guildRank) return refuse("the character is in a guild");
  if ((identity.quests?.active?.length ?? 0) > 0 || (identity.quests?.completed?.length ?? 0) > 0) {
    return refuse("the character has quest progress");
  }
  if ((state.mail ?? []).some((letter) => letter.fromKey === name || letter.toKey === name)) {
    return refuse("mail references the character");
  }
  if (Object.values(state.guilds ?? {}).some((guild) => guild.founder === name || (guild.members ?? {})[name])) {
    return refuse("a guild references the character");
  }
  if ((state.duels ?? []).some((duel) => duel.challengerKey === name || duel.targetKey === name)) {
    return refuse("a duel references the character");
  }
  if ((state.objects ?? []).some((object) => object.holder === name || object.heldRoom === name)) {
    return refuse("an object references the character");
  }

  delete state.accounts[name];
  delete state.identities[name];
  return {
    ok: true,
    removed: { account, identity },
    counts: { accounts: Object.keys(state.accounts).length, identities: Object.keys(state.identities).length },
  };
}

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const statePath = option("state", null);
  const name = option("name", null);
  if (!statePath || !name) {
    throw new Error("usage: delete-legacy --state <world.json> --name <account> [--confirm]");
  }
  if (!existsSync(statePath)) throw new Error(`no state file at ${statePath}`);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const result = deleteLegacy(state, name);
  if (!result.ok) throw new Error(result.why);

  console.log(`would delete ${name}: ${JSON.stringify(result.removed.account.characters)}`);
  console.log(`counts after: ${result.counts.accounts} accounts, ${result.counts.identities} identities`);
  if (!args.includes("--confirm")) {
    console.log("dry run: pass --confirm to write the deletion");
    return;
  }

  const archive = option("backup-dir", join(dirname(statePath), "archive"));
  mkdirSync(archive, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(archive, `world-before-delete-${name}-${stamp}.json`);
  copyFileSync(statePath, backup);
  saveStateFile(statePath, state);
  console.log(`deleted ${name}; backup ${backup}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`delete-legacy: ${error.message}`);
    process.exit(1);
  }
}
