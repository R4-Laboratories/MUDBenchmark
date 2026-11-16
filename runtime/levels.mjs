// The level table: experience in, level out.
//
// It is data because every world disagrees about how long a level should take.
// The reducer only asks two questions: what level is this experience, and what
// does the next one cost?

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "levels.json");

export function loadLevels({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { levels: [0], errors: [`cannot read ${path}: ${error.message}`] };
  }
  const levels = raw.levels ?? [];
  if (!Array.isArray(levels) || levels.length === 0) errors.push("levels are empty");
  if (levels[0] !== 0) errors.push("the first level must start at 0 experience");
  for (let i = 1; i < levels.length; i += 1) {
    if (!Number.isInteger(levels[i]) || levels[i] <= levels[i - 1]) errors.push(`level ${i} does not cost more than level ${i - 1}`);
  }
  return { levels, errors };
}

/** The highest level whose threshold is at most `xp`, counting from 1. */
export function levelForXp(levels, xp) {
  let level = 1;
  for (let i = 1; i < levels.length; i += 1) {
    if (xp >= levels[i]) level = i + 1;
    else break;
  }
  return level;
}

/** Experience needed for the next level, or null at the top. */
export function nextLevelXp(levels, level) {
  return levels[level] ?? null;
}
