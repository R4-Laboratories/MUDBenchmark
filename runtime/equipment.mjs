// Equipment slots. Gear is an object: it is worn or held, not a separate
// persisted loadout. A slot is a view of the objects on the character.

import { guildBonus } from "./guilds.mjs";
import { GEAR_SETS } from "./forge.mjs";

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

/** One carried object for the inventory list, including what a shop pays. */
export function inventoryLabel(object, objects = []) {
  let base;
  if (object.worn) base = `${object.name} (worn)`;
  else if (!(object.flags ?? []).includes("container")) base = object.name;
  else {
    const held = objects.filter((child) => child.inside === object.id && !child.eaten).map((child) => child.name);
    const state_ = object.open ? "open" : "closed";
    base = held.length && object.open ? `${object.name} (${state_}, holding ${held.join(", ")})` : `${object.name} (${state_})`;
  }
  const value = Number.isInteger(object.value) ? object.value : 0;
  if (value > 0 && !(object.flags ?? []).includes("coin")) {
    base += ` [worth ${value}c; sells ${Math.floor(value / 2)}c]`;
  }
  return base;
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

export function setBonus(actor, objects) {
  const counts = new Map();
  for (const object of objects) {
    if (object.holder !== actor.id || object.eaten || !object.set) continue;
    if (!object.worn && actor.wielding !== object.id) continue;
    counts.set(object.set, (counts.get(object.set) ?? 0) + 1);
  }
  let armor = 0;
  let damage = 0;
  const sets = [];
  for (const [id, count] of counts) {
    if (count < 3) continue;
    const bonus = { id, name: GEAR_SETS[id] ?? id, count, armor: 1, damage: count >= 4 ? 1 : 0 };
    armor += bonus.armor;
    damage += bonus.damage;
    sets.push(bonus);
  }
  return { armor, damage, sets };
}

export function weaponDamageOf(weapon) {
  return (weapon?.damage ?? 0) + (weapon?.plus ?? 0);
}

export function armorOf(actor, objects) {
  const worn = objects
    .filter((object) => object.holder === actor.id && object.worn && !object.eaten)
    .reduce((total, object) => total + (Number.isFinite(object.armor) ? object.armor : 0) + (object.plus ?? 0), 0);
  return worn + Math.max(0, Number(actor.armorBonus ?? 0)) + guildBonus(actor).armor + setBonus(actor, objects).armor;
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
  const bonus = guildBonus(actor);
  const sets = setBonus(actor, objects);
  const lines = [`Armour ${armorOf(actor, objects)} · weapon damage ${weaponDamageOf(weapon) + bonus.damage + sets.damage}${bonus.damage ? ` (+${bonus.damage} rank)` : ""}${sets.damage ? ` (+${sets.damage} set)` : ""}.`];
  for (const set of sets.sets) lines.push(`Set ${set.name} (${set.count}): +${set.armor} armour${set.damage ? `, +${set.damage} damage` : ""}.`);
  for (const slot of SLOTS) {
    const object = slots[slot];
    lines.push(`${slot.padEnd(8)} ${object ? object.name : "—"}${object?.armor ? ` (armour ${object.armor})` : ""}${object?.damage ? ` (damage ${object.damage})` : ""}`);
  }
  return lines.join("\r\n");
}
