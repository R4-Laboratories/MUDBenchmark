// A small, model-independent focus planner.
//
// The LLM should choose among meaningful actions, not rediscover the verb list
// every turn. This module turns the live state and route memory into one clear
// focus and a short candidate list: survive, equip, take gear, pursue the next
// unfinished quest objective, accept a quest, or explore. It does not execute
// anything; the model still chooses the command.

import { frontier, pathTo } from "./memory.mjs";

const WEAPON = /sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i;
const ARMOR = /mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i;

const unique = (values) => [...new Set((values ?? []).filter(Boolean))];
const roomName = (state) => state?.room?.name ?? null;
const names = (values) => (values ?? []).map((entry) => String(entry?.name ?? entry)).filter(Boolean);

const routeFor = (memory, from, to) => {
  if (!from || !to || from === to) return [];
  return pathTo(memory, from, to) ?? [];
};

const withRoute = (focus, memory, from, target) => {
  const route = routeFor(memory, from, target);
  return { ...focus, target: target ?? null, route, routeText: route.length ? `${route[0]} (${route.length} move${route.length === 1 ? "" : "s"} to ${target})` : target && target !== from ? `no known route to ${target}; explore` : target === from ? "you are here" : "" };
};

const objectiveScore = (objective, { state, memory, from, mind } = {}) => {
  const room = state?.room ?? {};
  const self = state?.self ?? {};
  if (!objective || objective.done) return 0;
  const npcHere = (name) => names(room.npcs).some((entry) => entry.toLowerCase().includes(String(name ?? "").replace(/^the /, "")));
  const held = (name) => (self.inventory_names ?? []).some((entry) => entry.toLowerCase().includes(String(name ?? "").replace(/^the /, "")));
  if (objective.kind === "visit") {
    if (objective.roomName === from) return 5;
    return routeFor(memory, from, objective.roomName).length ? 4 : 1;
  }
  if (objective.kind === "kill") {
    if (npcHere(objective.npcName ?? objective.npc)) return 5;
    return routeFor(memory, from, objective.npcRoomName).length ? 4 : 1;
  }
  if (objective.kind === "collect") {
    if (held(objective.objectName ?? objective.object)) return 5;
    if (objective.objectRoomName === from) return 5;
    return routeFor(memory, from, objective.objectRoomName).length ? 4 : 1;
  }
  if (objective.kind === "deliver") {
    if (held(objective.objectName ?? objective.object) && npcHere(objective.npcName ?? objective.npc)) return 5;
    return routeFor(memory, from, objective.npcRoomName ?? objective.objectRoomName).length ? 4 : 1;
  }
  if (objective.kind === "talk") {
    if (npcHere(objective.npcName ?? objective.npc)) return 5;
    return routeFor(memory, from, objective.npcRoomName).length ? 4 : 1;
  }
  if (objective.kind === "answer") return mind?.knownWord ? 6 : 1;
  return 1;
};

const offerScore = (quest, { memory, from } = {}) => {
  if (quest.giverRoomName === from) return 5;
  return routeFor(memory, from, quest.giverRoomName).length ? 4 : 1;
};

