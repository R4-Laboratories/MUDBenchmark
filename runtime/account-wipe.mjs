// Wipe every player account, character and pinned Prism log.
//
// This is the launch-cleanup path, not the strict single-account delete: it
// removes the whole player data set, keeps the world, and clears references
// that would otherwise point at accounts that no longer exist. The caller
// archives the files first and stops the server before using it.

import { GUILD_HALL } from "./guilds.mjs";

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

  // The Mages' Guild, the Wardens and the Night Market are world institutions;
  // their rosters are player data. Any other guild was founded by players and
  // goes with them. A vault item is
  // world state, so it falls in the shared hall instead of vanishing.
  for (const [id, guild] of Object.entries(state.guilds ?? {})) {
    for (const objectId of guild.vault ?? []) {
      const object = (state.objects ?? []).find((entry) => entry.id === objectId);
      if (!object) continue;
      object.holder = null;
      object.room = GUILD_HALL;
      object.inside = null;
      object.heldRoom = null;
      object.worn = false;
    }
    guild.vault = [];
    if (id !== "mages" && id !== "wardens" && id !== "night-market") {
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
