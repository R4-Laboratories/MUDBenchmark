// A small, model-independent focus planner.
//
// The LLM should choose among meaningful actions, not rediscover the verb list
// every turn. This module turns the live state and route memory into one clear
// focus and a short candidate list: survive, equip, take gear, pursue the next
// unfinished quest objective, accept a quest, or explore. It does not execute
// anything; the model still chooses the command.

import { frontier, pathTo, displayRoom } from "./memory.mjs";

const WEAPON = /sword|axe|mace|dagger|spear|hammer|staff|\bbow\b|knife|pick|blade|club/i;
const ARMOR = /mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i;
const FOOD = /bread|stew|herb|ration|meat|apple|cheese|soup|loaf|berry|fish|biscuit|moonwater|starwater|\bale\b|water/i;

const unique = (values) => [...new Set((values ?? []).filter(Boolean))];
const roomName = (state) => state?.room?.name ?? null;
const names = (values) => (values ?? []).map((entry) => String(entry?.name ?? entry)).filter(Boolean);

const routeFor = (memory, from, to) => {
  if (!from || !to || from === to) return [];
  return pathTo(memory, from, to) ?? [];
};

const withRoute = (focus, memory, from, target) => {
  const route = routeFor(memory, from, target);
  const targetName = displayRoom(target);
  return { ...focus, target: target ?? null, route, routeText: route.length ? `${route[0]} (${route.length} move${route.length === 1 ? "" : "s"} to ${targetName})` : target && target !== from ? `no known route to ${targetName}; explore` : target === from ? "you are here" : "" };
};

const objectiveScore = (objective, { state, memory, from, mind, quest } = {}) => {
  const room = state?.room ?? {};
  const self = state?.self ?? {};
  if (!objective || objective.done) return 0;
  const npcHere = (name) => names(room.npcs).some((entry) => entry.toLowerCase().includes(String(name ?? "").replace(/^the /, "")));
  const held = (name) => (self.inventory_names ?? []).some((entry) => entry.toLowerCase().includes(String(name ?? "").replace(/^the /, "")));
  if (objective.kind === "visit") {
    const target = objective.roomKey ?? objective.roomName;
    if (target === from) return 5;
    const clue = (quest?.objective_details ?? []).find((entry) => entry.kind === "answer")?.clueRoomKey
      ?? (quest?.objective_details ?? []).find((entry) => entry.kind === "answer")?.clueRoomName;
    if (clue && target === clue && routeFor(memory, from, clue).length) return 6;
    return routeFor(memory, from, target).length ? 4 : 1;
  }
  if (objective.kind === "kill") {
    const target = objective.npcRoomKey ?? objective.npcRoomName;
    if (npcHere(objective.npcName ?? objective.npc)) return 5;
    if (target === from) return 3;
    return routeFor(memory, from, target).length ? 4 : 1;
  }
  if (objective.kind === "collect") {
    const target = objective.objectRoomKey ?? objective.objectRoomName;
    if (held(objective.objectName ?? objective.object)) return 5;
    if (target === from) return 5;
    return routeFor(memory, from, target).length ? 4 : 1;
  }
  if (objective.kind === "deliver") {
    const target = objective.npcRoomKey ?? objective.objectRoomKey ?? objective.npcRoomName ?? objective.objectRoomName;
    if (held(objective.objectName ?? objective.object) && npcHere(objective.npcName ?? objective.npc)) return 5;
    return routeFor(memory, from, target).length ? 4 : 1;
  }
  if (objective.kind === "talk") {
    const target = objective.npcRoomKey ?? objective.npcRoomName;
    if (npcHere(objective.npcName ?? objective.npc)) return 5;
    return routeFor(memory, from, target).length ? 4 : 1;
  }
  if (objective.kind === "answer") {
    const clue = objective.clueRoomKey ?? objective.clueRoomName;
    if (mind?.knownWord) return 6;
    if (clue === from) return 5;
    return routeFor(memory, from, clue).length ? 4 : 1;
  }
  return 1;
};

const offerScore = (quest, { memory, from } = {}) => {
  const target = quest.giverRoomKey ?? quest.giverRoomName;
  if (target === from) return 5;
  return routeFor(memory, from, target).length ? 4 : 1;
};

