import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { federationConfig, rulesFingerprint } from "./federation.mjs";
import { loadStateFile, saveStateFile } from "./state.mjs";

const SECRET = "a".repeat(40);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}

async function until(check, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await wait(50);
  }
  throw new Error("timed out waiting for condition");
}

function player(portNumber) {
  const socket = net.connect(portNumber, "127.0.0.1");
  let text = "";
  socket.on("data", (chunk) => { text += chunk; });
  socket.on("error", () => {});
  return {
    async expect(value) {
      try {
        await until(() => text.includes(value));
      } catch {
        throw new Error(`timed out waiting for ${JSON.stringify(value)}; received ${JSON.stringify(text)}`);
      }
    },
    send(line) { socket.write(`${line}\n`); },
    close() { socket.destroy(); },
  };
}

test("federation requires HTTPS except for loopback", () => {
  assert.throws(() => federationConfig({
    MUD_REGION_ID: "west",
    MUD_REGION_PEERS: JSON.stringify({ east: { url: "http://example.org", secret: SECRET } }),
  }), /HTTPS/);
  assert.throws(() => federationConfig({
    MUD_REGION_ID: "west",
    MUD_REGION_PEERS: "{}",
    MUD_REGION_RULES: "different",
  }), /do not match/);
});

test("federation refuses to roll back to an older state backup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mud-region-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "world.json");
  saveStateFile(file, { transfer: "active" });
  saveStateFile(file, { transfer: "outgoing" });
  await writeFile(file, "{");
  assert.throws(() => loadStateFile(file, { initial: () => ({}), restore: (state) => state, allowBackup: false }), /unreadable/);
  await rm(file);
  assert.throws(() => loadStateFile(file, { initial: () => ({}), restore: (state) => state, allowBackup: false }), /missing/);
});

