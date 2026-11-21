// Weapon-family techniques. A technique is a property of the weapon object,
// not a class or a quest: picking up a different weapon changes the option.

export const TECHNIQUES = {
  "power-strike": {
    id: "power-strike",
    name: "Power Strike",
    description: "Set up a heavier next blow (+4 damage).",
    cooldown: 24,
    effect: "damage",
    bonus: 4,
  },
  cleave: {
    id: "cleave",
    name: "Cleave",
    description: "Set up a broad next blow (+2 damage).",
    cooldown: 36,
    effect: "damage",
    bonus: 2,
  },
  bash: {
    id: "bash",
    name: "Bash",
    description: "Stun the target for one combat round.",
    cooldown: 36,
    effect: "stun",
    rounds: 12,
  },
  backstab: {
    id: "backstab",
    name: "Backstab",
    description: "Set up a precise next blow (+6 damage).",
    cooldown: 36,
    effect: "damage",
    bonus: 6,
  },
  rage: {
    id: "rage",
    name: "Rage",
    description: "Set up a furious next blow (+5 damage).",
    cooldown: 36,
    effect: "damage",
    bonus: 5,
  },
  drain: {
    id: "drain",
    name: "Drain",
    description: "The next blow heals half the damage dealt.",
    cooldown: 36,
    effect: "drain",
  },
  "chill-strike": {
    id: "chill-strike",
    name: "Chill Strike",
    description: "The next blow applies chill (-1 armour for two rounds).",
    cooldown: 24,
    effect: "status",
    status: "chill",
  },
};

export function techniqueForWeapon(weapon) {
  const id = weapon?.technique;
  return id && TECHNIQUES[id] ? TECHNIQUES[id] : null;
}

export function techniqueReady(actor, id, tick) {
  return (actor?.techniqueCooldowns?.[id] ?? -1) <= tick;
}