export function focusFor({ state = null, memory = null, mind = null, preferExplore = false } = {}) {
  const self = state?.self ?? {};
  const room = state?.room ?? {};
  const from = room.name ?? null;
  const enemies = self.enemies ?? [];
  if (enemies.length) {
    const enemy = enemies[0];
    const technique = self.techniques?.[0]?.id;
    const food = (self.inventory_names ?? []).find((name) => /bread|stew|herb|ration|meat|apple|cheese|soup|loaf|berry|fish/i.test(name));
    const focus = {
      kind: "combat",
      label: `survive ${enemy.name}`,
      reason: "attack already started the fight; rounds are automatic",
      candidates: unique([
        technique ? `technique ${technique}` : null,
        food ? `eat ${food}` : null,
        (self.spells ?? []).includes("mend") ? "cast mend" : null,
        "flee",
      ]),
    };
    return withRoute(focus, memory, from, from);
  }

  const hasStats = (self.inventory_items ?? []).length > 0;
  const carried = hasStats
    ? self.inventory_items
    : (self.inventory_names ?? []).map((name) => ({ name, damage: 0, armor: 0, slot: null }));
  const mainDamage = self.equipment?.mainhand?.damage ?? 0;
  const carriedWeapons = carried.filter((item) => WEAPON.test(item.name) && item.name !== self.wielding && (!hasStats || (item.damage ?? 0) > mainDamage)).map((item) => item.name);
  const carriedArmor = carried.filter((item) => ARMOR.test(item.name) && !(self.worn ?? []).includes(item.name)
    && (!hasStats || (item.armor ?? 0) > (self.equipment?.[item.slot]?.armor ?? 0))).map((item) => item.name);
  if (carriedWeapons.length || carriedArmor.length) {
    const candidates = [
      ...carriedWeapons.map((name) => `wield ${name}`),
      ...carriedArmor.map((name) => `wear ${name}`),
    ];
    return withRoute({
      kind: "equip",
      label: carriedWeapons.length ? `wield ${carriedWeapons[0]}` : `wear ${carriedArmor[0]}`,
      reason: "carried gear is not equipped",
      candidates: unique([...candidates, "score", "equipment"]),
    }, memory, from, from);
  }

  const roomGear = (room.objects ?? []).filter((object) => object.takeable
    && ((WEAPON.test(object.name) && (!hasStats || (object.damage ?? 0) > mainDamage))
      || (ARMOR.test(object.name) && (!hasStats || (object.armor ?? 0) > (self.equipment?.[object.slot]?.armor ?? 0)))));
  if (roomGear.length) {
    return withRoute({
      kind: "take",
      label: `take ${roomGear[0].name}`,
      reason: "useful gear is on the floor",
      candidates: unique([`take ${roomGear[0].name}`, "inventory", "look"]),
    }, memory, from, from);
  }

  const groupAction = (room.group_actions ?? [])[0];
  if (groupAction) {
    const party = self.party;
    const here = names(room.actors);
    const inParty = party ? (party.members ?? []).filter((member) => here.includes(member)) : [];
    if (!party) {
      return withRoute({
        kind: "party",
        label: `form a party for ${groupAction.verb} ${groupAction.target}`,
        reason: `the ${groupAction.verb} ${groupAction.target} needs ${groupAction.size} people`,
        candidates: unique([
          here.length ? `party invite ${here[0]}` : null,
          here.length ? `say Looking for a party for ${groupAction.target}` : null,
          "who",
          "say Looking for a party",
          `${groupAction.verb} ${groupAction.target}`,
        ]),
      }, memory, from, from);
    }
    if (inParty.length + 1 < groupAction.size) {
      return withRoute({
        kind: "party",
        label: `gather the party for ${groupAction.verb} ${groupAction.target}`,
        reason: `the ${groupAction.verb} ${groupAction.target} needs ${groupAction.size} people in the room`,
        candidates: unique(["party who", "say Wait for the party", "wait", `${groupAction.verb} ${groupAction.target}`]),
      }, memory, from, from);
    }
    return withRoute({
      kind: "group action",
      label: `${groupAction.verb} ${groupAction.target}`,
      reason: `the party is together; this opens the way`,
      candidates: unique([`${groupAction.verb} ${groupAction.target}`, "party who", "look"]),
    }, memory, from, from);
  }

  const activeOptions = (self.active_quests ?? []).map((quest) => {
    const objective = quest.objective_details?.find((entry) => !entry.done);
    return { quest, objective, score: objectiveScore(objective, { state, memory, from, mind }) };
  }).filter((entry) => entry.objective).sort((a, b) => b.score - a.score);
  const activeEntry = activeOptions[0] ?? null;
  const active = activeEntry?.quest ?? null;
  const objective = activeEntry?.objective ?? null;
  const answerHere = objective?.kind === "answer"
    && (from === objective.answerRoomName || (!mind?.knownWord && from === objective.clueRoomName));
  const objectiveHere = objective ? (objective.kind === "answer" ? answerHere : objectiveScore(objective, { state, memory, from, mind }) >= 5) : false;
  const preferExploreNow = Boolean(preferExplore && active && objective && !objectiveHere);
  const availableOptions = [...(self.available_quests ?? [])].map((quest) => ({ quest, score: offerScore(quest, { memory, from }) }))
    .sort((a, b) => b.score - a.score || (a.quest.level ?? 1) - (b.quest.level ?? 1));
  const bestOffer = availableOptions[0] ?? null;
  if ((!activeEntry || activeEntry.score <= 1 || objective?.kind === "answer") && bestOffer
    && bestOffer.score > (activeEntry?.score ?? 0) && !(preferExploreNow && bestOffer.score < 5)) {
    const target = bestOffer.quest.giverRoomName ?? from;
    const here = target === from;
    return withRoute({
      kind: "quest offer",
      label: `${bestOffer.quest.name} (level ${bestOffer.quest.level})`,
      reason: `${bestOffer.quest.giver ?? "a quest giver"} offers it${here ? " here" : ""}`,
      candidates: unique([here ? `quest accept ${bestOffer.quest.id}` : (routeFor(memory, from, target)[0] ?? "look"), "quests", "look"]),
    }, memory, from, target);
  }
  const activeReachable = active && objective && !preferExploreNow && (activeEntry.score > 1 || objective.kind === "answer");
  if (activeReachable) {
    const candidates = [];
    let target = from;
    if (objective.kind === "visit") {
      target = objective.roomName ?? from;
      candidates.push(routeFor(memory, from, target)[0] ?? "look", "look", `quest ${active.id}`);
    } else if (objective.kind === "kill") {
      target = objective.npcRoomName ?? from;
      const npcName = objective.npcName ?? objective.npc;
      const here = names(room.npcs).some((name) => name.toLowerCase().includes(String(npcName ?? "").replace(/^the /, "")));
      candidates.push(here ? `attack ${npcName}` : (routeFor(memory, from, target)[0] ?? "look"), "battle", "consider " + (npcName ?? "enemy"));
    } else if (objective.kind === "collect") {
      const objectName = objective.objectName ?? objective.object;
      const carried = (self.inventory_names ?? []).some((name) => name.toLowerCase().includes(String(objectName ?? "").replace(/^the /, "")));
      target = carried ? from : (objective.objectRoomName ?? from);
      candidates.push(carried ? "inventory" : `take ${objectName}`, routeFor(memory, from, target)[0] ?? "look", "look");
    } else if (objective.kind === "deliver") {
      const objectName = objective.objectName ?? objective.object;
      const npcName = objective.npcName ?? objective.npc;
      const held = (self.inventory_names ?? []).some((name) => name.toLowerCase().includes(String(objectName ?? "").replace(/^the /, "")));
      target = objective.npcRoomName ?? from;
      const here = names(room.npcs).some((name) => name.toLowerCase().includes(String(npcName ?? "").replace(/^the /, "")));
      if (held && here) candidates.push(`deliver ${objectName} to ${npcName}`);
      else if (!held && objective.objectRoomName) {
        target = objective.objectRoomName;
        candidates.push(routeFor(memory, from, target)[0] ?? "look", `take ${objectName}`);
      } else candidates.push(routeFor(memory, from, target)[0] ?? "look", "look");
      candidates.push(`quest ${active.id}`);
    } else if (objective.kind === "talk") {
      target = objective.npcRoomName ?? from;
      const npcName = objective.npcName ?? objective.npc;
      const here = names(room.npcs).some((name) => name.toLowerCase().includes(String(npcName ?? "").replace(/^the /, "")));
      candidates.push(here ? `talk ${npcName}` : (routeFor(memory, from, target)[0] ?? "look"), "look");
    } else if (objective.kind === "answer") {
      const word = mind?.knownWord ?? null;
      const answerRoom = objective.answerRoomName ?? null;
      const clueRoom = objective.clueRoomName ?? null;
      target = word ? (answerRoom ?? from) : (clueRoom ?? from);
      if (word && from === answerRoom) {
        candidates.push(`answer ${word}`);
      } else if (!word && from === clueRoom) {
        candidates.push("examine door", "look", "search");
      } else {
        candidates.push(routeFor(memory, from, target)[0] ?? "look", "look");
      }
      candidates.push("quests", "look");
    } else {
      target = objective.roomName ?? from;
      candidates.push(routeFor(memory, from, target)[0] ?? "look", "quests", "look");
    }
    return withRoute({
      kind: "quest",
      label: `${active.name}: ${objective.text}`,
      reason: "next unfinished quest objective",
      candidates: unique([...candidates, "quests", "score"]),
    }, memory, from, target);
  }

  const ahead = frontier(memory, from);
  if (ahead) {
    const exit = ahead.path[0];
    return withRoute({
      kind: "explore",
      label: `explore ${ahead.target}`,
      reason: `nearest unvisited room; ${Object.keys(memory?.rooms ?? {}).length} rooms seen`,
      candidates: unique([exit, "look", "map", "quests", "search"]),
    }, memory, from, ahead.target);
  }
  const exits = room.exits ?? [];
  const current = memory?.rooms?.[from];
  const staleDirs = new Set(Object.entries(current?.commands ?? {})
    .filter(([command, entry]) => /^(north|south|east|west|up|down|n|s|e|w|u|d)$/i.test(command) && (entry.stale ?? 0) > 0)
    .map(([command]) => command));
  const recent = new Set((memory?.trail ?? []).slice(-6));
  const fresh = exits.filter((exit) => exit?.dir && !staleDirs.has(exit.dir));
  const unseen = fresh.find((exit) => exit?.room && !memory?.rooms?.[exit.room]);
  const notRecent = fresh.find((exit) => !exit?.room || !recent.has(exit.room));
  const exit = unseen?.dir ?? notRecent?.dir ?? fresh[0]?.dir ?? exits[0]?.dir ?? "look";
  return withRoute({
    kind: "explore",
    label: unseen ? `explore ${exit} into ${unseen.room}` : "explore a fresh exit",
    reason: "no active objective; map the world",
    candidates: unique([exit, "look", "search", "quests", "map"]),
  }, memory, from, unseen?.room ?? from);
}

