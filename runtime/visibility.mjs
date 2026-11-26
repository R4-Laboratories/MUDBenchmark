// Player-facing visibility: levels, all-time leaderboard, map and shortcuts.
// Pure functions so the gate can check the text without a live socket.

export function levelRows(levels) {
  const rows = Array.isArray(levels?.levels) ? levels.levels : [];
  return rows.map((xp, index) => ({ level: index + 1, xp }));
}

export function levelsText(levels, currentLevel = 1) {
  const rows = levelRows(levels);
  if (!rows.length) return "No level table is loaded.";
  const lines = [`Levels (${rows.length}):`];
  for (const row of rows) {
    const next = rows[row.level];
    const span = next ? `${row.xp}–${Math.max(row.xp, next.xp - 1)} xp` : `${row.xp}+ xp`;
    lines.push(`  ${row.level === currentLevel ? "→" : " "} ${row.level} · ${span}`);
  }
  lines.push("Level is raised by XP from quests and kills; the next threshold is shown by score.");
  return lines.join("\n");
}

export function leaderboardRows(identities) {
  return Object.entries(identities ?? {})
    .map(([key, identity]) => ({
      name: identity?.name ?? key,
      level: identity?.level ?? 1,
      xp: identity?.xp ?? 0,
      quests: identity?.quests?.completed?.length ?? 0,
      guild: identity?.guild ?? null,
      guildRank: identity?.guildRank ?? null,
    }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp || a.name.localeCompare(b.name));
}

export function duelLadderRows(identities) {
  return Object.entries(identities ?? {})
    .map(([key, identity]) => ({
      name: identity?.name ?? key,
      wins: identity?.duelWins ?? 0,
      losses: identity?.duelLosses ?? 0,
      rating: identity?.duelRating ?? 1000,
    }))
    .filter((row) => row.wins + row.losses > 0)
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));
}

export function duelLadderText(identities, limit = 10) {
  const rows = duelLadderRows(identities);
  if (!rows.length) return "The Ring ladder is empty. Duels begin at the Ring beneath the Docks.";
  const lines = [`Ring ladder (${rows.length} duelists, top ${Math.min(limit, rows.length)}):`];
  rows.slice(0, limit).forEach((row, index) => {
    lines.push(`  ${String(index + 1).padStart(2)}. ${row.name} — rating ${row.rating}, ${row.wins}W/${row.losses}L`);
  });
  if (rows.length > limit) lines.push(`  … ${rows.length - limit} more.`);
  return lines.join("\n");
}

export function leaderboardText(identities, limit = 10) {
  const rows = leaderboardRows(identities);
  if (!rows.length) return "No characters yet.";
  const lines = [`Leaderboard (${rows.length} characters, top ${Math.min(limit, rows.length)}):`];
  rows.slice(0, limit).forEach((row, index) => {
    const guild = row.guild ? ` · ${row.guild}${row.guildRank ? ` (${row.guildRank})` : ""}` : "";
    lines.push(`  ${String(index + 1).padStart(2)}. ${row.name} — level ${row.level}, ${row.xp} xp, ${row.quests} quests${guild}`);
  });
  if (rows.length > limit) lines.push(`  … ${rows.length - limit} more; use leaderboard to see this list.`);
  return lines.join("\n");
}

export function mapText(rooms, zones, visited = [], currentId = 0, wantedZone = "") {
  const seen = new Set((visited ?? []).map(Number));
  const groups = Array.isArray(zones) ? zones : [];
  const current = rooms?.[currentId];
  const currentZone = groups.find((zone) => zone.id === current?.zone);
  const lines = [
    `Map: ${Object.keys(rooms ?? {}).length} rooms in ${groups.length} zones.`,
    `Current: ${current?.name ?? "nowhere"}${currentZone ? ` (${currentZone.name})` : ""} · visited ${seen.size}.`,
  ];
  const filter = String(wantedZone ?? "").trim().toLowerCase();
  if (filter) {
    const zone = groups.find((entry) => entry.id === filter || entry.name?.toLowerCase().includes(filter));
    if (!zone) return `${lines[0]}\nNo zone named "${wantedZone}".`;
    const found = zone.rooms.filter((id) => seen.has(Number(id))).length;
    lines.push(`${zone.name} (${zone.rooms.length} rooms · ${found}/${zone.rooms.length} visited):`);
    for (const id of zone.rooms) {
      const room = rooms[id];
      if (!room) continue;
      const name = seen.has(Number(id)) ? room.name : "unexplored";
      lines.push(`  ${Number(id) === Number(currentId) ? "→" : " "} ${name}`);
    }
    return lines.join("\n");
  }
  for (const zone of groups) {
    const total = zone.rooms.length;
    const found = zone.rooms.filter((id) => seen.has(Number(id))).length;
    lines.push(`  ${zone.name}: ${found}/${total} visited${zone.id === currentZone?.id ? " ← here" : ""}`);
  }
  lines.push("Use map <zone> for room names; unvisited rooms stay unexplored.");
  return lines.join("\n");
}

export function shortcutsText() {
  return [
    "Movement: north/south/east/west/up/down (n/s/e/w/u/d) or go <direction>.",
    "Look: look (l), examine (ex/x), exits are shown after look.",
    "Fast commands: inventory/i, score/sc, quests/q, equipment/eq, who/wh, spells, world/status.",
    "Visibility: levels, leaderboard/top/lb, map [zone], wayfarer, shortcuts.",
    "Travel: recall (spell) returns to the Atrium; the first flame and green heart are room shortcuts.",
  ].join("\n");
}
