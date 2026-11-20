#!/usr/bin/env node
// One unscripted Ollama run against an isolated server.
//
//   node tools/unscripted-session.mjs
//
// The server is real. The character is seeded in the Memory Garden with the
// garden fact and an active Remembered Bed quest. The model decides every
// command; this script only starts the world, starts the agent and reads back
// the spans.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "../runtime/worlddata.mjs";
import { initialState } from "../runtime/world.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests, emptyProgress } from "../runtime/quests.mjs";
import { hashPassword } from "../runtime/accounts.mjs";

const OUT = join(process.cwd(), "local", "unscripted-session");
const PORT = Number(process.env.LIVE_PORT ?? 8099);
const TELNET = Number(process.env.LIVE_TELNET ?? 4012);
const HOLO_PORT = Number(process.env.LIVE_HOLO_PORT ?? 8084);
const PASSWORD = "live-pass";
const PROVIDER = process.env.AGENT_PROVIDER ?? "ollama";
const MODEL = process.env.AGENT_MODEL ?? (PROVIDER === "opencode" ? "deepseek/deepseek-flash" : "qwen2.5:7b");
const SCENARIO = process.env.SCENARIO ?? "remembered";
const QUEST_IDS = SCENARIO === "broad" ? ["press-beneath", "cider-spring", "first-bed"] : [SCENARIO === "multi" ? "three-rememberings" : SCENARIO === "long" ? "long-remembering" : SCENARIO === "root" ? "first-bed" : "remembered-bed"];
const QUEST_ID = QUEST_IDS[0];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const world = loadWorld({ mode: "single" });
const channels = loadChannels();
const levels = loadLevels();
const quests = loadQuests();
const start = SCENARIO === "broad" ? 108 : SCENARIO === "multi" ? 6 : SCENARIO === "long" ? 105 : SCENARIO === "root" ? 101 : 98;
const state = initialState(world.rooms, world.npcs, world.objects, start, world.climate, channels.channels, levels.levels, quests.quests);
const rose = state.objects.find((object) => object.id === "memory-rose");
if (SCENARIO !== "root" && rose) {
  rose.room = 98;
  rose.home = 98;
  rose.forSale = false;
}
const { salt, hash } = hashPassword(PASSWORD);
const fact = { id: "garden-word", word: "garden", text: "The rememberer says: \"The garden remembers the word GARDEN.\"", source: "rememberer", tick: 0 };
const rootFact = { id: "root-word", word: "root", text: "The root keeper says: \"The archive keeps the word ROOT.\"", source: "root-keeper", tick: 0 };
state.accounts.tester = {
  kind: "legacy", name: "tester", characters: ["tester"],
  passwordHash: hash, salt, tokenHash: null, retired: false, mergedInto: null,
};
state.identities.tester = {
  kind: "character", owner: "tester", name: "tester", role: 0, level: 10, xp: 30000,
  guild: null, guildRank: null,
  quests: SCENARIO === "broad"
    ? { active: [{ id: "press-beneath", progress: emptyProgress() }, { id: "cider-spring", progress: emptyProgress() }, { id: "first-bed", progress: emptyProgress() }], completed: ["hall-word", "memory-garden", "remembered-bed", "long-remembering"] }
    : SCENARIO === "multi"
      ? { active: [{ id: "three-rememberings", progress: emptyProgress() }], completed: ["hall-word", "memory-garden", "remembered-bed", "first-bed", "long-remembering"] }
      : SCENARIO === "long"
      ? { active: [{ id: "long-remembering", progress: { ...emptyProgress(), visits: [103] } }], completed: ["hall-word", "memory-garden", "remembered-bed", "first-bed"] }
      : SCENARIO === "root"
        ? { active: [{ id: "first-bed", progress: emptyProgress() }], completed: ["hall-word", "memory-garden", "remembered-bed"] }
        : { active: [{ id: "remembered-bed", progress: emptyProgress() }], completed: ["hall-word", "memory-garden"] },
  spellbook: ["spark", "mend", "shield", "recall"], maxMana: 27, questCycles: {},
  ignored: [], title: "Gardenkeeper", found: SCENARIO === "long" || SCENARIO === "multi" || SCENARIO === "broad" ? ["98:down"] : [],
  memory: { facts: SCENARIO === "multi" || SCENARIO === "broad" ? { "garden-word": fact, "root-word": rootFact, "orchard-word": { id: "orchard-word", word: "orchard", text: "The orchard keeps ORCHARD.", source: "orchard-keeper", tick: 0 } } : SCENARIO === "long" || SCENARIO === "root" ? { "garden-word": fact, "root-word": rootFact } : { "garden-word": fact } },
};
const stateFile = join(OUT, "state.json");
writeFileSync(stateFile, JSON.stringify(state, null, 2));

