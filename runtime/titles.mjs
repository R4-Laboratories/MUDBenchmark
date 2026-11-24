// Titles are earned facts, not a second progression track. A title names one
// completed quest; the character chooses which earned title to wear.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "titles.json");

export function loadTitles({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { titles: [], errors: [`cannot read ${path}: ${error.message}`] };
  }
  const titles = [];
  const ids = new Set();
  for (const title of raw.titles ?? []) {
    if (typeof title.id !== "string" || !title.id) errors.push("a title has no id");
    if (ids.has(title.id)) errors.push(`title id "${title.id}" is used twice`);
    ids.add(title.id);
    if (typeof title.name !== "string" || !title.name) errors.push(`title ${title.id} has no name`);
    if (title.completion !== true && (typeof title.quest !== "string" || !title.quest)) {
      errors.push(`title ${title.id} has no quest or completion condition`);
    }
    titles.push({ ...title });
  }
  return { titles, errors };
}

export const earnedTitles = (titles, completed = [], completion = false) =>
  titles.filter((title) => (title.completion === true ? completion : completed.includes(title.quest)));

export function titleLookup(titles, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  return titles.find((title) => title.id.toLowerCase() === wanted || title.name.toLowerCase() === wanted) ?? null;
}
