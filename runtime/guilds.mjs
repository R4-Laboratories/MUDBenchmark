// Guilds: a name, a roster, and ranks. The state lives in the world; the
// membership lives on the identity.

export const RANKS = ["leader", "officer", "member"];

// The shared hall is room 24, south of the Gilded Rat. The vault is per guild
// but lives in one physical room, so the room id is a world constant here.
export const GUILD_HALL = 24;
export const GUILD_VAULT_CAPACITY = 20;
export const guildVaultHolder = (id) => `guild:${id}`;
export const isGuildVaultHolder = (holder) => typeof holder === "string" && holder.startsWith("guild:");

export const validGuildName = (name) =>
  typeof name === "string" && name.trim().length >= 2 && name.trim().length <= 32 && /^[a-z0-9][a-z0-9 '\-]*$/i.test(name.trim());

export function guildId(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

/** Wardens rank perks: scout armour, ranger damage, warden both. */
export function wardenBonus(actor) {
  if (actor?.guild !== "wardens") return { armor: 0, damage: 0 };
  if (actor.guildRank === "warden") return { armor: 1, damage: 1 };
  if (actor.guildRank === "ranger") return { armor: 0, damage: 1 };
  if (actor.guildRank === "scout") return { armor: 1, damage: 0 };
  return { armor: 0, damage: 0 };
}

/** Night Market rank perks: cutpurse armour, shadow damage, master both. */
export function nightBonus(actor) {
  if (actor?.guild !== "night-market") return { armor: 0, damage: 0 };
  if (actor.guildRank === "master") return { armor: 1, damage: 1 };
  if (actor.guildRank === "shadow") return { armor: 0, damage: 1 };
  if (actor.guildRank === "cutpurse") return { armor: 1, damage: 0 };
  return { armor: 0, damage: 0 };
}

/** The combat bonus from whichever guild the character belongs to. */
export function guildBonus(actor) {
  if (actor?.guild === "wardens") return wardenBonus(actor);
  if (actor?.guild === "night-market") return nightBonus(actor);
  return { armor: 0, damage: 0 };
}

export const rankAtLeast = (rank, wanted, ranks = RANKS) => {
  const have = ranks.indexOf(rank);
  const need = ranks.indexOf(wanted);
  return have >= 0 && need >= 0 && have <= need;
};

/** Ascending progression ranks (apprentice -> archmage, runner -> master). */
export const progressionAtLeast = (rank, wanted, ranks = []) => {
  const have = ranks.indexOf(rank);
  const need = ranks.indexOf(wanted);
  return have >= 0 && need >= 0 && have >= need;
};

export const GUILD_LEVELS = [0, 100, 300, 600, 1000, 1600];

export function guildLevelFor(xp) {
  let level = 1;
  for (let index = 1; index < GUILD_LEVELS.length; index += 1) {
    if (xp >= GUILD_LEVELS[index]) level = index + 1;
  }
  return level;
}

export function perksFor(level) {
  const perks = [];
  if (level >= 2) perks.push("hall-chest");
  if (level >= 3) perks.push("trainer-discount");
  if (level >= 4) perks.push("guild-quest-2");
  if (level >= 5) perks.push("banner");
  if (level >= 6) perks.push("guild-quest-3");
  return perks;
}

/** The next leader: the earliest officer, otherwise the earliest member. */
export function successor(members, leavingKey) {
  const entries = Object.entries(members).filter(([key]) => key !== leavingKey);
  return entries.find(([, rank]) => rank === "officer")?.[0] ?? entries[0]?.[0] ?? null;
}

/** Remove a key from every guild's roster and invites. */
export function removeMember(guild, key) {
  delete guild.members[key];
  guild.invites = (guild.invites ?? []).filter((invite) => invite !== key);
}
