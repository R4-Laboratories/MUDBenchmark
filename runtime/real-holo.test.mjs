import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function port() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const result = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return result;
}

async function until(check, label, timeout = 15000, child = null) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child && (child.failure || child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`${label} exited: ${child.failure ?? child.exitCode ?? child.signalCode}; ${child.output}`);
    }
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await wait(50);
  }
  throw new Error(`timed out waiting for ${label}${child?.output ? `; ${child.output}` : ""}`);
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
    close() { socket.destroy(); },
  };
}

const holoFile = process.env.MUD_HOLO;
const runner = process.env.MUD_PRISM_CODE;
test("a real hologram admits gameplay and a quest survives restart", {
  timeout: 60000,
  skip: !holoFile && !runner ? "set MUD_HOLO and MUD_PRISM_CODE to run the real-hologram test" : false,
}, async (t) => {
  assert.ok(holoFile && runner, "set MUD_HOLO and MUD_PRISM_CODE to the hologram and prism-code executable");
  const directory = await mkdtemp(join(tmpdir(), "mudbench-real-holo-"));
  const holoPort = await port();
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

  function startHolo() {
    return start(runner, [
      "run", holoFile, "--host", "127.0.0.1", "--port", String(holoPort),
      "--policy", fileURLToPath(new URL("../world/policy.dev.json", import.meta.url)),
    ], { stdio: ["ignore", "pipe", "pipe"] });
  }

  async function invoke(payload) {
    const response = await fetch(`http://127.0.0.1:${holoPort}/_hologram/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, name: "application.invoke", payload }),
    });
    if (!response.ok) throw new Error(`hologram returned ${response.status}`);
    return (await response.json()).outputs?.[0];
  }

  async function readyHolo(child) {
    await until(async () => await invoke("\u0001\u0005\u0005\u0000\u0000\u0000\u0000") === "admissible",
      "real hologram", 15000, child);
  }

  let holo = startHolo();
  await readyHolo(holo);
  assert.equal(await invoke("\u0001\u0002\u0001\u0003\u0000\u0000\u0000"), "refused");
  assert.equal(await invoke("\u0001"), "invalid request");

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
    await until(async () => (await fetch(`http://127.0.0.1:${webPort}/`)).ok, "world server", 15000, child);
  }

  let world = startWorld();
  await readyWorld(world);
  let p = player(telnetPort);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("register alice secret123");
  await p.expect("Account alice created.");
  await p.expect("#characters");
  p.send("quest accept scroll");
  await p.expect("Quest accepted: A Curled Scroll.");
  p.send("quest accept scroll");
  await p.expect("That quest is already active.");
  p.send("north");
  await p.expect("[The Corridor]");
  p.send("take scroll");
  await p.expect("Quest complete: A Curled Scroll.");
  p.send("score");
  await p.expect("15/100 xp");

  world.kill("SIGTERM");
  await new Promise((resolve) => world.once("exit", resolve));
  world = startWorld();
  await readyWorld(world);
  p = player(telnetPort);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("Signing in as alice.");
  await p.expect("#characters");
  p.send("quests");
  await p.expect("completed: A Curled Scroll");
  p.send("quest accept scroll");
  await p.expect("That quest is already complete.");
  const other = player(telnetPort);
  sockets.push(other);
  await other.expect("Welcome to MUDBench.");
  other.send("login alice incorrect");
  await other.expect("That name and password do not match.");
  other.close();
  p.send("score");
  await p.expect("15/100 xp");
  p.send("north");
  await p.expect("[The Corridor]");
  await p.expect("a curled scroll");
  p.send("take scroll");
  await p.expect("You take a curled scroll.");
  p.send("score");
  await p.expect("15/100 xp");
  p.send("west");
  await p.expect("You cannot go west.");
  holo.kill("SIGTERM");
  await new Promise((resolve) => holo.once("exit", resolve));
  p.send("south");
  await p.expect("error:");
  p.send("look");
  await p.expect("[The Corridor]");
  p.send("score");
  await p.expect("15/100 xp");
  holo = startHolo();
  await readyHolo(holo);
  p.send("south");
  await p.expect("[The Atrium]");
});
