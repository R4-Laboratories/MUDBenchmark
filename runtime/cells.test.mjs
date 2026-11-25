import test from "node:test";
import assert from "node:assert/strict";
import { cellFor, objectPosition, validateLayout } from "./cells.mjs";
import { initialState, releaseHeldObjects, step, upgradeState } from "./world.mjs";
import { loadWorld } from "./worlddata.mjs";

const world = loadWorld();
const rooms = world.rooms;
const messages = { actor: "", others: "", target: "" };
const apply = (state, intents) => step({ state, rooms, intents }).state;
const entity = (state, id) => state.objects.find((object) => object.id === id);

test("authored corridor starts with explicit positions", () => {
  assert.deepEqual(world.errors, []);
  const state = initialState(rooms, world.npcs, world.objects, world.start);
  assert.deepEqual(state.npcs.find((npc) => npc.id === "rat").cell, [3, 1]);
  assert.deepEqual(objectPosition(state, rooms, entity(state, "scroll")), { room: 2, cell: [2, 1] });
  assert.deepEqual(objectPosition(state, rooms, entity(state, "chest")), { room: 2, cell: [4, 1] });
  assert.equal(objectPosition(state, rooms, entity(state, "coin")), null);
});

test("room movement places arrivals at the authored entry without changing room commands", () => {
  let state = initialState(rooms, world.npcs, world.objects, world.start);
  state = apply(state, [{ kind: "join", actorId: 1, name: "Alice" }]);
  assert.equal(state.actors[0].cell, null);
  state = apply(state, [{ kind: "move", actorId: 1, dir: "north", to: 2 }]);
  assert.equal(state.actors[0].room, 2);
  assert.deepEqual(state.actors[0].cell, [1, 1]);
  state = apply(state, [{ kind: "move", actorId: 1, dir: "south", to: 1 }]);
  assert.equal(state.actors[0].room, 1);
  assert.equal(state.actors[0].cell, null);
});

test("objects follow their carrier and container, then drop at the actor's cell", () => {
  let state = initialState(rooms, world.npcs, world.objects, world.start);
  state = apply(state, [{ kind: "join", actorId: 1, name: "Alice" }]);
  state = apply(state, [{ kind: "move", actorId: 1, dir: "north", to: 2 }]);
  state = apply(state, [{ kind: "take", actorId: 1, objectId: "scroll", messages }]);
  assert.deepEqual(objectPosition(state, rooms, entity(state, "scroll")), { room: 2, cell: [1, 1] });
  state = apply(state, [{ kind: "open", actorId: 1, objectId: "chest", messages }]);
  state = apply(state, [{ kind: "put", actorId: 1, objectId: "scroll", containerId: "chest", messages }]);
  assert.deepEqual(objectPosition(state, rooms, entity(state, "scroll")), { room: 2, cell: [4, 1] });
  state = apply(state, [{ kind: "takeFrom", actorId: 1, objectId: "scroll", containerId: "chest", messages }]);
  state = apply(state, [{ kind: "drop", actorId: 1, objectId: "scroll", messages }]);
  assert.deepEqual(entity(state, "scroll").cell, [1, 1]);
});

test("old saves do not invent positions and restart drops at a known cell", () => {
  const base = initialState(rooms, world.npcs, world.objects, world.start);
  const saved = structuredClone(base);
  delete saved.npcs.find((npc) => npc.id === "rat").cell;
  delete entity(saved, "scroll").cell;
  const restored = upgradeState(saved, base);
  assert.equal(restored.npcs.find((npc) => npc.id === "rat").cell, null);
  assert.equal(entity(restored, "scroll").cell, null);
  const actor = { id: 1, room: 2, cell: [1, 1] };
  entity(restored, "scroll").holder = 1;
  entity(restored, "scroll").room = null;
  releaseHeldObjects(restored, [actor]);
  assert.deepEqual(entity(restored, "scroll").cell, [1, 1]);
});

test("wandering uses the authored entry and reset restores home positions", () => {
  const map = {
    1: { exits: { north: 2 } },
    2: { exits: { south: 1 }, cells: { grid: ["..."], spawn: [1, 0], entries: { south: [0, 0] } } },
  };
  let state = initialState(map, [{ id: "rat", name: "rat", room: 1, home: 1, period: 1, jitter: 0, hp: 1 }], [], 1);
  state = step({ state, rooms: map, intents: [] }).state;
  assert.equal(state.npcs[0].room, 2);
  assert.deepEqual(state.npcs[0].cell, [0, 0]);

  state = initialState(rooms, world.npcs, world.objects, world.start);
  const rat = state.npcs.find((npc) => npc.id === "rat");
  rat.room = 1;
  rat.cell = null;
  entity(state, "scroll").room = 1;
  entity(state, "scroll").cell = null;
  state.pulses.area.remaining = 1;
  state = apply(state, []);
  assert.deepEqual(state.npcs.find((npc) => npc.id === "rat").cell, [3, 1]);
  assert.deepEqual(entity(state, "scroll").cell, [2, 1]);
});

test("invalid cells and missing entries do not produce invented locations", () => {
  assert.ok(validateLayout({ grid: ["##", "#."] , spawn: [0, 0], entries: {} }, {}, 1).length);
  assert.ok(validateLayout({ grid: ["..."], spawn: [0, 0], entries: { north: [3, 0] } }, { north: 2 }, 1).length);
  assert.equal(cellFor(rooms[2], "north"), null);
  const state = { actors: [], objects: [{ id: "a", inside: "b" }, { id: "b", inside: "a" }] };
  assert.equal(objectPosition(state, rooms, state.objects[0]), null);
});
