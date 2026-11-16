// The hidden scenario corpus.
//
// These playthroughs are the candidate loop's judges. `tools/candidate.mjs`
// never imports this file: it proposes values without knowing what will be
// measured, so it cannot select a variant because it suits the test. The gate
// protects this file and `tools/measure.mjs` from a publisher.
//
// Every scenario is deterministic. The reducer's only apparent randomness is
// `attackRoll`, which is a pure function of the tick and the attacker's id, so
// a run from the same world always produces the same numbers.

import { initialState, step } from "../runtime/world.mjs";

const EMPTY = { actor: "", others: "", target: "" };

function actorOf(state, id) {
  return state.actors.find((actor) => actor.id === id);
}

function intentFor({ state, world, actorId, action, scenarioId }) {
  const actor = actorOf(state, actorId);
  switch (action.do) {
    case "login":
      return [{ kind: "login", actorId, key: action.name ?? "measure", authenticated: true }];
    case "move": {
      const to = world.rooms[actor.room]?.exits?.[action.dir];
      if (to === undefined) throw new Error(`${scenarioId}: no exit ${action.dir} from room ${actor.room}`);
      return [{ kind: "move", actorId, dir: action.dir, to }];
    }
    case "take":
      return [{ kind: "take", actorId, objectId: action.object, messages: EMPTY }];
    case "buy": {
      const coinIds = state.objects
        .filter((object) => object.holder === actorId && (object.flags ?? []).includes("coin"))
        .map((object) => object.id);
      return [{ kind: "buy", actorId, objectId: action.object, room: actor.room, coinIds, messages: EMPTY }];
    }
    case "eat":
      return [{ kind: "eat", actorId, objectId: action.object, messages: EMPTY }];
    case "attack":
      return [{ kind: "attack", actorId, targetId: action.target }];
    case "questAccept":
      return [{ kind: "questAccept", actorId, questId: action.quest }];
    case "questAnswer":
      return [{ kind: "questAnswer", actorId, word: action.word }];
    default:
      throw new Error(`${scenarioId}: unknown action ${action.do}`);
  }
}

export function runScenario({ world, quests, scenario }) {
  const actorId = "m";
  const rooms = world.rooms;
  let state = initialState(
    world.rooms,
    world.npcs,
    world.objects,
    world.start,
    world.climate,
    [],
    world.levels,
    quests,
  );
  state = step({ state, rooms, intents: [{ kind: "join", actorId, name: "measure" }] }).state;

  const advance = (intents) => {
    const result = step({ state, rooms, intents });
    state = result.state;
    return result.events;
  };

  const trace = { ticks: 0, moves: 0, visits: 0, damage: 0, deaths: 0, minHp: 10, combatTicks: 0 };

  for (const action of scenario.steps) {
    if (action.do === "pose") {
      const actor = actorOf(state, actorId);
      actor.room = action.room;
      if (!actor.visited.includes(action.room)) actor.visited.push(action.room);
      for (const npcId of action.npcs ?? []) {
        const npc = state.npcs.find((entry) => entry.id === npcId);
        if (!npc) throw new Error(`${scenario.id}: no npc ${npcId}`);
        npc.room = action.room;
        // A frozen mobile stands its ground. The hunt measures a fight, not a
        // chase: whether a boar wanders is a different question, asked by the
        // liveliness scenario.
        if (action.freeze) npc.clock = { period: 1_000_000_000, remaining: 1_000_000_000 };
      }
      continue;
    }

    if (action.do === "until" || action.do === "observe") {
      const max = action.ticks ?? 480;
      const target = action.target ? state.npcs.find((npc) => npc.id === action.target) : null;
      if (action.do === "until" && !target) throw new Error(`${scenario.id}: no target ${action.target}`);
      const before = new Map(state.npcs.map((npc) => [npc.id, npc.room]));
      for (let i = 0; i < max; i += 1) {
        const actorBefore = actorOf(state, actorId);
        const hpBefore = actorBefore.hp;
        const events = advance([]);
        trace.ticks += 1;
        if (action.do === "until") trace.combatTicks += 1;
        for (const event of events) {
          if (event.onlyId === actorId && /You die|You fall/.test(event.text ?? "")) trace.deaths += 1;
        }
        const actorNow = actorOf(state, actorId);
        if (actorNow.hp < hpBefore) trace.damage += hpBefore - actorNow.hp;
        trace.minHp = Math.min(trace.minHp, actorNow.hp);
        const zone = world.rooms[actorNow.room]?.zone;
        for (const npc of state.npcs) {
          if (before.get(npc.id) !== npc.room) {
            if (!action.zone || npc.zone === action.zone || npc.zone === zone) trace.moves += 1;
            if (npc.room === actorNow.room) trace.visits += 1;
            before.set(npc.id, npc.room);
          }
        }
        if (trace.deaths > 0) break;
        if (action.do === "until") {
          const live = state.npcs.find((npc) => npc.id === action.target);
          if (!live || live.dead || live.hp <= 0) break;
        }
      }
      continue;
    }

    advance(intentFor({ state, world, actorId, action, scenarioId: scenario.id }));
    trace.ticks += 1;
  }

  return { state, trace, metrics: scenario.measure({ state, trace, world }) };
}

