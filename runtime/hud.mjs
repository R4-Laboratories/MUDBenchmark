// Which parts of a self snapshot the HUD shows. Combat rounds run on the tick,
// not on a command, so a player who is hit must be refreshed even though no
// intent named them. Comparing these fields is cheaper and narrower than
// refreshing every online actor every tick.

export const HUD_FIELDS = [
  "name", "level", "xp", "deaths", "hp", "max_hp", "mana", "max_mana",
  "armor", "damage", "coins", "wielding", "worn", "inventory_names",
  "enemies", "effects", "quests", "completion", "title", "guild",
  "guild_rank", "party", "party_invites",
];

export function hudSnapshot(self) {
  const picked = {};
  for (const field of HUD_FIELDS) picked[field] = self?.[field] ?? null;
  return JSON.stringify(picked);
}

export function hudChanged(before, after) {
  return before !== after;
}
