import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await wait(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}

function player(portNumber) {
  const socket = net.connect(portNumber, "127.0.0.1");
  let text = "";
  socket.on("data", (chunk) => { text += chunk; });
  socket.on("error", () => {});
  return {
    async expect(value) {
      try {
        await until(() => text.includes(value), JSON.stringify(value));
      } catch {
        throw new Error(`timed out waiting for ${JSON.stringify(value)}; received ${JSON.stringify(text)}`);
      }
      text = text.slice(text.indexOf(value) + value.length);
    },
    send(line) { socket.write(`${line}\n`); },
    received() { return text; },
    closed: new Promise((resolve) => socket.once("close", resolve)),
    close() { socket.destroy(); },
  };
}

test("acknowledged quest progress survives process kills and checkpoint failures fail closed", {
  timeout: 60000,
}, async (t) => {
  const holoFile = process.env.MUD_HOLO;
  const runner = process.env.MUD_PRISM_CODE;
  assert.ok(Boolean(holoFile) === Boolean(runner), "set both MUD_HOLO and MUD_PRISM_CODE, or neither");
  const directory = await mkdtemp(join(tmpdir(), "mudbench-crash-"));
  const holoPort = await port();
  const webPort = await port();
  const telnetPort = await port();
  const children = new Set();
  const sockets = [];
  let stub;
  t.after(async () => {
    for (const socket of sockets) socket.close();
    for (const child of children) child.kill("SIGTERM");
    await Promise.all([...children].map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    })));
    if (stub) await new Promise((resolve) => stub.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  function start(command, args, options) {
    const child = spawn(command, args, options);
    child.output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk) => { child.output = `${child.output}${chunk}`.slice(-3000); });
    }
    children.add(child);
    child.once("exit", () => children.delete(child));
    child.once("error", (error) => { child.failure = error.message; children.delete(child); });
    return child;
  }

  if (holoFile) {
    const holo = start(runner, [
      "run", holoFile, "--host", "127.0.0.1", "--port", String(holoPort),
      "--policy", fileURLToPath(new URL("../world/policy.dev.json", import.meta.url)),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    await until(async () => {
      if (holo.failure || holo.exitCode !== null || holo.signalCode !== null) {
        throw new Error(`hologram exited: ${holo.failure ?? holo.exitCode ?? holo.signalCode}; ${holo.output}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${holoPort}/_hologram/intent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 1, name: "application.invoke", payload: "\u0001\u0005\u0005\u0000\u0000\u0000\u0000" }),
        });
        return response.ok && (await response.json()).outputs?.[0] === "admissible";
      } catch {
        return false;
      }
    }, "real hologram");
  } else {
    stub = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ outputs: ["admissible"] }));
    });
    await new Promise((resolve) => stub.listen(holoPort, "127.0.0.1", resolve));
  }

  function startWorld() {
    return start(process.execPath, ["server.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: {
        ...process.env,
        HOLO_URL: `http://127.0.0.1:${holoPort}`,
        WEB_PORT: String(webPort),
        TELNET_PORT: String(telnetPort),
        STATE_FILE: join(directory, "world.json"),
        IDENTITY_FILE: join(directory, "identities.json"),
        TRACE_FILE: join(directory, "trace.jsonl"),
        TELEMETRY_LOG: join(directory, "telemetry.jsonl"),
        COMMAND_INTERVAL_MS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  async function readyWorld(child) {
    await until(async () => {
      if (child.failure || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`world exited: ${child.failure ?? child.exitCode ?? child.signalCode}; ${child.output}`);
      }
      try {
        return (await fetch(`http://127.0.0.1:${webPort}/`)).ok;
      } catch {
        return false;
      }
    }, "world server");
  }

  async function connect() {
    const p = player(telnetPort);
    sockets.push(p);
    await p.expect("Welcome to MUDBench.");
    return p;
  }

  async function crash(child) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(child.signalCode, "SIGKILL");
  }

  let world = startWorld();
  await readyWorld(world);
  let p = await connect();
  p.send("register alice secret123");
  await p.expect("Account alice created.");
  await p.expect("#characters");
  p.send("quest accept scroll");
  await p.expect("Quest accepted: A Curled Scroll.");
  await crash(world);

  world = startWorld();
  await readyWorld(world);
  p = await connect();
  p.send("login alice secret123");
  await p.expect("Signing in as alice.");
  await p.expect("#characters");
  p.send("quest accept scroll");
  await p.expect("That quest is already active.");
  p.send("north");
  await p.expect("[The Corridor]");
  p.send("take scroll");
  await p.expect("Quest complete: A Curled Scroll.");
  await crash(world);

  world = startWorld();
  await readyWorld(world);
  p = await connect();
  p.send("login alice secret123");
  await p.expect("Signing in as alice.");
  await p.expect("#characters");
  p.send("quests");
  await p.expect("completed: A Curled Scroll");
  p.send("score");
  await p.expect("15/100 xp");
  p.send("north");
  await p.expect("[The Corridor]");
  await p.expect("a curled scroll");
  p.send("take scroll");
  await p.expect("You take a curled scroll.");
  p.send("score");
  await p.expect("15/100 xp");

  const stateFile = join(directory, "world.json");
  await rename(stateFile, `${stateFile}.saved`);
  await mkdir(stateFile);
  p.send("quest accept word");
  try {
    await until(() => world.exitCode !== null, "world exit after checkpoint failure", 5000);
  } catch {
    throw new Error(`world did not exit after checkpoint failure; received ${JSON.stringify(p.received())}; ${world.output}`);
  }
  await p.closed;
  assert.equal(world.exitCode, 1);
  assert.match(world.output, /state checkpoint failed/);
  assert.doesNotMatch(p.received(), /Quest accepted: The True Word/);
});
