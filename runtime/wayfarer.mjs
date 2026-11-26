// A small discovery track separate from the 25 quests.
//
// Visiting one landmark in each outer zone records a wayfarer mark in the
// character's existing `found` list as `wayfarer:<zone>`. The completion
// tally ignores those keys (it filters to secret exits), so this adds a
// reason to cross the world without changing the win condition or the quest
// budget.

export const WAYFARER = [
  { zone: "town", room: 30, name: "The Harbor Quay" },
  { zone: "wilds", room: 18, name: "The Deep Forest" },
  { zone: "arcanum", room: 170, name: "The Prism Chamber" },
  { zone: "lantern", room: 40, name: "The High Walk" },
  { zone: "undervault", room: 41, name: "The Mirror Pool" },
  { zone: "ember", room: 70, name: "The First Flame" },
  { zone: "fen", room: 80, name: "The Green Heart" },
  { zone: "salt", room: 85, name: "The Salt Heart" },
  { zone: "moon", room: 89, name: "The Moonwell" },
  { zone: "garden", room: 102, name: "The Root Archive" },
  { zone: "grey-keep", room: 140, name: "The Bell Tower" },
  { zone: "mistfall", room: 190, name: "The Cave Mouth" },
  { zone: "deepdelve", room: 205, name: "The Surveyor's Camp" },
  { zone: "foundry", room: 225, name: "The Master's Forge" },
  { zone: "monastery", room: 239, name: "The Reliquary" },
  { zone: "wreck", room: 251, name: "The Drowned Captain" },
];

const BY_ROOM = new Map(WAYFARER.map((entry) => [String(entry.room), entry]));
const BY_ZONE = new Map(WAYFARER.map((entry) => [entry.zone, entry]));
const KEY = "wayfarer:";

export function wayfarerSeen(actor) {
  const seen = new Set();
  for (const key of actor?.found ?? []) {
    if (typeof key === "string" && key.startsWith(KEY)) seen.add(key.slice(KEY.length));
  }
  return seen;
}

export function wayfarerState(actor) {
  const seen = wayfarerSeen(actor);
  const landmarks = WAYFARER.filter((entry) => seen.has(entry.zone));
  const next = WAYFARER.find((entry) => !seen.has(entry.zone)) ?? null;
  return {
    seen: landmarks.length,
    total: WAYFARER.length,
    zones: landmarks.map((entry) => entry.zone),
    next: next ? { zone: next.zone, room: next.room, name: next.name } : null,
  };
}

/** Record a landmark visit; returns the landmark when this is the first time. */
export function markWayfarer(actor, roomId) {
  const entry = BY_ROOM.get(String(roomId));
  if (!entry) return null;
  const key = `${KEY}${entry.zone}`;
  const found = actor?.found ?? [];
  if (found.includes(key)) return null;
  actor.found = [...found, key];
  return entry;
}

export function wayfarerLine(actor) {
  const state = wayfarerState(actor);
  if (!state.total) return "Wayfarer: no landmarks are configured.";
  const next = state.next ? ` Next: ${state.next.name} (${state.next.zone}).` : " Every landmark is recorded.";
  const zones = state.zones.length ? ` Seen: ${state.zones.join(", ")}.` : "";
  return `Wayfarer: ${state.seen}/${state.total} landmarks.${zones}${next}`;
}

export function wayfarerLandmark(zone) {
  return BY_ZONE.get(zone) ?? null;
}
