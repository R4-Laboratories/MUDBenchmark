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
import { appendFileSync } from "node:fs";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:4001";
const BRAIN = process.env.BRAIN ?? "scripted";
const LOG = process.env.HARNESS_LOG ?? "/tmp/mudbench-harness.jsonl";
const NAME = process.env.HARNESS_NAME ?? "agent";

const INSTRUCTIONS = `You are playing MUDBench, a text world.

Rules of the interface:
- Reply with exactly one command per turn, and nothing else.
- Commands: look, who, say <text>, north, south, east, west, quit.
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
  const base = process.env.MODEL_BASE_URL;
  const key = process.env.MODEL_API_KEY;
  const model = process.env.MODEL_NAME;
  if (!base || !key || !model) return null;
  const messages = [{ role: "system", content: INSTRUCTIONS }];
  return async (observed) => {
    messages.push({ role: "user", content: observed });
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 60 }),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const body = await res.json();
    const reply = body.choices?.[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content: reply });
    return reply;
  };
}

const decide = (BRAIN === "llm" ? llmBrain() : scriptedBrain()) ?? scriptedBrain();

// --- parsing -------------------------------------------------------------

const COMMANDS = new Set(["look", "l", "who", "north", "south", "east", "west",
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
  console.log(`harness connected as ${NAME} with the ${BRAIN} brain`);
  record({ event: "connect", url: WS_URL, brain: BRAIN });
});

socket.on("message", (data) => { observed += data.toString("utf8"); });

socket.on("error", (error) => { console.error(`harness error: ${error.message}`); process.exit(1); });

socket.on("close", () => { console.log("harness disconnected"); process.exit(0); });

// One turn per window: let the room speak, then decide.
async function loop() {
  while (socket.readyState === WebSocket.OPEN) {
    await new Promise((r) => setTimeout(r, 500));
    const seen = observed;
    observed = "";
    if (!seen.trim()) continue;

    turn += 1;
    let reply;
    try {
      reply = await decide(seen);
    } catch (error) {
      record({ turn, event: "brain-error", message: error.message, seen });
      continue;
    }
    const { command, ok, raw } = parseCommand(reply);
    record({ turn, event: "decision", seen, reply: raw ?? reply, command, parse_ok: ok });
    if (!ok) console.warn(`turn ${turn}: unparseable reply, sending "look" instead`);
    socket.send(`${command}\n`);
    if (command === "quit") break;
  }
}

socket.on("open", () => { loop(); });
