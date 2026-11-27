#!/usr/bin/env node
// A reproducible local model scorecard for the browser brain.
//
//   node tools/agent-score.mjs --provider=ollama --model=qwen2.5:3b --turns=200
//   DEEPSEEK_KEY=... node tools/agent-score.mjs --provider=deepseek --model=deepseek-flash
//
// It starts an isolated world and a byte-accurate holo stub, drives the same
// Mind, planner, memory, coach and prompts the browser uses, and writes a JSON
// scorecard plus a JSONL transcript. No provider key is read by the game server.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";
import WebSocket from "../runtime/node_modules/ws/index.js";
import { loadWorld } from "../runtime/worlddata.mjs";
import { initialState } from "../runtime/world.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests } from "../runtime/quests.mjs";
import { hashPassword } from "../runtime/accounts.mjs";
import { buildSystemPrompt, buildUserPrompt, buildActionMenu, parseBrain, coachCommand, coachAction, coachFallbackDue, requestFor, replyFrom } from "../runtime/web/ai.mjs";
import { agentProfile } from "../runtime/web/agent-profile.mjs";
import { emptyMind, updateMind, mindPrompt } from "../runtime/web/mind.mjs";
import { focusFor, focusPrompt, focusGuard } from "../runtime/web/planner.mjs";
import { emptyMemory, rememberResult, memoryPrompt, loopWarning, breakLoop, shouldBreakLoop, seedMapFromLlms } from "../runtime/web/memory.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "1"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const provider = args.get("provider") ?? "ollama";
const base = args.get("base") ?? (provider === "deepseek" ? "https://api.deepseek.com/v1" : provider === "bonsai" ? "http://127.0.0.1:8085/v1" : "http://127.0.0.1:11434/v1");
const model = args.get("model") ?? (provider === "deepseek" ? "deepseek-flash" : "qwen2.5:3b");
const turns = Math.max(1, Number(args.get("turns") ?? 200));
const startRoom = Number(args.get("start") ?? 1);
const goal = args.get("goal") ?? "Explore the world, complete quests, keep notes and stay alive. Use FOCUS, FRONTIER, the Mind and lessons.";
const out = args.get("out") ?? `/tmp/agent-score-${provider}-${Date.now()}.json`;
const password = "score-pass";
const name = "score-ai";
const key = process.env.DEEPSEEK_KEY ?? process.env.MODEL_API_KEY ?? null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); });
});
const until = async (fn, label, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch {}
    await wait(100);
  }
  throw new Error(`timeout ${label}`);
};

const world = loadWorld({ mode: "single", path: join(process.cwd(), "world", "data", "world.json") });
const levels = loadLevels();
const quests = loadQuests();
const channels = loadChannels();
const state = initialState(world.rooms, world.npcs, world.objects, startRoom, world.climate, channels.channels, levels.levels, quests.quests);
const { salt, hash } = hashPassword(password);
state.accounts[name] = { kind: "legacy", name, characters: [name], passwordHash: hash, salt, tokenHash: null, retired: false, mergedInto: null };
state.identities[name] = {
  kind: "character", owner: name, name, role: 0, level: 3, xp: 300, gold: 0,
  guild: null, guildRank: null, quests: { active: [], completed: [] }, spellbook: [],
  maxMana: 8, questCycles: {}, ignored: [], title: null, memory: { facts: {} },
  duelWins: 0, duelLosses: 0, duelRating: 1000,
};
state.tick = Math.floor(Math.random() * 1_000_000);
const dir = `/tmp/agent-score-${process.pid}`;
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "state.json"), JSON.stringify(state));

