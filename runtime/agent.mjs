#!/usr/bin/env node
// The player-facing agent runner: one file, no dependencies.
//
// Run it on your own machine. It connects to the world on the same WebSocket a
// human uses, logs in as your character, asks your model for one command per
// turn, and waits for the same 250 ms allowance. The game server never holds a
// provider key.
//
//   curl -O https://play.r4labs.org/agent.mjs
//   MODEL_PROVIDER=ollama MODEL_BASE_URL=http://127.0.0.1:11434 \
//   MODEL_NAME=qwen2.5:7b HARNESS_NAME=my-agent HARNESS_PASSWORD=... \
//   WS_URL=wss://play.r4labs.org node agent.mjs

import { appendFileSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emptyMemory, noteRoom, rememberResult, memoryPrompt, loopWarning, breakLoop, shouldBreakLoop, routeHint, nearestTarget, seedMap, nextStep, observedCommandSuccess } from "./web/memory.mjs";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8090";
const NAME = process.env.HARNESS_NAME ?? process.env.AGENT_NAME ?? "agent";
const PASSWORD = process.env.HARNESS_PASSWORD ?? process.env.AGENT_PASSWORD ?? "";
const PROVIDER = process.env.MODEL_PROVIDER ?? process.env.AGENT_PROVIDER ?? "ollama";
const BASE = process.env.MODEL_BASE_URL ?? (PROVIDER === "prime-router" ? "http://127.0.0.1:8000" : PROVIDER === "ollama" ? "http://127.0.0.1:11434" : "https://api.example.com/v1");
const MODEL = process.env.MODEL_NAME ?? (PROVIDER === "opencode" ? "deepseek/deepseek-flash" : "qwen2.5:7b");
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 24);
const MEMORY_TURNS = Number(process.env.MEMORY_TURNS ?? 12);
const TIMEOUT = Number(process.env.MODEL_TIMEOUT_MS ?? 90000);
const GOAL = process.env.AGENT_GOAL ?? "Read the word in the Vault (north then east of the Atrium), then reach the Shrine (east, north, north) and use answer <word>. Explore, trade, fight or speak as you wish.";
const LOG = process.env.AGENT_LOG ?? "";
const PRIME_ID = process.env.PRIME_ROUTER_IDENTITY ?? `mudbench-${NAME}`;
const runOpenCode = promisify(execFile);
const STOP_ON_QUEST = process.env.AGENT_STOP_ON_QUEST === "1";
const DESTINATION = process.env.AGENT_DESTINATION ?? "";
const LLMS_URL = process.env.LLMS_URL ?? `${WS_URL.replace(/^ws/, "http").replace(/\/$/, "")}/llms.txt`;
const OBJECTIVES = (process.env.AGENT_OBJECTIVES ?? "")
  .split("|")
  .map((part) => {
    const [spec, after] = part.split(">");
    const [room, action] = spec.split(":");
    return room?.trim() ? { room: room.trim(), action: (action ?? "").trim(), after: (after ?? "").trim() } : null;
  })
  .filter(Boolean);
const DIRECTIONS = new Set(["north", "south", "east", "west", "up", "down", "n", "s", "e", "w", "u", "d"]);
const ROUTE_LOCK = process.env.AGENT_ROUTE_LOCK !== "0";
const WAYPOINTS = (process.env.AGENT_WAYPOINTS ?? "")
  .split("|")
  .map((part) => {
    const [room, action] = part.split(":");
    return room?.trim() ? { room: room.trim(), action: (action ?? "").trim() } : null;
  })
  .filter(Boolean);
let waypointIndex = 0;

if (!PASSWORD) {
  console.error("Set HARNESS_PASSWORD (or AGENT_PASSWORD) to the character's password.");
  process.exit(2);
}

const KEY = (() => {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY.trim();
  if (process.env.MODEL_API_KEY_FILE) {
    try { return readFileSync(process.env.MODEL_API_KEY_FILE, "utf8").trim(); } catch {}
  }
  return null;
})();

