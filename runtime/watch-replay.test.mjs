import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await wait(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function port() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const result = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return result;
}

function devtools(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return async (method, params = {}) => {
    const id = ++nextId;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params }));
    return response;
  };
}

test("a finished stream is archived and can be replayed in /watch", { timeout: 90000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mudbench-watch-replay-"));
  const webPort = await port();
  const telnetPort = await port();
  const children = new Set();
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.close();
    for (const child of children) child.kill("SIGTERM");
    await Promise.all([...children].map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    })));
    await wait(250);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const archiveFile = join(directory, "stream-archive.json");
  function startServer() {
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: {
        ...process.env,
        WEB_PORT: String(webPort),
        TELNET_PORT: String(telnetPort),
        STATE_FILE: join(directory, "world.json"),
        STREAM_ARCHIVE_FILE: archiveFile,
        IDENTITY_FILE: join(directory, "identities.json"),
        TRACE_FILE: join(directory, "trace.jsonl"),
        TELEMETRY_LOG: join(directory, "telemetry.jsonl"),
        COMMAND_INTERVAL_MS: "0",
        SIGNUP_MODE: "open",
      },
      stdio: "ignore",
    });
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  }
  let server = startServer();
  await until(() => fetch(`http://127.0.0.1:${webPort}/health`).then((response) => response.ok), "world server");

  const streamer = new WebSocket(`ws://127.0.0.1:${webPort}/`);
  sockets.push(streamer);
  let text = "";
  streamer.on("message", (data) => { text += String(data); });
  await new Promise((resolve, reject) => { streamer.once("open", resolve); streamer.once("error", reject); });
  const expect = (needle) => until(() => text.includes(needle), needle);

  streamer.send("register replayuser secret123\n");
  await expect("Characters: replayuser");
  streamer.send("stream on\n");
  await expect("Public stream on: /watch");
  const events = [
    { kind: "meta", character: "replayuser", model: "test-model", goal: "Explorer" },
    { kind: "command", text: "look", turn: 1, tick: 1 },
    { kind: "decision", text: "I will inspect the room before moving.", command: "look", room: "The Atrium", turn: 1, tick: 1 },
    { kind: "state", hp: 20, maxHp: 20, mana: 5, maxMana: 5, level: 1, xp: 0, nextXp: 100, room: "The Atrium", zone: "temple", tick: 1, turn: 1 },
    { kind: "stats", turn: 1, commands: 1, latencyMs: 120, tokensIn: 10, tokensOut: 20, provider: "test", model: "test-model", timeouts: 0, invalid: 0, loops: 0, tick: 1 },
    { kind: "highlight", text: "A rat arrives.", turn: 1, tick: 1 },
    { kind: "text", text: "[The Atrium]\nA cold marble hall.", turn: 1, tick: 1 },
  ];
  for (const event of events) {
    streamer.send(`stream event ${JSON.stringify(event)}\n`);
    await wait(30);
  }
  streamer.send("stream off\n");
  await expect("Public stream off.");

  const directoryResponse = await (await fetch(`http://127.0.0.1:${webPort}/stream`)).json();
  const run = directoryResponse.recent?.[0];
  assert.ok(run?.id, "the recent run has no id");
  assert.equal(run.hasReplay, true);
  assert.equal(run.archivedEvents, events.length);
  assert.equal(Object.hasOwn(run, "events"), false, "the directory leaked archive events");
  const archiveResponse = await fetch(`http://127.0.0.1:${webPort}/stream?run=${encodeURIComponent(run.id)}`);
  assert.equal(archiveResponse.status, 200);
  const archive = await archiveResponse.json();
  assert.equal(archive.run?.events?.length, events.length);
  assert.deepEqual(archive.run.events.map((event) => event.kind), events.map((event) => event.kind));
  assert.equal((await fetch(`http://127.0.0.1:${webPort}/stream?run=missing`)).status, 404);
  const savedArchive = JSON.parse(await readFile(archiveFile, "utf8"));
  assert.equal(savedArchive.runs?.[0]?.id, run.id);
  assert.equal(savedArchive.runs?.[0]?.events?.length, events.length);

  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  server = startServer();
  await until(() => fetch(`http://127.0.0.1:${webPort}/health`).then((response) => response.ok), "restarted world server");
  const restored = await (await fetch(`http://127.0.0.1:${webPort}/stream`)).json();
  assert.equal(restored.recent?.[0]?.id, run.id, "the restart lost the archived run");
  assert.equal(restored.recent?.[0]?.hasReplay, true);
  const restoredArchive = await (await fetch(`http://127.0.0.1:${webPort}/stream?run=${encodeURIComponent(run.id)}`)).json();
  assert.equal(restoredArchive.run?.events?.length, events.length);

  const chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-networking", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${join(directory, "chrome")}`, "about:blank",
  ], { stdio: "ignore" });
  children.add(chrome);
  const debugPort = await until(async () => {
    const value = Number((await readFile(join(directory, "chrome", "DevToolsActivePort"), "utf8")).split("\n")[0]);
    return value > 0 ? value : null;
  }, "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const debugSocket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  sockets.push(debugSocket);
  await new Promise((resolve, reject) => { debugSocket.once("open", resolve); debugSocket.once("error", reject); });
  const send = devtools(debugSocket);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${webPort}/watch` });
  await until(() => evaluate('[...document.querySelectorAll(".agent-card")].some((card) => card.textContent.includes("replayuser"))'), "recent run card");
  await evaluate('[...document.querySelectorAll(".agent-card")].find((card) => card.textContent.includes("replayuser")).click()');
  await until(() => evaluate('[...document.querySelectorAll(".archive-card button")].some((button) => button.textContent.includes("Replay decisions"))'), "replay button");
  await evaluate('[...document.querySelectorAll(".archive-card button")].find((button) => button.textContent.includes("Replay decisions")).click()');
  await until(() => evaluate('document.querySelector(".replay-status")?.textContent === "0 / 7"'), "replay controls");
  for (let index = 0; index < 3; index += 1) {
    await evaluate('document.querySelectorAll(".replay-controls button")[2].click()');
    await wait(150);
  }
  const replay = await evaluate(`({
    title: document.querySelector(".archive-card h2")?.textContent,
    status: document.querySelector(".replay-status")?.textContent,
    decision: document.querySelector(".replay-feed .decision-card .body")?.textContent,
    command: document.querySelector(".replay-feed .line.cmd")?.textContent,
  })`);
  assert.match(replay.title ?? "", /^Replay: replayuser/);
  assert.equal(replay.status, "3 / 7");
  assert.equal(replay.decision, "I will inspect the room before moving.");
  assert.equal(replay.command, "> look");
});
