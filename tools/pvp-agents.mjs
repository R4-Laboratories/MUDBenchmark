#!/usr/bin/env node
// Two remote-model agents in a real Ring duel.
//
//   node tools/pvp-agents.mjs --level=5 --matches=1
//   node tools/pvp-agents.mjs --level=10 --matches=1
//
// Each match starts an isolated server with both characters in The Ring and a
// mirrored kit. Two runtime/agent.mjs processes use OpenCode/DeepSeek; the
// report is built from the server spans and the agent logs. This is slower and
// noisier than tools/pvp-session.mjs, but it tests the model-facing PvP path.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";
import { loadWorld } from "../runtime/worlddata.mjs";
import { initialState, maxHpForLevel } from "../runtime/world.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests } from "../runtime/quests.mjs";
import { hashPassword } from "../runtime/accounts.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "1"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const LEVEL = Number(args.get("level") ?? process.env.PVP_LEVEL ?? 5);
const MATCHES = Math.max(1, Number(args.get("matches") ?? process.env.PVP_MATCHES ?? 1));
const MODEL = args.get("model") ?? process.env.PVP_MODEL ?? "deepseek/deepseek-flash";
const TURNS = Number(args.get("turns") ?? process.env.PVP_TURNS ?? 30);
const WALL_MS = Number(args.get("wall") ?? process.env.PVP_WALL_MS ?? 360000);
const PASSWORD = "pvp-pass";
const RING = 33;
const NAMES = ["pvp-a", "pvp-b"];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join(process.cwd(), "local", "pvp-agents", `level-${LEVEL}-${stamp}`);
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});

const KIT = LEVEL >= 10
  ? [
      ["dawn-blade", "dawn blade", "wield"],
      ["dawn-crown", "dawn crown", "wear"],
      ["eclipse-plate", "eclipse plate", "wear"],
      ["ember-cloak", "ember cloak", "wear"],
      ["shield", "round shield", "wear"],
      ["boots", "pair of leather boots", "wear"],
      ["gloves", "pair of leather gloves", "wear"],
    ]
  : [
      ["sword", "short sword", "wield"],
      ["jerkin", "leather jerkin", "wear"],
      ["helmet", "iron helmet", "wear"],
      ["boots", "pair of leather boots", "wear"],
      ["gloves", "pair of leather gloves", "wear"],
      ["shield", "round shield", "wear"],
    ];

const makeWorldPath = (dir) => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "world", "data", "world.json"), "utf8"));
  for (const color of ["crimson", "cobalt"]) {
    for (const [templateId, label, action] of KIT) {
      const template = raw.objects.find((object) => object.id === templateId);
      if (!template) throw new Error(`missing kit object ${templateId}`);
      const clone = structuredClone(template);
      delete clone.holder;
      delete clone.inside;
      delete clone.heldRoom;
      delete clone.worn;
      raw.objects.push({
        ...clone,
        id: `pvp-${color}-${templateId}`,
        name: `a ${color} ${label}`,
        room: RING,
        home: RING,
        forSale: false,
        action,
        label,
        color,
      });
    }
  }
  const path = join(dir, "world.json");
  writeFileSync(path, JSON.stringify(raw));
  return path;
};

const makeState = (world) => {
  const channels = loadChannels();
  const levels = loadLevels();
  const quests = loadQuests();
  const state = initialState(world.rooms, world.npcs, world.objects, RING, world.climate, channels.channels, levels.levels, quests.quests);
  const { salt, hash } = hashPassword(PASSWORD);
  for (const name of NAMES) {
    state.accounts[name] = {
      kind: "legacy", name, characters: [name], passwordHash: hash, salt,
      tokenHash: null, retired: false, mergedInto: null,
    };
    state.identities[name] = {
      kind: "character", owner: name, name, role: 0,
      level: LEVEL, xp: LEVEL >= 10 ? 30000 : 1500,
      guild: null, guildRank: null, quests: { active: [], completed: [] },
      spellbook: [], maxMana: 3 + LEVEL * 2, questCycles: {}, ignored: [],
      title: null, found: [], memory: { facts: {} },
      duelWins: 0, duelLosses: 0, duelRating: 1000,
    };
  }
  return state;
};

