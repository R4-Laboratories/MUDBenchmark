#!/usr/bin/env node
// The core-based local agent runner.
//
// The browser and tools/agent-score.mjs use runtime/web/agent-core.mjs. This
// file is the same controller for a terminal client: one command per turn,
// no separate prompt or planner. Only the WebSocket transport and the optional
// opencode JSON adapter are local to this file.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { requestFor, replyFrom } from "./web/ai.mjs";
import { agentProfile } from "./web/agent-profile.mjs";
import { createAgentCore, beginTurn, decideTurn, recordTurn, DEFAULT_GOAL } from "./web/agent-core.mjs";
import { seedMapFromLlms } from "./web/memory.mjs";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8090";
const NAME = process.env.HARNESS_NAME ?? process.env.AGENT_NAME ?? "agent";
const PASSWORD = process.env.HARNESS_PASSWORD ?? process.env.AGENT_PASSWORD ?? "";
const PROVIDER = process.env.MODEL_PROVIDER ?? process.env.AGENT_PROVIDER ?? "ollama";
const BASE = process.env.MODEL_BASE_URL ?? (PROVIDER === "prime-router" ? "http://127.0.0.1:8000" : PROVIDER === "ollama" ? "http://127.0.0.1:11434/v1" : PROVIDER === "bonsai" ? "http://127.0.0.1:8085/v1" : "https://api.example.com/v1");
const MODEL = process.env.MODEL_NAME ?? "qwen2.5:7b";
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 24);
const TIMEOUT = Number(process.env.MODEL_TIMEOUT_MS ?? 90000);
const GOAL = process.env.AGENT_GOAL ?? DEFAULT_GOAL;
const LOG = process.env.AGENT_LOG ?? "";
const SCENARIO = process.env.AGENT_SCENARIO ?? "";
const MEMORY_FILE = process.env.HARNESS_MEMORY ?? "";
const STOP_ON_QUEST = process.env.AGENT_STOP_ON_QUEST === "1";
const DESTINATION = process.env.AGENT_DESTINATION ?? "";
const OBJECTIVES = (process.env.AGENT_OBJECTIVES ?? "").split("|").filter(Boolean);
const WAYPOINTS = (process.env.AGENT_WAYPOINTS ?? "").split("|").filter(Boolean);
const LLMS_URL = process.env.LLMS_URL ?? `${WS_URL.replace(/^ws/, "http").replace(/\/$/, "")}/llms.txt`;
const KEY = (() => {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY.trim();
  if (process.env.MODEL_API_KEY_FILE) {
    try { return readFileSync(process.env.MODEL_API_KEY_FILE, "utf8").trim(); } catch {}
  }
  return null;
})();
const runOpenCode = promisify(execFile);

if (!PASSWORD) {
  console.error("Set HARNESS_PASSWORD (or AGENT_PASSWORD) to the character's password.");
  process.exit(2);
}

