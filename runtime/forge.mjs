// Forge rules: set tags, salvage components, upgrade costs and set bonuses.
// Components are abstract counts on the character, not world objects.

export const COMPONENTS = {
  "ember-ore": "Ember ore",
  "wisp-glass": "Wisp glass",
  "salt-pearl": "Salt pearl",
  moonpetal: "Moon petal",
  "eclipse-token": "Eclipse token",
  "ashen-ash": "Ashen ash",
  "red-iron": "Red iron",
  "night-glass": "Night glass",
};

const SET_COMPONENT = {
  ember: "ember-ore",
  fen: "wisp-glass",
  salt: "salt-pearl",
  moon: "moonpetal",
  eclipse: "eclipse-token",
  ashen: "ashen-ash",
  red: "red-iron",
  night: "night-glass",
};

export const GEAR_SETS = {
  ember: "Ember Forge",
  fen: "Fen Wardens",
  salt: "Salt Wardens",
  moon: "Moon Wardens",
  eclipse: "Eclipse Court",
  ashen: "Ashen Hand",
  red: "Red Company",
  night: "Night Market",
};

export const MAX_UPGRADE = 3;

export function componentForItem(object) {
  return SET_COMPONENT[object?.set] ?? SET_COMPONENT[object?.faction] ?? "ember-ore";
}

export function upgradeCost(object) {
  const next = Math.min(MAX_UPGRADE, (object?.plus ?? 0) + 1);
  return { plus: next, component: componentForItem(object), count: next * 2, coins: next * 20 };
}

export function salvageYield(object) {
  return Math.max(1, Math.floor((Number(object?.value) || 0) / 20)) + (object?.plus ?? 0);
}

export function componentsText(components = {}) {
  const entries = Object.entries(components).filter(([, count]) => Number(count) > 0);
  if (!entries.length) return "You have no forge components.";
  return `Forge components: ${entries.map(([id, count]) => `${COMPONENTS[id] ?? id} ×${count}`).join(", ")}`;
}