const goalFor = (name, other) => {
  const color = name === "pvp-a" ? "crimson" : "cobalt";
  const kit = KIT.map(([, label, action]) => `${action} ${color} ${label}`).join("; ");
  const take = KIT.map(([, label]) => `take ${color} ${label}`).join("; ");
  return `PVP: You are ${name} in The Ring with ${other}. Do not leave The Ring. Take only the ${color} kit: ${take}. Then ${kit}. ${name === "pvp-a"
    ? `Type \`duel ${other}\`. Wait for "The Ring is yours. Fight.", then type \`attack ${other}\` until the duel ends.`
    : `Wait for "${other} challenges you", then type \`duel accept\`. When you see "The Ring is yours. Fight.", type \`attack ${other}\` until the duel ends.`} Never attack before the duel begins. Do not take the other player's items.`;
};

const readSpans = (file) => {
  try {
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};

const oneMatch = async (matchNumber) => {
  const dir = join(OUT, `match-${matchNumber}`);
  mkdirSync(dir, { recursive: true });
  const worldPath = makeWorldPath(dir);
  const world = loadWorld({ mode: "single", path: worldPath });
  const state = makeState(world);
  const stateFile = join(dir, "state.json");
  writeFileSync(stateFile, JSON.stringify(state));
  const holoPort = await port();
  const webPort = await port();
  const telnetPort = await port();
  const holo = http.createServer((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ outputs: ["admissible"] }));
    });
  });
  await new Promise((resolve) => holo.listen(holoPort, "127.0.0.1", resolve));
  const spanFile = join(dir, "spans.jsonl");
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: join(process.cwd(), "runtime"),
    env: {
      ...process.env,
      TELNET_PORT: String(telnetPort),
      WEB_PORT: String(webPort),
      STATE_FILE: stateFile,
      IDENTITY_FILE: join(dir, "identities.json"),
      TRACE_FILE: join(dir, "trace.jsonl"),
      TELEMETRY_LOG: spanFile,
      REPORT_FILE: join(dir, "reports.jsonl"),
      HOLO_URL: `http://127.0.0.1:${holoPort}`,
      WORLD_PATH: worldPath,
      SIGNUP_MODE: "closed",
      COMMAND_INTERVAL_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  const agents = [];
  try {
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${webPort}/health`)).ok) break; } catch {}
      await wait(100);
    }
    for (const name of NAMES) {
      const other = name === "pvp-a" ? "pvp-b" : "pvp-a";
      const logFile = join(dir, `${name}.jsonl`);
      const agent = spawn(process.execPath, ["agent.mjs"], {
        cwd: join(process.cwd(), "runtime"),
        env: {
          ...process.env,
          WS_URL: `ws://127.0.0.1:${webPort}`,
          MODEL_PROVIDER: "opencode",
          MODEL_NAME: MODEL,
          MODEL_TIMEOUT_MS: "90000",
          AGENT_NAME: name,
          AGENT_PASSWORD: PASSWORD,
          AGENT_SCENARIO: "pvp",
          AGENT_GOAL: goalFor(name, other),
          MAX_TURNS: String(TURNS),
          AGENT_STOP_ON_QUEST: "0",
          AGENT_ROUTE_LOCK: "0",
          AGENT_LOG: logFile,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      agent.stdout.on("data", (chunk) => { output += chunk; });
      agent.stderr.on("data", (chunk) => { output += chunk; });
      agents.push({ name, agent, logFile, output: () => output });
    }
    const end = Date.now() + WALL_MS;
    let duelWin = null;
    while (Date.now() < end) {
      const spans = readSpans(spanFile);
      duelWin = spans.find((span) => span.name === "world.duel" && span["duel.action"] === "win");
      if (duelWin) break;
      if (agents.every((entry) => entry.agent.exitCode !== null)) break;
      await wait(1000);
    }
    await wait(1200);
    const spans = readSpans(spanFile);
    const sessions = spans.filter((span) => span.name === "world.session" && span["actor.name"]);
    const idFor = Object.fromEntries(NAMES.map((name) => [name, sessions.find((span) => span["actor.name"] === name)?.["actor.id"]]));
    const combats = spans.filter((span) => span.name === "world.combat"
      && [idFor["pvp-a"], idFor["pvp-b"]].includes(span["actor.id"])
      && [idFor["pvp-a"], idFor["pvp-b"]].includes(span["target.id"]));
    const win = spans.find((span) => span.name === "world.duel" && span["duel.action"] === "win");
    const winner = win?.["duel.a"] === idFor["pvp-a"] ? "pvp-a" : win ? "pvp-b" : null;
    const hits = (name) => combats.filter((span) => span["actor.id"] === idFor[name] && span.outcome !== "miss");
    const attacks = (name) => combats.filter((span) => span["actor.id"] === idFor[name]);
    const damage = (name) => hits(name).reduce((sum, span) => sum + (Number(span.damage) || 0), 0);
    const hpLeft = (name) => {
      const targetSpans = combats.filter((span) => span["target.id"] === idFor[name]);
      return targetSpans.length ? Math.max(0, Number(targetSpans[targetSpans.length - 1]["target.hp"])) : maxHpForLevel(LEVEL);
    };
    const logs = Object.fromEntries(agents.map((entry) => {
      let text = entry.output();
      try { text += readFileSync(entry.logFile, "utf8"); } catch {}
      const turns = (text.match(/^turn \d+:/gm) ?? []).length;
      const commands = (text.match(/^turn \d+: (.+)$/gm) ?? []).map((line) => line.replace(/^turn \d+: /, "")).slice(-30);
      return [entry.name, { turns, commands, tail: text.slice(-1600) }];
    }));
    const result = {
      match: matchNumber,
      level: LEVEL,
      model: MODEL,
      winner,
      duelSpans: spans.filter((span) => span.name === "world.duel").map((span) => span["duel.action"]),
      attacks: combats.length,
      rounds: Math.max(attacks("pvp-a").length, attacks("pvp-b").length),
      a: { attacks: attacks("pvp-a").length, hits: hits("pvp-a").length, damage: damage("pvp-a"), hpLeft: hpLeft("pvp-a") },
      b: { attacks: attacks("pvp-b").length, hits: hits("pvp-b").length, damage: damage("pvp-b"), hpLeft: hpLeft("pvp-b") },
      winnerHp: winner ? hpLeft(winner) : null,
      maxHp: maxHpForLevel(LEVEL),
      agents: logs,
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    writeFileSync(join(dir, "error.txt"), `${error.message}\n\n${serverLog}\n\n${agents.map((entry) => `${entry.name}:\n${entry.output()}`).join("\n")}`);
    throw error;
  } finally {
    for (const entry of agents) { try { entry.agent.kill("SIGTERM"); } catch {} }
    server.kill("SIGTERM");
    holo.close();
    await wait(500);
  }
};

const results = [];
const failures = [];
for (let match = 1; match <= MATCHES; match += 1) {
  try {
    const result = await oneMatch(match);
    results.push(result);
    console.log(`${match}/${MATCHES} ${result.winner ?? "no winner"} · ${result.rounds} rounds · ${result.attacks} attacks · agent turns ${result.agents["pvp-a"].turns}/${result.agents["pvp-b"].turns}`);
  } catch (error) {
    failures.push({ match, error: error.message });
    console.error(`${match}/${MATCHES} failed: ${error.message}`);
  }
}
const summary = { level: LEVEL, model: MODEL, matches: results.length, failures, results };
writeFileSync(join(OUT, "report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(failures.length || !results.some((result) => result.winner) ? 1 : 0);
