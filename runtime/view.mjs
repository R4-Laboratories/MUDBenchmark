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
export function describe({ room, role = 0, others = [], beasts = [], tick = 0, cleared }) {
  const exits = Object.keys(room.exits ?? {}).join(", ") || "none";
  const lines = [``, `[${room.name}]`, room.text];

  for (const notice of room.notices ?? []) {
    if (cleared ? cleared(role, notice.level) : false) lines.push(notice.text);
  }

  lines.push(others.length ? `You are not alone: ${others.join(", ")}.` : `You are alone.`);
  if (beasts.length) lines.push(`Here also: ${beasts.join(", ")}.`);
  lines.push(`Exits: ${exits}.`, `Tick ${tick}.`, ``);
  return lines.join("\r\n");
}
