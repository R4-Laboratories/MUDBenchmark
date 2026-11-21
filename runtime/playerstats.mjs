// Aggregate player statistics from the flat span log.
//
// This is a public view: counts, rates and distributions only. Account keys,
// character names, chat text and private tells never leave the server through
// this module. The raw per-account record stays in the span log.

const number = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const text = (value) => (value === undefined || value === null ? null : String(value));

const flag = (value) => value === true || value === "true";

const rate = (part, whole) => (whole ? part / whole : null);

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const aiFlag = (session) => {
  const value = session["session.ai"];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
};

const latestActors = (snapshots) => {
  // The newest snapshot is often taken with nobody online. Use the most recent
  // snapshot that actually holds players so the level distribution stays
  // descriptive instead of collapsing to zero between sessions.
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    try {
      const actors = JSON.parse(snapshot["world.actors"] ?? "[]");
      if (Array.isArray(actors) && actors.length) return { at: snapshot.at ?? null, actors };
    } catch {
      // skip a malformed snapshot
    }
  }
  return { at: snapshots[snapshots.length - 1]?.at ?? null, actors: [] };
};

export function summarizePlayers(spans) {
  const all = Array.isArray(spans) ? spans : [];
  const sessions = all.filter((span) => span.name === "world.session");
  const disconnects = all.filter((span) => span.name === "world.disconnect");
  const questSpans = all.filter((span) => span.name === "world.quest");
  const transitions = all.filter((span) => span.name === "world.transition" && (span["action.kind"] ?? "move") === "move");
  const combats = all.filter((span) => span.name === "world.combat");
  const inputs = all.filter((span) => span.name === "world.input");
  const snapshots = all.filter((span) => span.name === "world.snapshot");

  const prismAi = new Map();
  for (const span of all) {
    if (span.name !== "world.prism") continue;
    const id = text(span["prism.id"]);
    if (id) prismAi.set(id, flag(span["prism.ai"]));
  }
  const aiFor = (session) => {
    const explicit = aiFlag(session);
    if (explicit !== null) return explicit;
    const account = text(session["account.key"]);
    return account ? prismAi.get(account) ?? null : null;
  };

  const times = all.map((span) => span.at).filter((at) => typeof at === "string").sort();
  const sessionByActor = new Map();
  const accountSessions = new Map();
  const characters = new Set();
  for (const session of sessions) {
    const actor = text(session["actor.id"]);
    const account = text(session["account.key"]);
    if (actor) sessionByActor.set(actor, { account, ai: aiFor(session) });
    if (account) accountSessions.set(account, (accountSessions.get(account) ?? 0) + 1);
    if (session["actor.name"]) characters.add(String(session["actor.name"]).toLowerCase());
  }
  const accountOf = (span) => sessionByActor.get(text(span["actor.id"]))?.account ?? null;
  const isPlayer = (id) => sessionByActor.has(text(id));

  const ai = sessions.filter((session) => aiFor(session) === true).length;
  const human = sessions.filter((session) => aiFor(session) === false).length;
  const aiUnknown = sessions.length - ai - human;
  const registrations = sessions.filter((session) => session["session.kind"] === "register").length;
  const prism = sessions.filter((session) => flag(session["session.prism"])).length;
  const activeDays = new Set(sessions.map((session) => (typeof session.at === "string" ? session.at.slice(0, 10) : null)).filter(Boolean)).size;
  const returningAccounts = [...accountSessions.values()].filter((count) => count > 1).length;

  const disconnectByActor = new Map();
  for (const disconnect of disconnects) {
    const actor = text(disconnect["actor.id"]);
    const duration = number(disconnect.duration_ms);
    if (!actor || duration === null) continue;
    disconnectByActor.set(actor, (disconnectByActor.get(actor) ?? 0) + Math.max(0, duration));
  }
  const connectionActors = [...sessionByActor.keys()];
  const durations = connectionActors.map((actor) => disconnectByActor.get(actor)).filter((value) => value !== undefined);
  const totalPlaytime = durations.reduce((sum, value) => sum + value, 0);

  const questsById = new Map();
  let questAccepts = 0;
  let questCompletions = 0;
  let questAbandons = 0;
  for (const span of questSpans) {
    const id = text(span["quest.id"]);
    if (!id) continue;
    const action = text(span["quest.action"]);
    const actor = text(span["actor.id"]);
    const entry = questsById.get(id) ?? {
      id,
      name: text(span["quest.name"]) ?? id,
      accepts: 0,
      completions: 0,
      abandons: 0,
      actors: new Set(),
      completers: new Set(),
    };
    if (action === "accept") {
      questAccepts += 1;
      entry.accepts += 1;
      if (actor) entry.actors.add(actor);
    } else if (action === "complete") {
      questCompletions += 1;
      entry.completions += 1;
      if (actor) {
        entry.actors.add(actor);
        entry.completers.add(actor);
      }
    } else if (action === "abandon") {
      questAbandons += 1;
      entry.abandons += 1;
      if (actor) entry.actors.add(actor);
    }
    questsById.set(id, entry);
  }
  const questsByPlayer = [...questsById.values()]
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      actors: entry.actors.size,
      completers: entry.completers.size,
      accepts: entry.accepts,
      completions: entry.completions,
      abandons: entry.abandons,
      completion_rate: rate(entry.completers.size, entry.actors.size),
    }))
    .sort((a, b) => b.actors - a.actors || b.accepts - a.accepts || a.id.localeCompare(b.id));

  let rounds = 0;
  let hits = 0;
  let misses = 0;
  let kills = 0;
  let npcKills = 0;
  let pvpKills = 0;
  let playerDeaths = 0;
  let pvpRounds = 0;
  let npcRounds = 0;
  let damageTotal = 0;
  let damageHits = 0;
  const combatActors = new Set();
  for (const span of combats) {
    rounds += 1;
    const outcome = text(span.outcome);
    const damage = number(span.damage);
    if (outcome === "miss") misses += 1;
    else {
      hits += 1;
      if (outcome === "killed") kills += 1;
      if (damage !== null) {
        damageTotal += damage;
        damageHits += 1;
      }
    }
    const attacker = text(span["actor.id"]);
    const target = text(span["target.id"]);
    if (attacker) combatActors.add(attacker);
    if (isPlayer(attacker) && isPlayer(target)) pvpRounds += 1;
    else if (isPlayer(attacker)) npcRounds += 1;
    if (outcome !== "killed") continue;
    if (isPlayer(target)) {
      playerDeaths += 1;
      if (isPlayer(attacker)) pvpKills += 1;
    } else if (isPlayer(attacker)) {
      npcKills += 1;
    }
  }

  const roomVisits = new Map();
  const roomsByAccount = new Map();
  let visits = 0;
  for (const span of transitions) {
    const room = text(span["room.to"]);
    if (room === null) continue;
    visits += 1;
    const entry = roomVisits.get(room) ?? { id: room, visits: 0, accounts: new Set() };
    entry.visits += 1;
    const account = accountOf(span);
    if (account) {
      entry.accounts.add(account);
      const rooms = roomsByAccount.get(account) ?? new Set();
      rooms.add(room);
      roomsByAccount.set(account, rooms);
    }
    roomVisits.set(room, entry);
  }
  const rooms = [...roomVisits.values()]
    .map((entry) => ({ id: entry.id, visits: entry.visits, accounts: entry.accounts.size }))
    .sort((a, b) => b.visits - a.visits || a.id.localeCompare(b.id));
  const roomsPerAccount = [...roomsByAccount.values()].map((set) => set.size);

  const acceptedInputs = inputs.filter((span) => !span.refused);
  const refusedInputs = inputs.filter((span) => span.refused);
  const commandActors = new Set(acceptedInputs.map((span) => text(span["actor.id"])).filter(Boolean));

  const { at: snapshotAt, actors } = latestActors(snapshots);
  const levels = actors.map((actor) => number(actor.level)).filter((value) => value !== null);
  const distribution = { "1-4": 0, "5-7": 0, "8-10": 0 };
  for (const level of levels) {
    if (level <= 4) distribution["1-4"] += 1;
    else if (level <= 7) distribution["5-7"] += 1;
    else distribution["8-10"] += 1;
  }

  return {
    schema: "mudbenchmark/players/1",
    spans: all.length,
    window: { first: times[0] ?? null, last: times[times.length - 1] ?? null },
    sessions: {
      total: sessions.length,
      logins: sessions.length - registrations,
      registrations,
      prism,
      legacy: sessions.length - prism,
      human,
      ai,
      ai_unknown: aiUnknown,
      unique_accounts: accountSessions.size,
      unique_characters: characters.size,
      returning_accounts: returningAccounts,
      sessions_per_account: accountSessions.size ? sessions.length / accountSessions.size : null,
      active_days: activeDays,
    },
    playtime: {
      connections: connectionActors.length,
      completed: durations.length,
      open: connectionActors.length - durations.length,
      total_ms: durations.length ? totalPlaytime : null,
      average_ms: durations.length ? totalPlaytime / durations.length : null,
      median_ms: percentile(durations, 50),
      max_ms: durations.length ? Math.max(...durations) : null,
    },
    quests: {
      accepted: questAccepts,
      completed: questCompletions,
      abandoned: questAbandons,
      completion_rate: rate(questCompletions, questAccepts),
      unique_quests: questsById.size,
      by_quest: questsByPlayer.slice(0, 20),
    },
    combat: {
      rounds,
      hits,
      misses,
      kills,
      npc_kills: npcKills,
      pvp_kills: pvpKills,
      player_deaths: playerDeaths,
      hit_rate: rate(hits, hits + misses),
      kill_rate: rate(kills, rounds),
      player_death_rate: rate(playerDeaths, rounds),
      average_damage: damageHits ? damageTotal / damageHits : null,
      pvp_rounds: pvpRounds,
      npc_rounds: npcRounds,
      actors: combatActors.size,
    },
    rooms: {
      visits,
      unique: roomVisits.size,
      average_per_account: mean(roomsPerAccount),
      top: rooms.slice(0, 12),
    },
    commands: {
      accepted: acceptedInputs.length,
      refused: refusedInputs.length,
      actors: commandActors.size,
      average_per_connection: commandActors.size ? acceptedInputs.length / commandActors.size : null,
    },
    levels: {
      snapshot_at: snapshotAt,
      actors: levels.length,
      average: mean(levels),
      max: levels.length ? Math.max(...levels) : null,
      distribution,
      guilded: actors.filter((actor) => actor.guild).length,
    },
  };
}