test("two live servers transfer a character and retain separate authority", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mud-regions-"));
  const keys = {};
  for (const region of ["west", "east"]) {
    const pair = generateKeyPairSync("ed25519");
    keys[region] = {
      privatePath: join(directory, `${region}.pem`),
      privateKey: pair.privateKey,
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
    };
    await writeFile(keys[region].privatePath, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  }
  const ports = { westWeb: await port(), eastWeb: await port(), westTelnet: await port(), eastTelnet: await port() };
  const children = new Set();
  const sockets = [];
  const holo = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const kind = JSON.parse(body).payload.charCodeAt(0);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ outputs: [kind === 1 ? "admissible" : kind === 6 ? "cleared" : "invalid request"] }));
    });
  });
  await new Promise((resolve) => holo.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.close();
    for (const child of children) child.kill("SIGTERM");
    await Promise.all([...children].map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    })));
    await new Promise((resolve) => holo.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  function start(region) {
    const other = region === "west" ? "east" : "west";
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: {
        ...process.env,
        MUD_REGION_ID: region,
        MUD_REGION_PEERS: JSON.stringify({ [other]: {
          url: `http://127.0.0.1:${ports[`${other}Web`]}`, secret: SECRET, publicKey: keys[other].publicKey,
        } }),
        MUD_REGION_RULES: rulesFingerprint(),
        MUD_REGION_SIGNING_KEY_FILE: keys[region].privatePath,
        MUD_REGION_ALLOWED_SKILLS: JSON.stringify(region === "east"
          ? ["mend"] : ["spark", "mend", "light", "shield", "detect", "recall"]),
        TELNET_PORT: String(ports[`${region}Telnet`]),
        WEB_PORT: String(ports[`${region}Web`]),
        STATE_FILE: join(directory, `${region}.json`),
        IDENTITY_FILE: join(directory, `${region}-identity.json`),
        TRACE_FILE: join(directory, `${region}-trace.jsonl`),
        TELEMETRY_LOG: join(directory, `${region}-telemetry.jsonl`),
        HOLO_URL: `http://127.0.0.1:${holo.address().port}`,
        COMMAND_INTERVAL_MS: "0",
      },
      stdio: "ignore",
    });
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  }

  async function ready(region, from) {
    return until(async () => {
      const response = await fetch(`http://127.0.0.1:${ports[`${region}Web`]}/federation/status`, {
        headers: { authorization: `Bearer ${SECRET}`, "x-mud-region": from },
      });
      return response.ok && (await response.json()).region === region;
    });
  }

  let east = start("east");
  let west = start("west");
  await Promise.all([ready("west", "east"), ready("east", "west")]);
  const demo = await fetch(`http://127.0.0.1:${ports.westWeb}/api/demo`);
  assert.equal(demo.status, 200);
  assert.equal(typeof (await demo.json()).configured, "boolean");
  const denied = await fetch(`http://127.0.0.1:${ports.eastWeb}/federation/status`);
  assert.equal(denied.status, 403);
  const prototypePeer = await fetch(`http://127.0.0.1:${ports.eastWeb}/federation/status`, {
    headers: { authorization: `Bearer ${SECRET}`, "x-mud-region": "constructor" },
  });
  assert.equal(prototypePeer.status, 403);

  let p = player(ports.westTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("register alice secret123");
  await p.expect("Account alice created.");
  await p.expect("#characters");
  p.close();
  west.kill("SIGTERM");
  await new Promise((resolve) => west.once("exit", resolve));
  const westFile = join(directory, "west.json");
  const saved = JSON.parse(await readFile(westFile, "utf8"));
  saved.identities.alice.xp = 123;
  saved.identities.alice.level = 2;
  saved.identities.alice.spellbook = ["spark"];
  await writeFile(westFile, JSON.stringify(saved));
  west = start("west");
  await ready("west", "east");

  p = player(ports.westTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("#characters");
  p.send("take cloak");
  await p.expect("You take a grey cloak.");
  p.send("travel east");
  await p.expect("Transferred to east.");

  const westAfter = JSON.parse(await readFile(westFile, "utf8"));
  const eastAfter = JSON.parse(await readFile(join(directory, "east.json"), "utf8"));
  assert.equal(westAfter.accounts.alice.federation.status, "away");
  assert.equal(eastAfter.accounts.alice.federation.status, "active");
  assert.equal(eastAfter.identities.alice.xp, 123);
  assert.equal(eastAfter.identities.alice.level, 2);
  assert.deepEqual(eastAfter.identities.alice.spellbook, []);
  assert.deepEqual(eastAfter.identities.alice.unrecognizedSkills, ["spark"]);
  const proof = eastAfter.identities.alice.federationProof;
  assert.equal(verify(null, Buffer.from(JSON.stringify(proof.claim)), keys.west.publicKey,
    Buffer.from(proof.signature, "base64url")), true);
  assert.equal(westAfter.objects.find((object) => object.id === "cloak").holder, null);
  assert.equal(westAfter.objects.find((object) => object.id === "cloak").room, 1);
  assert.equal(eastAfter.objects.find((object) => object.id === "cloak").holder, null);

  const oldTransfer = {
    claim: proof.claim,
    signature: proof.signature,
    account: westAfter.accounts.alice,
  };
  const submit = (body) => fetch(`http://127.0.0.1:${ports.eastWeb}/federation/transfer`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "x-mud-region": "west", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await submit({ ...oldTransfer, claim: { ...oldTransfer.claim, rules: "incompatible" } })).status, 409);
  assert.equal((await submit({
    ...oldTransfer,
    claim: { ...oldTransfer.claim, character: { ...oldTransfer.claim.character, spellbook: ["recall"] } },
  })).status, 409);
  const invalidClaim = {
    ...oldTransfer.claim,
    character: { ...oldTransfer.claim.character, spellbook: ["unknown-skill"] },
  };
  assert.equal((await submit({
    ...oldTransfer,
    claim: invalidClaim,
    signature: sign(null, Buffer.from(JSON.stringify(invalidClaim)), keys.west.privateKey).toString("base64url"),
  })).status, 409);

  west.kill("SIGTERM");
  await new Promise((resolve) => west.once("exit", resolve));
  const uncertain = JSON.parse(await readFile(westFile, "utf8"));
  uncertain.accounts.alice.federation.status = "outgoing";
  uncertain.accounts.alice.federation.character = proof.claim.character;
  await writeFile(westFile, JSON.stringify(uncertain));
  west = start("west");
  await ready("west", "east");
  const retry = player(ports.westTelnet);
  sockets.push(retry);
  await retry.expect("Welcome to MUDBench.");
  retry.send("login alice secret123");
  await retry.expect("Transferred to east.");
  assert.equal(JSON.parse(await readFile(westFile, "utf8")).accounts.alice.federation.status, "away");

  const stale = player(ports.westTelnet);
  sockets.push(stale);
  await stale.expect("Welcome to MUDBench.");
  stale.send("login alice secret123");
  await stale.expect("Your character is in east.");

  p = player(ports.eastTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("#characters");
  await p.expect("Skills not recognized here: spark.");
  p.send("cast spark");
  await p.expect("Spark is not recognized in this region.");
  p.send("travel west");
  await p.expect("Transferred to west.");
  const returned = JSON.parse(await readFile(westFile, "utf8")).identities.alice;
  assert.equal(returned.xp, 123);
  assert.deepEqual(returned.spellbook, ["spark"]);
  assert.deepEqual(returned.unrecognizedSkills, []);
  assert.equal((await submit(oldTransfer)).status, 409);
  assert.equal(JSON.parse(await readFile(join(directory, "east.json"), "utf8")).accounts.alice.federation.status, "away");

  east.kill("SIGTERM");
  await new Promise((resolve) => east.once("exit", resolve));
  p = player(ports.westTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("#characters");
  p.send("travel east");
  await p.expect("Cannot transfer:");
  p.send("quest accept scroll");
  await p.expect("Quest accepted: A Curled Scroll.");
  west.kill("SIGKILL");
  await new Promise((resolve) => west.once("exit", resolve));
  const afterAcceptance = JSON.parse(await readFile(westFile, "utf8"));
  assert.ok(afterAcceptance.identities.alice.quests.active.some((quest) => quest.id === "scroll"));
  west = start("west");
  await ready("west", "east");
  p = player(ports.westTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("#characters");
  p.send("north");
  await p.expect("\r\n[The Corridor]\r\n");
  p.send("take scroll");
  await p.expect("Quest complete: A Curled Scroll.");
  west.kill("SIGKILL");
  await new Promise((resolve) => west.once("exit", resolve));
  const afterCrash = JSON.parse(await readFile(westFile, "utf8"));
  assert.equal(afterCrash.identities.alice.xp, 138);
  assert.ok(afterCrash.identities.alice.quests.completed.includes("scroll"));

  west = start("west");
  await ready("west", "east");
  p = player(ports.westTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("#characters");
  p.send("score");
  await p.expect("138/300 xp");
  east = start("east");
  await ready("east", "west");
  p.send("travel east");
  await p.expect("Transferred to east.");
  const recoveredWest = JSON.parse(await readFile(westFile, "utf8"));
  const recoveredEast = JSON.parse(await readFile(join(directory, "east.json"), "utf8"));
  assert.equal(recoveredEast.identities.alice.xp, 138);
  assert.ok(recoveredEast.identities.alice.quests.completed.includes("scroll"));
  assert.equal(recoveredWest.accounts.alice.federation.status, "away");
  assert.equal(recoveredEast.accounts.alice.federation.status, "active");
  assert.equal(recoveredWest.objects.find((object) => object.id === "scroll").room, 2);
  assert.equal(recoveredEast.objects.find((object) => object.id === "scroll").room, 2);
  p = player(ports.eastTelnet);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send("login alice secret123");
  await p.expect("#characters");
  p.send("score");
  await p.expect("138/300 xp");
  p.send("quests");
  await p.expect("completed: A Curled Scroll");
});