const holo = http.createServer((request, response) => {
  request.on("data", () => {});
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

let exitCode = 1;
let agentLog = "";
try {
  if (!(await healthy())) throw new Error("server did not become healthy");
  const agent = spawn(process.execPath, ["agent.mjs"], {
    cwd: join(process.cwd(), "runtime"),
    env: {
      ...process.env,
      WS_URL: `ws://127.0.0.1:${PORT}`,
      MODEL_PROVIDER: PROVIDER,
      MODEL_BASE_URL: process.env.AGENT_BASE_URL ?? "http://127.0.0.1:11434",
      MODEL_NAME: MODEL,
      AGENT_NAME: "tester",
      AGENT_PASSWORD: PASSWORD,
      AGENT_GOAL: SCENARIO === "broad"
        ? "You are at The Old Press. Complete three quests in any order: Press Beneath (talk orchard keeper, take press seed at The Seed Vault), Cider Spring (talk spring keeper at The Spring Keeper's Rest, take cider bloom at The White Bed), and First Bed (talk root keeper at The Root Archive, take the first seed at The First Bed)."
        : SCENARIO === "multi"
          ? "You are at The Shrine. The Three Rememberings is active. Start by typing exactly: recall orchard. Then complete the remaining goals in any order: talk to the guild clerk at The Guild Hall, take an orchard seed at The Windfall, and talk to the orchard keeper at The Old Press."
          : SCENARIO === "long"
          ? "You are at The Root Gate. Go up to Market Square, west to The Gilded Rat, north to The Guild Hall, and talk guild clerk. Then go south, east to Market Square, north to The Atrium, east to The Storeroom, north to The Cell, north to The Shrine, and type exactly: recall root. The Long Remembering quest is active."
          : SCENARIO === "root"
          ? "You are in The Remembered Bed. Go down to The Root Archive, talk to the root keeper, go east to The First Bed, and take the first seed. The First Bed quest is active."
          : "You are in the Memory Garden. Use these commands in order, one per turn: take memory rose; plant rose; down; take remembered bloom; up; north; talk rememberer. Do not repeat look. The plant opens a hidden stair down.",
      AGENT_DESTINATION: SCENARIO === "root" ? "The Root Archive" : SCENARIO === "long" ? "The Guild Hall" : SCENARIO === "multi" || SCENARIO === "broad" ? "" : "The Rememberer's Bench",
      AGENT_WAYPOINTS: SCENARIO === "root" ? "The Root Archive:talk|The First Bed:take|The Root Archive:talk" : SCENARIO === "long" ? "The Guild Hall:talk|The Shrine:recall" : "",
      AGENT_OBJECTIVES: SCENARIO === "multi" ? "The Shrine:recall orchard|The Guild Hall:talk guild clerk|The Windfall:take orchard seed|The Old Press:talk orchard keeper" : SCENARIO === "broad" ? "The Old Press:talk orchard keeper|The Seed Vault:take press seed|The Spring Keeper's Rest:talk spring keeper|The White Bed:take cider bloom|The Root Archive:talk root keeper|The First Bed:take first seed" : "",
      AGENT_STOP_ON_QUEST: SCENARIO === "broad" ? "0" : "1",
      MAX_TURNS: process.env.AGENT_MAX_TURNS ?? "16",

      MODEL_TIMEOUT_MS: "120000",
      AGENT_LOG: join(OUT, "agent.jsonl"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  agent.stdout.on("data", (chunk) => { agentLog += chunk; });
  agent.stderr.on("data", (chunk) => { agentLog += chunk; });
  const questDone = () => {
    try {
      const lines = readFileSync(join(OUT, "spans.jsonl"), "utf8").trim().split("\n").filter(Boolean);
      const done = new Set();
      for (const line of lines) {
        try {
          const span = JSON.parse(line);
          if (span.name === "world.quest" && span["quest.action"] === "complete") done.add(span["quest.id"]);
        } catch {}
      }
      return QUEST_IDS.every((id) => done.has(id));
    } catch { return false; }
  };
  exitCode = await new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(code);
    };
    const poll = setInterval(() => {
      if (questDone()) {
        try { agent.kill("SIGTERM"); } catch {}
        finish(0);
      }
    }, 1200);
    const timer = setTimeout(() => { agent.kill("SIGKILL"); finish(124); }, 600_000);
    agent.on("close", (code) => finish(code ?? 1));
  });
} catch (error) {
  serverLog += `unscripted run: ${error.message}\n`;
  console.error(error.message);
} finally {
  server.kill("SIGTERM");
  holo.close();
  await wait(800);
}

let spans = [];
try {
  spans = readFileSync(join(OUT, "spans.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
} catch {}
const span = (name) => spans.filter((entry) => entry.name === name);
const planted = span("world.action").some((entry) => entry["action.id"] === "plant-memory");
const hidden = span("world.transition").some((entry) => String(entry["room.to"]) === "101");
const bloom = span("world.object").some((entry) => entry["object.id"] === "remembered-bloom");
const seedId = SCENARIO === "broad" ? "press-seed" : SCENARIO === "multi" ? "orchard-seed" : SCENARIO === "long" ? null : "first-seed";
const seed = seedId ? span("world.object").some((entry) => entry["object.id"] === seedId) : false;
const ciderBloom = SCENARIO === "broad" && span("world.object").some((entry) => entry["object.id"] === "cider-bloom");
const orchardSeed = SCENARIO === "broad" && span("world.object").some((entry) => entry["object.id"] === "orchard-seed");
const firstSeed = SCENARIO === "broad" && span("world.object").some((entry) => entry["object.id"] === "first-seed");
const questState = Object.fromEntries(QUEST_IDS.map((id) => [id, span("world.quest").some((entry) => entry["quest.id"] === id && entry["quest.action"] === "complete")]));
const quest = QUEST_IDS.every((id) => questState[id]);
const talked = span("world.talk").some((entry) => entry["npc.id"] === (SCENARIO === "broad" ? "orchard-keeper" : SCENARIO === "multi" ? "orchard-keeper" : SCENARIO === "long" ? "guild-clerk" : SCENARIO === "root" ? "root-keeper" : "rememberer"));
const turns = (agentLog.match(/^turn \d+:/gm) ?? []).length;
const report = { scenario: SCENARIO, exitCode, model: MODEL, turns, planted, hidden, bloom, seed, ciderBloom, orchardSeed, firstSeed, quest, quests: questState, talked, agentLog: agentLog.slice(-12000) };
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scenario: SCENARIO, exitCode, model: MODEL, turns, planted, hidden, bloom, seed, ciderBloom, orchardSeed, firstSeed, quest, quests: questState, talked }, null, 2));
if (!agentLog.trim()) console.log("no agent output");
process.exit(exitCode === 0 ? 0 : 1);