export const SCENARIOS = [
  {
    id: "opening",
    note: "The first minute: find a coin and bread, then buy and eat stew.",
    steps: [
      { do: "login" },
      { do: "move", dir: "east" },
      { do: "move", dir: "north" },
      { do: "take", object: "coin" },
      { do: "take", object: "bread" },
      { do: "move", dir: "south" },
      { do: "move", dir: "west" },
      { do: "move", dir: "south" },
      { do: "move", dir: "west" },
      { do: "buy", object: "stew" },
      { do: "eat", object: "stew" },
    ],
    measure: ({ state, trace }) => {
      const actor = actorOf(state, "m");
      return {
        ticks: trace.ticks,
        bought: state.objects.find((object) => object.id === "stew")?.forSale === false,
        hasBread: state.objects.find((object) => object.id === "bread")?.holder === actor.id,
        hp: actor.hp,
        survived: trace.deaths === 0,
      };
    },
  },
  {
    id: "hunt",
    note: "A fresh character meets the boar at the forest edge and fights it out.",
    steps: [
      { do: "login" },
      { do: "pose", room: 15, npcs: ["boar"], freeze: true },
      { do: "attack", target: "boar" },
      { do: "until", target: "boar", ticks: 480, room: 15 },
    ],
    measure: ({ state, trace }) => {
      const boar = state.npcs.find((npc) => npc.id === "boar");
      const actor = actorOf(state, "m");
      return {
        ticks: trace.ticks,
        rounds: Math.ceil(trace.combatTicks / 12),
        damage: trace.damage,
        killed: Boolean(boar?.dead) || (boar?.hp ?? 0) <= 0,
        survived: trace.deaths === 0,
        hp: actor.hp,
        minHp: trace.minHp,
      };
    },
  },
  {
    id: "quests",
    note: "The True Word and the Curled Scroll, walked end to end.",
    steps: [
      { do: "login" },
      { do: "questAccept", quest: "word" },
      { do: "move", dir: "north" },
      { do: "move", dir: "east" },
      { do: "move", dir: "west" },
      { do: "move", dir: "south" },
      { do: "move", dir: "east" },
      { do: "move", dir: "north" },
      { do: "move", dir: "north" },
      { do: "questAnswer", word: "amber" },
      { do: "questAccept", quest: "scroll" },
      { do: "move", dir: "south" },
      { do: "move", dir: "south" },
      { do: "move", dir: "west" },
      { do: "move", dir: "north" },
      { do: "take", object: "scroll" },
    ],
    measure: ({ state, trace }) => {
      const actor = actorOf(state, "m");
      const quests = actor.quests ?? { active: [], completed: [] };
      return {
        ticks: trace.ticks,
        completed: quests.completed.length,
        completedIds: [...quests.completed].sort(),
        active: quests.active.length,
      };
    },
  },
  {
    id: "liveliness",
    note: "Stand in the safe Atrium for fifteen hundred ticks and watch the temple move.",
    steps: [
      { do: "login" },
      { do: "pose", room: 1 },
      { do: "observe", ticks: 1500, zone: "temple" },
    ],
    measure: ({ trace }) => ({
      ticks: trace.ticks,
      moves: trace.moves,
      visits: trace.visits,
      survived: trace.deaths === 0,
    }),
  },
];