const SYSTEM = `You are playing MUDBench, a persistent text world shared by people and agents.

Reply with exactly one command per turn and nothing else.
Commands: look, look <thing>, examine <thing>, who, awake, say <text>, global <text>,
tell <name> <text>, mail <name> <text>, channels, answer <word>, claim <word>,
claim unknown, north, south, east, west, up, down (n/s/e/w/u/d), attack <name>,
wield <weapon>, unwield, technique <name>, inventory [category], coins, standing, components, upgrade <item>, salvage <item>, take <thing>, take all,
drop <thing>, put <thing> in <thing>, open <thing>, close <thing>, wear <thing>,
remove <thing>, eat <thing>, drink <thing>, light <thing>, buy <thing>, sell <thing>,
list, wave, nod, bow, laugh, sigh, shrug, dance, score,
quests, quest accept <id>, quest abandon <id>, deliver <thing> to <name>,
guild create <name>, guild join <name>, guild leave, guild who, guild list, guild chat <text>,
guild rank <member> <rank>, guild disband, vault, deposit <item>, withdraw <item>, ladder,
ignore <name>, unignore <name>, ignoring, titles, title <id|none>, facts,
recall <word>, plant <thing>, talk <name>, help, quit.

The route: the Vault is north then east of the Atrium; the Shrine is east, north, north.
Read the word in the Vault. At the Shrine use answer <word>. claim is a separate puzzle.
You are shown only what your character can see. Other characters may be wrong or lying.
There is no map unless you build one. ${GOAL}`;

const COMMANDS = new Set([
  "look", "l", "examine", "x", "who", "awake", "answer", "claim", "say", "tell", "mail",
  "global", "gossip", "trade", "channels", "north", "south", "east", "west", "up", "down",
  "n", "s", "e", "w", "u", "d", "quit", "attack", "kill", "wield", "unwield",
  "inventory", "i", "inv", "coins", "money", "purse", "standing", "reputation", "factions", "components", "parts", "materials", "upgrade", "improve", "forge", "salvage", "melt", "scrap", "technique", "tech", "take", "get", "t", "grab", "drop", "put", "open", "close", "wear", "remove",
  "eat", "drink", "quaff", "light", "extinguish", "buy", "sell", "list", "wave", "nod", "bow", "laugh",
  "sigh", "shrug", "dance", "score", "quests", "quest", "guild", "gc", "gchat", "deliver", "talk", "help",
  "vault", "deposit", "withdraw", "ladder", "pvp", "duels", "ignore", "unignore", "ignoring", "titles", "title", "facts", "recall", "plant",
]);

const log = (...parts) => {
  const line = parts.join(" ");
  console.log(line);
  if (LOG) { try { appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), line })}\n`); } catch {} }
};

let socket;
let observed = "";
let authed = false;
let registered = false;
let started = false;
let answered = false;
let turns = 0;
let busy = false;
let lastSend = 0;
let lastCommand = "";
let lastRoom = "";
let lastExits = [];
let recent = [];
let waitingForRoom = false;
let pendingObjective = null;
const nav = emptyMemory();
const messages = [{ role: "system", content: SYSTEM }];

// The public room table lets the agent plan across rooms it has not visited.
async function loadPublicMap() {
  try {
    const text = await fetch(LLMS_URL, { signal: AbortSignal.timeout(3000) }).then((response) => response.text());
    const rows = text.split(/\r?\n/).map((line) => line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/)).filter(Boolean);
    const byId = new Map(rows.map((row) => [row[1], row[2].trim()]));
    const rooms = rows.map((row) => ({
      name: row[2].trim(),
      exits: row[5].split(",").map((part) => part.trim()).filter((part) => part && part !== "none").map((part) => {
        const [dir, id] = part.split(/\s+/);
        return { dir, room: byId.get(id) ?? null };
      }),
    }));
    seedMap(nav, rooms);
    log(`map: ${rooms.length} rooms seeded`);
  } catch (error) {
    log(`map: unavailable (${error.message})`);
  }
}

await loadPublicMap();

const trim = () => {
  const rest = messages.slice(1).slice(-MEMORY_TURNS * 2);
  messages.splice(1, messages.length - 1, ...rest);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parse(text) {
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^[`"'*>-\s]+|[`"'*.\s]+$/g, "").trim();
    if (!line) continue;
    const [verb, ...rest] = line.split(/\s+/);
    if (!verb) continue;
    if (COMMANDS.has(verb.toLowerCase())) return { command: line, ok: true };
    if (["say", "tell", "global", "gossip", "trade", "mail", "guild", "gc"].includes(verb.toLowerCase()) && rest.length) {
      return { command: line, ok: true };
    }
  }
  return { command: "look", ok: false };
}

function mapExits(name) {
  return Object.entries(nav.map?.[name] ?? {}).map(([dir, room]) => ({ dir, room }));
}

