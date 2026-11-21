// A rotating world event, one faction at a time. The event is derived from the
// two-hour reset cycle, so it needs no extra saved state and changes on reset.

export const WORLD_EVENTS = [
  { id: "ember", name: "The Ember Tide", faction: "ember", zone: "ember", text: "Ember standing is doubled and the Ember Forge quartermaster takes 20% off." },
  { id: "fen", name: "The Fen Rising", faction: "fen", zone: "fen", text: "Fen standing is doubled and the Fen Wardens quartermaster takes 20% off." },
  { id: "salt", name: "The Salt Surge", faction: "salt", zone: "salt", text: "Salt standing is doubled and the Salt Wardens quartermaster takes 20% off." },
  { id: "moon", name: "The Moonrise", faction: "moon", zone: "moon", text: "Moon standing is doubled and the Moon Wardens quartermaster takes 20% off." },
];

export function currentEvent(cycle = 0) {
  const index = ((Number(cycle) || 0) % WORLD_EVENTS.length + WORLD_EVENTS.length) % WORLD_EVENTS.length;
  return WORLD_EVENTS[index];
}

export function eventPrice(object, cycle = 0) {
  if (!object?.forSale || !Number.isInteger(object.price)) return object?.price ?? null;
  const event = currentEvent(cycle);
  if (object.faction !== event.faction) return object.price;
  return Math.max(1, Math.floor(object.price * 0.8));
}

export function eventText(cycle = 0) {
  const event = currentEvent(cycle);
  return `${event.name}: ${event.text}`;
}
