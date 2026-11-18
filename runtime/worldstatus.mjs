// The server-wide view players and AIs can share.
//
// Level, XP, equipment counts, quest counts, guild membership and the two-hour
// reset are world facts, not private session details. This module is the one
// shape used by the `world` command, the public `/world` endpoint and the
// periodic `world.snapshot` telemetry span.

import { phaseAt, TICK_MS } from "./world.mjs";

function equipment(state, actor) {
  const worn = state.objects
    .filter((object) => object.holder === actor.id && object.worn)
    .map((object) => object.name);
  const wielded = state.objects.find((object) => object.id === actor.wielding);
  return { worn, wielded: wielded?.name ?? null };
}

export function worldStatus(state, rooms) {
  const actors = state.actors
    .filter((actor) => actor.key)
    .map((actor) => {
      const gear = equipment(state, actor);
      return {
        name: actor.name,
        room: rooms[actor.room]?.name ?? String(actor.room),
        level: actor.level ?? 1,
        xp: actor.xp ?? 0,
        hp: actor.hp ?? null,
        maxHp: actor.maxHp ?? null,
        mana: actor.mana ?? null,
        maxMana: actor.maxMana ?? null,
        spells: [...(actor.spellbook ?? [])],
        guild: actor.guild ?? null,
        guildRank: actor.guildRank ?? null,
        quests: {
          active: actor.quests?.active?.length ?? 0,
          completed: actor.quests?.completed?.length ?? 0,
        },
        inventory: state.objects.filter((object) => object.holder === actor.id && !object.worn).length,
        ...gear,
      };
    })
    .sort((a, b) => b.level - a.level || b.xp - a.xp || a.name.localeCompare(b.name));

  const area = state.pulses?.area ?? { period: 28_800, remaining: 28_800 };
  const guilds = Object.values(state.guilds ?? {})
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      members: Object.keys(guild.members ?? {}).length,
      level: guild.level ?? 1,
      xp: guild.xp ?? 0,
      perks: [...(guild.perks ?? [])],
    }))
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));

  return {
    schema: "mudbenchmark/world/1",
    tick: state.tick,
    phase: phaseAt(state.tick, state.climate),
    weather: state.climate?.weather?.[state.weather]?.id ?? null,
    weatherText: state.climate?.weather?.[state.weather]?.text ?? null,
    online: actors.length,
    accounts: Object.keys(state.accounts ?? {}).length,
    characters: Object.keys(state.identities ?? {}).length,
    rooms: Object.keys(rooms ?? {}).length,
    npcs: (state.npcs ?? []).filter((npc) => !npc.dead).length,
    objects: (state.objects ?? []).filter((object) => !object.eaten).length,
    reset: {
      period: area.period,
      remaining: area.remaining,
      seconds: Math.max(0, Math.round((area.remaining * TICK_MS) / 1000)),
    },
    actors,
    guilds,
    top: actors.slice(0, 5).map((actor) => ({ name: actor.name, level: actor.level, xp: actor.xp })),
  };
}

const duration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

export function worldStatusText(status) {
  const lines = [
    `MUDBench: ${status.online} online · ${status.rooms} rooms · ${status.phase} · ${status.weather ?? "clear"} · reset in ${duration(status.reset.seconds)}.`,
    `Accounts ${status.accounts} · characters ${status.characters} · mobiles ${status.npcs} · objects ${status.objects}.`,
  ];
  if (!status.actors.length) {
    lines.push("No one is online.");
  } else {
    lines.push("Online:");
    for (const actor of status.actors) {
      const guild = actor.guild ? ` · guild ${actor.guild}` : "";
      const gear = actor.wielded ? ` · wielding ${actor.wielded}` : "";
      const mana = actor.maxMana ? ` · mana ${actor.mana}/${actor.maxMana}` : "";
      lines.push(`  ${actor.name} — level ${actor.level}, ${actor.xp} xp, ${actor.room}${mana}${guild}${gear}`);
    }
  }
  if (status.guilds.length) {
    lines.push(`Guilds: ${status.guilds.map((guild) => `${guild.name} (level ${guild.level}, ${guild.members})`).join(", ")}.`);
  }
  return lines.join("\r\n");
}
