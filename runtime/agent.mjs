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

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8090";
const NAME = process.env.HARNESS_NAME ?? process.env.AGENT_NAME ?? "agent";
const PASSWORD = process.env.HARNESS_PASSWORD ?? process.env.AGENT_PASSWORD ?? "";
const PROVIDER = process.env.MODEL_PROVIDER ?? process.env.AGENT_PROVIDER ?? "ollama";
const BASE = process.env.MODEL_BASE_URL ?? (PROVIDER === "prime-router" ? "http://127.0.0.1:8000" : PROVIDER === "ollama" ? "http://127.0.0.1:11434" : "https://api.example.com/v1");
const MODEL = process.env.MODEL_NAME ?? "qwen2.5:7b";
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 24);
const MEMORY_TURNS = Number(process.env.MEMORY_TURNS ?? 12);
const TIMEOUT = Number(process.env.MODEL_TIMEOUT_MS ?? 90000);
const GOAL = process.env.AGENT_GOAL ?? "Read the word in the Vault (north then east of the Atrium), then reach the Shrine (east, north, north) and use answer <word>. Explore, trade, fight or speak as you wish.";
const LOG = process.env.AGENT_LOG ?? "";
const PRIME_ID = process.env.PRIME_ROUTER_IDENTITY ?? `mudbench-${NAME}`;

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
flee, wield <weapon>, unwield, inventory, take <thing>, drop <thing>, put <thing> in <thing>,
open <thing>, close <thing>, wear <thing>, remove <thing>, eat <thing>, light <thing>,
buy <thing>, sell <thing>, list, wave, nod, bow, laugh, sigh, shrug, dance, score,
quests, quest accept <id>, quest abandon <id>, deliver <thing> to <name>,
guild create <name>, guild join <name>, guild leave, guild who, guild list, guild chat <text>,
guild rank <member> <rank>, guild disband, vault, deposit <item>, withdraw <item>,
ignore <name>, unignore <name>, ignoring, titles, title <id|none>, facts,
recall <word>, plant <thing>, talk <name>, help, quit.

The route: the Vault is north then east of the Atrium; the Shrine is east, north, north.
Read the word in the Vault. At the Shrine use answer <word>. claim is a separate puzzle.
You are shown only what your character can see. Other characters may be wrong or lying.
There is no map unless you build one. ${GOAL}`;

const COMMANDS = new Set([
  "look", "l", "examine", "x", "who", "awake", "answer", "claim", "say", "tell", "mail",
  "global", "gossip", "trade", "channels", "north", "south", "east", "west", "up", "down",
  "n", "s", "e", "w", "u", "d", "quit", "attack", "kill", "flee", "wield", "unwield",
  "inventory", "i", "take", "get", "drop", "put", "open", "close", "wear", "remove",
  "eat", "light", "extinguish", "buy", "sell", "list", "wave", "nod", "bow", "laugh",
  "sigh", "shrug", "dance", "score", "quests", "quest", "guild", "gc", "gchat", "deliver", "talk", "help",
  "vault", "deposit", "withdraw", "ignore", "unignore", "ignoring", "titles", "title", "facts", "recall", "plant",
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
const messages = [{ role: "system", content: SYSTEM }];

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

async function ask(observedText) {
  messages.push({ role: "user", content: observedText });
  let reply = "";
  if (PROVIDER === "prime-router") {
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
  turns += 1;
  if (turns > MAX_TURNS) { try { socket.send("quit\n"); } catch {} return; }
  busy = true;
  try {
    const reply = await ask(seen);
    const { command, ok } = parse(reply);
    if (!ok) log("unparseable reply; sending look");
    if (/^answer\s+/i.test(command)) answered = true;
    log(`turn ${turns}: ${command}`);
    await send(command);
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
