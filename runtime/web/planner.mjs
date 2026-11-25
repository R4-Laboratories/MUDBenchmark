// A small, model-independent focus planner.
//
// The LLM should choose among meaningful actions, not rediscover the verb list
// every turn. This module turns the live state and route memory into one clear
// focus and a short candidate list: survive, equip, take gear, pursue the next
// unfinished quest objective, accept a quest, or explore. It does not execute
// anything; the model still chooses the command.

import { pathTo } from "./memory.mjs";

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

export function focusFor({ state = null, memory = null } = {}) {
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
        "battle",
        technique ? `technique ${technique}` : null,
        food ? `eat ${food}` : null,
        (self.spells ?? []).includes("mend") ? "cast mend" : null,
        "flee",
      ]),
    };
    return withRoute(focus, memory, from, from);
  }

  const carriedWeapons = (self.inventory_names ?? []).filter((name) => WEAPON.test(name) && name !== self.wielding);
  const carriedArmor = (self.inventory_names ?? []).filter((name) => ARMOR.test(name) && !(self.worn ?? []).includes(name));
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

  const roomGear = (room.objects ?? []).filter((object) => object.takeable && (WEAPON.test(object.name) || ARMOR.test(object.name)));
  if (roomGear.length) {
    return withRoute({
      kind: "take",
      label: `take ${roomGear[0].name}`,
      reason: "useful gear is on the floor",
      candidates: unique([`take ${roomGear[0].name}`, "inventory", "look"]),
    }, memory, from, from);
  }

  const active = (self.active_quests ?? [])[0];
  const objective = active?.objective_details?.find((entry) => !entry.done);
  if (active && objective) {
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

  const available = (self.available_quests ?? [])[0];
  if (available) {
    const target = available.giverRoomName ?? from;
    const here = target === from;
    return withRoute({
      kind: "quest offer",
      label: `${available.name} (level ${available.level})`,
      reason: `${available.giver ?? "a quest giver"} offers it${here ? " here" : ""}`,
      candidates: unique([here ? `quest accept ${available.id}` : (routeFor(memory, from, target)[0] ?? "look"), "quests", "look"]),
    }, memory, from, target);
  }

  const exits = room.exits ?? [];
  const unseen = exits.find((exit) => exit?.room && !memory?.rooms?.[exit.room]);
  const exit = unseen?.dir ?? exits[0]?.dir ?? "look";
  return withRoute({
    kind: "explore",
    label: unseen ? `explore ${exit} into ${unseen.room}` : "explore the nearest exit",
    reason: "no active objective; map the world",
    candidates: unique([exit, "look", "search", "quests", "map"]),
  }, memory, from, unseen?.room ?? from);
}

export function focusPrompt(focus) {
  if (!focus) return "";
  const lines = [`FOCUS: ${focus.kind} — ${focus.label}.`];
  if (focus.reason) lines.push(`WHY: ${focus.reason}.`);
  if (focus.routeText) lines.push(`ROUTE: ${focus.routeText}.`);
  if ((focus.candidates ?? []).length) lines.push(`CANDIDATES: ${focus.candidates.join(" | ")}.`);
  return lines.join("\n");
}
