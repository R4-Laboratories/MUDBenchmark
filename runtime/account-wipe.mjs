// Wipe every player account, character and pinned Prism log.
//
// This is the launch-cleanup path, not the strict single-account delete: it
// removes the whole player data set, keeps the world, and clears references
// that would otherwise point at accounts that no longer exist. The caller
// archives the files first and stops the server before using it.

const playerCounts = (state, store) => ({
  accounts: Object.keys(state.accounts ?? {}).length,
  identities: Object.keys(state.identities ?? {}).length,
  pinned: Object.keys(store?.prisms ?? {}).length,
  actors: (state.actors ?? []).length,
  guildMembers: Object.values(state.guilds ?? {}).reduce(
    (sum, guild) => sum + Object.keys(guild.members ?? {}).length,
    0,
  ),
  mail: (state.mail ?? []).length,
  duels: (state.duels ?? []).length,
  engagements: (state.engagements ?? []).length,
});

export function wipePlayers(state, store) {
  const before = playerCounts(state, store);

  state.accounts = {};
  state.identities = {};
  state.actors = [];
  state.mail = [];
  state.duels = [];
  state.engagements = [];

  // The Mages' Guild is a world institution; its roster is player data. Any
  // other guild was founded by players and goes with them.
  for (const [id, guild] of Object.entries(state.guilds ?? {})) {
    if (id !== "mages") {
      delete state.guilds[id];
      continue;
    }
    guild.members = {};
    guild.invites = [];
  }

  if (store) {
    // Every id that held a pin at reset time is a removed test identity. Block
    // the exact ids so a client that mints a fresh session still cannot return.
    const pinned = Object.keys(store.prisms ?? {});
    store.blocked = [...new Set([...(store.blocked ?? []), ...pinned])];
    store.prisms = {};
    // Sessions minted before this reset cannot be replayed to re-pin a removed
    // identity. New sign-ins mint a session after this instant and pass unless
    // their id is blocked.
    store.revokedBefore = Date.now();
  }

  return {
    before,
    after: playerCounts(state, store),
    revokedBefore: store?.revokedBefore ?? null,
    blocked: store?.blocked ?? [],
  };
}
