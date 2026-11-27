// One turn controller for every agent surface.
//
// The browser, the local scorecard and any custom harness call these same
// functions. Providers only supply request/response transport; they do not get
// their own prompt, planner, memory or coach.

import { emptyMind, updateMind, mindPrompt } from "./mind.mjs";
import { emptyMemory, rememberResult, memoryPrompt, breakLoop, shouldBreakLoop } from "./memory.mjs";
import { focusFor, focusPrompt, focusGuard } from "./planner.mjs";
import { buildSystemPrompt, buildUserPrompt, buildActionMenu, parseBrain, coachCommand, coachAction, coachFallbackDue } from "./ai.mjs";

export const DEFAULT_GOAL = "Explore the world, complete quests, keep notes and stay alive. Use FOCUS, FRONTIER, the Mind and lessons.";

export function createAgentCore({
  name = "agent",
  goal = DEFAULT_GOAL,
  memory = emptyMemory(),
  mind = emptyMind(),
  weak = false,
  strict = false,
  fast = true,
  deliberateEvery = 5,
} = {}) {
  return {
    name, goal, memory, mind, weak, strict, fast, deliberateEvery,
    focusKey: "", focusDetours: 0, coachRetries: 0, blockedCounts: new Map(),
    progressMark: "", stallTurns: 0, frontierTurns: 0, lastPlan: "",
    questFocus: null,
    recent: [], lastCommand: null, lastParsed: null, lastValidation: null,
    lastCoach: null, commandRoom: null, tick: 0, transcript: [],
  };
}

const roomFrom = (state, room) => room ?? state?.room?.name ?? "unknown";
const exitsFrom = (observation, state) => {
  const match = String(observation ?? "").match(/^Exits:\s*(.+)$/m);
  if (match) return match[1].split(/,\s*/).map((part) => part.trim().split(/\s+/)[0].replace(/[^a-z]/gi, "")).filter(Boolean);
  return (state?.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir)).filter(Boolean);
};

/** Fold the previous result into memory/mind and build this turn's prompt. */
export function beginTurn(core, { state = null, observation = "", room = null, turn = 1, director = [], r4 = "", notebook = "", note = "" } = {}) {
  if (core.lastCommand && core.commandRoom) {
    rememberResult(core.memory, { room: core.commandRoom, command: core.lastCommand, observation, tick: core.tick, at: Date.now(), exits: core.commandExits ?? [] });
    updateMind(core.mind, { state, observation, command: core.lastCommand, parsed: core.lastParsed, validation: core.lastValidation, coach: core.lastCoach, room: core.commandRoom, tick: core.tick });
  }
  const currentRoom = roomFrom(state, room);
  const exits = exitsFrom(observation, state);
  const promptState = { ...(state ?? {}), room: { ...(state?.room ?? {}), name: currentRoom, exits: exits.map((dir) => ({ dir, room: null })), text: observation } };
  const mark = `${Object.keys(core.memory.rooms).length}|${promptState.self?.quests?.completed ?? 0}|${promptState.self?.xp ?? 0}|${promptState.self?.level ?? 1}`;
  if (core.progressMark === mark) core.stallTurns += 1;
  else { core.progressMark = mark; core.stallTurns = 0; }
  const planRepeated = Boolean(core.mind.plan && core.lastPlan === core.mind.plan);
  core.lastPlan = core.mind.plan;
  let preferExplore = core.weak && (core.stallTurns >= 12 || (core.stallTurns >= 6 && planRepeated));
  if (preferExplore && core.frontierTurns >= 8) {
    preferExplore = false;
    core.stallTurns = 0;
    core.frontierTurns = 0;
  } else if (preferExplore) core.frontierTurns += 1;
  else core.frontierTurns = 0;
  const focus = focusFor({ state: promptState, memory: core.memory, mind: core.mind, preferExplore, previousFocus: core.questFocus });
  if (focus.kind === "quest") core.questFocus = focus;
  const actions = [...new Set([...(focus.candidates ?? []), ...buildActionMenu(promptState)])].slice(0, 48);
  const deliberate = turn === 1 || turn % core.deliberateEvery === 0;
  const memoryText = memoryPrompt(core.memory, { room: currentRoom, exits: state?.room?.exits ?? [], query: observation });
  const mindText = mindPrompt(core.mind, { state: promptState, room: currentRoom });
  const focusText = focusPrompt(focus);
  const system = buildSystemPrompt({ name: core.name, goal: core.goal, fast: core.fast, deliberate });
  const user = buildUserPrompt({
    turn, observation, director, state: promptState, actions,
    memory: memoryText, mind: mindText, focus: focusText, fast: core.fast, r4, notebook, note,
  });
  return { promptState, currentRoom, exits, focus, actions, system, user, preferExplore, deliberate, memoryText, mindText, focusText };
}

