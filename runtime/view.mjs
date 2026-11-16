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
export function describe({ room, role = 0, others = [], beasts = [], objects = [], tick = 0, phase = null, weather = null, cleared }) {
  const exits = Object.keys(room.exits ?? {}).join(", ") || "none";
  const lines = [``, `[${room.name}]`, room.text];
  if (room.safe) lines.push("This is a safe place.");
  else lines.push("Contested ground: players may attack here.");
  if (phase || weather) lines.push([phase ? `It is ${phase}.` : null, weather].filter(Boolean).join(" "));
  if (Array.isArray(room.ambient) && room.ambient.length) lines.push(room.ambient[tick % room.ambient.length]);

  for (const notice of room.notices ?? []) {
    if (cleared ? cleared(role, notice.level) : false) lines.push(notice.text);
  }

  lines.push(others.length ? `You are not alone: ${others.join(", ")}.` : `You are alone.`);
  if (beasts.length) lines.push(`Here also: ${beasts.join(", ")}.`);
  if (objects.length) lines.push(`You can see: ${objects.join(", ")}.`);
  lines.push(`Exits: ${exits}.`, `Tick ${tick}.`, ``);
  return lines.join("\r\n");
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
