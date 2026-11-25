// The verb table: words, audiences and templates.
//
// Effects stay in the server; wording does not. This is the split idirt used —
// `data/actions` carried the flags and the per-audience message lists, and the
// C code carried the behaviour — and it is what makes the game's voice
// reviewable without reading code.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "verbs.json");
const CODES = new Set(["a", "o", "t", "s"]);

export function loadVerbs({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { byAlias: new Map(), verbs: {}, errors: [`cannot read ${path}: ${error.message}`] };
  }

  const verbs = raw.verbs ?? {};
  const byAlias = new Map();

  for (const [name, entry] of Object.entries(verbs)) {
    // Commands arrive lowercased. Register the lowercased form of every name
    // and alias so camelCase verbs such as takeFrom remain addressable.
    byAlias.set(name.toLowerCase(), name);
    for (const alias of entry.aliases ?? []) {
      const key = alias.toLowerCase();
      if (byAlias.has(key)) errors.push(`alias "${key}" is claimed twice`);
      byAlias.set(key, name);
    }
    const messages = entry.messages ?? {};
    if (Object.keys(messages).length === 0) errors.push(`verb ${name} has no messages`);
    for (const [audience, template] of Object.entries(messages)) {
      for (const match of template.matchAll(/%(\w)/g)) {
        if (!CODES.has(match[1])) errors.push(`verb ${name} message "${audience}" uses unknown code %${match[1]}`);
      }
    }
  }

  return { verbs, byAlias, errors };
}

/** The verb name a word belongs to, or null. */
export const resolve = (table, word) => table.byAlias.get(word.toLowerCase()) ?? null;

/**
 * Fill a template. Missing values become an empty string rather than an
 * undefined, because a half-rendered message is worse than a terse one.
 */
export function render(template, values = {}) {
  if (typeof template !== "string") return "";
  return template.replace(/%(\w)/g, (_, code) => {
    const key = { a: "actor", o: "object", t: "target", s: "words" }[code];
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}