/** Parse a reply, run loop/coach/focus control, and return the command to send. */
export function decideTurn(core, { reply = "", state = null, promptState = null, focus = null, room = null, turn = 1, preferExplore = false } = {}) {
  const parsed = parseBrain(reply);
  if (shouldBreakLoop(core.memory, { room: room ?? promptState?.room?.name, command: parsed.command, recent: core.recent }) || core.mind.stuck?.looping) {
    const forced = breakLoop(core.recent, state?.room?.exits ?? [], core.memory);
    if (forced && forced !== parsed.command) { parsed.command = forced; parsed.thought = `Loop broken: ${forced}.`; }
  }
  const coach = coachCommand(parsed.command, promptState, core.mind);
  const invalidAttempt = coach.blocked || !coach.validation.ok;
  if (invalidAttempt) core.blockedCounts.set(parsed.command, (core.blockedCounts.get(parsed.command) ?? 0) + 1);
  else core.blockedCounts.delete(parsed.command);
  if (coach.blocked && (core.blockedCounts.get(parsed.command) ?? 0) < 2 && core.coachRetries < 1) {
    core.coachRetries += 1;
    core.lastCommand = parsed.command;
    core.lastParsed = parsed;
    core.lastValidation = coach.validation;
    core.lastCoach = coach;
    core.commandRoom = room ?? promptState?.room?.name ?? null;
    core.commandExits = state?.room?.exits ?? [];
    return { blocked: true, command: parsed.command, parsed, coach, observation: `COMMAND NOT SENT: ${coach.feedback}`, focusForced: false };
  }
  core.coachRetries = 0;
  let command = parsed.command;
  if (coachFallbackDue({ blocked: coach.blocked, valid: coach.validation.ok, count: core.blockedCounts.get(parsed.command) ?? 0 })) {
    command = coachAction(focus, promptState, core.mind, coach.repaired);
  } else if (coach.blocked) {
    command = coachAction(focus, promptState, core.mind, coach.repaired);
  } else if (!coach.validation.ok) {
    command = coach.repaired || "look";
  }
  const fkey = `${focus?.kind}:${focus?.label}:${focus?.target ?? ""}`;
  if (core.focusKey !== fkey) { core.focusKey = fkey; core.focusDetours = 0; }
  const lock = focusGuard({ focus, command, detours: core.focusDetours, state: promptState, strict: core.strict });
  core.focusDetours = lock.detours;
  if (lock.forced) command = lock.command;
  core.lastCommand = command;
  core.lastParsed = parsed;
  core.lastValidation = coach.validation;
  core.lastCoach = coach;
  core.commandRoom = room ?? promptState?.room?.name ?? null;
  core.commandExits = state?.room?.exits ?? [];
  core.recent = [...core.recent, command].slice(-12);
  return { blocked: false, command, parsed, coach, focusForced: lock.forced, preferExplore };
}

/** Record the observation produced by the command just sent. */
export function recordTurn(core, { command = null, parsed = null, coach = null, observation = "", room = null, tick = 0, focusForced = false, preferExplore = false, turn = 0, focus = null, activeQuests = [] } = {}) {
  if (command) {
    core.lastCommand = command;
    core.lastParsed = parsed;
    core.lastValidation = coach?.validation ?? null;
    core.lastCoach = coach;
    core.commandRoom = room;
    core.tick = tick;
  }
  core.transcript.push({
    turn, plan: parsed?.plan ?? "", lesson: parsed?.lesson ?? "", command, blocked: false,
    coach: coach?.feedback || null, focusForced, observation, room, preferExplore,
    proposed: parsed?.command ?? null,
    focus: focus ? { kind: focus.kind, label: focus.label, target: focus.target ?? null, route: focus.route ?? [] } : null,
    activeQuests: (activeQuests ?? []).map((quest) => ({ id: quest.id, name: quest.name })),
  });
  return core.transcript.at(-1);
}

export function observeTurn(core, { state = null, observation = "", room = null, tick = 0 } = {}) {
  if (!core.lastCommand || !core.commandRoom) return;
  rememberResult(core.memory, { room: core.commandRoom, command: core.lastCommand, observation, tick, at: Date.now(), exits: core.commandExits ?? [] });
  updateMind(core.mind, { state, observation, command: core.lastCommand, parsed: core.lastParsed, validation: core.lastValidation, coach: core.lastCoach, room: core.commandRoom, tick });
}