function roomFrom(text) {
  const bracket = [...String(text).matchAll(/^\[([^\]]+)\]/gm)].at(-1)?.[1] ?? null;
  let stateRoom = null;
  const line = String(text).split(/\r?\n/).filter((entry) => entry.trim().startsWith("#state ")).at(-1);
  if (line) {
    try {
      const state = JSON.parse(line.trim().slice(7));
      stateRoom = state.room ?? state.self?.room ?? null;
    } catch {}
  }
  const name = bracket ?? stateRoom?.name ?? null;
  if (!name) return null;
  const stateExits = stateRoom?.name === name
    ? (stateRoom.exits ?? []).map((exit) => (typeof exit === "string" ? { dir: exit, room: null } : { dir: exit.dir, room: exit.room ?? null })).filter((exit) => exit.dir)
    : [];
  const exits = stateExits.length ? stateExits : mapExits(name);
  if (exits.length) return { name, exits };
  const directions = String(text).match(/^Exits:\s*(.+)$/m)?.[1] ?? "";
  return { name, exits: directions.split(/,\s*/).map((dir) => ({ dir: dir.trim(), room: null })).filter((exit) => exit.dir) };
}

async function ask(observedText) {
  messages.push({ role: "user", content: observedText });
  let reply = "";
  if (PROVIDER === "opencode") {
    const prompt = `${SYSTEM}\n\n${observedText}\n\nReturn exactly one game command and nothing else. Do not use tools, do not explain, and do not wrap the command in code fences.`;
    const { stdout } = await runOpenCode("opencode", ["run", "--model", MODEL, "--format", "json", "--archived", prompt], {
      timeout: TIMEOUT,
      maxBuffer: 8 * 1024 * 1024,
    });
    const texts = String(stdout).split(/\r?\n/).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((entry) => entry?.type === "text").map((entry) => entry.part?.text ?? "");
    reply = texts.join("\n").trim();
    if (!reply) throw new Error("opencode returned no text");
  } else if (PROVIDER === "prime-router") {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `${SYSTEM}\n\n${observedText}`, identity: PRIME_ID }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`prime-router ${res.status}`);
    const body = await res.json();
    reply = String(body.description ?? body.response ?? "").trim();
  } else if (PROVIDER === "ollama") {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, stream: false, options: { temperature: 0 } }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const body = await res.json();
    reply = String(body.message?.content ?? "").trim();
  } else {
    if (!KEY) throw new Error("MODEL_API_KEY or MODEL_API_KEY_FILE is required");
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: 256 }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const body = await res.json();
    const message = body.choices?.[0]?.message ?? {};
    reply = String(message.content ?? message.reasoning_content ?? "").trim();
  }
  messages.push({ role: "assistant", content: reply });
  trim();
  return reply;
}

function send(command) {
  return new Promise((resolve) => {
    const waitFor = Math.max(0, 300 - (Date.now() - lastSend));
    setTimeout(() => {
      try { socket.send(`${command}\n`); } catch {}
      lastSend = Date.now();
      resolve();
    }, waitFor);
  });
}

