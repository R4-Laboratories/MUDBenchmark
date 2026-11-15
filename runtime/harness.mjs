// MUDBench agent harness.
//
// Connects as a player, on the same wire a human uses. The server cannot tell
// the difference, which is the point: an agent gets no privileged view.
//
// Responsibilities, per ARCHITECTURE.md §3.4:
//   1. connect as a player
//   2. hold the conversation with a model
//   3. inject the game's instructions as a system prompt
//   4. turn the event stream into model turns
//   5. parse the reply into a command
//   6. report parse failures as data, never as silence
//
// Brains:
//   scripted  deterministic, needs no key, used to test the plumbing
//   llm       any OpenAI-compatible chat endpoint, configured by env:
//             MODEL_BASE_URL, MODEL_API_KEY, MODEL_NAME

import WebSocket from "ws";
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { recordSpan, digest } from "./telemetry.mjs";
import { assemble } from "./router.mjs";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8090";
const BRAIN = process.env.BRAIN ?? "scripted";
const MODEL = process.env.MODEL_NAME ?? "deepseek-flash";
const MODEL_BASE = process.env.MODEL_BASE_URL ?? "https://api.deepseek.com/v1";
const LOG = process.env.HARNESS_LOG ?? "/tmp/mudbench-harness.jsonl";
const NAME = process.env.HARNESS_NAME ?? "agent";
const ROUTER_MODE = process.env.ROUTER_MODE ?? "flat";
const GOAL = process.env.HARNESS_GOAL ?? "reach the Shrine and speak the word that is carved in the Vault.";
const memory = [];
const BUDGET = Number(process.env.ROUTER_BUDGET ?? 220);
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 40);
let lastUsage = null;

// --- recall: what this identity knows from earlier sessions ---------------
//
// The world restores the room and the visited set; that is not legible to a
// model. This is: the harness keeps what it saw and offers it back as context.
// It is identical in both router modes, because memory is not what is being
// routed.

const MEMORY_FILE = process.env.HARNESS_MEMORY ?? `/tmp/mudbench-memory-${NAME}.json`;

function loadMemory() {
  try {
    const saved = JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
    return { rooms: saved.rooms ?? [], word: saved.word ?? null, answers: saved.answers ?? 0, token: saved.token ?? null };
  } catch {
    return { rooms: [], word: null, answers: 0, token: null };
  }
}

const recall = loadMemory();

function observe(text) {
  for (const match of text.matchAll(/\[([A-Z][A-Za-z ]+)\]/g)) {
    if (!recall.rooms.includes(match[1])) recall.rooms.push(match[1]);
  }
  if (text.includes("word carved into the door is AMBER")) recall.word = "amber";
  if (text.includes("shrine accepts your answer")) recall.answers += 1;
  const minted = text.match(/Your key is: ([a-f0-9]{32})/);
  if (minted) recall.token = minted[1];
}

function recallText() {
  if (!recall.rooms.length && !recall.word && !recall.answers) return null;
  const parts = ["You have been in this world before."];
  if (recall.rooms.length) parts.push(`Rooms you have seen: ${recall.rooms.join(", ")}.`);
  if (recall.word) parts.push(`The word you found in the Vault: ${recall.word}.`);
  if (recall.answers) parts.push(`You have answered at the shrine ${recall.answers} time(s).`);
  return parts.join(" ");
}

function saveMemory() {
  try { writeFileSync(MEMORY_FILE, JSON.stringify(recall)); } catch {}
}

const INSTRUCTIONS = `You are playing MUDBench, a text world.

Rules of the interface:
- Reply with exactly one command per turn, and nothing else.
- Commands: look, who, say <text>, answer <word>, north, south, east, west, quit.
- You are shown only what your character can see. Other characters may be wrong,
  lying, or absent. There is no map unless you build one.

Play well: explore, remember where things are, and speak to whoever you meet.`;

// --- brains --------------------------------------------------------------

function scriptedBrain() {
  const script = ["look", "who", "north", "say the corridor is quiet", "look", "south", "quit"];
  let i = 0;
  return async () => script[Math.min(i++, script.length - 1)];
}

function llmBrain() {
  const base = MODEL_BASE;
  const model = MODEL;
  let key = process.env.MODEL_API_KEY;
  // A file keeps the key out of the process list.
  if (!key && process.env.MODEL_API_KEY_FILE) {
    try { key = readFileSync(process.env.MODEL_API_KEY_FILE, "utf8").trim(); } catch { /* fall through */ }
  }
  if (!key) return null;
  const messages = [{ role: "system", content: INSTRUCTIONS }];
  return async (observed) => {
    messages.push({ role: "user", content: observed });
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 256 }),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const body = await res.json();
    const message = body.choices?.[0]?.message ?? {};
    lastUsage = body.usage ?? null;
    // A reasoning model may spend the whole budget thinking and leave `content`
    // empty; the command then sits in the reasoning field. Take either.
    const reply = (message.content ?? "").trim() || (message.reasoning_content ?? "").trim();
    messages.push({ role: "assistant", content: reply });
    return reply;
  };
}