const huntRounds = (hunt, self) => Math.max(1, Math.ceil((hunt?.maxHp ?? hunt?.hp ?? 1) / Math.max(1, self?.damage ?? 1)));

/** A rough safety check: can this mobile be killed before it kills the agent? */
const safeHunt = (hunt, self) => {
  if (!hunt?.room) return false;
  if ((hunt.level ?? 1) > (self?.level ?? 1)) return false;
  const hp = self?.hp ?? self?.max_hp ?? 20;
  const taken = huntRounds(hunt, self) * Math.max(0, (hunt.damage ?? 0) - (self?.armor ?? 0));
  return taken < Math.max(1, hp) * 0.6;
};

/** Objects an active collect or deliver objective still needs; do not eat them. */
const questObjects = (self) => new Set((self?.active_quests ?? []).flatMap((quest) => (quest.objective_details ?? [])
  .filter((objective) => !objective.done && (objective.kind === "collect" || objective.kind === "deliver"))
  .map((objective) => String(objective.objectName ?? objective.object ?? "").toLowerCase().replace(/^the /, "").trim())
  .filter(Boolean)));
const isQuestObject = (name, objects) => [...objects].some((object) => object && String(name).toLowerCase().includes(object));

const hasItem = (self, name) => {
  const wanted = String(name ?? "").toLowerCase().replace(/^the /, "").trim();
  if (!wanted) return false;
  return [...(self?.inventory_names ?? []), ...(self?.worn ?? [])]
    .some((entry) => String(entry).toLowerCase().replace(/^the /, "").includes(wanted));
};

const questPrepMet = (pre, { self = {}, memory = null, from = null, zone = null } = {}) => {
  if (!pre) return true;
  if (pre.kind === "buy") return hasItem(self, pre.name) || hasItem(self, pre.object);
  if (pre.kind === "light") return Boolean(self.light);
  if (pre.kind === "search") {
    const roomKey = pre.roomKey ?? pre.roomName;
    const reveals = pre.revealsKey ?? pre.revealsName;
    const exits = memory?.map?.[roomKey] ?? {};
    return Boolean(reveals && (Object.values(exits).includes(reveals) || memory?.rooms?.[reveals]));
  }
  if (pre.kind === "take") return hasItem(self, pre.name) || hasItem(self, pre.object);
  if (pre.kind === "action") {
    if (pre.item && !hasItem(self, pre.name ?? pre.item)) return false;
    const after = pre.afterRoomKey ?? pre.afterRoomName;
    if (after && (from === after || memory?.rooms?.[after])) return true;
    const roomKey = pre.roomKey ?? pre.roomName;
    const reveals = pre.revealsKey ?? pre.revealsName;
    const exits = memory?.map?.[roomKey] ?? {};
    return Boolean(reveals && Object.values(exits).includes(reveals));
  }
  if (pre.kind === "route") {
    const to = pre.toKey ?? pre.toName ?? pre.to;
    return Boolean(to && (from === to || memory?.rooms?.[to]));
  }
  return true;
};

const nextQuestPrep = (quest, ctx = {}) => {
  const prereqs = quest?.prereqs ?? [];
  if (!prereqs.length) return null;
  const objectiveIndex = (quest.objective_details ?? []).findIndex((objective) => !objective.done);
  const actionDone = prereqs.find((pre) => pre.kind === "action" && questPrepMet(pre, ctx));
  const cutoff = actionDone ? prereqs.indexOf(actionDone) : -1;
  for (let index = 0; index < prereqs.length; index += 1) {
    if (index <= cutoff) continue;
    const pre = prereqs[index];
    if (pre.when !== undefined && pre.when !== objectiveIndex) continue;
    if (!questPrepMet(pre, ctx)) {
      if (pre.optional) {
        if (pre.roomName && ctx.from !== pre.roomName) continue;
        if (!questPrepFocus(pre, quest, ctx)) continue;
      }
      return pre;
    }
  }
  return null;
};

