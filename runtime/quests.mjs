// Quests: a named set of facts about the world, and a progress record.
//
// The engine never runs a quest script. It advances an objective when an event
// matches it, checks the facts, and pays the reward once. The text belongs to
// the giver; the facts belong to the world.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "quests.json");
const KINDS = new Set(["visit", "kill", "collect", "deliver", "answer", "talk"]);

export function loadQuests({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { quests: [], errors: [`cannot read ${path}: ${error.message}`] };
  }
  const quests = [];
  const seen = new Set();
  for (const quest of raw.quests ?? []) {
    if (typeof quest.id !== "string" || !quest.id) errors.push("a quest has no id");
    if (seen.has(quest.id)) errors.push(`quest id "${quest.id}" is used twice`);
    seen.add(quest.id);
    if (typeof quest.name !== "string" || !quest.name) errors.push(`quest ${quest.id} has no name`);
    if (!Number.isInteger(quest.level) || quest.level < 1) errors.push(`quest ${quest.id} has an invalid level`);
    const objectives = quest.objectives ?? [];
    if (!Array.isArray(objectives) || objectives.length === 0) errors.push(`quest ${quest.id} has no objectives`);
    for (const objective of objectives) {
      if (!KINDS.has(objective.kind)) errors.push(`quest ${quest.id} has unknown objective "${objective.kind}"`);
      if (objective.kind === "visit" && !Number.isInteger(objective.room)) errors.push(`quest ${quest.id} visit has no room`);
      if ((objective.kind === "kill" || objective.kind === "deliver" || objective.kind === "talk") && typeof objective.npc !== "string") errors.push(`quest ${quest.id} ${objective.kind} has no npc`);
      if (objective.kind === "collect" && typeof objective.object !== "string") errors.push(`quest ${quest.id} collect has no object`);
      if (objective.kind === "answer" && typeof objective.word !== "string") errors.push(`quest ${quest.id} answer has no word`);
      if (objective.kind === "answer" && objective.fact !== undefined && typeof objective.fact !== "string") errors.push(`quest ${quest.id} answer has an invalid fact`);
      if (objective.count !== undefined && (!Number.isInteger(objective.count) || objective.count < 1)) errors.push(`quest ${quest.id} has an invalid count`);
    }
    const rewards = quest.rewards ?? {};
    if (rewards.xp !== undefined && (!Number.isInteger(rewards.xp) || rewards.xp < 0)) errors.push(`quest ${quest.id} has invalid xp`);
    if (rewards.object !== undefined && typeof rewards.object !== "string") errors.push(`quest ${quest.id} has an invalid object reward`);
    if (quest.requires !== undefined && (!Array.isArray(quest.requires) || quest.requires.some((id) => typeof id !== "string"))) {
      errors.push(`quest ${quest.id} has invalid prerequisites`);
    }
    quests.push({ ...quest, objectives, rewards });
  }
  return { quests, errors };
}

export const questById = (quests, id) => quests.find((quest) => quest.id === id) ?? null;

export const emptyProgress = () => ({ visits: [], kills: {}, collected: {}, delivered: {}, deliveredObjects: {}, answered: {}, talked: {} });

export function normalizeProgress(progress = {}) {
  return {
    visits: Array.isArray(progress.visits) ? [...new Set(progress.visits.filter(Number.isInteger))] : [],
    kills: { ...(progress.kills ?? {}) },
    collected: { ...(progress.collected ?? {}) },
    delivered: { ...(progress.delivered ?? {}) },
    deliveredObjects: { ...(progress.deliveredObjects ?? {}) },
    answered: { ...(progress.answered ?? {}) },
    talked: { ...(progress.talked ?? {}) },
  };
}

/** A save may hold active ids as strings; make every active entry an object. */
export function normalizeQuestState(state = {}, quests = []) {
  const active = (Array.isArray(state.active) ? state.active : [])
    .map((entry) => (typeof entry === "string" ? { id: entry, progress: emptyProgress() } : { id: entry.id, progress: normalizeProgress(entry.progress) }))
    .filter((entry) => entry.id && questById(quests, entry.id));
  const completed = [...new Set((Array.isArray(state.completed) ? state.completed : []).filter((id) => questById(quests, id)))];
  return { active, completed };
}

const heldCount = (actor, objectId, objects) =>
  objects.filter((object) => object.holder === actor.id && object.id === objectId && !object.eaten).length;

