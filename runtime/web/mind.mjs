// The agent's persistent working mind.
//
// A raw transcript is not memory: the model forgets what it tried, why it
// failed, and what it meant to do next. This module keeps the small, structured
// facts that make an agent an agent: identity, goal, plan, attempts, derived
// lessons, the social map, combat state, gear and a loop detector. It is
// deliberately compact and derivable, so it can be replayed and audited.

const VERSION = 1;
const MAX_ATTEMPTS = 12;
const MAX_LESSONS = 16;
const MAX_ROOMS = 14;

export const emptyMind = () => ({
  version: VERSION,
  identity: {},
  goal: "",
  plan: "",
  lessons: [],
  attempts: [],
  last: null,
  social: { players: [], npcs: [], knownNpcs: [], party: null, speech: [] },
  combat: { active: false, enemies: [], hp: null, maxHp: null, target: null },
  gear: { wielding: null, worn: [], weapons: [], armor: [] },
  stuck: { room: null, sameRoom: 0, looping: false, lastRooms: [] },
  updated: null,
});

const clean = (text, max = 240) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const WEAPON = /sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i;
const ARMOR = /mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i;

export function addLesson(mind, text) {
  const lesson = clean(text, 220);
  if (!lesson || /^none[.!]?$/i.test(lesson)) return mind;
  mind.lessons ??= [];
  if (!mind.lessons.includes(lesson)) mind.lessons.push(lesson);
  if (mind.lessons.length > MAX_LESSONS) mind.lessons.splice(0, mind.lessons.length - MAX_LESSONS);
  return mind;
}

