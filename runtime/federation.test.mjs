import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "./node_modules/ws/index.js";
import { createDevice, createPrism, signAction } from "./web/prism-id.mjs";
import { federationConfig, rulesFingerprint, skillAllowed, verifyTravelGrant } from "./federation.mjs";
import { scrollTargetName } from "./magic.mjs";
import { loadStateFile, saveStateFile } from "./state.mjs";

const SECRET = "a".repeat(40);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64u = (value) => Buffer.from(value instanceof Uint8Array ? value : typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

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

async function loginSession(session, origin) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", keys.publicKey);
  const now = Date.now();
  const envelope = await signAction(session, "prism/session/1", { sessionKey: b64u(new Uint8Array(raw)), expires: now + 600000 }, { audience: origin, now });
  return { session, keys, token: b64u({ app: origin, envelope, records: [...session.log.values()] }) };
}

async function grantFor(login, character, region, audience, transferId = crypto.randomUUID()) {
  const envelope = await signAction(login.session, "mudbenchmark/region-travel/1", { character, region, audience, transferId }, { audience, now: Date.now() });
  return { envelope, records: [...login.session.log.values()] };
}

function player(portNumber, origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${portNumber}/`, { origin });
  let text = "";
  let cursor = 0;
  socket.on("message", (chunk) => { text += String(chunk); });
  socket.on("error", () => {});
  return {
    socket,
    text: () => text,
    async expect(value, timeout = 15000) {
      try {
        await until(() => {
          const index = text.indexOf(value, cursor);
          if (index < 0) return false;
          cursor = index + value.length;
          return true;
        }, timeout);
      } catch {
        throw new Error(`timed out waiting for ${JSON.stringify(value)}; received ${JSON.stringify(text.slice(-2000))}`);
      }
    },
    async challenge(login) {
      const match = await until(() => text.match(/#challenge ([\w-]+)/));
      const nonce = match[1];
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        login.keys.privateKey,
        new TextEncoder().encode(`prism/session-key/1 ${nonce} 0`),
      );
      this.send(`session-key 0 ${b64u(new Uint8Array(signature))}`);
      await this.expect("#characters");
    },
    send(line) { socket.send(`${line}\n`); },
    close() { socket.close(); },
  };
}

test("federation requires HTTPS except for loopback and an exact rules fingerprint", async () => {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => federationConfig({
    MUD_REGION_ID: "west",
    MUD_REGION_ORIGIN: "http://example.org",
    MUD_REGION_PEERS: JSON.stringify({ east: { url: "https://east.example", secret: SECRET, publicKey } }),
    MUD_REGION_RULES: rulesFingerprint(),
    MUD_REGION_SIGNING_KEY_FILE: "/nonexistent",
  }), /origin.*HTTPS|HTTPS/);
  assert.throws(() => federationConfig({
    MUD_REGION_ID: "west",
    MUD_REGION_ORIGIN: "http://127.0.0.1:9000",
    MUD_REGION_PEERS: JSON.stringify({ east: { url: "https://east.example", secret: SECRET, publicKey } }),
    MUD_REGION_RULES: "different",
    MUD_REGION_SIGNING_KEY_FILE: "/nonexistent",
  }), /do not match/);
});

test("a Prism travel grant names its region, character and audience", async () => {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  const directory = await mkdtemp(join(tmpdir(), "mud-grant-"));
  const keyFile = join(directory, "region.pem");
  await writeFile(keyFile, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const config = federationConfig({
    MUD_REGION_ID: "west",
    MUD_REGION_ORIGIN: "http://127.0.0.1:9000",
    MUD_REGION_PEERS: JSON.stringify({ east: { url: "http://127.0.0.1:9001", secret: SECRET, publicKey } }),
    MUD_REGION_RULES: rulesFingerprint(),
    MUD_REGION_SIGNING_KEY_FILE: keyFile,
  });
  const device = await createDevice({ deviceClass: "browser", protection: "software" });
  const session = await createPrism(device);
  const login = await loginSession(session, "http://127.0.0.1:9001");
  const grant = await grantFor(login, "alice", "east", "http://127.0.0.1:9001");
  const transferId = grant.envelope.body.payload.transferId;
  const verdict = await verifyTravelGrant(config, grant, {
    destinationOrigin: "http://127.0.0.1:9001",
    expected: { character: "alice", region: "east", transferId },
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.prism, session.prism);
  const wrong = await verifyTravelGrant(config, grant, {
    destinationOrigin: "http://127.0.0.1:9001",
    expected: { character: "bob", region: "east", transferId },
  });
  assert.equal(wrong.ok, false);
  assert.equal(skillAllowed(config, "spark"), true);
  const restricted = federationConfig({
    MUD_REGION_ID: "west",
    MUD_REGION_ORIGIN: "http://127.0.0.1:9000",
    MUD_REGION_PEERS: JSON.stringify({ east: { url: "http://127.0.0.1:9001", secret: SECRET, publicKey } }),
    MUD_REGION_RULES: rulesFingerprint(),
    MUD_REGION_SIGNING_KEY_FILE: keyFile,
    MUD_REGION_ALLOWED_SKILLS: JSON.stringify(["mend"]),
  });
  assert.equal(skillAllowed(restricted, "spark"), false);
  assert.equal(scrollTargetName(["recite", "a", "scroll", "of", "spark", "on", "a", "bard"], 5), "a bard");
  assert.equal(scrollTargetName(["recite", "a", "scroll", "of", "spark", "a", "bard"], -1), "a scroll of spark a bard");
  await rm(directory, { recursive: true, force: true });
});

test("two regions hand off a Prism character without passwords", { timeout: 90000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mud-prism-regions-"));
  const keys = {};
  for (const region of ["west", "east"]) {
    const pair = generateKeyPairSync("ed25519");
    keys[region] = { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }) };
    await writeFile(join(directory, `${region}.pem`), pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  }
  const ports = { west: await port(), east: await port(), westTelnet: await port(), eastTelnet: await port() };
  const children = new Set();
  const sockets = [];
  const holo = createServer((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ outputs: ["admissible"] }));
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
    const webPort = ports[region];
    const child = spawnRegion(region, other, webPort);
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  }
  function spawnRegion(region, other, webPort) {
    return spawnServer({
      MUD_REGION_ID: region,
      MUD_REGION_ORIGIN: `http://127.0.0.1:${webPort}`,
      MUD_REGION_PEERS: JSON.stringify({ [other]: {
        url: `http://127.0.0.1:${ports[other]}`, secret: SECRET, publicKey: keys[other].publicKey,
      } }),
      MUD_REGION_RULES: rulesFingerprint(),
      MUD_REGION_SIGNING_KEY_FILE: join(directory, `${region}.pem`),
      MUD_REGION_ALLOWED_SKILLS: JSON.stringify(region === "east" ? ["mend"] : ["spark", "mend", "light", "shield", "detect", "recall"]),
      MUD_REGION_MAX_ACCOUNTS: "100",
      TELNET_PORT: String(ports[`${region}Telnet`]),
      WEB_PORT: String(webPort),
      STATE_FILE: join(directory, `${region}.json`),
      IDENTITY_FILE: join(directory, `${region}-identity.json`),
      TRACE_FILE: join(directory, `${region}-trace.jsonl`),
      TELEMETRY_LOG: join(directory, `${region}-telemetry.jsonl`),
      HOLO_URL: `http://127.0.0.1:${holo.address().port}`,
      COMMAND_INTERVAL_MS: "0",
      SIGNUP_MODE: "open",
      PRISM_ORIGINS: `http://127.0.0.1:${webPort}`,
    });
  }
  function spawnServer(env) {
    const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.once("exit", (code) => { if (code !== 0) console.log("REGION EXIT", env.MUD_REGION_ID, code, log.slice(-1000)); });
    return child;
  }
  async function ready(region, from) {
    return until(async () => {
      const response = await fetch(`http://127.0.0.1:${ports[region]}/federation/status`, {
        headers: { authorization: `Bearer ${SECRET}`, "x-mud-region": from },
      });
      return response.ok && (await response.json()).region === region;
    });
  }

  let west = start("west");
  let east = start("east");
  await Promise.all([ready("west", "east"), ready("east", "west")]);
  const denied = await fetch(`http://127.0.0.1:${ports.east}/federation/status`);
  assert.equal(denied.status, 403);

  const device = await createDevice({ deviceClass: "browser", protection: "software" });
  const prism = await createPrism(device);
  let westLogin = await loginSession(prism, `http://127.0.0.1:${ports.west}`);
  let p = player(ports.west, `http://127.0.0.1:${ports.west}`);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.", 15000);
  p.send(`prism ${westLogin.token}`);
  await p.expect("Signed in as prism:");
  await p.challenge(westLogin);
  p.send("create alice");
  await p.expect("Character alice created.");
  await p.expect("[The Atrium]");
  p.send("score");
  await p.expect("Level 1");
  p.close();

  // Give the character progression and local-only fields before travel.
  west.kill("SIGTERM");
  await new Promise((resolve) => west.once("exit", resolve));
  const westFile = join(directory, "west.json");
  const saved = JSON.parse(await readFile(westFile, "utf8"));
  const alice = saved.identities.alice;
  alice.xp = 123;
  alice.level = 2;
  alice.spellbook = ["spark"];
  alice.title = "the Remembered";
  alice.found = ["1:plaque", "2:door"];
  alice.ignored = ["bob"];
  alice.memory = { facts: { door: { word: "amber", text: "AMBER", source: "The Vault" } } };
  alice.duelWins = 2;
  alice.duelRating = 1040;
  alice.standing = { ember: 3 };
  alice.components = { iron: 2 };
  alice.role = 0;
  await writeFile(westFile, JSON.stringify(saved));
  west = start("west");
  await ready("west", "east");

  westLogin = await loginSession(prism, `http://127.0.0.1:${ports.west}`);
  p = player(ports.west, `http://127.0.0.1:${ports.west}`);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send(`prism ${westLogin.token}`);
  await p.expect("Signed in as prism:");
  await p.challenge(westLogin);
  p.send("play alice");
  await p.expect("[The Atrium]");
  await wait(300);
  p.send("score");
  await p.expect("Level");
  await p.expect("123");

  const eastLogin = await loginSession(prism, `http://127.0.0.1:${ports.east}`);
  const grant = await grantFor(westLogin, "alice", "east", `http://127.0.0.1:${ports.east}`);
  p.send(`travel east ${b64u(grant)}`);
  await p.expect("Transferred to east.");
  p.close();
  await wait(300);

  const westAfter = JSON.parse(await readFile(westFile, "utf8"));
  const eastAfter = JSON.parse(await readFile(join(directory, "east.json"), "utf8"));
  assert.equal(westAfter.accounts[prism.prism].federation.status, "away");
  assert.equal(eastAfter.accounts[prism.prism].federation.status, "active");
  assert.equal(eastAfter.accounts[prism.prism].passwordHash, undefined);
  assert.equal(eastAfter.accounts[prism.prism].salt, undefined);
  assert.equal(eastAfter.identities.alice.owner, prism.prism);
  assert.equal(eastAfter.identities.alice.xp, 123);
  assert.equal(eastAfter.identities.alice.level, 2);
  assert.deepEqual(eastAfter.identities.alice.spellbook, []);
  assert.deepEqual(eastAfter.identities.alice.unrecognizedSkills, ["spark"]);
  assert.equal(eastAfter.identities.alice.federationProof.prism, prism.prism);
  assert.equal(eastAfter.identities.alice.federationProof.claim.character.passwordHash, undefined);
  assert.equal(eastAfter.identities.alice.federationProof.claim.account, undefined);
  assert.equal(verify(null, Buffer.from(JSON.stringify(eastAfter.identities.alice.federationProof.claim)),
    keys.west.publicKey, Buffer.from(eastAfter.identities.alice.federationProof.signature, "base64url")), true);
  assert.equal(westAfter.objects.find((object) => object.id === "cloak").room, 1);
  assert.equal(eastAfter.objects.find((object) => object.id === "cloak").holder, null);

  let e = player(ports.east, `http://127.0.0.1:${ports.east}`);
  sockets.push(e);
  await e.expect("Welcome to MUDBench.");
  e.send(`prism ${eastLogin.token}`);
  await e.expect("Signed in as prism:");
  await e.challenge(eastLogin);
  e.send("play alice");
  await e.expect("[The Atrium]");
  e.send("score");
  await e.expect("123");
  e.send("cast spark");
  await e.expect("Spark is not recognized in this region.");

  const back = await grantFor(eastLogin, "alice", "west", `http://127.0.0.1:${ports.west}`);
  e.send(`travel west ${b64u(back)}`);
  await e.expect("Transferred to west.");
  e.close();
  await wait(300);

  const returned = JSON.parse(await readFile(westFile, "utf8")).identities.alice;
  assert.equal(returned.xp, 123);
  assert.equal(returned.level, 2);
  assert.deepEqual(returned.spellbook, ["spark"]);
  assert.deepEqual(returned.unrecognizedSkills, []);
  assert.equal(returned.title, "the Remembered");
  assert.deepEqual(returned.found, ["1:plaque", "2:door"]);
  assert.deepEqual(returned.ignored, ["bob"]);
  assert.deepEqual(returned.memory.facts.door.word, "amber");
  assert.equal(returned.duelWins, 2);
  assert.equal(returned.duelRating, 1040);
  assert.equal(returned.standing.ember, 3);
  assert.equal(returned.components.iron, 2);
  assert.equal(JSON.parse(await readFile(join(directory, "east.json"), "utf8")).accounts[prism.prism].federation.status, "away");

  // Replaying the old grant must be refused.
  const proof = JSON.parse(await readFile(join(directory, "east.json"), "utf8")).identities.alice.federationProof;
  const replay = await fetch(`http://127.0.0.1:${ports.east}/federation/transfer`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "x-mud-region": "west", "content-type": "application/json" },
    body: JSON.stringify({ claim: proof.claim, signature: proof.signature, grant, prism: prism.prism }),
  });
  assert.equal(replay.status, 409);
  const badGrant = JSON.parse(JSON.stringify(grant));
  badGrant.envelope.body.payload.character = "bob";
  const bad = await fetch(`http://127.0.0.1:${ports.east}/federation/transfer`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "x-mud-region": "west", "content-type": "application/json" },
    body: JSON.stringify({ claim: proof.claim, signature: proof.signature, grant: badGrant, prism: prism.prism }),
  });
  assert.equal(bad.status, 409);

  // A legacy password account is refused before any grant is requested.
  const legacy = player(ports.west, `http://127.0.0.1:${ports.west}`);
  sockets.push(legacy);
  await legacy.expect("Welcome to MUDBench.");
  legacy.send("register bob secret123");
  await legacy.expect("Account bob created.");
  await legacy.expect("[The Atrium]");
  legacy.send("travel east");
  await legacy.expect("Region travel needs a character on a Prism account.");
  legacy.close();

  // The west character is playable again after the return.
  westLogin = await loginSession(prism, `http://127.0.0.1:${ports.west}`);
  p = player(ports.west, `http://127.0.0.1:${ports.west}`);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send(`prism ${westLogin.token}`);
  await p.expect("Signed in as prism:");
  await p.challenge(westLogin);
  p.send("play alice");
  await p.expect("[The Atrium]");
  p.send("score");
  await p.expect("123");
  p.close();

  east.kill("SIGTERM");
  await new Promise((resolve) => east.once("exit", resolve));
  west.kill("SIGTERM");
  await new Promise((resolve) => west.once("exit", resolve));
  const uncertain = JSON.parse(await readFile(westFile, "utf8"));
  uncertain.accounts[prism.prism].federation.status = "outgoing";
  uncertain.accounts[prism.prism].federation.to = "east";
  uncertain.accounts[prism.prism].federation.transferId = proof.claim.transferId;
  uncertain.accounts[prism.prism].federation.characterId = proof.claim.characterId;
  uncertain.accounts[prism.prism].federation.character = { ...proof.claim.character };
  uncertain.accounts[prism.prism].federation.grant = grant;
  await writeFile(westFile, JSON.stringify(uncertain));
  west = start("west");
  await ready("west", "east");
  const retryLogin = await loginSession(prism, `http://127.0.0.1:${ports.west}`);
  p = player(ports.west, `http://127.0.0.1:${ports.west}`);
  sockets.push(p);
  await p.expect("Welcome to MUDBench.");
  p.send(`prism ${retryLogin.token}`);
  await p.expect("Transfer is still pending.");
  p.close();
});
