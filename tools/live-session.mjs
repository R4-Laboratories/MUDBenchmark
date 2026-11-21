#!/usr/bin/env node
// One real server session, isolated from production state.
//
//   node tools/live-session.mjs
//
// It seeds a level-10 character at the Moon Throne, starts runtime/server.mjs
// on a private port, connects over the same WebSocket a player uses, fights the
// eclipse regent, then walks the Memory Garden quest. The span file is read
// back so the report is evidence, not a transcript assertion alone.

import { spawn } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "../runtime/worlddata.mjs";
import { initialState } from "../runtime/world.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests } from "../runtime/quests.mjs";
import { hashPassword } from "../runtime/accounts.mjs";

const require = createRequire(new URL("../runtime/", import.meta.url));
const WebSocket = require("ws");

const OUT = join(process.cwd(), "local", "live-session");
const PORT = Number(process.env.LIVE_PORT ?? 8098);
const TELNET = Number(process.env.LIVE_TELNET ?? 4011);
const HOLO_PORT = Number(process.env.LIVE_HOLO_PORT ?? 8083);
const PASSWORD = "live-pass";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const world = loadWorld({ mode: "single" });
if (world.errors?.length) throw new Error(`world: ${world.errors[0]}`);
const channels = loadChannels();
const levels = loadLevels();
const quests = loadQuests();
const state = initialState(world.rooms, world.npcs, world.objects, 91, world.climate, channels.channels, levels.levels, quests.quests);

// Put the level-10 kit on the Moon Throne, where the session starts.
for (const id of ["dawn-blade", "dawn-crown", "jerkin", "boots", "gloves", "ember-cloak", "eclipse-ward", "shield", "starwater"]) {
  const object = state.objects.find((entry) => entry.id === id);
  if (!object) continue;
  object.holder = null;
  object.room = 91;
  object.inside = null;
  object.home = 91;
  object.homeInside = null;
  object.forSale = false;
  object.price = null;
}
// Keep the walk to the regent quiet until the bot attacks.
for (const id of ["moon-stag", "star-hound", "sundial-knight", "eclipse-regent"]) {
  const npc = state.npcs.find((entry) => entry.id === id);
  if (!npc) continue;
  npc.aggression = 0;
  if (id === "moon-stag") { npc.room = 90; npc.home = 90; }
}

const { salt, hash } = hashPassword(PASSWORD);
state.accounts.tester = {
  kind: "legacy",
  name: "tester",
  characters: ["tester"],
  passwordHash: hash,
  salt,
  tokenHash: null,
  retired: false,
  mergedInto: null,
};
state.identities.tester = {
  kind: "character",
  owner: "tester",
  name: "tester",
  role: 0,
  level: 10,
  xp: 30000,
  guild: null,
  guildRank: null,
  quests: { active: [], completed: ["hall-word", "moon-stag", "eclipse-throne"] },
  spellbook: ["spark", "mend", "shield", "recall"],
  maxMana: 27,
  questCycles: {},
  ignored: [],
  title: "Dawnbringer",
  memory: { facts: {} },
};
const stateFile = join(OUT, "state.json");
writeFileSync(stateFile, JSON.stringify(state, null, 2));

// The real world asks the holo to admit every transition. This isolated run
// uses a verifier double so the session can exercise the server and combat
// loop without the production artifact; the gate still proves the real model.
const holo = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ outputs: ["admissible"] }));
  });
});
await new Promise((resolve) => holo.listen(HOLO_PORT, "127.0.0.1", resolve));

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: join(process.cwd(), "runtime"),
  env: {
    ...process.env,
    TELNET_PORT: String(TELNET),
    WEB_PORT: String(PORT),
    STATE_FILE: stateFile,
    IDENTITY_FILE: join(OUT, "identities.json"),
    TRACE_FILE: join(OUT, "trace.jsonl"),
    TELEMETRY_LOG: join(OUT, "spans.jsonl"),
    R4_URL: "http://127.0.0.1:1",
    HOLO_URL: `http://127.0.0.1:${HOLO_PORT}`,
    SIGNUP_MODE: "closed",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

async function healthy() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (response.ok) return true;
    } catch {}
    await wait(150);
  }
  return false;
}

const transcript = [];
let socket;
let buffer = "";
let lastSend = 0;

function connect() {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
    socket.on("message", (data) => { buffer += data.toString(); });
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
}

async function command(text, pause = 450) {
  const waitMs = Math.max(0, 320 - (Date.now() - lastSend));
  await wait(waitMs);
  socket.send(`${text}\n`);
  lastSend = Date.now();
  await wait(pause);
  const output = buffer;
  buffer = "";
  transcript.push({ command: text, output });
  return output;
}

