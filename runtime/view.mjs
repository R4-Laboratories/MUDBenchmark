// Room rendering, separated from the server so it can be tested.
//
// This exists because of a real escape: the world-data migration renamed
// `secrets` to `notices` in the loader while the server still read `secrets`,
// so every notice vanished — and the gate passed, because it validated the data
// and never the renderer. A renderer in its own module can be asserted against.

/**
 * @param {{ room: object, role: number, others: string[], beasts: string[],
 *           tick: number, cleared: (role: number, level: number) => boolean }} input
 * @returns {string} the text a player sees
 */
export function describe({ room, role = 0, others = [], beasts = [], objects = [], tick = 0, phase = null, weather = null, cleared, light = true }) {
  const exits = Object.keys(room.exits ?? {}).join(", ") || "none";
  if (room.dark === true && !light) {
    return `${[
      "",
      `[${room.name}]`,
      room.darkText ?? "The dark is complete. You can feel the room only as a cold space around you.",
      `Exits: ${exits}.`,
    ].join("\r\n")}\r\n`;
  }
  const lines = [``, `[${room.name}]`, room.text];

  // Time and weather are atmosphere, not a status panel.
  if (phase || weather) lines.push(`${phase ? phase[0].toUpperCase() + phase.slice(1) : "The day"}.${weather ? ` ${weather}` : ""}`);

  for (const notice of room.notices ?? []) {
    if (cleared ? cleared(role, notice.level) : false) lines.push(notice.text);
  }

  if (Array.isArray(room.ambient) && room.ambient.length) lines.push(room.ambient[tick % room.ambient.length]);

  const people = [...others, ...beasts];
  if (people.length) {
    lines.push("Here:");
    for (const name of people) lines.push(`  ${name}`);
  }
  if (objects.length) {
    lines.push("Objects:");
    for (const name of objects) lines.push(`  ${name}`);
  }
  lines.push(`Exits: ${exits}.`);
  return `${lines.join("\r\n")}\r\n`;
}



/**
 * What one named thing looks like, from the room's point of view. Objects and
 * mobiles win over a room detail; a detail wins over nothing.
 */
export function examine({ room, target, objects = [], npcs = [] }) {
  const want = String(target ?? "").trim().toLowerCase();
  if (!want) return null;
  const object = objects.find((candidate) => candidate.name.toLowerCase().includes(want));
  if (object) return object.examine ?? object.name;
  const npc = npcs.find((candidate) => candidate.name.toLowerCase().includes(want));
  if (npc) return npc.examine ?? npc.description ?? npc.name;
  const details = room?.details ?? {};
  const exact = details[want];
  if (typeof exact === "string") return exact;
  const entry = Object.entries(details).find(([key]) => key.toLowerCase().includes(want));
  return entry ? entry[1] : null;
}