const duration = (value) => {
  if (typeof value !== "number") return "—";
  const seconds = Math.round(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

export function playerLines(summary) {
  const pct = (value) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
  const sessions = summary.sessions;
  const playtime = summary.playtime;
  const quests = summary.quests;
  const combat = summary.combat;
  const rooms = summary.rooms;
  const levels = summary.levels;
  return [
    `spans ${summary.spans}  ${summary.window.first ?? "—"} → ${summary.window.last ?? "—"}`,
    `sessions ${sessions.total}  accounts ${sessions.unique_accounts}  characters ${sessions.unique_characters}  returning ${sessions.returning_accounts}`,
    `session mix  human ${sessions.human}  ai ${sessions.ai}  unknown ${sessions.ai_unknown}  prism ${sessions.prism}  legacy ${sessions.legacy}`,
    `playtime ${duration(playtime.total_ms)}  avg ${duration(playtime.average_ms)}  median ${duration(playtime.median_ms)}  open ${playtime.open}`,
    `quests accepted ${quests.accepted}  completed ${quests.completed}  rate ${pct(quests.completion_rate)}  unique ${quests.unique_quests}`,
    `combat rounds ${combat.rounds}  hits ${pct(combat.hit_rate)}  avg dmg ${combat.average_damage?.toFixed(1) ?? "—"}  npc kills ${combat.npc_kills}  pvp kills ${combat.pvp_kills}  player deaths ${combat.player_deaths}`,
    `rooms visits ${rooms.visits}  unique ${rooms.unique}  avg/account ${rooms.average_per_account?.toFixed(1) ?? "—"}`,
    `levels actors ${levels.actors}  avg ${levels.average?.toFixed(1) ?? "—"}  max ${levels.max ?? "—"}  guilded ${levels.guilded}`,
    `commands accepted ${summary.commands.accepted}  refused ${summary.commands.refused}  per connection ${summary.commands.average_per_connection?.toFixed(1) ?? "—"}`,
  ];
}
