#!/usr/bin/env node
// One short remote-model tuning session against an isolated server.
//
//   TUNING_PROVIDER=opencode TUNING_MODEL=deepseek/deepseek-flash \
//     TUNING_SCENARIO=mirror node tools/tuning-session.mjs
//   TUNING_SCENARIO=high node tools/tuning-session.mjs
//
// mirror: a geared level-5 character at the Mirror Pool.
// high:   an unseeded level-8 character at the Starless Hall.
// The report reads the real spans; it never edits production.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "../runtime/worlddata.mjs";
import { initialState } from "../runtime/world.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests } from "../runtime/quests.mjs";
import { hashPassword } from "../runtime/accounts.mjs";
import { summarizePlayers } from "../runtime/playerstats.mjs";

const SCENARIO = process.env.TUNING_SCENARIO ?? "mirror";
const OUT = join(process.cwd(), "local", `tuning-${SCENARIO}`);
const PORT = Number(process.env.TUNING_PORT ?? 8098);
const TELNET = Number(process.env.TUNING_TELNET ?? 4013);
const HOLO_PORT = Number(process.env.TUNING_HOLO_PORT ?? 8085);
const PASSWORD = "tune-pass";
const PROVIDER = process.env.TUNING_PROVIDER ?? "opencode";
const MODEL = process.env.TUNING_MODEL ?? "deepseek/deepseek-flash";
const MAX_TURNS = process.env.TUNING_TURNS ?? (SCENARIO === "high" ? "10" : "16");
const TIMEOUT_MS = process.env.TUNING_TIMEOUT_MS ?? "120000";
const WALL_MS = Number(process.env.TUNING_WALL_MS ?? (SCENARIO === "high" ? 300000 : 240000));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const world = loadWorld({ mode: "single" });
const channels = loadChannels();
const levels = loadLevels();
const quests = loadQuests();
const start = SCENARIO === "high" ? 93 : 41;
const state = initialState(world.rooms, world.npcs, world.objects, start, world.climate, channels.channels, levels.levels, quests.quests);

// The mirror scenario puts a mundane kit on the floor, so the model exercises
// take-all, wield and wear. The high scenario is deliberately unseeded.
if (SCENARIO === "mirror") {
  const kit = ["sword", "jerkin", "helmet", "boots", "gloves", "shield"];
  for (const object of state.objects) {
    if (!kit.includes(object.id)) continue;
    object.room = start;
    object.home = start;
    object.inside = null;
    object.homeInside = null;
    object.holder = null;
    object.forSale = false;
    object.worn = false;
    object.heldRoom = null;
  }
  // The wraith drops this, so it must not start in the fight room.
  const mirrorShield = state.objects.find((object) => object.id === "mirror-shield");
  if (mirrorShield) {
    mirrorShield.room = 42;
    mirrorShield.home = 42;
  }
}
const { salt, hash } = hashPassword(PASSWORD);
state.accounts.tester = {
  kind: "legacy", name: "tester", characters: ["tester"],
  passwordHash: hash, salt, tokenHash: null, retired: false, mergedInto: null,
};
state.identities.tester = {
  kind: "character", owner: "tester", name: "tester", role: 0,
  level: SCENARIO === "high" ? 8 : 5, xp: SCENARIO === "high" ? 10000 : 1500,
  guild: null, guildRank: null, quests: { active: [], completed: [] },
  spellbook: [], maxMana: SCENARIO === "high" ? 19 : 17, questCycles: {}, ignored: [], title: null, found: [],
  memory: { facts: {} },
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
    REPORT_FILE: join(OUT, "reports.jsonl"),
    R4_URL: "http://127.0.0.1:1",
    HOLO_URL: `http://127.0.0.1:${HOLO_PORT}`,
    SIGNUP_MODE: "closed",
    COMMAND_INTERVAL_MS: "0",
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
      MODEL_NAME: MODEL,
      MODEL_TIMEOUT_MS: TIMEOUT_MS,
      AGENT_NAME: "tester",
      AGENT_PASSWORD: PASSWORD,
      AGENT_GOAL: SCENARIO === "high"
        ? "You are at the Starless Hall, unseeded. Fight the star hound with attack star-hound. Use score after the fight. There is no fleeing; a fight ends with a death."
        : "You are at The Mirror Pool. Take all the gear on the floor, wield the sword and wear the armour. Then attack the mirror-wraith until it dies. After the fight, take all again and wear the mirror shield. Use score and equipment to check your health and slots. There is no fleeing; a fight ends with a death.",
      AGENT_STOP_ON_QUEST: "0",
      MAX_TURNS,
      AGENT_ROUTE_LOCK: "0",
      AGENT_LOG: join(OUT, "agent.jsonl"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  agent.stdout.on("data", (chunk) => { agentLog += chunk; });
  agent.stderr.on("data", (chunk) => { agentLog += chunk; });
  exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { agent.kill("SIGKILL"); } catch {}
      resolve(124);
    }, WALL_MS);
    agent.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
} catch (error) {
  serverLog += `tuning run: ${error.message}\n`;
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
const summary = summarizePlayers(spans);
const objectSpans = spans.filter((span) => span.name === "world.object");
const tookShield = objectSpans.some((span) => (span["object.id"] === "mirror-shield" && ["take", "takeFrom"].includes(span["action.kind"])) || (span["action.kind"] === "takeAll" && String(span["object.ids"] ?? "").split(",").includes("mirror-shield")));
const woreShield = objectSpans.some((span) => span["object.id"] === "mirror-shield" && span["action.kind"] === "wear");
const killedWraith = spans.some((span) => span.name === "world.combat" && span["target.id"] === "mirror-wraith" && span.outcome === "killed");
const killedStar = spans.some((span) => span.name === "world.combat" && span["target.id"] === "star-hound" && span.outcome === "killed");
const turns = (agentLog.match(/^turn \d+:/gm) ?? []).length;
const taskOk = SCENARIO === "high" ? summary.combat.rounds > 0 : killedWraith && tookShield && woreShield;
const report = {
  scenario: SCENARIO,
  provider: PROVIDER,
  model: MODEL,
  exitCode,
  turns,
  combat: summary.combat,
  taskOk,
  killedWraith,
  killedStar,
  tookShield,
  woreShield,
  objectSpans: objectSpans.map((span) => `${span["action.kind"]}:${span["object.id"] ?? ""}`),
  agentLog: agentLog.slice(-12000),
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scenario: SCENARIO, provider: PROVIDER, model: MODEL, exitCode, turns, taskOk, combat: summary.combat, killedWraith, killedStar, tookShield, woreShield }, null, 2));
if (!agentLog.trim()) console.log("no agent output");
process.exit(taskOk && summary.combat.rounds > 0 ? 0 : 1);