const extra = [
  DESTINATION ? `destination ${DESTINATION}` : "",
  OBJECTIVES.length ? `objectives ${OBJECTIVES.join("; ")}` : "",
  WAYPOINTS.length ? `waypoints ${WAYPOINTS.join("; ")}` : "",
].filter(Boolean).join("; ");
const goal = extra ? `${GOAL} Route targets: ${extra}.` : GOAL;
const weak = PROVIDER === "ollama" || /qwen|tiny|small|3b|1\\.5b|0\\.5b|phi|gemma/i.test(MODEL);
const core = createAgentCore({ name: NAME, goal, weak, strict: SCENARIO === "pvp", fast: true });
if (MEMORY_FILE) {
  try { core.memory = JSON.parse(readFileSync(MEMORY_FILE, "utf8")); } catch {}
}
// `AGENT_SCENARIO=pvp` keeps every movement command in The Ring. The command
// contract still includes take all, drink, duel <name>, duel accept, attack,
// wield and wear; "duel" is a first-class PvP command here.
const stay = SCENARIO === "pvp";
const log = (...parts) => {
  const line = parts.join(" ");
  console.log(line);
  if (LOG) { try { appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), line })}\n`); } catch {} }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch {}
    await wait(100);
  }
  throw new Error(`timeout ${label}`);
};

let socket;
let observed = "";
let authed = false;
let registered = false;
let started = false;
let turns = 0;
let busy = false;
let lastSend = 0;
let stateNow = null;

async function loadMap() {
  try {
    const text = await fetch(LLMS_URL, { signal: AbortSignal.timeout(3000) }).then((response) => response.text());
    seedMapFromLlms(core.memory, text);
    log("map seeded");
  } catch (error) {
    log(`map unavailable: ${error.message}`);
  }
}

async function ask(system, user) {
  if (PROVIDER === "opencode") {
    const prompt = `${system}\n\n${user}\n\nReturn exactly one game command and nothing else. Do not use tools, do not explain.`;
    const { stdout } = await runOpenCode("opencode", ["run", "--model", MODEL, "--format", "json", "--archived", prompt], { timeout: TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
    const text = String(stdout).split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry) => entry?.type === "text").map((entry) => entry.part?.text ?? "").join("\n").trim();
    if (!text) throw new Error("opencode returned no text");
    return text;
  }
  const profile = agentProfile({ fast: true, weak });
  const request = requestFor(PROVIDER, { ...profile, base: BASE, model: MODEL, key: KEY }, system, [{ role: "user", content: user }]);
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw new Error(`${PROVIDER} ${response.status}`);
  return replyFrom(PROVIDER, await response.json()).text;
}

const send = (command) => new Promise((resolve) => {
  const delay = Math.max(0, 300 - (Date.now() - lastSend));
  setTimeout(() => {
    try { socket.send(`${command}\n`); } catch {}
    lastSend = Date.now();
    resolve();
  }, delay);
});

async function turn() {
  if (busy || !authed) return;
  const seen = observed;
  observed = "";
  if (!seen.trim()) return;
  if (STOP_ON_QUEST && /Quest complete:/i.test(seen)) {
    log("quest complete; stopping");
    try { socket.send("quit\n"); } catch {}
    setTimeout(() => process.exit(0), 300);
    return;
  }
  const room = seen.match(/^\[([^\]]+)\]\s*$/m)?.[1] ?? stateNow?.room?.name ?? null;
  if (!room) { await send("look"); return; }
  turns += 1;
  if (turns > MAX_TURNS) { try { socket.send("quit\n"); } catch {} return; }
  busy = true;
  try {
    const turnData = beginTurn(core, { state: stateNow, observation: seen, room, turn: turns });
    const reply = await ask(turnData.system, turnData.user);
    const decision = decideTurn(core, { reply, state: stateNow, promptState: turnData.promptState, focus: turnData.focus, room, turn: turns, preferExplore: turnData.preferExplore });
    let command = decision.command;
    if (decision.blocked) {
      log(`turn ${turns}: blocked ${command}: ${decision.coach.feedback}`);
      observed = decision.observation;
      return;
    }
    if (stay && /^(n|s|e|w|u|d|north|south|east|west|up|down)$/i.test(command.trim())) {
      log(`pvp guard: stay in The Ring (${command} -> look)`);
      command = "look";
    }
    log(`turn ${turns}: ${command}`);
    await send(command);
    await wait(1200);
    const observation = observed;
    observed = observation;
    recordTurn(core, { command, parsed: decision.parsed, coach: decision.coach, observation, room, tick: stateNow?.tick ?? turns, focusForced: decision.focusForced, preferExplore: decision.preferExplore, turn: turns });
    if (MEMORY_FILE) { try { writeFileSync(MEMORY_FILE, JSON.stringify(core.memory)); } catch {} }
    if (command.toLowerCase() === "quit") setTimeout(() => process.exit(0), 300);
  } catch (error) {
    log(`brain error: ${error.message}`);
    try { socket.send("quit\n"); } catch {}
    setTimeout(() => process.exit(1), 300);
  } finally {
    busy = false;
  }
}

await loadMap();
socket = new WebSocket(WS_URL);
socket.onopen = () => {
  log(`connected as ${NAME} (${PROVIDER})`);
  socket.send(`login ${NAME} ${PASSWORD}\n`);
  setTimeout(() => {
    if (!authed && !registered && /No such name/i.test(observed)) {
      registered = true;
      observed = "";
      socket.send(`register ${NAME} ${PASSWORD}\n`);
    } else if (!authed && /do not match/i.test(observed)) {
      console.error("The name exists and the password does not match.");
      process.exit(1);
    }
  }, 700);
};
socket.onmessage = (event) => {
  const text = String(event.data);
  observed += text;
  for (const match of text.matchAll(/#state (.*)\r?\n/g)) {
    try { stateNow = JSON.parse(match[1]); } catch {}
  }
  if (/Signing in as|Account .* created|Welcome,\s/.test(text)) {
    authed = true;
    if (!started) { started = true; setInterval(turn, 500); }
  }
};
socket.onerror = () => { console.error("connection error"); process.exit(1); };
socket.onclose = () => { log("disconnected"); process.exit(0); };