const decide = (BRAIN === "llm" ? llmBrain() : scriptedBrain()) ?? scriptedBrain();

// --- parsing -------------------------------------------------------------

const COMMANDS = new Set(["look", "l", "who", "answer", "north", "south", "east", "west",
  "n", "s", "e", "w", "quit"]);

// A model may wrap its command in prose or quotes; take the first line that
// looks like a command, and report when nothing does.
function parseCommand(reply) {
  const lines = String(reply).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line.replace(/^[`"'*>-\s]+|[`"'*.\s]+$/g, "");
    const [verb, ...rest] = cleaned.split(/\s+/);
    if (!verb) continue;
    if (COMMANDS.has(verb.toLowerCase())) return { command: cleaned, ok: true };
    if (verb.toLowerCase() === "say" && rest.length) return { command: cleaned, ok: true };
  }
  return { command: "look", ok: false, raw: String(reply) };
}

// --- session -------------------------------------------------------------

const socket = new WebSocket(WS_URL);
let observed = "";
let turn = 0;

const record = (entry) => appendFileSync(LOG, `${JSON.stringify(entry)}\n`);

socket.on("open", () => {
  // A fresh file per run: appending let a killed run's turns leak into the next
  // run's log under the same name, which silently mixed two sessions.
  writeFileSync(LOG, "");
  console.log(`harness connected as ${NAME} with the ${BRAIN} brain`);
  record({ event: "connect", url: WS_URL, brain: BRAIN, name: NAME });
  // Claim an identity so a later run with the same name resumes where this one
  // stopped. A claim, not an authentication: anyone may use any name.
  // Claim an identity: with its key if we have one, without if this is the
  // first visit and the server will mint one.
  socket.send(`login ${NAME}${recall.token ? ` ${recall.token}` : ""}\n`);
});

socket.on("message", (data) => { observed += data.toString("utf8"); });

socket.on("error", (error) => { console.error(`harness error: ${error.message}`); process.exit(1); });

socket.on("close", () => { saveMemory(); console.log("harness disconnected"); process.exit(0); });

// One turn per window: let the room speak, then decide.
async function loop() {
  while (socket.readyState === WebSocket.OPEN) {
    await new Promise((r) => setTimeout(r, 500));
    const seen = observed;
    observed = "";
    if (!seen.trim()) continue;

    turn += 1;
    const started = Date.now();
    observe(seen);
    const routed = assemble({ events: seen, memory, goal: GOAL, mode: ROUTER_MODE, budget: BUDGET, recall: recallText() });
    if (process.env.ROUTER_TRACE) {
      console.log(`[${routed.mode}] layers=${routed.layers.join(",")} tokens=${routed.tokens}`);
      console.log(routed.context);
      console.log("---");
    }
    let reply;
    try {
      reply = await decide(routed.context);
    } catch (error) {
      record({ turn, event: "brain-error", message: error.message, seen });
      continue;
    }
    const { command, ok, raw } = parseCommand(reply);
    record({ turn, event: "decision", model: MODEL, seen, context: routed.context, layers: routed.layers, recall: recallText(), roomsSeen: [...recall.rooms], reply: raw ?? reply, command, parse_ok: ok, usage: lastUsage });
    saveMemory();
    if (/shrine accepts/i.test(seen)) record({ turn, event: "solved" });
    if (/shrine does not accept/i.test(seen)) record({ turn, event: "rejected" });
    memory.push(command);
    recordSpan("agent.decision", {
      "actor.name": NAME,
      "router.mode": routed.mode,
      "router.layers": routed.layers.join(","),
      "router.tokens": routed.tokens,
      "router.context.hash": digest(routed.context),
      "observation.hash": digest(seen),
      "observation.bytes": seen.length,
      "output.command": command,
      "output.parse_ok": ok,
      "telemetry.latency_ms": Date.now() - started,
      "telemetry.tokens_in": lastUsage?.prompt_tokens,
      "telemetry.tokens_out": lastUsage?.completion_tokens,
    }, Date.now() - started);
    if (!ok) console.warn(`turn ${turn}: unparseable reply, sending "look" instead`);
    socket.send(`${command}\n`);
    if (command === "quit") break;
    if (turn >= MAX_TURNS) { socket.send("quit\n"); break; }
  }
}

socket.on("open", () => { loop(); });
