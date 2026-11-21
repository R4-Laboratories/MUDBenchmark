// Four local factions, one for each exploration zone. Standing is earned by
// fighting the things that live there, not by a quest checklist. Thresholds
// unlock quartermaster stock.

export const FACTIONS = {
  ember: {
    id: "ember",
    name: "The Ember Forge",
    contact: "forge-master",
    room: 63,
    ranks: ["outsider", "spark", "forgefriend", "ember-sworn"],
  },
  fen: {
    id: "fen",
    name: "The Fen Wardens",
    contact: "heron-keeper",
    room: 80,
    ranks: ["outsider", "trailhand", "fenfriend", "fen-sworn"],
  },
  salt: {
    id: "salt",
    name: "The Salt Wardens",
    contact: "tide-hermit",
    room: 83,
    ranks: ["outsider", "tidewalker", "saltfriend", "brine-sworn"],
  },
  moon: {
    id: "moon",
    name: "The Moon Wardens",
    contact: "silver-owl",
    room: 88,
    ranks: ["outsider", "moonwatcher", "moonfriend", "moon-sworn"],
  },
  ashen: {
    id: "ashen",
    name: "The Ashen Hand",
    contact: "ashen-priest",
    room: 58,
    ranks: ["outsider", "acolyte", "ashfriend", "ash-sworn"],
  },
  red: {
    id: "red",
    name: "The Red Company",
    contact: "red-captain",
    room: 71,
    ranks: ["outsider", "blooded", "redfriend", "red-sworn"],
  },
};

export const STANDING_THRESHOLDS = [0, 3, 6, 10];

export function factionRank(id, value = 0) {
  const faction = FACTIONS[id] ?? null;
  const points = Math.max(0, Number(value) || 0);
  let index = 0;
  for (let i = 0; i < STANDING_THRESHOLDS.length; i += 1) {
    if (points >= STANDING_THRESHOLDS[i]) index = i;
  }
  return {
    faction: faction?.id ?? id,
    name: faction?.ranks?.[index] ?? "outsider",
    value: points,
    next: STANDING_THRESHOLDS[index + 1] ?? null,
  };
}

export const factionAllows = (standing, id, minimum = 0) =>
  (Number(standing?.[id]) || 0) >= minimum;

export function standingsText(standing = {}) {
  const lines = ["Faction standing:"];
  for (const faction of Object.values(FACTIONS)) {
    const rank = factionRank(faction.id, standing?.[faction.id] ?? 0);
    lines.push(`  ${faction.name}: ${rank.value} (${rank.name})${rank.next === null ? " · max" : ` · next ${rank.next}`}`);
  }
  return lines.join("\n");
}
