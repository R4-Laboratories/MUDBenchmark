// Channels: rooms that are not places.
//
// A channel is data — its aliases, the role that may speak on it, and one
// message for the speaker and one for everyone tuned in. The server decides
// who is tuned in (everyone awake); the table decides what they read.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "channels.json");
const CODES = new Set(["a", "o", "t", "s"]);
const LEVELS = 4;

export function loadChannels({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { channels: [], byAlias: new Map(), errors: [`cannot read ${path}: ${error.message}`] };
  }

  const channels = [];
  const byAlias = new Map();
  const seen = new Set();

  for (const channel of raw.channels ?? []) {
    if (typeof channel.id !== "string" || !channel.id) errors.push("a channel has no id");
    if (seen.has(channel.id)) errors.push(`channel id "${channel.id}" is used twice`);
    seen.add(channel.id);

    if (!Number.isInteger(channel.minRole) || channel.minRole < 0 || channel.minRole >= LEVELS) {
      errors.push(`channel ${channel.id} has minRole ${channel.minRole}, outside 0..${LEVELS - 1}`);
    }

    const messages = channel.messages ?? {};
    for (const audience of ["actor", "others"]) {
      if (typeof messages[audience] !== "string") errors.push(`channel ${channel.id} has no ${audience} message`);
    }
    for (const [audience, template] of Object.entries(messages)) {
      if (typeof template !== "string") {
        errors.push(`channel ${channel.id} message "${audience}" is not text`);
        continue;
      }
      for (const match of template.matchAll(/%(\\w)/g)) {
        if (!CODES.has(match[1])) errors.push(`channel ${channel.id} message "${audience}" uses unknown code %${match[1]}`);
      }
    }

    const keys = new Set([channel.name ?? channel.id, ...(channel.aliases ?? [])].map((alias) => String(alias).toLowerCase()));
    for (const key of keys) {
      if (byAlias.has(key)) errors.push(`channel alias "${key}" is claimed twice`);
      byAlias.set(key, channel.id);
    }

    channels.push({ ...channel, name: channel.name ?? channel.id, messages });
  }

  return { channels, byAlias, errors };
}

/** The channel a word belongs to, or null. */
export const resolveChannel = (table, word) =>
  table.channels.find((channel) => channel.id === table.byAlias.get(String(word).toLowerCase())) ?? null;
