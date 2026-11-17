// Spells, mana and the Mages' Guild's first curriculum.
//
// A spellbook is knowledge on the character; mana is a session pool. The
// reducer applies the effect, so a cast is replayable like any other intent.

export const SPELLS = [
  {
    id: "spark", name: "Spark", level: 1, mana: 3, target: "npc", effect: "damage",
    damage: 4, xp: 3,
    description: "A beginner's attack. One to four damage.",
    train: "The archmage traces a spark between two fingers.",
  },
  {
    id: "mend", name: "Mend", level: 1, mana: 4, target: "self", effect: "heal",
    heal: 4,
    description: "Close a wound with a word. Heals four plus half your level.",
    train: "The archmage presses a warm hand to your shoulder.",
  },
  {
    id: "light", name: "Light", level: 1, mana: 2, target: "self", effect: "light",
    description: "A cold flame that follows you. A convenience, not a weapon.",
    train: "The archmage lights a candle without touching it.",
  },
  {
    id: "shield", name: "Shield", level: 3, mana: 5, target: "self", effect: "shield",
    armor: 2, ticks: 120,
    description: "A brief ward. Two armour for thirty seconds.",
    train: "The air around the archmage hardens like glass.",
  },
  {
    id: "detect", name: "Detect", level: 3, mana: 3, target: "self", effect: "detect",
    description: "Read the room for what it is hiding.",
    train: "The archmage closes his eyes and names a door you cannot see.",
  },
  {
    id: "recall", name: "Recall", level: 5, mana: 10, target: "self", effect: "recall",
    description: "Return to the Atrium. The road is shorter going back.",
    train: "The archmage is suddenly standing where he was not.",
  },
];

export const SPELL_BY_ID = new Map(SPELLS.map((spell) => [spell.id, spell]));

export function spellById(id) {
  return SPELL_BY_ID.get(String(id ?? "").toLowerCase()) ?? null;
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