function expect(output, pattern, label) {
  assert(pattern.test(output), `${label}: ${pattern} not found in ${JSON.stringify(output.slice(-300))}`);
}

let exitCode = 0;
try {
  assert(await healthy(), "local server did not become healthy");
  await connect();
  let output = await command(`login tester ${PASSWORD}`, 1200);
  expect(output, /Moon Throne/i, "login");

  for (const [item, verb] of [["dawn blade", "wield"], ["dawn crown", "wear"], ["jerkin", "wear"], ["boots", "wear"], ["gloves", "wear"], ["ember cloak", "wear"], ["eclipse ward", "wear"], ["shield", "wear"]]) {
    output = await command(`take ${item}`);
    expect(output, /You take/i, `take ${item}`);
    output = await command(`${verb} ${item}`);
    expect(output, /You (wield|wear)/i, `${verb} ${item}`);
  }
  output = await command("score");
  expect(output, /Level 10/i, "score level");
  expect(output, /armour 14/i, "armour total");

  for (const dir of ["up", "north", "east", "north"]) {
    output = await command(dir);
  }
  expect(output, /Throne of Ash/i, "regent room");
  output = await command("attack eclipse regent");
  expect(output, /You attack/i, "attack regent");

  let combatOutput = "";
  for (let i = 0; i < 45; i += 1) {
    combatOutput += await command("wait", 1000);
    if (/regent dies|You die/i.test(combatOutput)) break;
  }
  const won = /regent dies/i.test(combatOutput);
  assert(won || /You die/i.test(combatOutput), "combat did not resolve");

  output = await command("up");
  expect(output, /Dawn Gate/i, "dawn gate");
  output = await command("enter gate", 700);
  expect(output, /Moonlit Gate/i, "dawn gate exit");
  for (const dir of ["west", "west", "north", "north", "west", "north"]) output = await command(dir);
  expect(output, /Guild Hall/i, "guild hall");
  output = await command("quest accept memory-garden");
  expect(output, /Quest accepted/i, "accept memory-garden");
  output = await command("talk guild clerk", 700);
  expect(output, /LEDGER/i, "ledger fact");
  for (const dir of ["south", "east", "north", "east", "north", "north"]) output = await command(dir);
  expect(output, /Shrine/i, "shrine");
  output = await command("recall ledger", 700);
  expect(output, /You recall/i, "ledger recall");
  output = await command("east");
  expect(output, /Memory Garden/i, "memory garden");
  expect(output, /Quest complete: The Garden Remembers/i, "memory quest completion");
  output = await command("facts");
  expect(output, /LEDGER/i, "facts list");
  output = await command("titles");
  expect(output, /Gardenkeeper/i, "garden title");
  output = await command("title gardenkeeper");
  expect(output, /Title set/i, "title set");
  output = await command("score");
  expect(output, /Gardenkeeper/i, "title in score");
  await command("quit", 300);
} catch (error) {
  exitCode = 1;
  console.error(`live session failed: ${error.message}`);
  console.error(serverLog.slice(-2000));
} finally {
  try { socket?.close(); } catch {}
  server.kill("SIGTERM");
  holo.close();
  await wait(800);
}

let spans = [];
try {
  spans = readFileSync(join(OUT, "spans.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
} catch {}
const combat = spans.filter((span) => span.name === "world.combat");
const hits = combat.filter((span) => span.outcome === "hit" || span.outcome === "killed").length;
const kills = combat.filter((span) => span.outcome === "killed").length;
const combatRounds = new Set(combat.map((span) => span["world.tick"])).size;
const report = {
  exitCode,
  won: transcript.some((entry) => /regent dies/i.test(entry.output)),
  combatRounds,
  combatEvents: combat.length,
  hitRate: combat.length ? Number((hits / combat.length).toFixed(3)) : 0,
  kills,
  talkEvents: spans.filter((span) => span.name === "world.talk").length,
  questEvents: spans.filter((span) => span.name === "world.quest").length,
  title: transcript.some((entry) => /Title set: Gardenkeeper/i.test(entry.output)) ? "Gardenkeeper" : null,
  transcript: transcript.map((entry) => ({ command: entry.command, output: entry.output })),
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ exitCode, won: report.won, combatRounds: report.combatRounds, combatEvents: report.combatEvents, hitRate: report.hitRate, kills: report.kills, talkEvents: report.talkEvents, questEvents: report.questEvents, title: report.title }, null, 2));
process.exit(exitCode);
