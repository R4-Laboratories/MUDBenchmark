// Load and validate the world.
//
// The world is data, not code: rooms, exits and notices live in
// world/data/world.json so an author can change the map without touching the
// server, and so the same file can be checked by the gate.
//
// Validation is fail-closed. A room whose exit points nowhere, a notice at a
// level no role can reach, or a room nobody can walk to is a broken world, and
// a broken world should not accept a connection.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved against this module, not the process working directory: the service
// runs with its cwd inside runtime/, and relative paths there would lie.
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, "..", "world", "data", "world.json");

const LEVELS = 4; // roles and notice levels are both 0..3, per Perception.lex.tex

export function loadWorld({ mode = "single", path = DEFAULT_PATH } = {}) {
  const errors = [];
  let raw;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { rooms: {}, start: 1, errors: [`cannot read ${path}: ${error.message}`] };
  }

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
    rooms[numeric] = {
      name: room.name ?? `Room ${id}`,
      exits: room.exits ?? {},
      text,
      notices: room.notices ?? [],
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
    npcs.push({ ...npc, behaviour, maxHp: npc.hp });
  }

  // Objects must start somewhere real, and ids must be unique. Their properties
  // are data too: a container holds things, a thing can be worn, eaten or lit,
  // and a broken property is a world that will not boot rather than a verb that
  // silently does nothing.
  const objects = [];
  const seenObject = new Set();
  const FLAGS = new Set(["takeable", "fixed", "container", "wearable", "food", "light", "readable"]);
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
    if (flags.includes("food")) {
      if (!Number.isInteger(object.bites) || object.bites < 1) errors.push(`food ${object.id} has no bites`);
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

  // Zones are a naming layer over rooms, as they were in the codebases this
  // borrows from; they are how a world gets reset a piece at a time.
  const zones = (raw.zones ?? []).map((zone) => {
    for (const id of zone.rooms) {
      if (!rooms[id]) errors.push(`zone ${zone.id} names room ${id}, which does not exist`);
    }
    return { ...zone };
  });

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

  return { rooms, start, task, npcs, objects, zones, errors };
}