const questPrepFocus = (pre, quest, { self = {}, memory = null, from = null, room = {}, previousPrep = null, lastCommand = null } = {}) => {
  if (!pre || !quest) return null;
  const reason = pre.text ?? `${quest.name} needs this first`;
  if (pre.kind === "buy") {
    const roomKey = pre.roomKey ?? pre.roomName;
    const here = from === roomKey;
    if (here) {
      const item = (room.objects ?? []).find((object) => object?.forSale
        && (object.name === pre.name || object.name === pre.object || String(object.name).toLowerCase().includes(String(pre.name ?? "").toLowerCase().replace(/^the /, ""))));
      if (!item || (self.coins ?? 0) < (item.price ?? pre.price ?? 0)) return null;
      return withRoute({ kind: "prep", questId: quest.id, label: `buy ${item.name} — ${reason}`, reason, candidates: unique([`buy ${item.name}`, "list", "score"]) }, memory, from, from);
    }
    const path = routeFor(memory, from, roomKey);
    if (!path.length) return null;
    return withRoute({ kind: "prep", questId: quest.id, label: `buy ${pre.name} at ${roomKey}`, reason, candidates: unique([path[0], "quests", "look"]) }, memory, from, roomKey);
  }
  if (pre.kind === "light") {
    if (!hasItem(self, pre.name)) return null;
    return withRoute({ kind: "prep", questId: quest.id, label: `light ${pre.name}`, reason, candidates: unique([`light ${pre.name}`, "score"]) }, memory, from, from);
  }
  if (pre.kind === "search") {
    const roomKey = pre.roomKey ?? pre.roomName;
    const viaKey = pre.viaKey ?? pre.viaName;
    const here = Number.isFinite(room.id) && Number.isFinite(pre.room) ? Number(room.id) === Number(pre.room) : from === roomKey;
    if (here) return withRoute({ kind: "prep", questId: quest.id, label: `search ${pre.roomName} for ${pre.revealsName}`, reason, candidates: unique(["search", "look", "quests"]) }, memory, from, from);
    if (viaKey && from !== viaKey) {
      const viaPath = routeFor(memory, from, viaKey);
      if (!viaPath.length) return null;
      return withRoute({ kind: "prep", questId: quest.id, label: `reach ${pre.viaName} for ${pre.roomName}`, reason, candidates: unique([viaPath[0], "quests", "look"]) }, memory, from, viaKey);
    }
    if (viaKey && pre.exit) {
      return withRoute({ kind: "prep", questId: quest.id, label: `${pre.exit} to ${pre.roomName}`, reason, candidates: unique([pre.exit, "look", "quests"]) }, memory, from, pre.roomName);
    }
    const path = routeFor(memory, from, roomKey);
    if (!path.length) return null;
    return withRoute({ kind: "prep", questId: quest.id, label: `search ${pre.roomName} for ${pre.revealsName}`, reason, candidates: unique([path[0], "quests", "look"]) }, memory, from, roomKey);
  }
  if (pre.kind === "take") {
    const roomKey = pre.roomKey ?? pre.roomName;
    const here = from === roomKey;
    if (here) {
      const item = (room.objects ?? []).find((object) => object?.takeable && (object.name === pre.name || object.name === pre.object || String(object.name).toLowerCase().includes(String(pre.name ?? "").toLowerCase().replace(/^the /, ""))));
      if (!item) return null;
      return withRoute({ kind: "prep", questId: quest.id, label: `take ${item.name} — ${reason}`, reason, candidates: unique([`take ${item.name}`, "look", "inventory"]) }, memory, from, from);
    }
    const path = routeFor(memory, from, roomKey);
    if (!path.length) return null;
    return withRoute({ kind: "prep", questId: quest.id, label: `take ${pre.name} at ${pre.roomName}`, reason, candidates: unique([path[0], "quests", "look"]) }, memory, from, roomKey);
  }
  if (pre.kind === "action") {
    if (pre.item && !hasItem(self, pre.name ?? pre.item)) return null;
    const command = `${pre.verb} ${pre.target}`;
    const roomKey = pre.roomKey ?? pre.roomName;
    const here = from === roomKey;
    if (here) return withRoute({ kind: "prep", questId: quest.id, label: command, reason, candidates: unique([command, "look"]) }, memory, from, from);
    const path = routeFor(memory, from, roomKey);
    if (!path.length) return null;
    return withRoute({ kind: "prep", questId: quest.id, label: command, reason, candidates: unique([path[0], "quests", "look"]) }, memory, from, roomKey);
  }
  if (pre.kind === "route") {
    const to = pre.toKey ?? pre.toName ?? pre.to;
    const start = pre.fromKey ?? pre.fromName ?? pre.from;
    if (!to || from === to || memory?.rooms?.[to]) return null;
    const steps = pre.steps ?? [];
    if (!steps.length) return null;
    const keys = pre.roomKeys?.length ? pre.roomKeys : (pre.rooms ?? []);
    const onRoute = previousPrep?.routeSteps?.join("|") === steps.join("|") && previousPrep.routeTo === to;
    if (!onRoute && start && from !== start) {
      const path = routeFor(memory, from, start);
      if (!path.length) return null;
      return withRoute({ kind: "prep", questId: quest.id, label: `reach ${pre.fromName ?? displayRoom(start)} for the hold route`, reason, candidates: unique([path[0], "quests", "look"]) }, memory, from, start);
    }
    let index = 0;
    if (onRoute) {
      index = previousPrep.routeIndex ?? 0;
      if (lastCommand === steps[index]) index += 1;
    } else if (from === start) index = 0;
    if (keys.length && from !== keys[Math.min(index, keys.length - 1)]) {
      const path = routeFor(memory, from, keys[0]);
      if (!path.length) return null;
      return withRoute({ kind: "prep", questId: quest.id, label: `return to ${pre.fromName ?? displayRoom(keys[0])} for the hold route`, reason, candidates: unique([path[0], "quests", "look"]) }, memory, from, keys[0]);
    }
    const step = steps[index];
    if (!step) return null;
    return {
      kind: "prep",
      questId: quest.id,
      label: `${pre.text ?? "follow the route"} — ${step} (${index + 1}/${steps.length})`,
      reason: pre.text ?? `route to ${to}`,
      candidates: unique([step, "look"]),
      route: [step],
      routeText: `${step} (${index + 1}/${steps.length} to ${displayRoom(to)})`,
      target: to,
      routeSteps: steps,
      routeIndex: index,
      routeFrom: pre.fromName ?? pre.from,
      routeTo: to,
    };
  }
  return null;
};

