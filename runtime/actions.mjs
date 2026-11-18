// Load and validate room actions.
//
// An action is a verb + target in one room, with a closed effect list. The
// server asks this module whether the action exists; the reducer applies the
// effects. No action may name a missing room, object, spell or secret exit.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spellById } from "./magic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "actions.json");
const EFFECTS = new Set(["revealExit", "open", "close", "grantItem", "teleport", "damage", "heal", "message"]);

export function loadActions({ path = DEFAULT_PATH, world = null } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { actions: [], errors: [`cannot read ${path}: ${error.message}`] };
  }
  const actions = [];
  const ids = new Set();
  for (const action of raw.actions ?? []) {
    if (!action.id || ids.has(action.id)) errors.push(`action ${action.id ?? "(missing id)"} is duplicated or empty`);
    ids.add(action.id);
    if (typeof action.verb !== "string" || !/^[a-z]+$/.test(action.verb)) errors.push(`action ${action.id} has an invalid verb`);
    if (typeof action.target !== "string" || !action.target) errors.push(`action ${action.id} has no target`);
    if (!Number.isInteger(action.room)) errors.push(`action ${action.id} has no room`);
    if (!action.messages || typeof action.messages.actor !== "string" || typeof action.messages.others !== "string") {
      errors.push(`action ${action.id} has no actor/others messages`);
    }
    if (action.requires?.spell && !spellById(action.requires.spell)) errors.push(`action ${action.id} requires unknown spell ${action.requires.spell}`);
    if (!Array.isArray(action.effects) || action.effects.length === 0) errors.push(`action ${action.id} has no effects`);
    for (const effect of action.effects ?? []) {
      if (!EFFECTS.has(effect.kind)) {
        errors.push(`action ${action.id} has unknown effect ${effect.kind}`);
        continue;
      }
      if (effect.kind === "revealExit" && !world?.rooms?.[action.room]?.secretExits?.[effect.dir]) {
        errors.push(`action ${action.id} reveals ${effect.dir}, which is not a secret exit in room ${action.room}`);
      }
      if (["open", "close", "grantItem"].includes(effect.kind) && world && !world.objects?.some((object) => object.id === effect.object)) {
        errors.push(`action ${action.id} names object ${effect.object}, which does not exist`);
      }
      if (effect.kind === "teleport" && world && !world.rooms?.[effect.room]) {
        errors.push(`action ${action.id} teleports to room ${effect.room}, which does not exist`);
      }
      if (["damage", "heal"].includes(effect.kind) && (!Number.isInteger(effect.amount) || effect.amount < 1)) {
        errors.push(`action ${action.id} has an invalid ${effect.kind} amount`);
      }
      if (effect.kind === "message" && typeof effect.text !== "string") errors.push(`action ${action.id} has an empty message effect`);
    }
    actions.push({ ...action });
  }
  return { actions, errors };
}

export function findAction(actions, { verb, target, room }) {
  const wanted = String(target ?? "").trim().toLowerCase();
  return actions.find((action) =>
    action.room === room
    && action.verb === String(verb ?? "").toLowerCase()
    && (!wanted || action.target.includes(wanted) || wanted.includes(action.target))
  ) ?? null;
}
