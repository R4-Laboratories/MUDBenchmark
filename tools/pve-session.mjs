#!/usr/bin/env node
// Live first-hour PvE sample.
//
// Each match starts a fresh isolated server with the enemy pinned in its room,
// a level-1 character in practice gear, and a random world tick. The result is
// built from the server's world.combat spans and final #state, not a reducer.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
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
const LEVEL = Number(args.get("level") ?? 1);
const MATCHES = Math.max(1, Number(args.get("matches") ?? 10));
const ENEMY = args.get("enemy") ?? "boar";
const ROOM = ENEMY === "wolf" ? 18 : 15;
const NAME = "pve-a";
const PASSWORD = "pve-pass";
const OUT = join(process.cwd(), "local", "pve", `${ENEMY}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});

const KIT = [
  ["practice-sword", "practice sword", "wield"],
  ["practice-shield", "practice shield", "wear"],
];
const makeWorldPath = (dir) => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "world", "data", "world.json"), "utf8"));
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
      id: `pve-${templateId}`,
      name: `a ${label}`,
      room: ROOM,
      home: ROOM,
      forSale: false,
      action,
      label,
    });
  }
  const path = join(dir, "world.json");
  writeFileSync(path, JSON.stringify(raw));
  return path;
};

const makeState = (world) => {
  const channels = loadChannels();
  const levels = loadLevels();
  const quests = loadQuests();
  const state = initialState(world.rooms, world.npcs, world.objects, ROOM, world.climate, channels.channels, levels.levels, quests.quests);
  const { salt, hash } = hashPassword(PASSWORD);
  state.accounts[NAME] = {
    kind: "legacy", name: NAME, characters: [NAME], passwordHash: hash, salt,
    tokenHash: null, retired: false, mergedInto: null,
  };
  state.identities[NAME] = {
    kind: "character", owner: NAME, name: NAME, role: 0, level: LEVEL, xp: 0,
    gold: 0, guild: null, guildRank: null, quests: { active: [], completed: [] },
    spellbook: [], maxMana: 3 + LEVEL * 2, questCycles: {}, ignored: [],
    title: null, memory: { facts: {} }, duelWins: 0, duelLosses: 0, duelRating: 1000,
  };
  const enemy = state.npcs.find((npc) => npc.id === ENEMY);
  if (!enemy) throw new Error(`missing enemy ${ENEMY}`);
  // The temp world adds practice gear, so its hash no longer matches the
  // generated pacing candidate. Apply the current enemy fields explicitly so
  // the sample uses what production actually serves.
  try {
    const pacing = JSON.parse(readFileSync(join(process.cwd(), "world", "data", "generated", "pacing.json"), "utf8"));
    for (const change of pacing.changes ?? []) {
      if (change.collection !== "npcs" || change.target !== ENEMY) continue;
      if (change.field === "hp") { enemy.hp = change.to; enemy.maxHp = change.to; }
      if (change.field === "damage") enemy.damage = change.to;
    }
  } catch {}
  enemy.period = 100_000;
  enemy.jitter = 0;
  enemy.clock = { period: 100_000, remaining: 100_000 };
  enemy.room = ROOM;
  enemy.home = ROOM;
  enemy.dead = false;
  enemy.hp = enemy.maxHp;
  state.tick = Math.floor(Math.random() * 1_000_000);
  return state;
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
        await wait(50);
      }
      throw new Error(`timeout waiting for ${pattern}; tail=${JSON.stringify(text.slice(-900))}`);
    },
    close: () => ws.close(),
  };
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
  let client;
  try {
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${webPort}/health`)).ok) break;
      } catch {}
      await wait(100);
    }
    client = await connect(`ws://127.0.0.1:${webPort}/`);
    client.send(`login ${NAME} ${PASSWORD}`);
    await client.expect("Signing in as pve-a.");
    await client.expect(`[${ENEMY === "boar" ? "The Forest Edge" : "The Deep Forest"}]`);
    client.send("take all");
    await client.expect("You take");
    client.send("wield practice sword");
    await client.expect("You wield");
    client.send("wear practice shield");
    await client.expect("You wear");
    client.send(`attack ${ENEMY}`);
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (/a wild boar dies\.|a grey wolf dies\.|You die|You fall/.test(client.text())) break;
      await wait(100);
    }
    await wait(600);
    client.send("score");
    await client.expect("Level");
    await wait(300);
    server.kill("SIGTERM");
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); });
    const spans = readFileSync(join(dir, "spans.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const session = spans.find((span) => span.name === "world.session" && span["actor.name"] === NAME);
    const playerId = session?.["actor.id"];
    const combats = spans.filter((span) => span.name === "world.combat"
      && [playerId, ENEMY].includes(span["actor.id"])
      && [playerId, ENEMY].includes(span["target.id"]));
    const playerAttacks = combats.filter((span) => span["actor.id"] === playerId);
    const enemyAttacks = combats.filter((span) => span["actor.id"] === ENEMY);
    const hits = (rows) => rows.filter((span) => span.outcome !== "miss");
    const damage = (rows) => hits(rows).reduce((sum, span) => sum + (Number(span.damage) || 0), 0);
    const text = client.text();
    const winner = /You die|You fall/.test(text) ? "enemy" : "player";
    const stateLine = [...text.matchAll(/^#state (.*)$/gm)].pop();
    let finalState = null;
    try { finalState = JSON.parse(stateLine?.[1] ?? "null"); } catch {}
    const result = {
      match: matchNumber,
      enemy: ENEMY,
      startTick: state.tick,
      winner,
      rounds: Math.max(playerAttacks.length, enemyAttacks.length),
      player: { attacks: playerAttacks.length, hits: hits(playerAttacks).length, damage: damage(playerAttacks), hp: finalState?.self?.hp ?? null },
      enemyStats: { attacks: enemyAttacks.length, hits: hits(enemyAttacks).length, damage: damage(enemyAttacks), hp: finalState?.room?.npcs?.find((npc) => npc.name.includes(ENEMY))?.hp ?? null },
      maxHp: maxHpForLevel(LEVEL),
      logTail: text.slice(-400),
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    writeFileSync(join(dir, "error.txt"), `${error.message}\n\n${serverLog}\n\n${client?.text() ?? ""}`);
    throw error;
  } finally {
    client?.close();
    server.kill("SIGTERM");
    holo.close();
    await wait(300);
  }
};

const results = [];
const failures = [];
for (let match = 1; match <= MATCHES; match += 1) {
  try {
    const result = await oneMatch(match);
    results.push(result);
    console.log(`${match}/${MATCHES} ${result.winner} wins in ${result.rounds} rounds · player ${result.player.hits}/${result.player.attacks} hits · ${result.player.hp ?? "?"} hp`);
  } catch (error) {
    failures.push({ match, error: error.message });
    console.error(`${match}/${MATCHES} failed: ${error.message}`);
  }
}
const wins = results.filter((result) => result.winner === "player").length;
const summary = {
  enemy: ENEMY,
  level: LEVEL,
  matches: results.length,
  failures: failures.length,
  playerWins: wins,
  winRate: results.length ? wins / results.length : null,
  averageRounds: results.length ? results.reduce((sum, result) => sum + result.rounds, 0) / results.length : null,
  averagePlayerHp: results.length ? results.reduce((sum, result) => sum + (result.player.hp ?? 0), 0) / results.length : null,
  results,
  failureDetails: failures,
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(failures.length ? 1 : 0);