export function focusFor({ state = null, memory = null, mind = null, preferExplore = false, previousFocus = null, previousPrep = null, lastCommand = null, foodEmpty = null } = {}) {
  const self = state?.self ?? {};
  const room = state?.room ?? {};
  const from = room.key ?? room.name ?? null;
  const fromName = room.name ?? displayRoom(from);
  const enemies = self.enemies ?? [];
  if (enemies.length) {
    const enemy = enemies[0];
    const technique = self.techniques?.[0]?.id;
    const protectedObjects = questObjects(self);
    const food = (self.inventory_names ?? []).find((name) => FOOD.test(name) && !isQuestObject(name, protectedObjects));
    const selfHp = Number.isFinite(self.hp) ? self.hp : null;
    const enemyHp = Number.isFinite(enemy.hp) ? enemy.hp : null;
    const canWin = selfHp !== null && enemyHp !== null
      && selfHp >= Math.max(8, (self.max_hp ?? 20) * 0.35)
      && enemyHp <= selfHp;
    const focus = {
      kind: "combat",
      label: `survive ${enemy.name}`,
      reason: canWin ? "this fight is winnable; see it through" : "attack already started the fight; rounds are automatic",
      candidates: unique([
        technique ? `technique ${technique}` : null,
        food ? `${/ale|water/i.test(food) ? "drink" : "eat"} ${food}` : null,
        (self.spells ?? []).includes("mend") ? "cast mend" : null,
        "wait",
        canWin ? null : "flee",
      ]),
    };
    return withRoute(focus, memory, from, from);
  }

  const hp = Number.isFinite(self.hp) ? self.hp : null;
  const maxHp = Number.isFinite(self.max_hp) ? self.max_hp : null;
  if (hp !== null && maxHp !== null && hp < maxHp * 0.6) {
    const protectedObjects = questObjects(self);
    const food = (self.inventory_names ?? []).find((name) => FOOD.test(name) && !isQuestObject(name, protectedObjects));
    if (food) {
      const verb = /ale|water/i.test(food) ? "drink" : "eat";
      return withRoute({
        kind: "recover",
        label: `${verb} ${food}`,
        reason: `HP ${hp}/${maxHp}; recover before the next fight`,
        candidates: unique([`${verb} ${food}`, "score", "inventory"]),
      }, memory, from, from);
    }
    const roomFood = (room.objects ?? []).find((object) => object?.takeable && !object.forSale && FOOD.test(object.name) && !isQuestObject(object.name, protectedObjects));
    if (roomFood) {
      return withRoute({
        kind: "recover",
        label: `take ${roomFood.name}`,
        reason: `HP ${hp}/${maxHp}; food is on the floor`,
        candidates: unique([`take ${roomFood.name}`, "score", "inventory"]),
      }, memory, from, from);
    }
    const questZone = Boolean(room.zone) && (self.active_quests ?? []).some((quest) => (quest.objective_details ?? [])
      .some((objective) => !objective.done && [objective.roomZone, objective.npcRoomZone, objective.objectRoomZone].includes(room.zone)));
    const foodAhead = (memory?.foods ?? [])
      .filter((food) => food?.room && food.room !== from && !isQuestObject(food.name, protectedObjects))
      .map((food) => ({ food, path: routeFor(memory, from, food.room) }))
      .filter((entry) => entry.path.length)
      .sort((a, b) => a.path.length - b.path.length)[0] ?? null;
    if (foodAhead) {
      return withRoute({
        kind: "recover",
        label: `take ${foodAhead.food.name} in ${foodAhead.food.roomName ?? displayRoom(foodAhead.food.room)}`,
        reason: `HP ${hp}/${maxHp}; food was seen there`,
        candidates: unique([foodAhead.path[0], "look", "inventory"]),
      }, memory, from, foodAhead.food.room);
    }
    if (!questZone) {
      const inn = "The Gilded Rat";
      const innPath = routeFor(memory, from, inn);
      const here = from === inn;
      const innFood = (room.objects ?? []).find((object) => object?.forSale && FOOD.test(object.name));
      if (here && innFood) foodEmpty?.delete(inn);
      if (here && !innFood) foodEmpty?.add(inn);
      if (!foodEmpty?.has(inn) && (self.coins ?? 0) >= 3 && (here ? innFood : innPath.length)) {
        return withRoute({
          kind: "recover",
          label: here ? `buy ${innFood.name}` : `buy food at ${inn}`,
          reason: `HP ${hp}/${maxHp}; no food carried`,
          candidates: unique([here ? `buy ${innFood.name}` : innPath[0], "list", "score"]),
        }, memory, from, inn);
      }
      const cell = "The Cell";
      const cellPath = routeFor(memory, from, cell);
      const breadNeeded = [...protectedObjects].some((object) => object.includes("bread") || "a loaf of bread".includes(object));
      const cellHere = from === cell;
      const cellFood = (room.objects ?? []).find((object) => object?.takeable && FOOD.test(object.name));
      if (cellHere && cellFood) foodEmpty?.delete(cell);
      if (cellHere && !cellFood) foodEmpty?.add(cell);
      if (!foodEmpty?.has(cell) && !breadNeeded && (cellHere ? cellFood : cellPath.length)) {
        return withRoute({
          kind: "recover",
          label: cellHere ? `take ${cellFood.name}` : `find bread in ${cell}`,
          reason: `HP ${hp}/${maxHp}; no food carried`,
          candidates: unique([cellHere ? `take ${cellFood.name}` : cellPath[0], "look", "inventory"]),
        }, memory, from, cell);
      }
    }
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

  const roomGear = (room.objects ?? []).filter((object) => object.takeable && !object.forSale
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

  const prepCtx = { self, memory, from, room, zone: room.zone ?? null, previousPrep, lastCommand };
  const prepFor = (entry) => entry?.quest ? questPrepFocus(nextQuestPrep(entry.quest, prepCtx), entry.quest, prepCtx) : null;
  const activeOptions = (self.active_quests ?? []).map((quest) => {
    const objective = quest.objective_details?.find((entry) => !entry.done);
    return { quest, objective, score: objectiveScore(objective, { state, memory, from, mind, quest }) };
  }).filter((entry) => entry.objective).sort((a, b) => b.score - a.score || (a.quest.level ?? 1) - (b.quest.level ?? 1));
  const reachable = (entry) => Boolean(entry?.objective) && entry.score > 1;
  const committed = previousFocus?.kind === "quest" && previousFocus.questId
    ? activeOptions.find((entry) => entry.quest.id === previousFocus.questId && (reachable(entry) || Boolean(prepFor(entry)))) ?? null
    : null;
  const activeEntry = committed ?? activeOptions[0] ?? null;
  const active = activeEntry?.quest ?? null;
  const objective = activeEntry?.objective ?? null;
  const answerHere = objective?.kind === "answer"
    && (from === (objective.answerRoomKey ?? objective.answerRoomName) || (!mind?.knownWord && from === (objective.clueRoomKey ?? objective.clueRoomName)));
  const objectiveHere = objective ? (objective.kind === "answer" ? answerHere : objectiveScore(objective, { state, memory, from, mind, quest: active }) >= 5) : false;
  const preferExploreNow = Boolean(preferExplore && active && objective && !objectiveHere);
  const activePrepFocus = prepFor(activeEntry);
  const activeReachable = (reachable(activeEntry) || Boolean(activePrepFocus)) && !preferExploreNow;
  const availableOptions = [...(self.available_quests ?? [])].map((quest) => ({ quest, score: offerScore(quest, { memory, from }) }))
    .sort((a, b) => b.score - a.score || (a.quest.level ?? 1) - (b.quest.level ?? 1));
  const bestOffer = availableOptions[0] ?? null;
  if (!activeReachable && bestOffer
    && bestOffer.score > (activeEntry?.score ?? 0) && !(preferExploreNow && bestOffer.score < 5)) {
    const target = bestOffer.quest.giverRoomKey ?? bestOffer.quest.giverRoomName ?? from;
    const here = target === from;
    return withRoute({
      kind: "quest offer",
      label: `${bestOffer.quest.name} (level ${bestOffer.quest.level})`,
      reason: `${bestOffer.quest.giver ?? "a quest giver"} offers it${here ? " here" : ""}`,
      candidates: unique([here ? `quest accept ${bestOffer.quest.id}` : (routeFor(memory, from, target)[0] ?? "look"), "quests", "look"]),
    }, memory, from, target);
  }
  if (activePrepFocus) return activePrepFocus;
  if (activeReachable) {
    const candidates = [];
    let target = from;
    if (objective.kind === "visit") {
      target = objective.roomKey ?? objective.roomName ?? from;
      candidates.push(routeFor(memory, from, target)[0] ?? "look", "look", `quest ${active.id}`);
    } else if (objective.kind === "kill") {
      target = objective.npcRoomKey ?? objective.npcRoomName ?? from;
      const npcName = objective.npcName ?? objective.npc;
      const here = names(room.npcs).some((name) => name.toLowerCase().includes(String(npcName ?? "").replace(/^the /, "")));
      if (here) candidates.push(`attack ${npcName}`);
      else if (target === from) candidates.push("search", "wait", "look");
      else candidates.push(routeFor(memory, from, target)[0] ?? "look", "battle", "consider " + (npcName ?? "enemy"));
    } else if (objective.kind === "collect") {
      const objectName = objective.objectName ?? objective.object;
      const carried = (self.inventory_names ?? []).some((name) => name.toLowerCase().includes(String(objectName ?? "").replace(/^the /, "")));
      target = carried ? from : (objective.objectRoomKey ?? objective.objectRoomName ?? from);
      if (carried) candidates.push("inventory");
      else if (target === from) candidates.push(`take ${objectName}`);
      else candidates.push(routeFor(memory, from, target)[0] ?? "look");
      candidates.push("look");
    } else if (objective.kind === "deliver") {
      const objectName = objective.objectName ?? objective.object;
      const npcName = objective.npcName ?? objective.npc;
      const held = (self.inventory_names ?? []).some((name) => name.toLowerCase().includes(String(objectName ?? "").replace(/^the /, "")));
      target = objective.npcRoomKey ?? objective.npcRoomName ?? from;
      const here = names(room.npcs).some((name) => name.toLowerCase().includes(String(npcName ?? "").replace(/^the /, "")));
      if (held && here) candidates.push(`deliver ${objectName} to ${npcName}`);
      else if (!held && (objective.objectRoomKey ?? objective.objectRoomName)) {
        target = objective.objectRoomKey ?? objective.objectRoomName;
        if (target === from) candidates.push(`take ${objectName}`);
        else candidates.push(routeFor(memory, from, target)[0] ?? "look", `take ${objectName}`);
      } else candidates.push(routeFor(memory, from, target)[0] ?? "look", "look");
      candidates.push(`quest ${active.id}`);
    } else if (objective.kind === "talk") {
      target = objective.npcRoomKey ?? objective.npcRoomName ?? from;
      const npcName = objective.npcName ?? objective.npc;
      const here = names(room.npcs).some((name) => name.toLowerCase().includes(String(npcName ?? "").replace(/^the /, "")));
      candidates.push(here ? `talk ${npcName}` : (routeFor(memory, from, target)[0] ?? "look"), "look");
    } else if (objective.kind === "answer") {
      const word = mind?.knownWord ?? null;
      const answerRoom = objective.answerRoomKey ?? objective.answerRoomName ?? null;
      const clueRoom = objective.clueRoomKey ?? objective.clueRoomName ?? null;
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
      target = objective.roomKey ?? objective.roomName ?? from;
      candidates.push(routeFor(memory, from, target)[0] ?? "look", "quests", "look");
    }
    return withRoute({
      kind: "quest",
      questId: active.id,
      label: `${active.name}: ${objective.text}`,
      reason: "next unfinished quest objective",
      candidates: unique([...candidates, "quests", "score"]),
    }, memory, from, target);
  }

  const needsXp = Number.isFinite(self.next_xp) && (self.xp ?? 0) < self.next_xp;
  const hunts = (memory?.hunts ?? []).filter((hunt) => hunt?.room && safeHunt(hunt, self));
  const huntHere = hunts.find((hunt) => hunt.room === from);
  if (needsXp && huntHere) {
    return withRoute({
      kind: "hunt",
      label: `hunt ${huntHere.name}`,
      reason: `a safe ${huntHere.name} is here; fight it to reach level ${(self.level ?? 1) + 1}`,
      candidates: unique([`attack ${huntHere.name}`, `consider ${huntHere.name}`, "battle", "look"]),
    }, memory, from, from);
  }
  const huntAhead = hunts
    .filter((hunt) => hunt.room !== from)
    .map((hunt) => ({ hunt, path: routeFor(memory, from, hunt.room) }))
    .filter((entry) => entry.path.length)
    .sort((a, b) => a.path.length - b.path.length)[0] ?? null;
  if (needsXp && huntAhead) {
    return withRoute({
      kind: "hunt",
      label: `hunt ${huntAhead.hunt.name} in ${huntAhead.hunt.roomName ?? displayRoom(huntAhead.hunt.room)}`,
      reason: `no quest is reachable; ${huntAhead.hunt.name} is ${huntAhead.path.length} move${huntAhead.path.length === 1 ? "" : "s"} away`,
      candidates: unique([huntAhead.path[0], `consider ${huntAhead.hunt.name}`, "quests", "look"]),
    }, memory, from, huntAhead.hunt.room);
  }

  const ahead = frontier(memory, from);
  if (ahead) {
    const exit = ahead.path[0];
    return withRoute({
      kind: "explore",
      label: `explore ${displayRoom(ahead.target)}`,
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
  if (!focus || !["quest", "quest offer", "group action", "party", "explore", "hunt", "combat", "recover", "prep", "equip", "take"].includes(focus.kind)) {
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
  if (focus.kind === "combat") {
    if (/^flee\b/i.test(String(command).trim()) && !(focus.candidates ?? []).includes("flee")) {
      return { command: candidate, detours: 0, forced: true };
    }
    if (!/^(technique|tech|eat|drink|cast|flee|wait|battle|combat|score|equipment)\b/i.test(String(command).trim())) {
      return { command: candidate, detours: 0, forced: true };
    }
  }
  const concrete = !["look", "inventory", "quests", "score", "map"].includes(candidate);
  if (strict || (["quest", "quest offer", "hunt", "recover", "prep", "equip", "take"].includes(focus.kind) && concrete)) return { command: candidate, detours: 0, forced: true };
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
