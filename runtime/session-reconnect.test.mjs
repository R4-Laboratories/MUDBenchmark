import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await wait(50);
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

test("browser reconnects after a region restart without losing the player session", { timeout: 90000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mudbench-reconnect-"));
  const webPort = await port();
  const telnetPort = await port();
  const children = new Set();
  const debugSockets = [];
  t.after(async () => {
    for (const socket of debugSockets) socket.close();
    for (const child of children) child.kill("SIGTERM");
    await Promise.all([...children].map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    })));
    await wait(250);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  function start(command, args, options) {
    const child = spawn(command, args, options);
    children.add(child);
    child.once("exit", () => children.delete(child));
    child.on("error", () => {});
    return child;
  }

  function startServer() {
    return start(process.execPath, ["server.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: {
        ...process.env,
        WEB_PORT: String(webPort),
        TELNET_PORT: String(telnetPort),
        STATE_FILE: join(directory, "world.json"),
        IDENTITY_FILE: join(directory, "identities.json"),
        TRACE_FILE: join(directory, "trace.jsonl"),
        TELEMETRY_LOG: join(directory, "telemetry.jsonl"),
        COMMAND_INTERVAL_MS: "250",
      },
      stdio: "ignore",
    });
  }

  async function readyServer() {
    await until(async () => (await fetch(`http://127.0.0.1:${webPort}/`)).ok, "world server");
  }

  let server = startServer();
  await readyServer();
  const profile = join(directory, "chrome");
  const chrome = start(process.env.CHROME_BIN ?? "google-chrome", [
    "--headless=new", "--disable-gpu", "--disable-background-networking",
    "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  const debugPort = await until(async () => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) throw new Error("browser exited");
    return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
  }, "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const debugSocket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  debugSockets.push(debugSocket);
  await new Promise((resolve, reject) => { debugSocket.once("open", resolve); debugSocket.once("error", reject); });
  const send = devtools(debugSocket);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const expect = async (expression, label) => {
    try {
      return await until(() => evaluate(expression), label);
    } catch (error) {
      const log = await evaluate('document.querySelector("#log")?.textContent.slice(-3000)');
      throw new Error(`${error.message}; browser log: ${log}`);
    }
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: 'window.WebSocket = class extends WebSocket { constructor(...args) { super(...args); window.testSocket = this; } };',
  });
  await send("Page.navigate", { url: `http://127.0.0.1:${webPort}/` });
  await expect('document.querySelector("#state")?.textContent === "connected"', "initial connection");

  await evaluate('document.querySelector("#name").value = "alice"; document.querySelector("#password").value = "secret123"; document.querySelector("#register").click()');
  await expect('!document.querySelector("#cmd").disabled && document.querySelector("#signed-name").textContent === "alice"', "legacy registration");
  await expect('document.querySelector("#character-list").textContent.includes("alice")', "legacy character list");
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await expect('document.querySelector("#state").textContent !== "connected"', "legacy disconnect");
  server = startServer();
  await readyServer();
  await expect('document.querySelector("#state").textContent === "connected"', "legacy reconnect");
  await expect('getComputedStyle(document.querySelector("#account")).display !== "none"', "legacy login form after reconnect");
  await evaluate('document.querySelector("#password").value = "secret123"; document.querySelector("#login").click()');
  await expect('!document.querySelector("#cmd").disabled && document.querySelector("#signed-name").textContent === "alice"', "legacy login after restart");

  await evaluate('document.querySelector("#sign-out").click()');
  await expect('document.querySelector("#state").textContent !== "connected"', "sign-out disconnect");
  await expect('document.querySelector("#state").textContent === "connected" && getComputedStyle(document.querySelector("#account")).display !== "none"', "sign-out reconnect");
  await evaluate('document.querySelector("#prism-login").click()');
  await expect('!document.querySelector("#characters").hidden', "Prism account");
  await wait(300);
  await evaluate('document.querySelector("#new-character").value = "bob"; document.querySelector("#create-character-form").requestSubmit()');
  await expect('!document.querySelector("#cmd").disabled && document.querySelector("#signed-name").textContent === "bob"', "Prism character");
  await wait(300);
  await evaluate('document.querySelector("#cmd").value = "quest accept scroll"; document.querySelector("#entry").requestSubmit()');
  await expect('document.querySelector("#log").textContent.includes("Quest accepted: A Curled Scroll.")', "quest progress");

  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await expect('document.querySelector("#state").textContent !== "connected"', "Prism disconnect");
  server = startServer();
  await readyServer();
  await expect('!document.querySelector("#cmd").disabled && document.querySelector("#signed-name").textContent === "bob"', "Prism character resume");
  await wait(300);
  await evaluate('document.querySelector("#cmd").value = "quests"; document.querySelector("#entry").requestSubmit()');
  await expect('document.querySelector("#log").textContent.includes("active: A Curled Scroll")', "quest after restart");

  const otherTab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
  const otherSocket = new WebSocket(otherTab.webSocketDebuggerUrl);
  debugSockets.push(otherSocket);
  await new Promise((resolve, reject) => { otherSocket.once("open", resolve); otherSocket.once("error", reject); });
  const otherSend = devtools(otherSocket);
  const otherEvaluate = async (expression) => {
    const result = await otherSend("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await otherSend("Page.navigate", { url: `http://127.0.0.1:${webPort}/` });
  await until(() => otherEvaluate('document.querySelector("#state")?.textContent === "connected"'), "second tab connection");
  await otherEvaluate('document.querySelector("#prism-login").click()');
  await until(() => otherEvaluate('!document.querySelector("#characters").hidden'), "second tab Prism account");
  await wait(300);
  await evaluate("window.testSocket.close()");
  await otherEvaluate('document.querySelector("#character-list button").click()');
  await until(() => otherEvaluate('!document.querySelector("#cmd").disabled && document.querySelector("#signed-name").textContent === "bob"'), "second tab controls character");
  await expect('document.querySelector("#log").textContent.includes("bob is already active elsewhere")', "safe resume refusal");
  assert.equal(await evaluate('document.querySelector("#cmd").disabled'), true);
  assert.equal(await otherEvaluate('document.querySelector("#cmd").disabled'), false);
  await otherSend("Page.close");
  await until(async () => !(await (await fetch(`http://127.0.0.1:${webPort}/world`)).json()).actors.some((actor) => actor.name === "bob"), "second tab disconnect");
  await wait(300);
  await evaluate('document.querySelector("#character-list button").click()');
  await expect('!document.querySelector("#cmd").disabled && document.querySelector("#signed-name").textContent === "bob"', "manual character takeover");
  await wait(300);
  await evaluate('document.querySelector("#quit").click(); window.testSocket.close()');
  await expect('document.querySelector("#state").textContent !== "connected"', "disconnect during quit");
  await expect('document.querySelector("#state").textContent === "connected" && !document.querySelector("#characters").hidden', "account reconnect after interrupted quit");
  assert.equal(await evaluate('document.querySelector("#cmd").disabled'), true);
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await expect('document.querySelector("#state").textContent !== "connected"', "disconnect after quit");
  server = startServer();
  await readyServer();
  await expect('document.querySelector("#state").textContent === "connected" && !document.querySelector("#characters").hidden', "account reconnect after quit");
  assert.equal(await evaluate('document.querySelector("#cmd").disabled'), true);
});
