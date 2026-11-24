// The run's win condition, in one place.
//
// The world's stated goal is: reach the maximum level, complete every live
// quest, and solve every hidden way (a secret exit). The tally is derived from
// facts the character already carries; a completed run is then recorded once
// and kept, so a later death or a new quest cannot take the title away.

export const WORLDBREAKER_TITLE = "Worldbreaker";

/** Every secret exit, as the `room:direction` keys `actor.found` stores. */
export function secretWays(rooms = {}) {
  const ways = [];
  for (const [id, room] of Object.entries(rooms ?? {})) {
    for (const dir of Object.keys(room?.secretExits ?? {})) ways.push(`${Number(id)}:${dir}`);
  }
  return ways.sort((a, b) => {
    const [ar, ad] = a.split(":");
    const [br, bd] = b.split(":");
    return Number(ar) - Number(br) || (ad < bd ? -1 : ad > bd ? 1 : 0);
  });
}

/**
 * The live tally. `done` means the character meets all three conditions now;
 * `achieved` means they have ever done so (the record survives death/reset).
 */
export function completionState({ actor = null, rooms = {}, quests = [], levels = [] } = {}) {
  const liveQuestIds = new Set((quests ?? []).map((quest) => quest.id));
  const completedQuestIds = new Set((actor?.quests?.completed ?? []).filter((id) => liveQuestIds.has(id)));
  const ways = secretWays(rooms);
  const found = new Set(actor?.found ?? []);
  const puzzles = ways.filter((way) => found.has(way)).length;
  const maxLevel = Array.isArray(levels) && levels.length ? levels.length : 10;
  const level = Number.isInteger(actor?.level) ? actor.level : 1;
  const questsTotal = liveQuestIds.size;
  const questsDone = completedQuestIds.size;
  const done = level >= maxLevel && questsDone >= questsTotal && puzzles >= ways.length;
  const record = actor?.completion && typeof actor.completion === "object" ? actor.completion : null;
  return {
    level,
    maxLevel,
    quests: questsDone,
    questsTotal,
    puzzles,
    puzzlesTotal: ways.length,
    done,
    achieved: Boolean(record) || done,
    achievedAt: Number.isInteger(record?.tick) ? record.tick : null,
    title: Boolean(record) || done ? WORLDBREAKER_TITLE : null,
  };
}

/** A compact line for the score, prompt and completion command. */
export function completionLine(state) {
  const tally = state;
  const current = `level ${tally.level}/${tally.maxLevel} · quests ${tally.quests}/${tally.questsTotal} · hidden ways ${tally.puzzles}/${tally.puzzlesTotal}`;
  if (tally.achieved) {
    const when = Number.isInteger(tally.achievedAt) ? ` at tick ${tally.achievedAt}` : "";
    return `Run beaten${when}: ${current}. ${WORLDBREAKER_TITLE} title earned.`;
  }
  return `Goal: ${current}.`;
}
