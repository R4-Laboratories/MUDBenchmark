// Socials: verbs with no state change and a message per audience.
//
// `wave` and `wave at <name>` are the same row. A social that has no target
// messages is untargeted; one that has them must have both, so a target never
// sees silence where the room saw a gesture.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "socials.json");
const CODES = new Set(["a", "o", "t", "s"]);

export function loadSocials({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { socials: {}, byAlias: new Map(), errors: [`cannot read ${path}: ${error.message}`] };
  }

  const socials = raw.socials ?? {};
  const byAlias = new Map();

  for (const [name, entry] of Object.entries(socials)) {
    const messages = entry.messages ?? {};
    for (const audience of ["actor", "others"]) {
      if (typeof messages[audience] !== "string") errors.push(`social ${name} has no ${audience} message`);
    }
    const targeted = typeof messages.target === "string" || typeof messages.targetOthers === "string";
    if (targeted && (typeof messages.target !== "string" || typeof messages.targetOthers !== "string" || typeof messages.targeted !== "string")) {
      errors.push(`social ${name} has an incomplete target: target, targetOthers and targeted are required`);
    }
    const selfTargeted = typeof messages.self === "string" || typeof messages.selfOthers === "string";
    if (selfTargeted && (typeof messages.self !== "string" || typeof messages.selfOthers !== "string")) {
      errors.push(`social ${name} has half a self: both self and selfOthers are required`);
    }
    for (const [audience, template] of Object.entries(messages)) {
      if (typeof template !== "string") {
        errors.push(`social ${name} message "${audience}" is not text`);
        continue;
      }
      for (const match of template.matchAll(/%(\\w)/g)) {
        if (!CODES.has(match[1])) errors.push(`social ${name} message "${audience}" uses unknown code %${match[1]}`);
      }
    }

    socials[name] = { ...entry, id: name, messages };
    const keys = new Set([name, ...(entry.aliases ?? [])].map((alias) => String(alias).toLowerCase()));
    for (const key of keys) {
      if (byAlias.has(key)) errors.push(`social alias "${key}" is claimed twice`);
      byAlias.set(key, name);
    }
  }

  return { socials, byAlias, errors };
}

/** The social a word belongs to, or null. */
export const resolveSocial = (table, word) =>
  table.socials[table.byAlias.get(String(word).toLowerCase())] ?? null;
