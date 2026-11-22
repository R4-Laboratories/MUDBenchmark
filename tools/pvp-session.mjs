#!/usr/bin/env node
// Two-client live PvP sample against isolated servers.
//
//   node tools/pvp-session.mjs --level=5 --matches=12
//   node tools/pvp-session.mjs --level=10 --matches=12
//
// Each match starts a fresh world with both characters in The Ring, gives each
// an identical mirrored kit, logs both in through the real WebSocket, and runs
// the real duel -> accept -> attack flow. The report is built from the server's
// world.session/world.combat/world.duel spans, not a reducer simulation.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";
import WebSocket from "../runtime/node_modules/ws/index.js";
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
const MATCHES = Math.max(1, Number(args.get("matches") ?? process.env.PVP_MATCHES ?? 12));
const STAGGER_MS = Math.max(0, Number(args.get("stagger") ?? process.env.PVP_STAGGER ?? 0));
const PASSWORD = "pvp-pass";
const RING = 33;
const NAMES = ["pvp-a", "pvp-b"];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join(process.cwd(), "local", "pvp", `level-${LEVEL}-${stamp}`);
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

const sleep = wait;
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

const connect = async (url) => {
  const ws = new WebSocket(url);
  let text = "";
  let cursor = 0;
  ws.on("message", (data) => { text += String(data); });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return {
    ws,
    text: () => text,
    send: (line) => ws.send(`${line}\n`),
    async expect(pattern, timeout = 20000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const index = text.indexOf(pattern, cursor);
        if (index >= 0) {
          cursor = index + pattern.length;
          return true;
        }
        await sleep(50);
      }
      throw new Error(`timeout waiting for ${pattern}; tail=${JSON.stringify(text.slice(-900))}`);
    },
    close: () => ws.close(),
  };
};