/** Advance a quest's progress from one event. */
export function applyQuestEvent(quest, progress, event, actor, objects) {
  const next = normalizeProgress(progress);
  if (event.kind === "visit") {
    if (!next.visits.includes(event.room)) next.visits.push(event.room);
  } else if (event.kind === "kill") {
    next.kills[event.npc] = (next.kills[event.npc] ?? 0) + 1;
  } else if (event.kind === "deliver") {
    next.delivered[event.npc] = (next.delivered[event.npc] ?? 0) + 1;
    if (event.object) {
      next.deliveredObjects[event.npc] = [...new Set([...(next.deliveredObjects[event.npc] ?? []), event.object])];
    }
  } else if (event.kind === "answer") {
    next.answered[event.word] = true;
  } else if (event.kind === "talk") {
    next.talked[event.npc] = (next.talked[event.npc] ?? 0) + 1;
  }
  // Collect is a fact about the actor's hands, not a counter: recompute it
  // whenever anything moves.
  for (const objective of quest.objectives) {
    if (objective.kind === "collect") next.collected[objective.object] = heldCount(actor, objective.object, objects);
  }
  return next;
}

/** One objective's fact, right now. */
export function objectiveDone(objective, progress, actor, objects) {
  const p = normalizeProgress(progress);
  if (objective.kind === "visit") return p.visits.includes(objective.room);
  if (objective.kind === "kill") return (p.kills[objective.npc] ?? 0) >= (objective.count ?? 1);
  if (objective.kind === "deliver") {
    const delivered = (p.delivered[objective.npc] ?? 0) >= (objective.count ?? 1);
    const rightObject = !objective.object || (p.deliveredObjects[objective.npc] ?? []).includes(objective.object);
    return delivered && rightObject;
  }
  if (objective.kind === "answer") {
    if (objective.fact && !actor.memory?.facts?.[objective.fact]) return false;
    return p.answered[objective.word] === true;
  }
  if (objective.kind === "talk") return (p.talked[objective.npc] ?? 0) >= (objective.count ?? 1);
  if (objective.kind === "collect") return heldCount(actor, objective.object, objects) >= (objective.count ?? 1);
  return false;
}

/** True when every objective is a fact about the world right now. */
export function questMet(quest, progress, actor, objects) {
  return quest.objectives.every((objective) => objectiveDone(objective, progress, actor, objects));
}

/** The quest log's account of one quest: one line per objective. */
export function questLines(quest, progress, actor, objects) {
  return quest.objectives.map((objective) =>
    `${objectiveDone(objective, progress, actor, objects) ? "[x]" : "[ ]"} ${objective.text ?? objective.kind}`);
}

/** Check that a quest names rooms, mobiles and objects that exist. */
export function validateQuestReferences(quests, { rooms = {}, npcs = [], objects = [] } = {}) {
  const errors = [];
  const npcIds = new Set(npcs.map((npc) => npc.id));
  const objectIds = new Set(objects.map((object) => object.id));
  for (const quest of quests) {
    for (const objective of quest.objectives) {
      if (objective.kind === "visit" && !rooms[objective.room]) errors.push(`quest ${quest.id} visits room ${objective.room}, which does not exist`);
      if ((objective.kind === "kill" || objective.kind === "deliver" || objective.kind === "talk") && !npcIds.has(objective.npc)) errors.push(`quest ${quest.id} names npc ${objective.npc}, which does not exist`);
      if (objective.kind === "collect" && !objectIds.has(objective.object)) errors.push(`quest ${quest.id} collects ${objective.object}, which does not exist`);
      if (objective.kind === "deliver" && objective.object && !objectIds.has(objective.object)) errors.push(`quest ${quest.id} delivers ${objective.object}, which does not exist`);
    }
  }
  return errors;
}

export function availableQuests(quests, actor, cycle = 0) {
  const state = normalizeQuestState(actor.quests, quests);
  return quests.filter((quest) => {
    const completed = state.completed.includes(quest.id);
    const repeatable = quest.repeat === "reset" && (actor.questCycles?.[quest.id] ?? -1) < cycle;
    return (actor.level ?? 1) >= quest.level
      && (quest.requires ?? []).every((id) => state.completed.includes(id))
      && (!completed || repeatable)
      && !state.active.some((entry) => entry.id === quest.id);
  });
}
