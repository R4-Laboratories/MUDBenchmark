// Facts a character can learn from an NPC. The character's own fact store is
// authoritative for a quest; R4 is the durable mirror and the fallback when a
// local note is missing. A fact never leaves the character that learned it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "facts.json");

export function loadFacts({ path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { facts: [], byId: new Map(), byNpc: new Map(), byWord: new Map(), errors: [`cannot read ${path}: ${error.message}`] };
  }
  const facts = [];
  const byId = new Map();
  const byNpc = new Map();
  const byWord = new Map();
  const ids = new Set();
  for (const fact of raw.facts ?? []) {
    if (typeof fact.id !== "string" || !fact.id) errors.push("a fact has no id");
    if (ids.has(fact.id)) errors.push(`fact id "${fact.id}" is used twice`);
    ids.add(fact.id);
    if (typeof fact.npc !== "string" || !fact.npc) errors.push(`fact ${fact.id} has no npc`);
    if (typeof fact.word !== "string" || !fact.word) errors.push(`fact ${fact.id} has no word`);
    if (typeof fact.text !== "string" || !fact.text) errors.push(`fact ${fact.id} has no text`);
    const clean = { ...fact, word: String(fact.word ?? "").toLowerCase() };
    facts.push(clean);
    byId.set(clean.id, clean);
    if (!byNpc.has(clean.npc)) byNpc.set(clean.npc, clean);
    if (!byWord.has(clean.word)) byWord.set(clean.word, clean);
  }
  return { facts, byId, byNpc, byWord, errors };
}

export const factForNpc = (facts, npcId) => facts.byNpc.get(npcId) ?? null;

/** A loose R4 check: the returned context or a concept must name the word. */
export function contextHasWord(data, word) {
  const wanted = String(word ?? "").toLowerCase();
  if (!wanted) return false;
  const text = [
    data?.context,
    ...(data?.concepts ?? []).map((concept) => concept?.term),
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes(wanted);
}