const classifyOutcome = (observation = "", command = "") => {
  const text = String(observation ?? "");
  if (/You die|You fall|You have died/i.test(text)) return "death";
  if (/already fighting|already engaged/i.test(text)) return "redundant";
  if (/You (take|buy|wield|wear|drop|deliver|light|eat|drink|open|unlock|plant|use)\b/i.test(text)) return "progress";
  if (/You (strike|hit|miss)\b|strikes|misses|attacks/i.test(text)) return "combat";
  if (/says:|You say\b|tells you/i.test(text)) return "social";
  if (/You can't|You cannot|You see no|No such|not here|does not|requires|too many|your pack is full|not safe/i.test(text)) return "failed";
  if (/^\[.+\]$/m.test(text)) return "moved";
  if (/^(north|south|east|west|up|down|n|s|e|w|u|d)$/i.test(String(command).trim())) return "moved";
  return "observed";
};

const targetWords = (command) => {
  const parts = String(command ?? "").trim().split(/\s+/).slice(1);
  const stop = parts.findIndex((part) => /^(to|from|in|with|at)$/i.test(part));
  return (stop >= 0 ? parts.slice(0, stop) : parts).map((part) => part.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean);
};

const nameMatches = (name, words) => {
  const wanted = String(name ?? "").toLowerCase().split(/[^a-z0-9']+/).filter((word) => word.length > 1);
  if (!wanted.length || !words.length) return false;
  return wanted.every((word) => words.includes(word));
};

const socialFrom = (state) => {
  const players = (state?.room?.actors ?? []).map((actor) => clean(actor, 60));
  const npcs = (state?.room?.npcs ?? []).map((npc) => clean(npc.name ?? npc, 60));
  return { players, npcs, party: state?.self?.party ?? null };
};

const speechFrom = (observation) => {
  const lines = [];
  for (const line of String(observation ?? "").replace(/\r/g, "").split("\n")) {
    const match = line.trim().match(/^([A-Za-z][\w' -]{0,40}) says:\s*(.+)$/);
    if (match && !/^you$/i.test(match[1].trim())) lines.push({ speaker: match[1].trim(), text: clean(match[2], 160) });
  }
  return lines.slice(-4);
};

const gearFrom = (state) => {
  const self = state?.self ?? {};
  const names = self.inventory_names ?? [];
  return {
    wielding: self.wielding ?? null,
    worn: [...(self.worn ?? [])],
    weapons: names.filter((name) => WEAPON.test(name) && name !== self.wielding),
    armor: names.filter((name) => ARMOR.test(name) && !(self.worn ?? []).includes(name)),
  };
};

const stuckFrom = (prior, room) => {
  const lastRooms = [...(prior.lastRooms ?? [])];
  if (room && lastRooms.at(-1) !== room) lastRooms.push(room);
  if (lastRooms.length > MAX_ROOMS) lastRooms.splice(0, lastRooms.length - MAX_ROOMS);
  const sameRoom = room ? lastRooms.filter((entry) => entry === room).length : 0;
  const recent = lastRooms.slice(-6);
  const looping = recent.length >= 6 && new Set(recent).size <= 2;
  return { room, sameRoom, looping, lastRooms };
};

/** Fold one observed turn into the mind. Called before the next prompt. */
export function updateMind(mind, { state = null, observation = "", command = "", parsed = null, validation = null, room = null, tick = 0 } = {}) {
  if (!mind) return emptyMind();
  mind.version = VERSION;
  mind.identity = {
    name: state?.self?.name ?? mind.identity?.name ?? "",
    level: state?.self?.level ?? mind.identity?.level ?? 1,
    title: state?.self?.title ?? null,
    deaths: state?.self?.deaths ?? 0,
    guild: state?.self?.guild ?? null,
    guildRank: state?.self?.guild_rank ?? null,
    hp: state?.self?.hp ?? null,
    maxHp: state?.self?.max_hp ?? null,
    coins: state?.self?.coins ?? 0,
  };
  const tally = state?.self?.completion;
  if (tally) mind.goal = `level ${tally.maxLevel}, all ${tally.questsTotal} quests and all ${tally.puzzlesTotal} hidden ways`;
  if (parsed?.plan && !/^none[.!]?$/i.test(parsed.plan)) mind.plan = clean(parsed.plan, 240);
  if (parsed?.lesson) addLesson(mind, parsed.lesson);
  const social = socialFrom(state);
  const knownNpcs = [...new Set([...(mind.social?.knownNpcs ?? []), ...social.npcs])].slice(-20);
  mind.social = { ...social, knownNpcs };
  const said = speechFrom(observation);
  if (said.length) {
    mind.social.speech = [...(mind.social.speech ?? []), ...said].slice(-4);
  }
  const enemies = state?.self?.enemies ?? [];
  mind.combat = {
    active: enemies.length > 0,
    enemies: enemies.map((enemy) => ({
      name: enemy.name,
      hp: enemy.hp ?? null,
      maxHp: enemy.maxHp ?? null,
      level: enemy.level ?? null,
    })),
    hp: state?.self?.hp ?? null,
    maxHp: state?.self?.max_hp ?? null,
    target: enemies[0]?.name ?? null,
  };
  mind.gear = gearFrom(state);
  mind.stuck = stuckFrom(mind.stuck ?? {}, room ?? state?.room?.name ?? null);

  const outcome = classifyOutcome(observation, command);
  if (command) {
    const attempt = { command: clean(command, 120), outcome, room: room ?? state?.room?.name ?? null, tick };
    mind.attempts = [...(mind.attempts ?? []), attempt].slice(-MAX_ATTEMPTS);
    mind.last = attempt;
  }
  mind.updated = Date.now();

  if (validation && validation.ok === false) {
    const rejected = clean(validation.command ?? command, 80);
    addLesson(mind, `"${rejected}" was rejected: ${clean(validation.reason, 120)}. Use an exact target from ACTIONS or look first.`);
  }
  if (outcome === "redundant" || /already fighting|already engaged/i.test(observation)) {
    addLesson(mind, "Attack only starts a fight. While COMBAT is present the rounds are automatic; use a technique, eat/drink, cast mend, or flee instead of repeating attack.");
  }
  const words = targetWords(command);
  const verb = String(command).trim().split(/\s+/)[0]?.toLowerCase();
  const npcMatch = (mind.social.npcs ?? []).find((name) => nameMatches(name, words.slice(0, 4)));
  const playerMatch = (mind.social.players ?? []).find((name) => nameMatches(name, words.slice(0, 4)));
  if (verb === "say" && npcMatch) {
    addLesson(mind, `say is room speech. To speak with ${npcMatch}, use talk ${npcMatch}; NPCs do not answer tells.`);
  }
  if (verb === "say" && playerMatch) {
    addLesson(mind, `say is room speech. For a private message to ${playerMatch}, use tell ${playerMatch} <text>.`);
  }
  if (verb === "tell" && npcMatch) {
    addLesson(mind, `NPCs do not receive tells. Use talk ${npcMatch} for dialogue.`);
  }
  if (verb === "talk" && playerMatch) {
    addLesson(mind, `talk is for NPCs. For a player, use tell ${playerMatch} <text> or say <text> to the room.`);
  }
  if (/You see no|No such|not here|does not|You can't|You cannot/i.test(observation)) {
    addLesson(mind, "If a target is not visible, use look, examine, inventory or the ACTIONS menu before trying it.");
  }
  if (mind.gear.weapons.length) {
    addLesson(mind, `You are carrying an unwielded weapon (${mind.gear.weapons[0]}). Wield it before the next fight.`);
  }
  if (mind.gear.armor.length) {
    addLesson(mind, `You are carrying unworn armour (${mind.gear.armor[0]}). Wear it before the next fight.`);
  }
  if (mind.combat.active && Number.isFinite(mind.combat.hp) && Number.isFinite(mind.combat.maxHp) && mind.combat.hp <= Math.ceil(mind.combat.maxHp * 0.4)) {
    addLesson(mind, "Low health in combat: eat/drink or cast mend; do not keep attacking and hoping.");
  }
  if (mind.stuck.looping) {
    addLesson(mind, `You are looping around ${mind.stuck.room}. Take an exit you have not tried, examine the room, search, or talk to someone.`);
  }
  return mind;
}

/** The compact block the model sees each turn. */
export function mindPrompt(mind, { state = null, room = null } = {}) {
  if (!mind) return "";
  const identity = mind.identity ?? {};
  const lines = [];
  lines.push(`IDENTITY: ${identity.name || state?.self?.name || "you"} · level ${identity.level ?? state?.self?.level ?? 1}${identity.title ? ` · ${identity.title}` : ""}${identity.guild ? ` · ${identity.guild}${identity.guildRank ? ` (${identity.guildRank})` : ""}` : ""} · ${identity.deaths ?? 0} deaths · ${identity.coins ?? 0} coins.`);
  if (mind.goal) lines.push(`GOAL: ${mind.goal}${state?.self?.completion?.achieved ? " · ACHIEVED" : ""}.`);
  lines.push(`PLAN: ${mind.plan ? mind.plan.replace(/\.+$/, "") : "none yet; set one this turn"}.`);
  if (mind.last) lines.push(`LAST: ${mind.last.command} → ${mind.last.outcome}${mind.last.room ? ` in ${mind.last.room}` : ""}.`);
  const attempts = (mind.attempts ?? []).slice(-6).map((attempt) => `${attempt.command} → ${attempt.outcome}`);
  if (attempts.length) lines.push(`ATTEMPTS: ${attempts.join(" | ")}.`);
  if ((mind.lessons ?? []).length) lines.push(`LESSONS:\n${mind.lessons.slice(-8).map((lesson) => `- ${lesson}`).join("\n")}`);
  const social = mind.social ?? {};
  const players = social.players ?? [];
  const npcs = social.npcs ?? [];
  lines.push(`SOCIAL: players ${players.length ? players.join(", ") : "none"} · NPCs ${npcs.length ? npcs.join(", ") : "none"}${social.party ? ` · party ${social.party.members?.join(", ")}` : ""}.`);
  if (!npcs.length && (social.knownNpcs ?? []).length) lines.push(`KNOWN NPCs elsewhere: ${social.knownNpcs.slice(-6).join(", ")}.`);
  if ((social.speech ?? []).length) lines.push(`HEARD: ${social.speech.map((entry) => `${entry.speaker}: "${entry.text}"`).join(" | ")}`);
  if (mind.combat?.active) {
    lines.push(`COMBAT: ${mind.combat.enemies.map((enemy) => `${enemy.name} ${enemy.hp ?? "?"}/${enemy.maxHp ?? "?"} hp`).join("; ")}. Attack already started; rounds are automatic. Use technique, eat/drink, cast mend, or flee.`);
  } else {
    lines.push("COMBAT: none.");
  }
  const gear = mind.gear ?? {};
  lines.push(`GEAR: wielding ${gear.wielding || "nothing"} · worn ${(gear.worn ?? []).join(", ") || "nothing"}${(gear.weapons ?? []).length ? ` · unwielded weapons: ${gear.weapons.join(", ")}` : ""}${(gear.armor ?? []).length ? ` · unworn armour: ${gear.armor.join(", ")}` : ""}.`);
  if (mind.stuck?.looping || (mind.stuck?.sameRoom ?? 0) >= 4) {
    lines.push(`STUCK: ${mind.stuck.room} repeated ${mind.stuck.sameRoom} times. Do not repeat the same command; use an unexplored exit, examine, search, talk, or ask a player.`);
  }
  return lines.join("\n");
}
