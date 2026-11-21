// The server-wide view players and AIs can share.
//
// Level, XP, equipment counts, quest counts, guild membership and the two-hour
// reset are world facts, not private session details. This module is the one
// shape used by the `world` command, the public `/world` endpoint and the
// periodic `world.snapshot` telemetry span.

import { phaseAt, TICK_MS } from "./world.mjs";
import { currentEvent } from "./events.mjs";

function equipment(state, actor) {
  const worn = state.objects
    .filter((object) => object.holder === actor.id && object.worn)
    .map((object) => object.name);
  const wielded = state.objects.find((object) => object.id === actor.wielding);
  return { worn, wielded: wielded?.name ?? null };
}

export function worldStatus(state, rooms, { detail = true } = {}) {
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
        coins: state.objects
          .filter((object) => object.holder === actor.id && (object.flags ?? []).includes("coin") && !object.eaten)
          .reduce((sum, object) => sum + (Number.isFinite(object.value) ? object.value : 0), 0),
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

  const event = currentEvent(state.cycle ?? 0);
  const status = {
    schema: "mudbenchmark/world/1",
    tick: state.tick,
    phase: phaseAt(state.tick, state.climate),
    weather: state.climate?.weather?.[state.weather]?.id ?? null,
    weatherText: state.climate?.weather?.[state.weather]?.text ?? null,
    event,
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
    guilds,
  };
  // Actor positions and vitals are a live god view. The public HTTP shape is
  // aggregate only; the authenticated in-client `overview` command carries the
  // detailed list over the player's own socket.
  if (detail) {
    status.actors = actors;
    status.top = actors.slice(0, 5).map((actor) => ({ name: actor.name, level: actor.level, xp: actor.xp }));
  }
  return status;
}

export function worldOverview(state, rooms) {
  const status = worldStatus(state, rooms);
  const everyone = new Map([...state.actors, ...state.npcs].map((entry) => [entry.id, entry]));
  const fights = [];
  const seen = new Set();
  for (const engagement of state.engagements ?? []) {
    const attacker = everyone.get(engagement.attackerId);
    const target = everyone.get(engagement.targetId);
    if (!attacker || !target) continue;
    const key = [attacker.id, target.id].sort().join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    fights.push({
      attacker: attacker.name,
      target: target.name,
      room: rooms[attacker.room]?.name ?? String(attacker.room),
      attackerHp: attacker.hp ?? null,
      attackerMaxHp: attacker.maxHp ?? null,
      targetHp: target.hp ?? null,
      targetMaxHp: target.maxHp ?? null,
    });
  }
  return {
    schema: "mudbenchmark/overview/1",
    tick: state.tick,
    online: status.online,
    actors: status.actors,
    fights,
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
    `Event: ${status.event?.name ?? "none"} — ${status.event?.text ?? ""}`,
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