async function turn() {
  if (busy || !authed) return;
  const seen = observed;
  observed = "";
  if (!seen.trim()) return;
  if (answered && /shrine accepts|shrine agrees/i.test(seen)) {
    log("solved");
    if (socket?.readyState === 1) socket.send("quit\n");
    return;
  }
  if (STOP_ON_QUEST && /Quest complete:/i.test(seen)) {
    log("quest complete; stopping");
    if (socket?.readyState === 1) socket.send("quit\n");
    setTimeout(() => process.exit(0), 300);
    return;
  }
  if (pendingObjective) {
    if (observedCommandSuccess(pendingObjective.command, seen)) {
      const index = OBJECTIVES.indexOf(pendingObjective.objective);
      if (index >= 0) OBJECTIVES.splice(index, 1);
      log(`objective confirmed: ${pendingObjective.objective.room}`);
    } else {
      log(`objective not confirmed: ${pendingObjective.objective.room}`);
    }
    pendingObjective = null;
  }
  const room = roomFrom(seen);
  if (!room) {
    if (!waitingForRoom) {
      waitingForRoom = true;
      log("waiting for room state");
      await send("look");
    }
    return;
  }
  waitingForRoom = false;
  turns += 1;
  if (turns > MAX_TURNS) { try { socket.send("quit\n"); } catch {} return; }
  if (lastCommand && lastRoom) rememberResult(nav, { room: lastRoom, command: lastCommand, observation: seen, tick: turns, exits: lastExits });
  if (room) noteRoom(nav, room.name, room.exits);
  const waypoint = WAYPOINTS[waypointIndex] ?? null;
  const available = OBJECTIVES.filter((entry) => !entry.after || !OBJECTIVES.some((other) => other.room === entry.after));
  const objective = !waypoint && !DESTINATION && available.length
    ? (() => {
        const best = nearestTarget(nav, room?.name ?? lastRoom, available.map((entry) => entry.room));
        return best ? available.find((entry) => entry.room === best.target) ?? available[0] : available[0];
      })()
    : null;
  const destination = waypoint?.room ?? (DESTINATION || objective?.room);
  const navText = memoryPrompt(nav, { room: room?.name ?? lastRoom, exits: room?.exits ?? [], query: seen });
  const hint = room && destination ? routeHint(nav, room.name, destination) : "";
  const routeNext = room && destination ? nextStep(nav, room.name, destination) : null;
  const objectiveNote = objective ? `OBJECTIVE: ${objective.room} — ${objective.action || "arrive"}.` : "";
  const warning = loopWarning(recent, nav.trail);
  if (process.env.AGENT_DEBUG_NAV === "1") log(`nav room=${room?.name ?? "?"} dest=${destination ?? "?"} next=${routeNext ?? "?"} hint=${hint}`);
  busy = true;
  try {
    const reply = await ask([seen, navText ? `NAVIGATION:\n${navText}` : "", hint ? `NAVIGATE: ${hint}` : "", objectiveNote, warning ? `NOTE: ${warning}` : ""].filter(Boolean).join("\n\n"));
    let { command, ok } = parse(reply);
    if (!ok) {
      const forced = breakLoop(recent, room?.exits ?? [], nav);
      command = forced ?? "look";
      log(`unparseable reply; exploring ${command}`);
    }
    if (shouldBreakLoop(nav, { room: room?.name, command, recent })) {
      const forced = breakLoop(recent, room?.exits ?? [], nav);
      if (forced && forced !== command) {
        log(`loop guard: ${command} → ${forced}`);
        command = forced;
      }
    }
    command = command.replace(/^talk\s+(?:to|with|the)\s+/i, "talk ").replace(/^speak\s+(?:to|with|the)\s+/i, "talk ");
    command = command.replace(/^(talk\s+[a-z ]+?)\s+in\s+the\s+.*$/i, "$1");
    const first = command.split(/\s+/)[0]?.toLowerCase();
    const mapped = first === "n" ? "north" : first === "s" ? "south" : first === "e" ? "east" : first === "w" ? "west" : first === "u" ? "up" : first === "d" ? "down" : first;
    if (ROUTE_LOCK && routeNext && command.toLowerCase() !== "quit" && command.toLowerCase() !== routeNext) {
      log(`route lock: ${command} → ${routeNext}`);
      command = routeNext;
    } else if (routeNext && DIRECTIONS.has(first) && mapped !== routeNext) {
      log(`route guard: ${command} → ${routeNext}`);
      command = routeNext;
    }
    if (objective && objective.action) {
      const actionVerb = objective.action.split(/\s+/)[0]?.toLowerCase();
      if (room?.name === objective.room) {
        if (!command.toLowerCase().startsWith(actionVerb)) {
          log(`objective guard: ${command} → ${objective.action}`);
          command = objective.action;
        }
      } else if (routeNext && command.toLowerCase().startsWith(actionVerb)) {
        log(`wrong-room objective: ${command} → ${routeNext}`);
        command = routeNext;
      }
    }
    if (waypoint && room?.name === waypoint.room && (!waypoint.action || command.toLowerCase().startsWith(waypoint.action.toLowerCase()))) {
      waypointIndex += 1;
      log(`waypoint ${waypointIndex}/${WAYPOINTS.length}: ${WAYPOINTS[waypointIndex]?.room ?? "done"}`);
    }
    if (objective && room?.name === objective.room && objective.action && command.toLowerCase().startsWith(objective.action.split(/\s+/)[0]?.toLowerCase())) {
      pendingObjective = { objective, command };
      log(`objective attempted: ${objective.room}: ${objective.action}`);
    }
    if (/^answer\s+/i.test(command)) answered = true;
    log(`turn ${turns}: ${command}`);
    recent = [...recent, command].slice(-12);
    await send(command);
    lastCommand = command;
    lastRoom = room?.name ?? lastRoom;
    lastExits = room?.exits ?? lastExits;
    if (command.toLowerCase() === "quit") {
      setTimeout(() => process.exit(0), 300);
    }
  } catch (error) {
    log(`brain error: ${error.message}`);
    try { socket.send("quit\n"); } catch {}
    setTimeout(() => process.exit(1), 300);
  } finally {
    busy = false;
  }
}

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
  if (/Signing in as|Account .* created|Welcome,\s/.test(text)) {
    authed = true;
    if (!started) {
      started = true;
      setInterval(turn, 500);
    }
  }
};

socket.onerror = () => { console.error("connection error"); process.exit(1); };
socket.onclose = () => { log("disconnected"); process.exit(0); };