const oneMatch = async (matchNumber, first) => {
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
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: join(process.cwd(), "runtime"),
    env: {
      ...process.env,
      TELNET_PORT: String(telnetPort),
      WEB_PORT: String(webPort),
      STATE_FILE: stateFile,
      IDENTITY_FILE: join(dir, "identities.json"),
      TRACE_FILE: join(dir, "trace.jsonl"),
      TELEMETRY_LOG: join(dir, "spans.jsonl"),
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
  const clients = [];
  try {
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${webPort}/health`)).ok) break;
      } catch {}
      await sleep(100);
    }
    const order = first === 0 ? ["pvp-a", "pvp-b"] : ["pvp-b", "pvp-a"];
    const byName = {};
    for (const name of order) {
      const client = await connect(`ws://127.0.0.1:${webPort}`);
      clients.push(client);
      byName[name] = client;
      client.send(`login ${name} ${PASSWORD}`);
      await client.expect(`Signing in as ${name}`);
      await client.expect("[The Ring]");
    }
    const a = byName["pvp-a"];
    const b = byName["pvp-b"];
    const gearFor = (client, color) => {
      const commands = [];
      for (const [templateId, label, action] of KIT) {
        commands.push(`take ${color} ${label}`, `${action} ${color} ${label}`);
      }
      return commands;
    };
    for (const client of clients) {
      const color = client === a ? "crimson" : "cobalt";
      for (const command of gearFor(client, color)) {
        client.send(command);
        await client.expect(command.startsWith("take ") ? "You take" : (command.startsWith("wield ") ? "You wield" : "You wear"));
        await sleep(500);
      }
    }
    await sleep(1000);
    a.send("duel pvp-b");
    await a.expect("You challenge pvp-b");
    await b.expect("challenges you");
    b.send("duel accept");
    await a.expect("The Ring is yours");
    await b.expect("The Ring is yours");
    if (STAGGER_MS > 0) await sleep(Math.floor(Math.random() * STAGGER_MS));
    const start = Date.now();
    a.send("attack pvp-b");
    b.send("attack pvp-a");
    await sleep(500);
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (/You win the duel\./.test(a.text()) || /You fall\. The Ring takes no goods\./.test(a.text())
          || /You win the duel\./.test(b.text()) || /You fall\. The Ring takes no goods\./.test(b.text())) break;
      await sleep(100);
    }
    await sleep(600);
    const durationMs = Date.now() - start;
    const aText = a.text();
    const bText = b.text();
    if (!/You win the duel\.|You fall\. The Ring takes no goods\./.test(aText + bText)) {
      throw new Error(`duel did not finish; A tail=${JSON.stringify(aText.slice(-500))} B tail=${JSON.stringify(bText.slice(-500))}`);
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); });
    const spans = readFileSync(join(dir, "spans.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const sessions = spans.filter((span) => span.name === "world.session" && span["actor.name"]);
    const idFor = Object.fromEntries(NAMES.map((name) => [name, sessions.find((span) => span["actor.name"] === name)?.["actor.id"]]));
    const combats = spans.filter((span) => span.name === "world.combat"
      && [idFor["pvp-a"], idFor["pvp-b"]].includes(span["actor.id"])
      && [idFor["pvp-a"], idFor["pvp-b"]].includes(span["target.id"]));
    const duelWin = spans.find((span) => span.name === "world.duel" && span["duel.action"] === "win");
    const winner = duelWin?.["duel.a"] === idFor["pvp-a"] ? "pvp-a" : "pvp-b";
    const loser = winner === "pvp-a" ? "pvp-b" : "pvp-a";
    const byId = Object.fromEntries(Object.entries(idFor).map(([name, id]) => [id, name]));
    const attacks = (name) => combats.filter((span) => span["actor.id"] === idFor[name]);
    const hits = (name) => attacks(name).filter((span) => span.outcome !== "miss");
    const damage = (name) => hits(name).reduce((sum, span) => sum + (Number(span.damage) || 0), 0);
    const hpLeft = (name) => {
      const targetSpans = combats.filter((span) => span["target.id"] === idFor[name]);
      return targetSpans.length ? Math.max(0, Number(targetSpans[targetSpans.length - 1]["target.hp"])) : maxHpForLevel(LEVEL);
    };
    const result = {
      match: matchNumber,
      first,
      level: LEVEL,
      winner,
      loser,
      durationMs,
      attacks: combats.length,
      rounds: Math.max(attacks("pvp-a").length, attacks("pvp-b").length),
      a: { attacks: attacks("pvp-a").length, hits: hits("pvp-a").length, damage: damage("pvp-a"), hpLeft: hpLeft("pvp-a") },
      b: { attacks: attacks("pvp-b").length, hits: hits("pvp-b").length, damage: damage("pvp-b"), hpLeft: hpLeft("pvp-b") },
      winnerHp: hpLeft(winner),
      maxHp: maxHpForLevel(LEVEL),
      duelSpans: spans.filter((span) => span.name === "world.duel").length,
      logTail: (aText + bText).slice(-300),
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    writeFileSync(join(dir, "error.txt"), `${error.message}\n\n${serverLog}\n\nA:${clients[0]?.text()}\nB:${clients[1]?.text()}`);
    throw error;
  } finally {
    for (const client of clients) client.close();
    server.kill("SIGTERM");
    holo.close();
    await sleep(400);
  }
};

const results = [];
const failures = [];
for (let match = 1; match <= MATCHES; match += 1) {
  try {
    const result = await oneMatch(match, match % 2);
    results.push(result);
    console.log(`${match}/${MATCHES} ${result.winner} wins in ${result.rounds} rounds · ${result.attacks} attacks · winner ${result.winnerHp}/${result.maxHp} hp`);
  } catch (error) {
    failures.push({ match, error: error.message });
    console.error(`${match}/${MATCHES} failed: ${error.message}`);
  }
}
const totals = results.reduce((sum, result) => {
  sum.matches += 1;
  sum.attacks += result.attacks;
  sum.hits += result.a.hits + result.b.hits;
  sum.damage += result.a.damage + result.b.damage;
  sum.rounds += result.rounds;
  sum.wins[result.winner] = (sum.wins[result.winner] ?? 0) + 1;
  sum.winnerHp += result.winnerHp;
  sum.maxHp += result.maxHp;
  return sum;
}, { matches: 0, attacks: 0, hits: 0, damage: 0, rounds: 0, wins: {}, winnerHp: 0, maxHp: 0 });
const summary = {
  level: LEVEL,
  matches: totals.matches,
  failures: failures.length,
  attacks: totals.attacks,
  hits: totals.hits,
  hitRate: totals.attacks ? totals.hits / totals.attacks : null,
  averageDamageOnHit: totals.hits ? totals.damage / totals.hits : null,
  averageRounds: totals.matches ? totals.rounds / totals.matches : null,
  wins: totals.wins,
  averageWinnerHp: totals.matches ? totals.winnerHp / totals.matches : null,
  maxHp: maxHpForLevel(LEVEL),
  averageWinnerHpPct: totals.matches ? (totals.winnerHp / totals.maxHp) / totals.matches : null,
  results,
  failureDetails: failures,
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(failures.length ? 1 : 0);