const webPort = await port();
const telnetPort = await port();
const holoPort = await port();
const holo = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    let answer = "invalid request";
    try {
      const payload = JSON.parse(body).payload;
      const bytes = Buffer.from(payload, "utf8");
      if (bytes.length === 7) {
        const [kind, room, origin, destination, held, amount, free] = bytes;
        if (kind === 0 || kind === 4) answer = "admissible";
        else if (kind === 1) answer = room === origin ? "admissible" : "refused";
        else if (kind === 2) answer = amount <= held && amount <= free ? "admissible" : "refused";
        else if (kind === 3) answer = room === destination ? "admissible" : "refused";
        else if (kind === 6) answer = room >= origin ? "cleared" : "hidden";
      }
    } catch {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ outputs: [answer] }));
  });
});
await new Promise((resolve) => holo.listen(holoPort, "127.0.0.1", resolve));

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: join(process.cwd(), "runtime"),
  env: {
    ...process.env,
    WEB_PORT: String(webPort), TELNET_PORT: String(telnetPort),
    STATE_FILE: join(dir, "state.json"), IDENTITY_FILE: join(dir, "identities.json"),
    TRACE_FILE: join(dir, "trace.jsonl"), TELEMETRY_LOG: join(dir, "spans.jsonl"),
    HOLO_URL: `http://127.0.0.1:${holoPort}`, SIGNUP_MODE: "closed", COMMAND_INTERVAL_MS: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

const connect = async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${webPort}/`);
  let text = "";
  let stateNow = null;
  let room = "";
  let cursor = 0;
  ws.on("message", (data) => {
    const chunk = String(data);
    text += chunk;
    for (const match of chunk.matchAll(/#state (.*)\r?\n/g)) {
      try { stateNow = JSON.parse(match[1]); } catch {}
    }
    const roomMatch = chunk.match(/^\[(.+)\]$/m);
    if (roomMatch) room = roomMatch[1];
  });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const expect = (needle, ms = 15000) => until(() => {
    const index = text.indexOf(needle, cursor);
    if (index < 0) return false;
    cursor = index + needle.length;
    return true;
  }, needle, ms);
  return { ws, text: () => text, state: () => stateNow, room: () => room, expect };
};

const ask = async (system, user) => {
  const started = Date.now();
  const profile = agentProfile({ fast: true, weak, reasoning: "medium" });
  const request = requestFor(provider, { base, model, key, ...profile }, system, [{ role: "user", content: user }]);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`${provider} ${response.status} ${(await response.text()).slice(0, 200)}`);
  const body = await response.json();
  return { text: replyFrom(provider, body).text, latency: Date.now() - started };
};

const weak = provider === "ollama" || /qwen|tiny|small|3b|1\.5b|0\.5b|phi|gemma/i.test(model);
let ai;
const mind = emptyMind();
const memory = emptyMemory();
let observation = "";
let lastCommand = null;
let lastParsed = null;
let lastValidation = null;
let lastCoach = null;
let commandRoom = null;
let tick = 0;
let coachRetries = 0;
const blockedCounts = new Map();
let focusDetours = 0;
let focusKey = "";
let recent = [];
let progressMark = "";
let stallTurns = 0;
let frontierTurns = 0;
let lastPlan = "";
const transcript = [];

try {
  await until(() => fetch(`http://127.0.0.1:${webPort}/health`).then((response) => response.ok), "server");
  ai = await connect();
  ai.ws.send(`login ${name} ${password}\n`);
  await ai.expect(`[${world.rooms[startRoom].name}]`);
  await wait(300);
  const llms = await fetch(`http://127.0.0.1:${webPort}/llms.txt`).then((response) => response.text());
  seedMapFromLlms(memory, llms);
  const initial = ai.state()?.self ?? null;

  for (let turn = 1; turn <= turns; turn += 1) {
    const stateNow = ai.state();
    if (!stateNow) { await wait(300); continue; }
    if (lastCommand && commandRoom) {
      rememberResult(memory, { room: commandRoom, command: lastCommand, observation, tick, at: Date.now(), exits: stateNow.room?.exits ?? [] });
      updateMind(mind, { state: stateNow, observation, command: lastCommand, parsed: lastParsed, validation: lastValidation, coach: lastCoach, room: commandRoom, tick });
    }
    const currentRoom = ai.room() || stateNow.room?.name;
    const exitMatch = observation.match(/^Exits:\s*(.+)$/m);
    const exitDirs = exitMatch
      ? exitMatch[1].split(/,\s*/).map((part) => part.trim().split(/\s+/)[0].replace(/[^a-z]/gi, "")).filter(Boolean)
      : (stateNow.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir));
    const promptState = { ...stateNow, room: { ...(stateNow.room ?? {}), name: currentRoom, exits: exitDirs.map((dir) => ({ dir, room: null })), text: observation } };
    const mark = `${Object.keys(memory.rooms).length}|${promptState.self?.quests?.completed ?? 0}|${promptState.self?.xp ?? 0}|${promptState.self?.level ?? 1}`;
    if (progressMark === mark) stallTurns += 1;
    else { progressMark = mark; stallTurns = 0; }
    const planRepeated = Boolean(mind.plan && lastPlan === mind.plan);
    lastPlan = mind.plan;
    let preferExplore = weak && (stallTurns >= 12 || (stallTurns >= 6 && planRepeated));
    if (preferExplore && frontierTurns >= 8) {
      preferExplore = false;
      stallTurns = 0;
      frontierTurns = 0;
    } else if (preferExplore) {
      frontierTurns += 1;
    } else {
      frontierTurns = 0;
    }
    const focus = focusFor({ state: promptState, memory, mind, preferExplore });
    const actions = [...new Set([...(focus.candidates ?? []), ...buildActionMenu(promptState)])].slice(0, 48);
    const system = buildSystemPrompt({ name, goal, fast: true, deliberate: turn === 1 || turn % 5 === 0 });
    const user = buildUserPrompt({
      turn, observation, director: [], state: promptState, actions,
      memory: memoryPrompt(memory, { room: currentRoom, exits: stateNow.room?.exits ?? [], query: observation }),
      mind: mindPrompt(mind, { state: promptState, room: currentRoom }),
      focus: focusPrompt(focus), fast: true,
    });
    const reply = await ask(system, user);
    const parsed = parseBrain(reply.text);
    if (shouldBreakLoop(memory, { room: currentRoom, command: parsed.command, recent }) || mind.stuck?.looping) {
      const forced = breakLoop(recent, stateNow.room?.exits ?? [], memory);
      if (forced && forced !== parsed.command) { parsed.command = forced; parsed.thought = `Loop broken: ${forced}.`; }
    }
    const coach = coachCommand(parsed.command, promptState, mind);
    const invalidAttempt = coach.blocked || !coach.validation.ok;
    if (invalidAttempt) blockedCounts.set(parsed.command, (blockedCounts.get(parsed.command) ?? 0) + 1);
    else blockedCounts.delete(parsed.command);
    let command = parsed.command;
    let sent = true;
    if (coach.blocked && (blockedCounts.get(parsed.command) ?? 0) < 2 && coachRetries < 1) {
      coachRetries += 1;
      sent = false;
      observation = `COMMAND NOT SENT: ${coach.feedback}`;
      lastCommand = parsed.command; lastParsed = parsed; lastValidation = coach.validation; lastCoach = coach; commandRoom = currentRoom;
      transcript.push({ turn, plan: parsed.plan, lesson: parsed.lesson, command: parsed.command, blocked: true, coach: coach.feedback, observation, room: currentRoom });
      await wait(200);
      continue;
    }
    coachRetries = 0;
    if (coachFallbackDue({ blocked: coach.blocked, valid: coach.validation.ok, count: blockedCounts.get(parsed.command) ?? 0 })) {
      command = coachAction(focus, promptState, mind, coach.repaired);
      console.log(`turn ${turn}: COACH FALLBACK ${command}`);
    } else if (coach.blocked) {
      command = coachAction(focus, promptState, mind, coach.repaired);
      console.log(`turn ${turn}: COACH FALLBACK ${command}`);
    } else if (!coach.validation.ok) command = coach.repaired || "look";
    const fkey = `${focus.kind}:${focus.label}:${focus.target ?? ""}`;
    if (focusKey !== fkey) { focusKey = fkey; focusDetours = 0; }
    const focusLock = focusGuard({ focus, command, detours: focusDetours, state: promptState });
    focusDetours = focusLock.detours;
    if (focusLock.forced) command = focusLock.command;
    lastCommand = command; lastParsed = parsed; lastValidation = coach.validation; lastCoach = coach; commandRoom = currentRoom;
    recent = [...recent, command].slice(-12);
    const before = ai.text().length;
    ai.ws.send(`${command}\n`);
    await wait(provider === "ollama" ? 700 : 1400);
    observation = ai.text().slice(before).replace(/#(?:state|tick|characters) .*\r?\n/g, "").trim().slice(0, 1500);
    tick = ai.state()?.tick ?? tick;
    transcript.push({ turn, plan: parsed.plan, lesson: parsed.lesson, command, blocked: false, coach: coach.feedback || null, focusForced: focusLock.forced, observation, room: currentRoom, preferExplore });
    if (turn % 20 === 0) console.log(`turn ${turn}: ${currentRoom} · ${command}`);
  }
  const final = ai.state()?.self ?? null;
  const sent = transcript.filter((entry) => !entry.blocked);
  const rooms = sent.map((entry) => entry.room).filter(Boolean);
  const counts = {};
  let maxStreak = 0, streak = 0, lastRoom = null;
  for (const room of rooms) {
    counts[room] = (counts[room] ?? 0) + 1;
    streak = room === lastRoom ? streak + 1 : 1;
    lastRoom = room;
    maxStreak = Math.max(maxStreak, streak);
  }
  const topRoom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const reasons = {};
  for (const entry of transcript) if (entry.coach) reasons[entry.coach] = (reasons[entry.coach] ?? 0) + 1;
  const scorecard = {
    provider, model, weak, turns: transcript.length, sent: sent.length, blocked: transcript.length - sent.length,
    plans: transcript.filter((entry) => entry.plan).length, lessons: transcript.filter((entry) => entry.lesson).length,
    uniqueRooms: new Set(rooms).size, topRoom: topRoom[0], topRoomVisits: topRoom[1], maxSameRoomStreak: maxStreak,
    finalRoom: final?.room?.name ?? ai.room(), level: [initial?.level ?? null, final?.level ?? null],
    xp: [initial?.xp ?? null, final?.xp ?? null], deaths: final?.deaths ?? 0, quests: final?.quests ?? null,
    wielding: final?.wielding ?? null, worn: final?.worn ?? [],
    social: {
      say: sent.filter((entry) => /^say\b/i.test(entry.command)).length,
      tell: sent.filter((entry) => /^tell\b/i.test(entry.command)).length,
      talk: sent.filter((entry) => /^talk\b/i.test(entry.command)).length,
      party: sent.filter((entry) => /^party\b/i.test(entry.command)).length,
    },
    attacks: sent.filter((entry) => /^attack\b/i.test(entry.command)).length,
    focusForced: sent.filter((entry) => entry.focusForced).length,
    preferExplore: sent.filter((entry) => entry.preferExplore).length,
    coachReasons: reasons, mindLessons: mind.lessons ?? [], mindNotes: mind.notes ?? [],
    transcript,
  };
  writeFileSync(out, JSON.stringify(scorecard, null, 2));
  console.log(JSON.stringify({ out, provider, model, turns: scorecard.turns, sent: scorecard.sent, blocked: scorecard.blocked, plans: scorecard.plans, lessons: scorecard.lessons, uniqueRooms: scorecard.uniqueRooms, quests: scorecard.quests, deaths: scorecard.deaths, preferExplore: scorecard.preferExplore, topRoom: scorecard.topRoom, topRoomVisits: scorecard.topRoomVisits }, null, 2));
} catch (error) {
  console.error(serverLog.slice(-2000));
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  try { ai?.ws.close(); } catch {}
  server.kill("SIGTERM");
  holo.close();
  await wait(300);
}
