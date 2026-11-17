// Load and validate the world.
//
// The world is data, not code: rooms, exits and notices live in
// world/data/world.json so an author can change the map without touching the
// server, and so the same file can be checked by the gate.
//
// Validation is fail-closed. A room whose exit points nowhere, a notice at a
// level no role can reach, or a room nobody can walk to is a broken world, and
// a broken world should not accept a connection.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved against this module, not the process working directory: the service
// runs with its cwd inside runtime/, and relative paths there would lie.
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "world.json");

const LEVELS = 4; // roles and notice levels are both 0..3, per Perception.lex.tex

// A generated pacing file is the loop's only write surface. It is bound to the
// exact world it was measured against, may move only four numeric fields, and
// must state the value it replaces. Anything else is a broken artifact: the
// world refuses to boot rather than run a half-applied candidate.
const PACING_SCHEMA = "mudbenchmark/pacing/1";
const PACING_FIELDS = {
  npcs: new Set(["hp", "period", "damage"]),
  objects: new Set(["price"]),
};

function applyPacing({ text, raw, path, errors }) {
  const generatedPath = join(dirname(path), "generated", "pacing.json");
  let generatedText;
  try {
    generatedText = readFileSync(generatedPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    errors.push(`cannot read ${generatedPath}: ${error.message}`);
    return null;
  }

  let file;
  try {
    file = JSON.parse(generatedText);
  } catch (error) {
    errors.push(`${generatedPath} is not JSON: ${error.message}`);
    return null;
  }
  if (file.schema !== PACING_SCHEMA) {
    errors.push(`${generatedPath} has schema ${file.schema}, not ${PACING_SCHEMA}`);
    return null;
  }

  // A pacing file built for another world is ignored, not applied. This is what
  // lets the seven-room control use the same data directory without inheriting
  // a candidate measured on the thirty-three-room world.
  const worldHash = createHash("sha256").update(text).digest("hex");
  if (file.worldHash !== worldHash) return null;

  for (const change of file.changes ?? []) {
    const fields = PACING_FIELDS[change.collection];
    if (!fields || !fields.has(change.field)) {
      errors.push(`generated pacing changes ${change.collection}.${change.field}, which is not writable`);
      continue;
    }
    const entry = (raw[change.collection] ?? []).find((candidate) => candidate.id === change.target);
    if (!entry) {
      errors.push(`generated pacing names ${change.target}, which does not exist`);
      continue;
    }
    if (entry[change.field] !== change.from) {
      errors.push(`generated pacing says ${change.target}.${change.field} is ${change.from}, but the world has ${entry[change.field]}`);
      continue;
    }
    if (!Number.isInteger(change.to)) {
      errors.push(`generated pacing sets ${change.target}.${change.field} to a non-integer`);
      continue;
    }
    entry[change.field] = change.to;
  }

  return { candidate: file.candidate ?? null, report: file.report ?? null, changes: file.changes ?? [], admission: file.admission ?? null };
}

export function loadWorld({ mode = "single", path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;
  let text;

  try {
    text = readFileSync(path, "utf8");
    raw = JSON.parse(text);
  } catch (error) {
    return { rooms: {}, start: 1, errors: [`cannot read ${path}: ${error.message}`] };
  }

  const pacing = applyPacing({ text, raw, path, errors });

  const rooms = {};
  for (const [id, room] of Object.entries(raw.rooms ?? {})) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric < 1) {
      errors.push(`room id "${id}" is not a positive integer`);
      continue;
    }
    const text = typeof room.text === "string" ? room.text : room.text?.[mode];
    if (typeof text !== "string") {
      errors.push(`room ${id} has no text for mode "${mode}"`);
      continue;
    }
    if (room.safe !== undefined && typeof room.safe !== "boolean") {
      errors.push(`room ${id} has a non-boolean safe flag`);
    }
    if (room.arena !== undefined && typeof room.arena !== "boolean") {
      errors.push(`room ${id} has a non-boolean arena flag`);
    }
    if (room.details !== undefined && (typeof room.details !== "object" || Array.isArray(room.details))) {
      errors.push(`room ${id} has details that are not an object`);
    }
    if (room.ambient !== undefined && !Array.isArray(room.ambient)) {
      errors.push(`room ${id} has ambient lines that are not a list`);
    }
    rooms[numeric] = {
      name: room.name ?? `Room ${id}`,
      exits: room.exits ?? {},
      text,
      notices: room.notices ?? [],
      safe: room.safe === true,
      arena: room.arena === true,
      details: room.details ?? {},
      ambient: room.ambient ?? [],
    };
  }

  // Exits must land somewhere.
  for (const [id, room] of Object.entries(rooms)) {
    for (const [direction, target] of Object.entries(room.exits)) {
      if (!rooms[target]) {
        errors.push(`room ${id} exits ${direction} to ${target}, which does not exist`);
      }
    }
  }

  // Notices must be readable by at least one role.
  for (const [id, room] of Object.entries(rooms)) {
    for (const notice of room.notices) {
      if (!Number.isInteger(notice.level) || notice.level < 0 || notice.level >= LEVELS) {
        errors.push(`room ${id} has a notice at level ${notice.level}, outside 0..${LEVELS - 1}`);
      }
      if (typeof notice.text !== "string") {
        errors.push(`room ${id} has a notice with no text`);
      }
    }
  }

  // NPCs must stand somewhere real, and their clocks must be sane.
  const npcs = [];
  for (const npc of raw.npcs ?? []) {
    if (!rooms[npc.room]) errors.push(`npc ${npc.id} is in room ${npc.room}, which does not exist`);
    if (!Number.isInteger(npc.period) || npc.period < 1) errors.push(`npc ${npc.id} has a period below 1`);
    if (!Number.isInteger(npc.jitter) || npc.jitter < 0) errors.push(`npc ${npc.id} has a negative jitter`);
    const behaviour = npc.behaviour ?? "wander";
    if (!["wander", "sentinel", "speaker"].includes(behaviour)) {
      errors.push(`npc ${npc.id} has unknown behaviour "${behaviour}"`);
    }
    if (behaviour === "speaker" && !(npc.phrases ?? []).length) {
      errors.push(`npc ${npc.id} speaks but has no phrases`);
    }
    if (!Number.isInteger(npc.hp) || npc.hp < 1) errors.push(`npc ${npc.id} has no hit points`);
    if (npc.damage !== undefined && (!Number.isInteger(npc.damage) || npc.damage < 0)) errors.push(`npc ${npc.id} has an invalid damage`);
    if (npc.armor !== undefined && (!Number.isInteger(npc.armor) || npc.armor < 0)) errors.push(`npc ${npc.id} has an invalid armor`);
    if (npc.aggression !== undefined && (!Number.isInteger(npc.aggression) || npc.aggression < 0 || npc.aggression > 100)) errors.push(`npc ${npc.id} has an aggression outside 0..100`);
    npcs.push({ ...npc, behaviour, maxHp: npc.hp });
  }

  // Objects must start somewhere real, and ids must be unique. Their properties
  // are data too: a container holds things, a thing can be worn, eaten or lit,
  // and a broken property is a world that will not boot rather than a verb that
  // silently does nothing.
  const objects = [];
  const seenObject = new Set();
  const FLAGS = new Set(["takeable", "fixed", "container", "wearable", "food", "light", "readable", "coin", "weapon", "armor"]);
  for (const object of raw.objects ?? []) {
    if (seenObject.has(object.id)) errors.push(`object id "${object.id}" is used twice`);
    seenObject.add(object.id);

    const flags = object.flags ?? [];
    for (const flag of flags) {
      if (!FLAGS.has(flag)) errors.push(`object ${object.id} has unknown flag "${flag}"`);
    }

    if (object.inside !== undefined) {
      if (object.room !== undefined) errors.push(`object ${object.id} is both in a room and inside something`);
    } else if (!rooms[object.room]) {
      errors.push(`object ${object.id} is in room ${object.room}, which does not exist`);
    }

    if (flags.includes("container")) {
      if (!Number.isInteger(object.capacity) || object.capacity < 1) errors.push(`container ${object.id} has no capacity`);
    }
    if (flags.includes("weapon") && (!Number.isInteger(object.damage) || object.damage < 1)) {
      errors.push(`weapon ${object.id} has no damage`);
    }
    if (flags.includes("armor") && (!Number.isInteger(object.armor) || object.armor < 1)) {
      errors.push(`armor ${object.id} has no armor value`);
    }
    if (flags.includes("food")) {
      if (!Number.isInteger(object.bites) || object.bites < 1) errors.push(`food ${object.id} has no bites`);
      if (object.heal !== undefined && (!Number.isInteger(object.heal) || object.heal < 0)) errors.push(`food ${object.id} has an invalid heal`);
    }
    if (flags.includes("coin") && (!Number.isInteger(object.value) || object.value < 1)) {
      errors.push(`coin ${object.id} has no integer value`);
    }
    if (object.forSale && (!Number.isInteger(object.price) || object.price < 1)) {
      errors.push(`object ${object.id} is for sale without a price`);
    }
    if (flags.includes("light") && typeof (object.lit ?? false) !== "boolean") {
      errors.push(`light ${object.id} has a non-boolean lit`);
    }
    objects.push({ ...object, flags });
  }

  // A container's contents must name a container that exists, and nesting stops
  // at one level, so a container cannot swallow itself.
  for (const object of objects) {
    if (object.inside === undefined) continue;
    const container = objects.find((o) => o.id === object.inside);
    if (!container) errors.push(`object ${object.id} is inside "${object.inside}", which does not exist`);
    else if (!container.flags.includes("container")) errors.push(`object ${object.id} is inside ${container.id}, which is not a container`);
    else if (container.inside !== undefined) errors.push(`container ${container.id} is itself inside something; nesting is one level`);
  }

  // The climate is data too: a day length, the phases that divide it, and the
  // weather the world moves through. An hour covered by no phase is a world
  // with a hole in its day, so coverage is checked rather than assumed.
  const rawClimate = raw.climate ?? {};
  const dayLength = rawClimate.dayLength ?? 720;
  if (!Number.isInteger(dayLength) || dayLength < 24) errors.push("climate dayLength must be at least 24 ticks");
  const phases = rawClimate.phases ?? [];
  if (phases.length === 0) errors.push("climate has no phases");
  const hours = new Set();
  for (const phase of phases) {
    if (!Number.isInteger(phase.from) || !Number.isInteger(phase.to) || phase.from > phase.to || phase.to > 23) {
      errors.push(`climate phase ${phase.id} has an invalid hour range`);
      continue;
    }
    for (let hour = phase.from; hour <= phase.to; hour += 1) hours.add(hour);
  }
  for (let hour = 0; hour < 24; hour += 1) {
    if (!hours.has(hour)) errors.push(`climate leaves hour ${hour} without a phase`);
  }
  const weather = rawClimate.weather ?? [];
  if (weather.length === 0) errors.push("climate has no weather");
  for (const entry of weather) {
    if (typeof entry.id !== "string" || typeof entry.text !== "string") errors.push("a weather state has no id or text");
  }
  const weatherPeriod = rawClimate.weatherPeriod ?? 120;
  if (!Number.isInteger(weatherPeriod) || weatherPeriod < 1) errors.push("climate weatherPeriod must be at least 1");
  const climate = { dayLength, phases, weather, weatherPeriod };

  // A shop is a room with a keeper and stock. The keeper must be a mobile that
  // exists and stands there, or the shop is a stall nobody minds.
  const shops = (raw.shops ?? []).map((shop) => {
    const keeper = npcs.find((npc) => npc.id === shop.keeper);
    if (!rooms[shop.room]) errors.push(`shop ${shop.id} is in room ${shop.room}, which does not exist`);
    if (!keeper) errors.push(`shop ${shop.id} names keeper "${shop.keeper}", which does not exist`);
    else if (keeper.room !== shop.room) errors.push(`shop ${shop.id} has its keeper in room ${keeper.room}, not ${shop.room}`);
    return { ...shop };
  });

  // Loot must name objects that exist; a mob that drops nothing is fine.
  for (const npc of npcs) {
    for (const lootId of npc.loot ?? []) {
      if (!objects.some((object) => object.id === lootId)) errors.push(`npc ${npc.id} loots ${lootId}, which does not exist`);
    }
    if (npc.dialogue !== undefined && (!Array.isArray(npc.dialogue) || npc.dialogue.some((line) => typeof line !== "string"))) {
      errors.push(`npc ${npc.id} has invalid dialogue`);
    }
  }

  // Zones are a naming layer over rooms, as they were in the codebases this
  // borrows from; they are how a world gets reset a piece at a time.
  const zones = (raw.zones ?? []).map((zone) => {
    for (const id of zone.rooms) {
      if (!rooms[id]) errors.push(`zone ${zone.id} names room ${id}, which does not exist`);
      else if (rooms[id].zone) errors.push(`room ${id} belongs to both ${rooms[id].zone} and ${zone.id}`);
      else rooms[id].zone = zone.id;
    }
    return { ...zone };
  });
  for (const [id, room] of Object.entries(rooms)) {
    if (!room.zone) errors.push(`room ${id} belongs to no zone`);
  }
  for (const npc of npcs) {
    if (!zones.some((zone) => zone.id === npc.zone)) errors.push(`npc ${npc.id} has unknown zone ${npc.zone}`);
  }

  // Every room must be reachable from the start, or nobody will ever see it.
  const start = raw.start ?? 1;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    for (const target of Object.values(rooms[id]?.exits ?? {})) {
      if (rooms[target] && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  for (const id of Object.keys(rooms)) {
    if (!seen.has(Number(id))) errors.push(`room ${id} is unreachable from room ${start}`);
  }

  const task = raw.task ?? { vault: 4, shrine: 6, word: "amber" };
  for (const key of ["vault", "shrine"]) {
    if (!rooms[task[key]]) errors.push(`task.${key} names room ${task[key]}, which does not exist`);
  }

  return { rooms, start, task, npcs, objects, shops, zones, climate, pacing, errors };
}
