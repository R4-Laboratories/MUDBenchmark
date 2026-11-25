// Optional room-local coordinates. A missing position means unknown, not (0, 0).
export function validCell(layout, cell) {
  return Array.isArray(cell) && cell.length === 2 &&
    cell.every(Number.isInteger) && cell[0] >= 0 && cell[1] >= 0 &&
    layout?.grid?.[cell[1]]?.[cell[0]] === ".";
}

export function validateLayout(layout, exits, id) {
  const errors = [];
  if (!layout || typeof layout !== "object" || Array.isArray(layout) ||
      !Array.isArray(layout.grid) || layout.grid.length < 1 || layout.grid.length > 32 ||
      typeof layout.grid[0] !== "string" || layout.grid[0].length < 1 ||
      layout.grid[0].length > 32 || layout.grid.some((row) =>
        typeof row !== "string" || row.length !== layout.grid[0].length || /[^.#]/.test(row))) {
    return [`room ${id} has an invalid cell grid`];
  }
  if (!validCell(layout, layout.spawn)) errors.push(`room ${id} has an invalid cell spawn`);
  if (!layout.entries || typeof layout.entries !== "object" || Array.isArray(layout.entries)) {
    errors.push(`room ${id} has invalid cell entries`);
  } else {
    for (const [direction, point] of Object.entries(layout.entries)) {
      if (exits[direction] === undefined || !validCell(layout, point)) {
        errors.push(`room ${id} has an invalid cell entry ${direction}`);
      }
    }
  }
  return errors;
}

export function cellFor(room, entry = null) {
  const layout = room?.cells;
  const cell = entry === null ? layout?.spawn : layout?.entries?.[entry];
  return validCell(layout, cell) ? [...cell] : null;
}

export function opposite(direction) {
  return { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" }[direction] ?? "";
}

export function objectPosition(state, rooms, object) {
  const seen = new Set();
  while (object) {
    if (seen.has(object.id) || object.eaten) return null;
    seen.add(object.id);
    if (object.holder != null) {
      const actor = state.actors.find((candidate) => candidate.id === object.holder);
      return validCell(rooms[actor?.room]?.cells, actor?.cell)
        ? { room: actor.room, cell: [...actor.cell] } : null;
    }
    if (object.inside != null) {
      object = state.objects.find((candidate) => candidate.id === object.inside);
      continue;
    }
    return validCell(rooms[object.room]?.cells, object.cell)
      ? { room: object.room, cell: [...object.cell] } : null;
  }
  return null;
}
