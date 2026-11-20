// Player and AI character names. Names are lower-case words with a short
// numeric suffix so a fresh persona never collides with an older "scout".

const ADJECTIVES = [
  "amber", "ash", "bright", "calm", "cider", "dawn", "deep", "ember",
  "fen", "frost", "garden", "glass", "grey", "hollow", "moon", "moss",
  "pale", "quiet", "rain", "root", "salt", "silver", "still", "stone",
  "thorn", "tide", "white", "wild",
];

const NOUNS = [
  "badger", "beacon", "bloom", "crow", "fern", "fox", "hare", "heron",
  "lantern", "moth", "otter", "owl", "reed", "rose", "seed", "sparrow",
  "stag", "stone", "thistle", "wisp", "wolf",
];

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

export function randomCharacterName(random = Math.random) {
  const adjective = pick(ADJECTIVES, random);
  const noun = pick(NOUNS, random);
  const suffix = 10 + Math.floor(random() * 90);
  return `${adjective}-${noun}-${suffix}`;
}

export function uniqueCharacterName(taken = [], random = Math.random) {
  const used = new Set((Array.isArray(taken) ? taken : []).map((name) => String(name).toLowerCase()));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const name = randomCharacterName(random);
    if (!used.has(name)) return name;
  }
  const adjective = pick(ADJECTIVES, random);
  const noun = pick(NOUNS, random);
  return `${adjective}-${noun}-${1000 + Math.floor(random() * 9000)}`;
}

/** Decide whether an account should play or create a character. */
export function chooseCharacter({ wanted = "", explicit = false, characters = [], random = Math.random } = {}) {
  const list = Array.isArray(characters) ? characters : [];
  const name = String(wanted ?? "").trim();
  if (name && list.includes(name)) return { action: "play", name };
  if (!list.length) return { action: "create", name: name || uniqueCharacterName(list, random) };
  if (!explicit) return { action: "play", name: list[0] };
  return { action: "create", name: name || uniqueCharacterName(list, random) };
}
