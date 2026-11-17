// Equipment slots. Gear is an object: it is worn or held, not a separate
// persisted loadout. A slot is a view of the objects on the character.

export const SLOTS = ["head", "body", "hands", "feet", "cloak", "neck", "mainhand", "offhand"];

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
  return worn + Math.max(0, Number(actor.armorBonus ?? 0));
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
  const lines = [`Armour ${armorOf(actor, objects)}.`];
  for (const slot of SLOTS) {
    const object = slots[slot];
    lines.push(`${slot.padEnd(8)} ${object ? object.name : "—"}${object?.armor ? ` (armour ${object.armor})` : ""}${object?.damage ? ` (damage ${object.damage})` : ""}`);
  }
  return lines.join("\r\n");
}
