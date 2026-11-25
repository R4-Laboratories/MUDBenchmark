// Spells, mana and the Mages' Guild's first curriculum.
//
// A spellbook is knowledge on the character; mana is a session pool. The
// reducer applies the effect, so a cast is replayable like any other intent.

export const SPELLS = [
  {
    id: "spark", cost: 15, name: "Spark", level: 1, mana: 3, target: "npc", effect: "damage",
    damage: 4, xp: 3, status: "burn",
    description: "A beginner's attack. One to four damage and a short burn.",
    train: "The archmage traces a spark between two fingers.",
  },
  {
    id: "mend", cost: 20, name: "Mend", level: 1, mana: 4, target: "self", effect: "heal",
    heal: 4,
    description: "Close a wound with a word. Heals four plus half your level.",
    train: "The archmage presses a warm hand to your shoulder.",
  },
  {
    id: "light", cost: 10, name: "Light", level: 1, mana: 2, target: "self", effect: "light",
    description: "A cold flame that follows you. A convenience, not a weapon.",
    train: "The archmage lights a candle without touching it.",
  },
  {
    id: "shield", cost: 40, name: "Shield", level: 3, mana: 5, target: "self", effect: "shield",
    armor: 2, ticks: 120,
    description: "A brief ward. Two armour for thirty seconds.",
    train: "The air around the archmage hardens like glass.",
  },
  {
    id: "detect", cost: 30, name: "Detect", level: 3, mana: 3, target: "self", effect: "detect",
    description: "Read the room for what it is hiding.",
    train: "The archmage closes his eyes and names a door you cannot see.",
  },
  {
    id: "recall", cost: 80, name: "Recall", level: 5, mana: 10, target: "self", effect: "recall",
    description: "Return to the Atrium. The road is shorter going back.",
    train: "The archmage is suddenly standing where he was not.",
  },
];

export const SPELL_BY_ID = new Map(SPELLS.map((spell) => [spell.id, spell]));

/** The target text after `on` for a scroll command, or the old tail form. */
export function scrollTargetName(restRaw = [], onIndex = -1) {
  return onIndex > 0 ? restRaw.slice(onIndex + 1).join(" ") : restRaw.slice(1).join(" ");
}

export function spellById(id) {
  return SPELL_BY_ID.get(String(id ?? "").toLowerCase()) ?? null;
}

export function spellPower(actor, focus = 0) {
  const level = Math.max(1, actor?.level ?? 1);
  const gear = Math.max(0, Number(focus) || 0);
  return Math.floor(level / 3) + Math.floor(gear / 2);
}

export function maxManaFor(actor) {
  return 3 + Math.max(1, actor?.level ?? 1) * 2 + (actor?.guild === "mages" ? 4 : 0);
}

export function knownSpells(actor) {
  return new Set((actor?.spellbook ?? []).map((id) => String(id).toLowerCase()));
}

export function trainableSpells(actor) {
  const known = knownSpells(actor);
  return SPELLS.filter((spell) => !known.has(spell.id) && (actor?.level ?? 1) >= spell.level);
}

export function spellLine(spell) {
  return `${spell.name} (${spell.id}) — ${spell.mana} mana, level ${spell.level}: ${spell.description}`;
}

export function trainingCost(spell, guild = null) {
  const cost = Number.isInteger(spell?.cost) ? spell.cost : 0;
  return guild?.perks?.includes("trainer-discount") ? Math.ceil(cost * 0.9) : cost;
}
