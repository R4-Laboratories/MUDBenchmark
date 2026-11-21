// Equipment slots. Gear is an object: it is worn or held, not a separate
// persisted loadout. A slot is a view of the objects on the character.

import { wardenBonus } from "./guilds.mjs";

export const SLOTS = ["head", "body", "hands", "feet", "cloak", "neck", "mainhand", "offhand"];

const INVENTORY_GROUPS = [
  { id: "weapons", label: "Weapons" },
  { id: "armour", label: "Armour" },
  { id: "containers", label: "Containers" },
  { id: "light", label: "Light" },
  { id: "food", label: "Food and drink" },
  { id: "scrolls", label: "Scrolls" },
  { id: "coins", label: "Coins" },
  { id: "other", label: "Other" },
];

function inventoryGroup(object) {
  const flags = object?.flags ?? [];
  if (flags.includes("coin")) return "coins";
  if (flags.includes("weapon")) return "weapons";
  if (flags.includes("armor") || flags.includes("wearable")) return "armour";
  if (flags.includes("container")) return "containers";
  if (flags.includes("light")) return "light";
  if (flags.includes("food") || flags.includes("drink")) return "food";
  if (flags.includes("readable")) return "scrolls";
  return "other";
}

/** Group carried objects so a large inventory stays readable. */
export function inventoryGroups(objects = []) {
  const buckets = new Map(INVENTORY_GROUPS.map((group) => [group.id, []]));
  for (const object of objects) buckets.get(inventoryGroup(object)).push(object);
  return INVENTORY_GROUPS
    .map((group) => ({ ...group, items: buckets.get(group.id) }))
    .filter((group) => group.items.length > 0);
}

export function slotOf(object) {
  if (object?.slot && SLOTS.includes(object.slot)) return object.slot;
  if ((object?.flags ?? []).includes("weapon")) return "mainhand";
  return "body";
}

export function wornBySlot(actor, objects) {
  const slots = {};
  for (const object of objects) {
    if (object.holder !== actor.id || !object.worn || object.eaten) continue;
    slots[slotOf(object)] = object;
  }
  return slots;
}

export function armorOf(actor, objects) {
  const worn = objects
    .filter((object) => object.holder === actor.id && object.worn && !object.eaten)
    .reduce((total, object) => total + (Number.isFinite(object.armor) ? object.armor : 0), 0);
  return worn + Math.max(0, Number(actor.armorBonus ?? 0)) + wardenBonus(actor).armor;
}

export function weaponOf(actor, objects) {
  const object = objects.find((candidate) => candidate.id === actor.wielding);
  if (!object || object.holder !== actor.id || object.eaten) return null;
  return (object.flags ?? []).includes("weapon") ? object : null;
}

export function equipmentOf(actor, objects) {
  const slots = wornBySlot(actor, objects);
  const weapon = weaponOf(actor, objects);
  if (weapon) slots.mainhand = weapon;
  return Object.fromEntries(SLOTS.map((slot) => [slot, slots[slot] ?? null]));
}

export function equipmentText(actor, objects) {
  const slots = equipmentOf(actor, objects);
  const weapon = weaponOf(actor, objects);
  const bonus = wardenBonus(actor);
  const lines = [`Armour ${armorOf(actor, objects)} · weapon damage ${(weapon?.damage ?? 0) + bonus.damage}${bonus.damage ? ` (+${bonus.damage} rank)` : ""}.`];
  for (const slot of SLOTS) {
    const object = slots[slot];
    lines.push(`${slot.padEnd(8)} ${object ? object.name : "—"}${object?.armor ? ` (armour ${object.armor})` : ""}${object?.damage ? ` (damage ${object.damage})` : ""}`);
  }
  return lines.join("\r\n");
}