/** A bounded objective lock: two unrelated commands in a row yield to the focus. */
export function focusGuard({ focus = null, command = "", detours = 0, state = null, strict = false } = {}) {
  if (!focus || !["quest", "quest offer", "group action", "party", "explore"].includes(focus.kind)) {
    return { command, detours: 0, forced: false };
  }
  const candidate = focus.route?.[0] ?? (focus.candidates ?? [])[0];
  if (!candidate || candidate === "look" || candidate === "inventory") {
    return { command, detours: 0, forced: false };
  }
  if (/^(north|south|east|west|up|down)$/.test(candidate)) {
    const exits = (state?.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir)).filter(Boolean);
    if (exits.length && !exits.includes(candidate)) return { command, detours: 0, forced: false };
  }
  if (String(command).trim() === candidate) return { command, detours: 0, forced: false };
  if (strict) return { command: candidate, detours: 0, forced: true };
  const next = (Number(detours) || 0) + 1;
  if (next < 2) return { command, detours: next, forced: false };
  return { command: candidate, detours: 0, forced: true };
}

export function focusPrompt(focus) {
  if (!focus) return "";
  const lines = [`FOCUS: ${focus.kind} — ${focus.label}.`];
  if (focus.reason) lines.push(`WHY: ${focus.reason}.`);
  if (focus.routeText) lines.push(`ROUTE: ${focus.routeText}.`);
  if ((focus.candidates ?? []).length) lines.push(`CANDIDATES: ${focus.candidates.join(" | ")}.`);
  return lines.join("\n");
}
