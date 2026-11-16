// Guilds: a name, a roster, and ranks. The state lives in the world; the
// membership lives on the identity.

export const RANKS = ["leader", "officer", "member"];

export const validGuildName = (name) =>
  typeof name === "string" && name.trim().length >= 2 && name.trim().length <= 32 && /^[a-z0-9][a-z0-9 '\-]*$/i.test(name.trim());

export function guildId(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

export const rankAtLeast = (rank, wanted) => RANKS.indexOf(rank) <= RANKS.indexOf(wanted);

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
