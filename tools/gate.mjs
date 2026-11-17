#!/usr/bin/env node
// The gate: compute the project's numbers, compare them to the ratchet, and
// fail if anything got worse.
//
// Two kinds of number:
//   debt   may fall, never rise. Rule implementations the runtime does itself
//          while a proof of the same rule sits unused in the model.
//   credit may rise, never fall. Model modules, proved theorems, acceptance
//          vectors.
//
// A gate that only counts code is theatre. This one counts the gap between what
// is proved and what is executed, which is the number that actually matters
// here: every item in `ruleDebt` is a place where a verified rule and a running
// rule can drift apart without anything noticing.
//
// Usage: node tools/gate.mjs [--json]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadWorld } from "../runtime/worlddata.mjs";
import { describe as renderRoom, examine } from "../runtime/view.mjs";
import { loadVerbs } from "../runtime/verbs.mjs";
import { loadChannels } from "../runtime/channels.mjs";
import { loadSocials } from "../runtime/socials.mjs";
import { hashPassword, verifyPassword, validName, validPassword } from "../runtime/accounts.mjs";
import { allowCommand, DEFAULT_INTERVAL_MS } from "../runtime/allowance.mjs";
import { loadLevels } from "../runtime/levels.mjs";
import { loadQuests, validateQuestReferences } from "../runtime/quests.mjs";
import { guildId, validGuildName } from "../runtime/guilds.mjs";
import { DEFAULT_TURNS, trimMessages } from "../runtime/memory.mjs";
import { buildLlms } from "../runtime/llms.mjs";
import { AREA_PERIOD, armorOf, attackRoll, checkpointIdentities, initialState, nextFrom, phaseAt, releaseHeldObjects, step, upgradeState } from "../runtime/world.mjs";
import { join } from "node:path";
import { buildCandidates } from "./candidate.mjs";
import { PROVIDERS, buildSystemPrompt, buildUserPrompt, normalizeBase, parseBrain, requestFor, replyFrom, trimHistory } from "../runtime/web/ai.mjs";
import { verifyPrismSession, verifyPersonaOwner, verifySessionKey } from "../runtime/prism-auth.mjs";
import { decodeIdentityRequest, identityAdmits } from "../runtime/identity.mjs";
import { loadStateFile, saveStateFile } from "../runtime/state.mjs";
import { acceptLinkRequest, completeLink, createDevice, createLinkOffer, createPrism, createRecovery, linkCode, recoverPrism, requestLink, revokeDevice, signAction, verifyAction } from "../runtime/web/prism-id.mjs";
import { openKit, sealKit } from "../runtime/web/recovery-kit.mjs";
import { readSpanTail, redactSpans, summarizeSpans } from "../runtime/spans.mjs";
import { admissionAdmits, decodeAdmissionRequest } from "./admission.mjs";
import { measureCandidates } from "./measure.mjs";
import { normalizePrismId, ownerAllowed, rebindPlan, tokenHash } from "../runtime/rebind.mjs";
import { deleteLegacy } from "./delete-legacy.mjs";
import { normalizeStreamEvent, publicStreamText } from "../runtime/stream.mjs";
import { normalizeAiTurn, aiTurnAttributes } from "../runtime/metrics.mjs";
import { summarizeTrends } from "../runtime/trends.mjs";
import { worldStatus, worldStatusText } from "../runtime/worldstatus.mjs";
import { redactCommand, sanitizeIntent, sanitizeState, scrubSecrets, scrubSpan } from "../runtime/telemetry-policy.mjs";

const root = process.cwd();
const ratchet = JSON.parse(readFileSync(join(root, "world/ratchet.json"), "utf8"));

const srcDir = join(root, "world/src");
const modules = readdirSync(srcDir).filter((f) => f.endsWith(".lex.tex"));
const sources = modules.map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");

const count = (text, pattern) => (text.match(pattern) ?? []).length;

const measured = {
  modelModules: modules.length,
  provedTheorems: count(sources, /theorem\{/g),
  acceptanceVectors: count(sources, /AcceptanceVector \{request/g),
  classicalChoiceAxioms: count(sources, /Classical\.choice/g),
  ruleDebt: ratchet.ruleDebt.length,
  unusedRules: ratchet.unusedRules.length,
};

const failures = [];

// Every kind the app facet can decide must be asked by a command. The ratchet
// says unusedRules is zero; this is what makes that statement checkable rather
// than prose. A call site is the whole claim: if the line goes, the rule is
// unreached again.
const serverSource = readFileSync(join(root, "runtime/server.mjs"), "utf8");
const askedKinds = new Set([...serverSource.matchAll(/admit\(\{\s*kind: (\d+)/g)].map((match) => Number(match[1])));
for (const kind of [0, 1, 2, 4, 6, 7]) {
  if (!askedKinds.has(kind)) failures.push(`the model's kind ${kind} is not asked by any command`);
}

for (const [key, ceiling] of Object.entries(ratchet.mustNotGrow)) {
  if (measured[key] > ceiling) {
    failures.push(`${key} is ${measured[key]}, above its ceiling of ${ceiling} — debt may only fall`);
  }
}
for (const [key, floor] of Object.entries(ratchet.mustNotFall)) {
  if (measured[key] < floor) {
    failures.push(`${key} is ${measured[key]}, below its floor of ${floor} — credit may not be withdrawn silently`);
  }
}
for (const [key, exact] of Object.entries(ratchet.mustStayZero)) {
  if (measured[key] !== exact) {
    failures.push(`${key} is ${measured[key]}, expected ${exact}`);
  }
}

// The world must be walkable in every experiment arm.
const worldProblems = [];
for (const mode of ["single", "marked", "true", "corroborated"]) {
  for (const problem of loadWorld({ mode }).errors) worldProblems.push(`${mode}: ${problem}`);
}
if (worldProblems.length > 0) {
  failures.push(`world data is invalid: ${worldProblems[0]}`);
}

// The renderer must show a notice it is cleared for and hide one it is not.
// This is the check that was missing when the world-data migration silently
// dropped every notice while the gate stayed green.
const noticeRoom = { name: "X", text: "t", exits: {}, notices: [{ level: 3, text: "SECRET-NOTICE" }] };
const shown = renderRoom({ room: noticeRoom, role: 3, cleared: (role, level) => role >= level });
const hidden = renderRoom({ room: noticeRoom, role: 0, cleared: (role, level) => role >= level });
if (!shown.includes("SECRET-NOTICE")) failures.push("the room renderer drops a notice it was cleared for");
if (hidden.includes("SECRET-NOTICE")) failures.push("the room renderer shows a notice it was not cleared for");

// The claims ledger must be well-formed and its generated page current.
const claimsCheck = spawnSync(process.execPath, ["tools/claims.mjs", "--check"], { encoding: "utf8" });
if (claimsCheck.status !== 0) failures.push(`claims are stale: ${(claimsCheck.stderr || "").trim().split("\n")[0]}`);

// The generated command reference must match the tables.
const commandsCheck = spawnSync(process.execPath, ["tools/commands.mjs", "--check"], { encoding: "utf8" });
if (commandsCheck.status !== 0) failures.push(`docs/COMMANDS.md is stale: ${(commandsCheck.stderr || "").trim().split("\n")[0]}`);

// The web shell must actually offer account and AI-play controls.
const web = readFileSync("runtime/web/index.html", "utf8");
if (!/id="login"/.test(web) || !/id="register"/.test(web) || !/id="prism-login"/.test(web) || !/id="mode-ai"/.test(web) || !/id="ai-provider"/.test(web) || !/id="ai-reset"/.test(web) || !/id="director-input"/.test(web)) {
  failures.push("the web shell lost its Prism, password or AI-play controls");
}

// The browser AI: the parser, the prompt, and every provider request shape.
let webAI = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { webAI.ok = false; webAI.why.push(why); } };
  check(!PROVIDERS.ollama?.needsKey && !PROVIDERS.custom?.needsKey && !PROVIDERS["prime-router"]?.needsKey, "a local provider requires a key");
  check(PROVIDERS.custom?.keyMode === "optional" && PROVIDERS.openai?.keyMode === "required", "the provider key modes are wrong");
  check(normalizeBase("https://api.openai.com/v1/chat/completions") === "https://api.openai.com/v1", "a full chat URL was not normalized to its base");
  check(normalizeBase("api.openai.com/v1") === "https://api.openai.com/v1", "a bare host was not normalized");
  check(normalizeBase("http://127.0.0.1:11434/v1/") === "http://127.0.0.1:11434/v1", "a local base kept its trailing slash");
  const normalized = requestFor("openai", { base: "https://api.openai.com/v1/chat/completions", model: "m", key: "k" }, "sys", [{ role: "user", content: "hi" }]);
  check(normalized.url === "https://api.openai.com/v1/chat/completions", "the request appended a second chat path");
  const customNoKey = requestFor("custom", { base: "http://localhost:8080/v1", model: "m", key: "" }, "sys", [{ role: "user", content: "hi" }]);
  check(!customNoKey.headers.authorization, "a keyless custom endpoint sent an authorization header");
  const good = parseBrain("THOUGHT: The Vault is north.\nREPLY: On my way.\nCOMMAND: north");
  check(good.command === "north", "the parser lost a labelled command");
  check(good.thought.includes("Vault"), "the parser lost the thought");
  check(good.reply === "On my way.", "the parser lost the reply");
  const bare = parseBrain("I will look around.\nlook");
  check(bare.command === "look", "the parser did not fall back to a bare verb");
  const quit = parseBrain("THOUGHT: done\nCOMMAND: quit");
  check(quit.command === "look", "the parser let the model quit the session");
  const system = buildSystemPrompt({ name: "scout" });
  check(system.includes("scout") && system.includes("COMMAND:"), "the system prompt lost the name or format");
  const user = buildUserPrompt({ turn: 2, observation: "[The Atrium]", director: ["go north"] });
  check(user.includes("TURN 2") && user.includes("go north"), "the user prompt lost the turn or direction");
  const openai = requestFor("openai", { base: "https://api.openai.com/v1", model: "m", key: "k", name: "scout" }, "sys", [{ role: "user", content: "hi" }]);
  check(openai.url.endsWith("/chat/completions") && openai.headers.authorization === "Bearer k", "the OpenAI request shape is wrong");
  const anthropic = requestFor("anthropic", { base: "https://api.anthropic.com/v1", model: "m", key: "k" }, "sys", [{ role: "user", content: "hi" }]);
  check(anthropic.headers["anthropic-dangerous-direct-browser-access"] === "true", "the Anthropic request lost the browser header");
  const prime = requestFor("prime-router", { base: "http://localhost:8000", name: "scout" }, "sys", [{ role: "user", content: "hi" }]);
  check(prime.url.endsWith("/api/chat") && prime.body.identity === "mudbench-scout", "the prime-router request shape is wrong");
  const reply = replyFrom("anthropic", { content: [{ type: "text", text: "THOUGHT: x\nCOMMAND: look" }], usage: { input_tokens: 3, output_tokens: 4 } });
  check(reply.text.includes("COMMAND") && reply.usage.input_tokens === 3, "the Anthropic reply shape is wrong");
  const history = [];
  for (let i = 0; i < 12; i += 1) history.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  const trimmed = trimHistory(history, 2);
  check(trimmed.length === 4 && trimmed[0].role === "user", "history trimming cut a pair in half");
  if (!webAI.ok) failures.push(`the browser AI is broken: ${webAI.why[0]}`);
}

// The world is a map, not a pile of rooms: every room has a real description,
// a detail and an ambient line, and every exit has a way back.
let worldMap = { ok: true, why: [], rooms: 0 };
{
  const world = loadWorld({ mode: "single" });
  const opposite = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };
  worldMap.rooms = Object.keys(world.rooms).length;
  for (const [id, room] of Object.entries(world.rooms)) {
    if (typeof room.text !== "string" || room.text.length < 60) { worldMap.ok = false; worldMap.why.push(`room ${id} has no real description`); }
    if (Object.keys(room.details ?? {}).length === 0) { worldMap.ok = false; worldMap.why.push(`room ${id} has no details to examine`); }
    if (!Array.isArray(room.ambient) || room.ambient.length === 0) { worldMap.ok = false; worldMap.why.push(`room ${id} has no ambient line`); }
    for (const [direction, target] of Object.entries(room.exits ?? {})) {
      const back = opposite[direction];
      if (!back || world.rooms[target]?.exits?.[back] !== Number(id)) {
        worldMap.ok = false;
        worldMap.why.push(`exit ${id} ${direction} -> ${target} has no way back`);
      }
    }
  }
  if (!examine({ room: world.rooms[1], target: "plaque" })) { worldMap.ok = false; worldMap.why.push("the Atrium plaque cannot be examined"); }
  if (!examine({ room: world.rooms[1], target: "sword", objects: world.objects })) { worldMap.ok = false; worldMap.why.push("an object cannot be examined"); }
  if (!examine({ room: world.rooms[1], target: "bard", npcs: world.npcs })) { worldMap.ok = false; worldMap.why.push("a mobile cannot be examined"); }
  if (examine({ room: world.rooms[1], target: "nothing-at-all" })) { worldMap.ok = false; worldMap.why.push("a missing thing was examined"); }
  if (!worldMap.ok) failures.push(`the world map is broken: ${worldMap.why[0]}`);
}

// The verb table must resolve its own aliases and use only known codes.
const verbTable = loadVerbs();
if (verbTable.errors.length > 0) failures.push(`verbs are invalid: ${verbTable.errors[0]}`);

// Channels and socials must resolve, and none may shadow a verb or each other.
const channelTable = loadChannels();
const socialTable = loadSocials();
const questTable = loadQuests();

// The agent contract is generated from the same tables as the game: every verb,
// room, channel and social must appear.
let llms = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const text = buildLlms({
    world,
    verbs: verbTable.verbs,
    channels: channelTable,
    socials: socialTable,
    quests: questTable.quests,
    levels: [],
    origin: "play.r4labs.org",
  });
  for (const verb of Object.keys(verbTable.verbs)) {
    if (!text.includes("`" + verb + "`")) { llms.ok = false; llms.why.push(`/llms.txt omits verb ${verb}`); }
  }
  for (const room of Object.values(world.rooms)) {
    if (!text.includes(room.name)) { llms.ok = false; llms.why.push(`/llms.txt omits room ${room.name}`); }
  }
  for (const channel of channelTable.channels) {
    if (!text.includes("`" + channel.name + "`")) { llms.ok = false; llms.why.push(`/llms.txt omits channel ${channel.name}`); }
  }
  for (const social of Object.keys(socialTable.socials)) {
    if (!text.includes("`" + social + "`")) { llms.ok = false; llms.why.push(`/llms.txt omits social ${social}`); }
  }
  for (const quest of questTable.quests) {
    if (!text.includes(`| ${quest.id} |`)) { llms.ok = false; llms.why.push(`/llms.txt omits quest ${quest.id}`); }
  }
  if (!llms.ok) failures.push(`/llms.txt is stale: ${llms.why[0]}`);
}


if (channelTable.errors.length > 0) failures.push(`channels are invalid: ${channelTable.errors[0]}`);
if (socialTable.errors.length > 0) failures.push(`socials are invalid: ${socialTable.errors[0]}`);
if (questTable.errors.length > 0) failures.push(`quests are invalid: ${questTable.errors[0]}`);
for (const alias of channelTable.byAlias.keys()) {
  if (verbTable.byAlias.has(alias)) failures.push(`channel alias "${alias}" shadows a verb`);
  if (socialTable.byAlias.has(alias)) failures.push(`channel alias "${alias}" shadows a social`);
}
for (const alias of socialTable.byAlias.keys()) {
  if (verbTable.byAlias.has(alias)) failures.push(`social alias "${alias}" shadows a verb`);
}

// Accounts are hashes, not words; the reducer only sees an authenticated
// identity, never a password.
let accounts = { ok: true, why: [] };
{
  const { salt, hash } = hashPassword("correct horse");
  if (!verifyPassword("correct horse", salt, hash)) { accounts.ok = false; accounts.why.push("a correct password was refused"); }
  if (verifyPassword("wrong horse", salt, hash)) { accounts.ok = false; accounts.why.push("a wrong password was accepted"); }
  if (!validName("alice-1") || validName("a b") || !validPassword("sixsix") || validPassword("short")) {
    accounts.ok = false;
    accounts.why.push("name or password validation is wrong");
  }

  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "agent" }]);
  run([{ kind: "register", actorId: "a", key: "alice", passwordHash: hash, salt }]);
  if (state.accounts.alice?.passwordHash !== hash) { accounts.ok = false; accounts.why.push("register did not write the password hash"); }
  if (state.identities.alice?.passwordHash !== undefined) { accounts.ok = false; accounts.why.push("register wrote a credential onto the character"); }
  if (state.identities.alice?.room !== undefined || state.identities.alice?.inventory !== undefined) { accounts.ok = false; accounts.why.push("register wrote session state"); }
  run([{ kind: "join", actorId: "b", name: "agent" }]);
  run([{ kind: "login", actorId: "b", key: "alice", authenticated: true }]);
  if (state.actors.find((actor) => actor.id === "b")?.level !== 1) { accounts.ok = false; accounts.why.push("login did not set progression defaults"); }
  run([{ kind: "password", actorId: "a", passwordHash: "new-hash", salt: "new-salt" }]);
  if (state.accounts.alice.passwordHash !== "new-hash") { accounts.ok = false; accounts.why.push("password change did not take"); }
  if (!accounts.ok) failures.push(`accounts are broken: ${accounts.why[0]}`);
}

// A Prism account owns one or more characters; the character is the in-game name.
let prismLogin = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const key = `sha256:${"a".repeat(64)}`;
  run([{ kind: "join", actorId: "p", name: "p" }]);
  run([
    { kind: "createCharacter", accountKey: key, name: "scout", actorId: "p" },
    { kind: "login", actorId: "p", key: "scout", account: key, authenticated: true, prism: true },
  ]);
  const actor = state.actors.find((candidate) => candidate.id === "p");
  const account = state.accounts[key];
  const character = state.identities.scout;
  if (actor?.name !== "scout") prismLogin.why.push("the actor did not take the character name");
  if (actor?.account !== key) prismLogin.why.push("the actor did not record the account");
  if (account?.kind !== "prism" || account?.characters?.[0] !== "scout" || account?.passwordHash !== null) {
    prismLogin.why.push("the Prism account is not a passwordless account with its character");
  }
  if (character?.kind !== "character" || character?.owner !== key) prismLogin.why.push("the character is not owned by the Prism account");
  if (character?.passwordHash !== undefined) prismLogin.why.push("the character kept a credential");

  // An unauthenticated intent must not take over the character.
  run([{ kind: "join", actorId: "q", name: "q" }]);
  run([{ kind: "login", actorId: "q", key: "scout", account: key, authenticated: false, prism: true }]);
  if (state.actors.find((candidate) => candidate.id === "q")?.key === "scout") {
    prismLogin.why.push("an unauthenticated login took over a Prism character");
  }

  // A character on another account is refused.
  run([{ kind: "join", actorId: "r", name: "r" }]);
  run([{ kind: "login", actorId: "r", key: "scout", account: `sha256:${"d".repeat(64)}`, authenticated: true, prism: true }]);
  if (state.actors.find((candidate) => candidate.id === "r")?.key === "scout") {
    prismLogin.why.push("a character was admitted to the wrong account");
  }

  // A legacy register creates an account and its one character.
  run([{ kind: "join", actorId: "l", name: "l" }]);
  run([{ kind: "register", actorId: "l", key: "legacy-test", passwordHash: "h", salt: "s" }]);
  if (state.accounts["legacy-test"]?.kind !== "legacy") prismLogin.why.push("a legacy account has no kind");
  if (state.identities["legacy-test"]?.kind !== "character" || state.identities["legacy-test"]?.owner !== "legacy-test") {
    prismLogin.why.push("a legacy character is not owned by its account");
  }
  const upgraded = upgradeState({ identities: { "old-name": { name: "old-name" } } }, initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests));
  if (upgraded.accounts["old-name"]?.kind !== "legacy") prismLogin.why.push("upgradeState did not create an account");
  if (upgraded.identities["old-name"]?.kind !== "character") prismLogin.why.push("upgradeState did not create a character");

  if (prismLogin.why.length) { prismLogin.ok = false; failures.push(`Prism login is broken: ${prismLogin.why[0]}`); }
}

// X4: a second login takes over only after the old actor leaves.
let takeover = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { takeover.ok = false; takeover.why.push(why); } };
  const account = `sha256:${"c".repeat(64)}`;
  const character = "scout";
  run([{ kind: "join", actorId: "a", name: "a" }]);
  run([
    { kind: "createCharacter", accountKey: account, name: character, actorId: "a" },
    { kind: "login", actorId: "a", key: character, account, authenticated: true, prism: true },
  ]);
  run([{ kind: "join", actorId: "b", name: "b" }]);
  run([{ kind: "leave", actorId: "a" }, { kind: "login", actorId: "b", key: character, account, authenticated: true, prism: true }]);
  check(!state.actors.some((actor) => actor.id === "a"), "the old actor stayed after the takeover leave");
  check(state.actors.find((actor) => actor.id === "b")?.key === character, "the new actor did not take the key");
  check(state.actors.length === 1, "the takeover left two controllers");
  if (takeover.why.length) { takeover.ok = false; failures.push(`takeover is broken: ${takeover.why[0]}`); }
}


// X5: the proved Identity kernel and its JavaScript twin agree on every vector.
let identityKernel = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { identityKernel.ok = false; identityKernel.why.push(why); } };
  const fixtureText = readFileSync(join(root, "world/data/identity-vectors.json"), "utf8");
  const fixture = JSON.parse(fixtureText);
  const vectors = fixture.vectors ?? [];
  const modelVectors = new Map(
    [...readFileSync(join(root, "world/src/MudBench.lex.tex"), "utf8")
      .matchAll(/AcceptanceVector \{request := 0x([0-9a-f]+), response := 0x([0-9a-f]+)\}/g)]
      .map((match) => [match[1], match[2]]),
  );
  let jsMatched = 0;
  let modelMatched = 0;
  for (const vector of vectors) {
    const flags = decodeIdentityRequest([...Buffer.from(vector.request, "hex")]);
    check(flags !== null, `${vector.name}: the request is not a kind-7 request`);
    if (!flags) continue;
    const jsVerdict = identityAdmits(flags) ? "admissible" : "refused";
    if (jsVerdict === vector.expected) jsMatched++;
    else check(false, `${vector.name}: JS says ${jsVerdict}, the fixture says ${vector.expected}`);
    if (Buffer.from(vector.response, "hex").toString("utf8") !== vector.expected) {
      check(false, `${vector.name}: the response bytes do not spell ${vector.expected}`);
    }
    if (modelVectors.get(vector.request) === vector.response) modelMatched++;
    else check(false, `${vector.name}: the model does not carry ${vector.request} -> ${vector.response}`);
  }
  check(vectors.length >= 10, "the identity fixture lost vectors");
  check(jsMatched === vectors.length, "the JS twin did not match every identity vector");
  check(modelMatched === vectors.length, "the model did not carry every identity vector");
  // A planted bad vector must be caught: flip one expected verdict and confirm
  // the same comparison the loop uses rejects it.
  const first = vectors[0];
  const planted = { ...first, expected: first.expected === "admissible" ? "refused" : "admissible" };
  const plantedFlags = decodeIdentityRequest([...Buffer.from(planted.request, "hex")]);
  const plantedVerdict = identityAdmits(plantedFlags) ? "admissible" : "refused";
  check(plantedVerdict !== planted.expected, "a planted bad identity vector was not caught");
  const receipt = {
    schema: "mudbenchmark/identity-receipt/1",
    kernel: `sha256:${createHash("sha256").update(readFileSync(join(root, "world/src/Identity.lex.tex"))).digest("hex")}`,
    app: `sha256:${createHash("sha256").update(readFileSync(join(root, "world/src/MudBench.lex.tex"))).digest("hex")}`,
    fixtures: `sha256:${createHash("sha256").update(fixtureText).digest("hex")}`,
    verdicts: vectors.map((vector) => ({ name: vector.name, request: vector.request, verdict: vector.expected })),
    checks: { js: `${jsMatched}/${vectors.length}`, model: `${modelMatched}/${vectors.length}`, planted: "refused" },
  };
  const receiptPath = join(root, "world/identity-receipt.json");
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!existsSync(receiptPath) || readFileSync(receiptPath, "utf8") !== receiptText) writeFileSync(receiptPath, receiptText);
  if (identityKernel.why.length) { identityKernel.ok = false; failures.push(`the identity kernel is broken: ${identityKernel.why[0]}`); }
}

// L4: the span summary is the benchmark view; command text is redacted.
let spanView = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { spanView.ok = false; spanView.why.push(why); } };
  const lines = [
    JSON.stringify({ name: "world.input", at: "2026-11-17T00:00:00.000Z", duration_ms: 0, "actor.id": 7, text: "look", "world.tick": 10 }),
    JSON.stringify({ name: "world.move", at: "2026-11-17T00:00:00.100Z", duration_ms: 12, "actor.id": 7, "room.id": 1, "world.tick": 11 }),
    JSON.stringify({ name: "world.input", at: "2026-11-17T00:00:00.200Z", duration_ms: 0, "actor.id": 7, text: "who", "world.tick": 12 }),
    JSON.stringify({ name: "world.input", at: "2026-11-17T00:00:00.300Z", duration_ms: 0, "actor.id": 7, text: "north", refused: "too-fast", "world.tick": 12 }),
  ];
  const summary = summarizeSpans(lines, { recent: 10 });
  check(summary.count === 4, "the span count is wrong");
  check(summary.ticks.min === 10 && summary.ticks.max === 12, "the tick range is wrong");
  check(summary.kinds["world.input"] === 3 && summary.kinds["world.move"] === 1, "the span kinds are wrong");
  check(summary.commands.length === 2 && summary.commands[0].text === "look" && summary.commands[1].tick === 12, "the accepted commands are wrong");
  check(summary.latency.count === 1 && summary.latency.max_ms === 12, "the latency summary is wrong");
  check(summary.actors.length === 1 && summary.rooms.length === 1, "the actor or room set is wrong");
  const redacted = redactSpans(summary);
  check(redacted.commands === 2 && redacted.actors === 1 && redacted.recent.length === 2, "the redacted summary is wrong");
  check(!JSON.stringify(redacted).includes("look"), "the redacted summary leaked a command");
  const dir = mkdtempSync(join(tmpdir(), "mudbench-spans-"));
  const file = join(dir, "spans.jsonl");
  writeFileSync(file, `${lines.join("\n")}\n`);
  const tail = readSpanTail(file, { recent: 10 });
  check(tail.count === 4 && tail.commands.length === 2 && tail.ticks.max === 12, "reading the span tail lost spans");
  if (spanView.why.length) { spanView.ok = false; failures.push(`the span summary is broken: ${spanView.why[0]}`); }
}

// L5: the admission kernel and its JS twin agree on every candidate vector.
let admission = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { admission.ok = false; admission.why.push(why); } };
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  const fixtureText = readFileSync(join(root, "world/data/admission-vectors.json"), "utf8");
  const fixture = JSON.parse(fixtureText);
  const vectors = fixture.vectors ?? [];
  const modelText = readFileSync(join(root, "world/src/MudBench.lex.tex"), "utf8");
  const modelVectors = new Map(
    [...modelText.matchAll(/AcceptanceVector \{request := 0x([0-9a-f]+), response := 0x([0-9a-f]+)\}/g)]
      .map((match) => [match[1], match[2]]),
  );
  let jsMatched = 0;
  let modelMatched = 0;
  for (const vector of vectors) {
    const flags = decodeAdmissionRequest([...Buffer.from(vector.request, "hex")]);
    check(flags !== null, `${vector.name}: the request is not a kind-8 admission`);
    if (!flags) continue;
    const jsVerdict = admissionAdmits(flags) ? "admissible" : "refused";
    if (jsVerdict === vector.expected) jsMatched++;
    else check(false, `${vector.name}: JS says ${jsVerdict}, the fixture says ${vector.expected}`);
    if (Buffer.from(vector.response, "hex").toString("utf8") !== vector.expected) {
      check(false, `${vector.name}: the response bytes do not spell ${vector.expected}`);
    }
    if (modelVectors.get(vector.request) === vector.response) modelMatched++;
    else check(false, `${vector.name}: the model does not carry ${vector.request} -> ${vector.response}`);
  }
  check(vectors.length >= 6, "the admission fixture lost vectors");
  check(jsMatched === vectors.length, "the JS admission twin did not match every vector");
  check(modelMatched === vectors.length, "the model did not carry every admission vector");
  const planted = { ...vectors[0], expected: vectors[0].expected === "admissible" ? "refused" : "admissible" };
  const plantedFlags = decodeAdmissionRequest([...Buffer.from(planted.request, "hex")]);
  const plantedVerdict = admissionAdmits(plantedFlags) ? "admissible" : "refused";
  check(plantedVerdict !== planted.expected, "a planted bad admission vector was not caught");
  const publisher = readFileSync(join(root, "tools/publish.mjs"), "utf8");
  check(/admissionAdmits/.test(publisher), "the publisher does not ask the admission policy");
  const receipt = {
    schema: "mudbenchmark/admission-receipt/1",
    kernel: `sha256:${digest(readFileSync(join(root, "world/src/Admission.lex.tex")))}`,
    app: `sha256:${digest(modelText)}`,
    fixtures: `sha256:${digest(fixtureText)}`,
    verdicts: vectors.map((vector) => ({ name: vector.name, request: vector.request, verdict: vector.expected })),
    checks: { js: `${jsMatched}/${vectors.length}`, model: `${modelMatched}/${vectors.length}`, planted: "refused" },
  };
  const receiptPath = join(root, "world/admission-receipt.json");
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!existsSync(receiptPath) || readFileSync(receiptPath, "utf8") !== receiptText) writeFileSync(receiptPath, receiptText);
  if (admission.why.length) { admission.ok = false; failures.push(`the admission kernel is broken: ${admission.why[0]}`); }
}

// R2: a human can hand one character to the AI persona; the owner stays human.
let handoff = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { handoff.ok = false; handoff.why.push(why); } };
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const humanKey = `sha256:${"1".repeat(64)}`;
  const personaKey = `sha256:${"2".repeat(64)}`;
  const origin = "https://play.r4labs.org";
  run([{ kind: "join", actorId: "h", name: "h" }]);
  run([
    { kind: "createCharacter", accountKey: humanKey, name: "alice", actorId: "h" },
    { kind: "login", actorId: "h", key: "alice", account: humanKey, authenticated: true, prism: true },
  ]);
  run([{ kind: "join", actorId: "p", name: "p" }]);
  run([
    { kind: "ownAccount", accountKey: personaKey, owner: humanKey, audience: origin, device: "d" },
    { kind: "createCharacter", accountKey: personaKey, name: "scout", actorId: "p" },
    { kind: "login", actorId: "p", key: "scout", account: personaKey, authenticated: true, prism: true },
  ]);
  run([{ kind: "handoffCharacter", characterKey: "alice", owner: humanKey, persona: personaKey, at: 5 }]);
  check(state.identities.alice?.delegate === personaKey, "the handoff did not set the delegate");
  check(state.identities.alice?.owner === humanKey, "the handoff changed the owner");
  // The human leaves alice before the AI takes the delegated character over.
  run([{ kind: "leave", actorId: "h" }, { kind: "leave", actorId: "p" }, { kind: "join", actorId: "p2", name: "p2" }]);
  run([{ kind: "login", actorId: "p2", key: "alice", account: personaKey, authenticated: true, prism: true }]);
  const delegatedActor = state.actors.find((actor) => actor.id === "p2");
  check(delegatedActor?.name === "alice" && delegatedActor?.account === personaKey, "the persona did not log in as the delegated character");
  check(state.identities.alice?.owner === humanKey && state.identities.alice?.delegate === personaKey, "the delegated login changed the character");
  run([{ kind: "leave", actorId: "p2" }]);
  check(state.identities.alice?.owner === humanKey && state.identities.alice?.delegate === personaKey, "the leave changed the delegated character");
  run([{ kind: "revokeHandoff", characterKey: "alice", owner: humanKey, persona: personaKey }]);
  check(!state.identities.alice?.delegate, "the revoke did not clear the delegate");
  run([{ kind: "join", actorId: "p3", name: "p3" }]);
  run([{ kind: "login", actorId: "p3", key: "alice", account: personaKey, authenticated: true, prism: true }]);
  check(state.actors.find((actor) => actor.id === "p3")?.key !== "alice", "the persona logged in after the revoke");
  run([{ kind: "handoffCharacter", characterKey: "alice", owner: humanKey, persona: personaKey, at: 6 }]);
  run([{ kind: "retireAccount", accountKey: personaKey, owner: humanKey, at: 7 }]);
  check(!state.identities.alice?.delegate, "retiring the persona left the delegation");

  const human = await createPrism({});
  const now = Date.now();
  const action = await signAction(human, "prism/character-handoff/1",
    { character: "alice", persona: personaKey, audience: origin }, { audience: origin, now });
  const verdict = await verifyPersonaOwner({ envelope: action },
    { origin, persona: personaKey, action: "prism/character-handoff/1", pinned: [...human.log.values()], now });
  check(verdict.ok && verdict.owner === human.prism, "the signed handoff action was not verified");
  const wrong = await verifyPersonaOwner({ envelope: action },
    { origin, persona: personaKey, action: "prism/character-revoke/1", pinned: [...human.log.values()], now });
  check(!wrong.ok, "a handoff action was accepted as a revoke");

  if (handoff.why.length) { handoff.ok = false; failures.push(`handoff is broken: ${handoff.why[0]}`); }
}

// Recovery: an encrypted kit recovers the id on a new device and revokes the old.
let recovery = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { recovery.ok = false; recovery.why.push(why); } };
  const origin = "https://play.r4labs.org";
  const now = Date.now();
  const passphrase = "correct horse battery staple";
  const kit = await sealKit({
    schema: "mudbenchmark/recovery-payload/1",
    prism: `sha256:${"a".repeat(64)}`,
    records: [],
    shares: [],
  }, passphrase);
  const opened = await openKit(kit, passphrase);
  check(opened.prism === `sha256:${"a".repeat(64)}`, "the kit did not open with the right passphrase");
  let wrong = false;
  try { await openKit(kit, "wrong passphrase here"); } catch { wrong = true; }
  check(wrong, "a wrong passphrase opened the kit");
  const tampered = { ...kit, ciphertext: `${kit.ciphertext.slice(0, -2)}${kit.ciphertext.endsWith("AA") ? "BB" : "AA"}` };
  let damaged = false;
  try { await openKit(tampered, passphrase); } catch { damaged = true; }
  check(damaged, "a tampered kit opened");

  const human = await createPrism({});
  const made = await createRecovery(human, { threshold: 1, guardians: [{ paper: true }] });
  check(made.shares?.length === 1 && made.shares[0].guardian === "paper", "the kit did not get one paper share");
  const device = await createDevice({});
  const recovered = await recoverPrism({
    prism: human.prism,
    records: [...made.session.log.values()],
    shares: made.shares,
    device,
  });
  const action = await signAction(recovered.session, "prism/session/1",
    { sessionKey: "x".repeat(87), expires: now + 10 * 60 * 1000 }, { audience: origin, now });
  const allowed = await verifyAction(human.prism, recovered.session.log, action, { audience: origin, now });
  check(allowed.allowed, "the recovered device could not sign in");
  const oldAction = await signAction(human, "prism/session/1",
    { sessionKey: "y".repeat(87), expires: now + 10 * 60 * 1000 }, { audience: origin, now });
  const refused = await verifyAction(human.prism, recovered.session.log, oldAction, { audience: origin, now });
  check(!refused.allowed, "the old device still signed after recovery");
  let below = false;
  try {
    await recoverPrism({ prism: human.prism, records: [...made.session.log.values()], shares: [], device: await createDevice({}) });
  } catch { below = true; }
  check(below, "recovery accepted no shares");

  if (recovery.why.length) { recovery.ok = false; failures.push(`recovery is broken: ${recovery.why[0]}`); }
}

// L1: a human-signed owner action binds a persona to the human's pinned log.
let persona = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { persona.ok = false; persona.why.push(why); } };
  const origin = "https://play.r4labs.org";
  const now = Date.now();
  const human = await createPrism({});
  const personaId = `sha256:${"a".repeat(64)}`;
  const owner = await signAction(human, "prism/persona-owner/1", { persona: personaId, audience: origin }, { audience: origin, now });
  const pinned = [...human.log.values()];
  const good = await verifyPersonaOwner({ envelope: owner }, { origin, persona: personaId, pinned, now });
  check(good.ok && good.owner === human.prism && good.device, "a human-signed owner action was not accepted");
  const wrong = await verifyPersonaOwner({ envelope: owner }, { origin, persona: `sha256:${"b".repeat(64)}`, pinned, now });
  check(!wrong.ok, "an owner action for another persona was accepted");
  const noPin = await verifyPersonaOwner({ envelope: owner }, { origin, persona: personaId, pinned: null, now });
  check(!noPin.ok, "an owner action without a pinned human log was accepted");

  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "a" }]);
  run([{ kind: "ownAccount", accountKey: personaId, owner: human.prism, audience: origin, device: "device" }]);
  check(state.accounts[personaId]?.owner === human.prism && state.accounts[personaId]?.ai === true, "ownAccount did not record the owner");
  run([{ kind: "ownAccount", accountKey: personaId, owner: `sha256:${"b".repeat(64)}`, audience: origin, device: "other" }]);
  check(state.accounts[personaId]?.owner === human.prism, "a second owner took the persona");
  run([
    { kind: "createCharacter", accountKey: personaId, name: "scout", actorId: "a" },
    { kind: "login", actorId: "a", key: "scout", account: personaId, authenticated: true, prism: true },
  ]);
  check(state.identities.scout?.owner === personaId, "the persona character was not created");
  run([{ kind: "retireAccount", accountKey: personaId, owner: human.prism, at: 9 }]);
  check(state.accounts[personaId]?.retired === true && state.accounts[personaId]?.retiredAt === 9, "retireAccount did not tombstone the account");
  const tombstone = `scout~${personaId.slice(-8)}`;
  check(state.identities[tombstone]?.retired === true && state.identities[tombstone]?.retiredFrom === "scout", "retireAccount left the character orphaned");
  check(state.identities.scout === undefined, "retireAccount kept the character name");
  run([{ kind: "retireAccount", accountKey: personaId, owner: `sha256:${"b".repeat(64)}`, at: 10 }]);
  check(state.accounts[personaId]?.retiredAt === 9, "a non-owner retired the persona");

  if (persona.why.length) { persona.ok = false; failures.push(`personas are broken: ${persona.why[0]}`); }
}

// X7: an account owns more than one character; the character is the game name.
let characters = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { characters.ok = false; characters.why.push(why); } };
  const account = `sha256:${"e".repeat(64)}`;
  const other = `sha256:${"f".repeat(64)}`;
  run([{ kind: "join", actorId: "a", name: "a" }]);
  run([
    { kind: "createCharacter", accountKey: account, name: "alice", actorId: "a" },
    { kind: "login", actorId: "a", key: "alice", account, authenticated: true, prism: true },
  ]);
  check(state.actors.find((actor) => actor.id === "a")?.name === "alice", "the first character did not enter");
  run([{ kind: "leave", actorId: "a" }, { kind: "join", actorId: "a", name: "a" }]);
  run([
    { kind: "createCharacter", accountKey: account, name: "bob", actorId: "a" },
    { kind: "login", actorId: "a", key: "bob", account, authenticated: true, prism: true },
  ]);
  check(state.accounts[account]?.characters?.length === 2, "a second character was not added to the account");
  check(state.actors.find((actor) => actor.id === "a")?.name === "bob", "the second character did not enter");
  run([{ kind: "join", actorId: "b", name: "b" }]);
  run([{ kind: "login", actorId: "b", key: "alice", account: other, authenticated: true, prism: true }]);
  check(state.actors.find((actor) => actor.id === "b")?.key !== "alice", "a character was admitted to another account");
  run([{ kind: "createCharacter", accountKey: account, name: "alice", actorId: "a" }]);
  check(state.accounts[account]?.characters?.length === 2, "a duplicate character name was added");
  if (characters.why.length) { characters.ok = false; failures.push(`characters are broken: ${characters.why[0]}`); }
}

// X2: the pinned public log refuses a revoked device's pre-revocation log.
let identityPin = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { identityPin.ok = false; identityPin.why.push(why); } };
  const origin = "https://play.r4labs.org";
  const now = Date.now();
  const owner = await createPrism({});
  const joining = await createPrism({});
  const offer = await createLinkOffer(owner, { now, ttl: 300000 });
  const request = await requestLink(joining.device, offer.offer);
  const code = await linkCode(offer.offer.secret, request.device);
  const accepted = await acceptLinkRequest(owner, offer.pending, request, { now, confirmCode: code });
  const linked = await completeLink(joining.device, offer.offer, accepted.response);
  const before = [...accepted.session.log.values()];
  const revoked = await revokeDevice(accepted.session, joining.device.id, { rotate: false });
  const after = [...revoked.log.values()];
  const sign = (session) => signAction(session, "prism/session/1", {
    sessionKey: "x".repeat(87),
    expires: now + 10 * 60 * 1000,
  }, { audience: origin, now });
  // The envelope is fresh for each call.
  const verify = async (session, records, pinned) => verifyPrismSession(
    { app: origin, envelope: await sign(session), records },
    { origin, now, pinned },
  );

  const first = await verify(linked, [...linked.log.values()], { records: before });
  check(first.ok, `the linked device was refused before the revocation was seen: ${first.reason}`);
  const survivor = await verify(revoked, after, { records: before });
  check(survivor.ok, `the surviving device was refused after the revocation: ${survivor.reason}`);
  check(survivor.records.length >= after.length, "the merged log lost the revocation");
  const pinned = { records: survivor.records, root: survivor.root };
  const old = await verify(linked, [...linked.log.values()], pinned);
  check(!old.ok, "the revoked device's pre-revocation log was accepted after the pin");
  check(/omits a record/i.test(old.reason ?? ""), "the refusal did not name the omitted record");

  // The pin survives a restart and still refuses the old log.
  const dir = mkdtempSync(join(tmpdir(), "mudbench-identities-"));
  const file = join(dir, "identities.json");
  saveStateFile(file, { schema: "mudbenchmark/identities/1", prisms: { [owner.prism]: pinned } });
  const loaded = loadStateFile(file, { initial: () => ({ schema: "mudbenchmark/identities/1", prisms: {} }), restore: (raw) => raw });
  const afterRestart = await verify(linked, [...linked.log.values()], loaded.prisms[owner.prism]);
  check(!afterRestart.ok, "the pin did not survive a restart");
  rmSync(dir, { recursive: true, force: true });

  // A tampered signing record cannot be admitted.
  const forged = JSON.parse(JSON.stringify(before));
  const genesis = forged[0];
  const signatureKey = Object.keys(genesis).find((key) => /sig/i.test(key));
  if (signatureKey) {
    genesis[signatureKey] = `${genesis[signatureKey].slice(0, -2)}${genesis[signatureKey].endsWith("AA") ? "BB" : "AA"}`;
  } else {
    genesis.body = { ...genesis.body, kind: 99 };
  }
  const tampered = await verify(linked, forged, { records: before });
  check(!tampered.ok, "a tampered log was accepted");

  // A replayed accept, a wrong six-digit code and an expired offer are refused.
  let replayed = false;
  try { await acceptLinkRequest(owner, offer.pending, request, { now, confirmCode: code }); } catch { replayed = true; }
  check(replayed, "a replayed link request was accepted");
  const wrongOffer = await createLinkOffer(revoked, { now, ttl: 300000 });
  const wrongRequest = await requestLink(joining.device, wrongOffer.offer);
  let wrongCode = false;
  try { await acceptLinkRequest(revoked, wrongOffer.pending, wrongRequest, { now, confirmCode: "000000" }); } catch { wrongCode = true; }
  check(wrongCode, "a wrong link code was accepted");
  const expiredOffer = await createLinkOffer(revoked, { now, ttl: 1 });
  const expiredRequest = await requestLink(joining.device, expiredOffer.offer);
  let expired = false;
  try {
    await acceptLinkRequest(revoked, expiredOffer.pending, expiredRequest, {
      now: now + 10,
      confirmCode: await linkCode(expiredOffer.offer.secret, expiredRequest.device),
    });
  } catch { expired = true; }
  check(expired, "an expired link offer was accepted");

  if (identityPin.why.length) { identityPin.ok = false; failures.push(`the pinned log is broken: ${identityPin.why[0]}`); }
}

// X1: a legacy name is adopted once, keyed records move, and the old login dies.
let claim = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { claim.ok = false; claim.why.push(why); } };
  const legacyKey = "oldcasey";
  const prismKey = `sha256:${"b".repeat(64)}`;
  const prismCharacter = "scout";

  run([{ kind: "join", actorId: "l", name: "l" }]);
  run([{ kind: "register", actorId: "l", key: legacyKey, passwordHash: "h", salt: "s" }]);
  // The old character quits before the claim; the owner still holds the old
  // password or token, which is what authorises the adoption.
  run([{ kind: "leave", actorId: "l" }]);
  state.identities[legacyKey] = {
    ...state.identities[legacyKey],
    level: 5, xp: 500, guild: "g1", guildRank: "officer",
    quests: { active: [{ id: "word", progress: {} }], completed: ["scroll"] },
  };
  state.guilds.g1 = { id: "g1", name: "The Keepers", founder: legacyKey, created: 0, members: { [legacyKey]: "officer" }, invites: [legacyKey] };
  state.mail.push({ id: "m1", from: legacyKey, fromKey: legacyKey, toKey: legacyKey, text: "old letter", tick: 0, read: false });

  run([{ kind: "join", actorId: "p", name: "p" }]);
  run([
    { kind: "createCharacter", accountKey: prismKey, name: prismCharacter, actorId: "p" },
    { kind: "login", actorId: "p", key: prismCharacter, account: prismKey, authenticated: true, prism: true },
  ]);
  run([{ kind: "claimLegacy", actorId: "p", accountKey: prismKey, legacyKey }]);

  const account = state.accounts[prismKey];
  const legacyAccount = state.accounts[legacyKey];
  const claimed = state.identities[legacyKey];
  check(account?.claimedFrom === legacyKey, "the Prism account did not record the claim");
  check(account?.characters?.includes(prismCharacter) && account?.characters?.includes(legacyKey), "the claimed character is not on the Prism account");
  check(claimed?.owner === prismKey && claimed?.name === legacyKey, "the claimed character did not move to the Prism account");
  check(claimed?.level === 5 && claimed?.xp === 500, "the claim lost the old progression");
  check(claimed?.guild === "g1" && claimed?.guildRank === "officer", "the claim lost the old guild");
  check(claimed?.quests?.completed?.includes("scroll") && claimed?.quests?.active?.some((entry) => entry.id === "word"), "the claim lost the old quests");
  check(legacyAccount?.retired === true && legacyAccount?.mergedInto === prismKey, "the old account was not tombstoned");
  check(legacyAccount?.passwordHash === null && legacyAccount?.tokenHash === null, "the old credentials were not cleared");
  check(state.mail[0]?.toKey === legacyKey && state.mail[0]?.fromKey === legacyKey, "the old mail keys moved");
  check(state.guilds.g1?.members?.[legacyKey] === "officer" && state.guilds.g1?.founder === legacyKey, "the old guild keys moved");

  // A second claim is refused.
  run([{ kind: "claimLegacy", actorId: "p", accountKey: prismKey, legacyKey }]);
  check(state.accounts[prismKey]?.characters?.filter((name) => name === legacyKey).length === 1, "a second claim added the character again");

  // The retired legacy account cannot log in.
  run([{ kind: "join", actorId: "o", name: "o" }]);
  const oldEvents = run([{ kind: "login", actorId: "o", key: legacyKey, account: legacyKey, authenticated: true }]);
  check(!state.actors.find((candidate) => candidate.id === "o")?.key, "the retired legacy login was accepted");
  check(oldEvents.some((event) => /not available/i.test(event.text ?? "")), "the retired login did not explain the move");

  // The claimed character can be played from the Prism account.
  run([{ kind: "leave", actorId: "p" }]);
  run([{ kind: "join", actorId: "p2", name: "p2" }]);
  run([{ kind: "login", actorId: "p2", key: legacyKey, account: prismKey, authenticated: true, prism: true }]);
  const returning = state.actors.find((candidate) => candidate.id === "p2");
  check(returning?.name === legacyKey && returning?.level === 5, "the claimed character did not resume");

  const checkpointed = checkpointIdentities(state);
  const upgraded = upgradeState(checkpointed, initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests));
  check(upgraded.identities[legacyKey]?.owner === prismKey, "the claim did not survive a checkpoint");
  check(upgraded.accounts[prismKey]?.claimedFrom === legacyKey, "the claim record did not survive a checkpoint");
  check(upgraded.accounts[legacyKey]?.retired === true && upgraded.accounts[legacyKey]?.mergedInto === prismKey, "the tombstone did not survive a checkpoint");

  if (claim.why.length) { claim.ok = false; failures.push(`the legacy claim is broken: ${claim.why[0]}`); }
}

// R4: the owner can rebind a credentialless legacy account, once, to a token
// or to a Prism account. A credentialed or online account is refused.
let rebind = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { rebind.ok = false; rebind.why.push(why); } };
  const prismKey = `sha256:${"c".repeat(64)}`;
  const token = "operator-delivered-token";
  const hash = tokenHash(token);

  const ghost = () => ({ kind: "legacy", name: "ghost", characters: ["ghost"], passwordHash: null, salt: null, tokenHash: null, retired: false, mergedInto: null });
  const wanderer = () => ({ kind: "legacy", name: "wanderer", characters: ["wanderer"], passwordHash: null, salt: null, tokenHash: null, retired: false, mergedInto: null });
  const character = (name) => ({ kind: "character", owner: name, name, role: 0, level: 4, xp: 350, guild: null, guildRank: null, quests: { active: [], completed: ["word"] } });
  state.accounts.ghost = ghost();
  state.identities.ghost = character("ghost");
  state.accounts.wanderer = wanderer();
  state.identities.wanderer = character("wanderer");
  state.accounts[prismKey] = { kind: "prism", name: prismKey, characters: ["keeper"], claimedFrom: null, passwordHash: null, salt: null, tokenHash: null, retired: false, mergedInto: null };
  state.identities.keeper = { ...character("keeper"), owner: prismKey };

  // The policy refuses a credentialed account, a bad hash, a bad id, and a
  // missing target before the reducer ever runs.
  check(rebindPlan(ghost(), { mode: "token", name: "ghost", tokenHash: hash }).ok, "the policy refused a credentialless token rebind");
  check(!rebindPlan({ ...ghost(), passwordHash: "h" }, { mode: "token", name: "ghost", tokenHash: hash }).ok, "the policy accepted a password account");
  check(!rebindPlan(ghost(), { mode: "token", name: "ghost", tokenHash: "short" }).ok, "the policy accepted a malformed token hash");
  check(rebindPlan(ghost(), { mode: "prism", name: "ghost", prism: prismKey.slice(7) }, state.accounts[prismKey]).ok, "the policy refused a bare Prism id");
  check(!rebindPlan(ghost(), { mode: "prism", name: "ghost", prism: prismKey }, null).ok, "the policy accepted an unknown target");
  check(normalizePrismId(prismKey) === prismKey && normalizePrismId("nope") === null, "the Prism id normalizer is wrong");
  check(ownerAllowed("secret", "secret") && !ownerAllowed("secret", "secreu") && !ownerAllowed("", "") && !ownerAllowed(undefined, "x"), "the owner token comparison is wrong");

  // Token mode: the hash is stored, the account survives, the character does
  // not move, and a second rebind is refused because a credential now exists.
  run([{ kind: "rebindLegacy", legacyKey: "ghost", mode: "token", tokenHash: hash }]);
  check(state.accounts.ghost?.tokenHash === hash, "the token hash was not stored");
  check(state.accounts.ghost?.rebound?.mode === "token" && state.accounts.ghost?.rebound?.at === 1, "the token rebind was not recorded");
  check(state.accounts.ghost?.retired === false && state.accounts.ghost?.mergedInto === null, "the token rebind retired the account");
  check(state.identities.ghost?.owner === "ghost" && state.identities.ghost?.level === 4, "the token rebind moved or reset the character");
  run([{ kind: "rebindLegacy", legacyKey: "ghost", mode: "prism", prism: prismKey }]);
  check(state.accounts.ghost?.retired === false, "a second rebind moved a token account");
  check(!state.accounts[prismKey]?.characters?.includes("ghost"), "a second rebind added the character to the target");

  // Prism mode refuses while the character is online, then moves it and
  // retires the legacy account once the character leaves.
  run([{ kind: "join", actorId: "w", name: "w" }]);
  run([{ kind: "login", actorId: "w", key: "wanderer", account: "wanderer", authenticated: true }]);
  run([{ kind: "rebindLegacy", legacyKey: "wanderer", mode: "prism", prism: prismKey }]);
  check(state.accounts.wanderer?.retired === false, "an online character was moved");
  run([{ kind: "leave", actorId: "w" }]);
  run([{ kind: "rebindLegacy", legacyKey: "wanderer", mode: "prism", prism: prismKey }]);
  check(state.accounts.wanderer?.retired === true && state.accounts.wanderer?.mergedInto === prismKey, "the Prism rebind did not tombstone the legacy account");
  check(state.accounts.wanderer?.characters?.length === 0 && state.accounts.wanderer?.passwordHash === null && state.accounts.wanderer?.tokenHash === null, "the Prism rebind left a credential or a character behind");
  check(state.accounts.wanderer?.rebound?.mode === "prism" && state.accounts.wanderer?.rebound?.to === prismKey, "the Prism rebind was not recorded");
  check(state.identities.wanderer?.owner === prismKey && state.identities.wanderer?.level === 4 && state.identities.wanderer?.xp === 350, "the Prism rebind lost progression");
  check(state.identities.wanderer?.quests?.completed?.includes("word"), "the Prism rebind lost quests");
  check(state.accounts[prismKey]?.characters?.includes("wanderer") && state.accounts[prismKey]?.characters?.includes("keeper"), "the target account did not gain the character");

  // The tombstone and the token hash survive a checkpoint and upgrade.
  const checkpointed = checkpointIdentities(state);
  const upgraded = upgradeState(checkpointed, initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests));
  check(upgraded.accounts.wanderer?.retired === true && upgraded.accounts.wanderer?.mergedInto === prismKey, "the Prism tombstone did not survive a restart");
  check(upgraded.accounts.ghost?.tokenHash === hash && upgraded.accounts.ghost?.rebound?.mode === "token", "the token hash did not survive a restart");
  check(upgraded.identities.wanderer?.owner === prismKey, "the rebind owner did not survive a restart");

  if (rebind.why.length) { rebind.ok = false; failures.push(`the legacy rebind is broken: ${rebind.why[0]}`); }
}

// The offline baseline delete removes only a bare legacy account. A live
// character, progression, a second character and any external reference refuse.
let deletion = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { deletion.ok = false; deletion.why.push(why); } };
  const bare = () => ({
    accounts: {
      casey: { kind: "legacy", name: "casey", characters: ["casey"], passwordHash: null, salt: null, tokenHash: "h", retired: false, mergedInto: null },
      keeper: { kind: "prism", name: "keeper", characters: ["keeper"], retired: false },
    },
    identities: {
      casey: { kind: "character", owner: "casey", name: "casey", level: 1, xp: 0, guild: null, guildRank: null, quests: { active: [], completed: [] } },
    },
    actors: [], mail: [], guilds: {}, duels: [], objects: [],
  });

  let state = bare();
  const removed = deleteLegacy(state, "casey");
  check(removed.ok, `a bare account was refused: ${removed.why}`);
  check(!state.accounts.casey && !state.identities.casey, "the bare account or character survived");
  check(removed.counts?.accounts === 1 && removed.counts?.identities === 0, "the delete counts are wrong");
  check(!deleteLegacy(state, "casey").ok, "a second delete was accepted");

  state = bare();
  state.actors.push({ id: "live", key: "casey", name: "casey" });
  check(!deleteLegacy(state, "casey").ok, "an online character was deleted");

  state = bare();
  state.identities.casey.level = 2;
  check(!deleteLegacy(state, "casey").ok, "a character with progression was deleted");

  state = bare();
  state.mail.push({ fromKey: "casey", toKey: "friend" });
  check(!deleteLegacy(state, "casey").ok, "a character with mail was deleted");

  state = bare();
  state.guilds.g1 = { founder: "casey", members: { casey: "leader" } };
  check(!deleteLegacy(state, "casey").ok, "a character in a guild was deleted");

  state = bare();
  state.accounts.casey.characters.push("other");
  check(!deleteLegacy(state, "casey").ok, "an account with two characters was deleted");

  state = bare();
  state.accounts.keeper.characters = ["keeper"];
  check(!deleteLegacy(state, "keeper").ok, "a Prism account was deleted");

  state = bare();
  state.objects.push({ holder: "casey" });
  check(!deleteLegacy(state, "casey").ok, "a held object was deleted with the character");

  if (deletion.why.length) { deletion.ok = false; failures.push(`the baseline delete is broken: ${deletion.why[0]}`); }
}

// The public watch layer filters private lines before anything is broadcast,
// and accepts only the four public event kinds.
let stream = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { stream.ok = false; stream.why.push(why); } };
  const raw = "The Vault is cold.\nA guard tells you a secret.\nYou tell the guard hello.\nPassword changed.\n#tick 4\nExits: north.";
  const publicText = publicStreamText(raw);
  check(publicText.includes("The Vault is cold"), "a public room line was filtered");
  check(publicText.includes("Exits: north"), "a public exit line was filtered");
  check(!/tells you/i.test(publicText), "a private tell was published");
  check(!/You tell/i.test(publicText), "the streamer's tell was published");
  check(!/Password/i.test(publicText), "a password line was published");
  check(!/#tick/.test(publicText), "a hidden tick line was published");
  check(normalizeStreamEvent({ kind: "command", text: "look", tick: 4 })?.text === "look", "a command event was refused");
  check(normalizeStreamEvent({ kind: "room", text: "The Vault" })?.text === "The Vault", "a room event was refused");
  check(normalizeStreamEvent({ kind: "status", text: "live" })?.text === "live", "a status event was refused");
  check(normalizeStreamEvent({ kind: "highlight", text: "I will search the pool.", turn: 3 })?.text === "I will search the pool.", "a highlight event was refused");
  check(normalizeStreamEvent({ kind: "poll", text: "x" }) === null, "a poll was accepted as an event kind");
  check(normalizeStreamEvent({ kind: "text", text: "A guard tells you x" }) === null, "a private-only text event was accepted");
  check(normalizeStreamEvent({ kind: "secret", text: "x" }) === null, "an unknown event kind was accepted");
  check(normalizeStreamEvent({ kind: "command", text: "x".repeat(500) })?.text.length === 240, "a command was not bounded");
  const serverText = readFileSync(join(root, "runtime/server.mjs"), "utf8");
  check(/pathname === "\/live"/.test(serverText), "the server has no /live spectator socket");
  check(/#stream-state/.test(serverText), "the server does not confirm stream state");
  check(/action === "poll"/.test(serverText) && /action === "chat"/.test(serverText), "the streamer has no poll or chat controls");
  check(/isVote/.test(serverText) && /vote a or vote b/.test(serverText), "spectators cannot vote");
  check(/\^\(stream\|metric\|session-key\|rebind\)/.test(serverText), "control verbs still consume the player rate limit");
  const page = readFileSync(join(root, "runtime/web/index.html"), "utf8");
  check(/id="ai-stream"/.test(page) && /#stream-chat/.test(page), "the AI panel has no Go live path");
  const watch = readFileSync(join(root, "runtime/web/watch.html"), "utf8");
  check(/WebSocket\(`\$\{scheme\}\/\/\$\{location\.host\}\/live`\)/.test(watch), "the watch page does not connect to /live");
  check(/function renderPoll/.test(watch) && /highlight-card/.test(watch), "the watch page has no poll or highlight");
  if (stream.why.length) { stream.ok = false; failures.push(`the public stream is broken: ${stream.why[0]}`); }
}

// Telemetry is descriptive: session, AI, world and client records aggregate
// into trends; the server-wide status is the same shape players and AIs see.
let telemetry = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { telemetry.ok = false; telemetry.why.push(why); } };
  const login = redactCommand("login ghost hunter2");
  check(login.text === null && login.policy === "secret" && !/hunter2/.test(JSON.stringify(login)), "a login command kept its secret");
  const say = redactCommand("say hello");
  check(say.text === "say hello" && say.policy === "public", "a public say was redacted");
  const tell = redactCommand("tell bob a secret");
  check(tell.text === null && tell.policy === "metadata" && tell.length > 0, "a tell kept its body");
  const intent = sanitizeIntent({ kind: "register", passwordHash: "h", salt: "s", token: "t" });
  check(intent.passwordHash === "[redacted]" && intent.salt === "[redacted]" && intent.token === "[redacted]", "an intent kept a credential");
  const cleanState = sanitizeState({ accounts: { a: { passwordHash: "h", salt: "s", tokenHash: "t" } }, mail: [{ text: "secret" }] });
  const cleanText = JSON.stringify(cleanState);
  check(!/passwordHash\":\"h|salt\":\"s|tokenHash\":\"t|secret/.test(cleanText), "a state snapshot kept a credential or mail body");
  check(cleanState.mail[0].textLength === 6, "a mail body length was lost");
  check(!/hunter2|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9]/.test(scrubSecrets("password: hunter2 key=sk-12345678 Bearer abc.def")), "scrubSecrets left a secret");
  const dirty = {
    name: "world.input",
    text: "login ghost hunter2",
  };
  const scrubInput = scrubSpan(dirty);
  check(!JSON.stringify(scrubInput).includes("hunter2") && scrubInput["command.verb"] === "login" && scrubInput["text.policy"] === "secret", "scrubSpan left a login secret");
  const scrubTick = scrubSpan({ name: "world.tick", "world.intents": JSON.stringify([{ kind: "register", passwordHash: "h", salt: "s" }]) });
  check(!/passwordHash\":\"h|salt\":\"s/.test(scrubTick["world.intents"]), "scrubSpan left a credential in intents");
  const scrubBaseline = scrubSpan({ name: "world.baseline", "world.state": JSON.stringify({ accounts: { a: { passwordHash: "h", salt: "s", tokenHash: "t" } } }) });
  check(!/passwordHash\":\"h|salt\":\"s|tokenHash\":\"t/.test(scrubBaseline["world.state"]), "scrubSpan left a credential in the baseline");
  const serverSource = readFileSync(join(root, "runtime/server.mjs"), "utf8");
  check(/redactCommand\(raw\)/.test(serverSource), "the input span does not call redactCommand");
  check(/JSON.stringify\(sanitizeState\(state\)\)/.test(serverSource), "the baseline span does not sanitize state");
  check(/intents\.map\(sanitizeIntent\)/.test(serverSource), "the tick span does not sanitize intents");
  const metric = normalizeAiTurn({
    kind: "ai.turn", provider: "openai", model: "test", latency_ms: 1234,
    prompt_tokens: 100, completion_tokens: 20, thinking_tokens: 15,
    parse_ok: true, command: "look", thought_chars: 40, turn: 2, tick: 9,
  });
  check(metric?.latency_ms === 1234 && metric?.command === "look", "a valid AI turn metric was refused");
  check(normalizeAiTurn({ kind: "other", provider: "x" }) === null, "an unknown metric kind was accepted");
  check(normalizeAiTurn({ kind: "ai.turn", provider: "x", error: "x".repeat(500) })?.error.length === 200, "an error string was not bounded");
  const attrs = aiTurnAttributes(metric);
  check(attrs["ai.latency_ms"] === 1234 && attrs["ai.command"] === "look", "the AI turn attributes are wrong");

  const spans = [
    { name: "world.client", at: "2026-11-17T00:00:00Z", "client.transport": "websocket" },
    { name: "world.disconnect", at: "2026-11-17T00:01:00Z", duration_ms: 60000, "client.transport": "websocket" },
    { name: "world.session", at: "2026-11-17T00:00:30Z", "session.kind": "login" },
    { name: "ai.turn", at: "2026-11-17T00:00:40Z", "ai.latency_ms": 1000, "ai.parse_ok": true, "ai.command": "look", "ai.prompt_tokens": 10, "ai.completion_tokens": 2, "ai.provider": "openai" },
    { name: "ai.turn", at: "2026-11-17T00:00:45Z", "ai.latency_ms": 3000, "ai.parse_ok": false, "ai.error": "timeout", "ai.timeout": true, "ai.provider": "openai" },
    { name: "world.input", at: "2026-11-17T00:00:41Z", text: "look" },
    { name: "world.input", at: "2026-11-17T00:00:42Z", text: "north" },
    { name: "world.input", at: "2026-11-17T00:00:43Z", text: "slow", refused: "too-fast" },
    { name: "world.snapshot", at: "2026-11-17T00:01:00Z", "world.online": 1, "world.reset_seconds": 3600, "world.accounts": 2, "world.characters": 2, "world.actors": JSON.stringify([{ name: "alice", level: 4 }]) },
  ];
  const trends = summarizeTrends(spans);
  check(trends.ai.turns === 2 && trends.ai.parsed === 0.5, "the AI trend counts are wrong");
  check(trends.ai.latency_ms.p50 === 1000 && trends.ai.latency_ms.max === 3000, "the AI latency percentiles are wrong");
  check(trends.commands.accepted === 2 && trends.commands.refused === 1, "the command trend counts are wrong");
  check(trends.world.online.latest === 1 && trends.world.levels.max === 4, "the world trend counts are wrong");
  check(trends.clients.connections === 1 && trends.clients.sessions === 1, "the client trend counts are wrong");

  const statusWorld = loadWorld({ mode: "single" });
  let statusState = initialState(statusWorld.rooms, statusWorld.npcs, statusWorld.objects, statusWorld.start, statusWorld.climate, channelTable.channels, statusWorld.levels, questTable.quests);
  statusState.actors.push({ id: "t1", key: "alice", account: "alice", name: "alice", room: statusWorld.start, level: 4, xp: 350, hp: 12, maxHp: 16, guild: null, guildRank: null, quests: { active: [], completed: [] }, wielding: "lamp6" });
  statusState.objects.push({ id: "lamp6", name: "a brass lamp", holder: "t1", worn: false, room: null });
  statusState.objects.push({ id: "cloak6", name: "a grey cloak", holder: "t1", worn: true, room: null });
  const status = worldStatus(statusState, statusWorld.rooms);
  check(status.online === 1 && status.actors[0]?.level === 4 && status.actors[0]?.wielded === "a brass lamp", "the world status actor is wrong");
  check(status.actors[0]?.worn?.includes("a grey cloak") && status.actors[0]?.inventory === 1, "the world status equipment count is wrong");
  check(status.reset.seconds > 0 && status.rooms > 0, "the world status reset or rooms are wrong");
  check(worldStatusText(status).includes("alice") && worldStatusText(status).includes("level 4"), "the human world status is missing the actor");

  if (telemetry.why.length) { telemetry.ok = false; failures.push(`the telemetry foundation is broken: ${telemetry.why[0]}`); }
}

// The state file is atomic, backed up, and fail-loud.
let durableState = { ok: true, why: [] };
{
  const dir = mkdtempSync(join(tmpdir(), "mudbench-state-"));
  const file = join(dir, "world.json");
  const initial = () => ({ identities: {}, tick: 0 });
  const restore = (raw) => ({ ...raw, restored: true });
  const missing = loadStateFile(file, { initial, restore });
  if (missing.restored) durableState.why.push("a missing state file was treated as a restore");
  saveStateFile(file, { identities: { a: { name: "a" } }, tick: 1 });
  const loaded = loadStateFile(file, { initial, restore });
  if (!loaded.restored || loaded.identities.a?.name !== "a") durableState.why.push("a saved state did not load");
  saveStateFile(file, { identities: { a: { name: "a2" } }, tick: 2 });
  if (!existsSync(`${file}.1`)) durableState.why.push("no backup was written");
  writeFileSync(file, "{broken");
  const fromBackup = loadStateFile(file, { initial, restore });
  if (fromBackup.identities.a?.name !== "a") durableState.why.push("the backup was not restored");
  writeFileSync(file, "{broken");
  writeFileSync(`${file}.1`, "{broken");
  let refused = false;
  try { loadStateFile(file, { initial, restore }); } catch { refused = true; }
  if (!refused) durableState.why.push("a corrupt state and backup did not refuse to start");
  rmSync(dir, { recursive: true, force: true });
  if (durableState.why.length) { durableState.ok = false; failures.push(`state durability is broken: ${durableState.why[0]}`); }
}

// The Prism session verifier: a committed signed session, a wrong origin, expiry.
let prismSession = { ok: true, why: [] };
{
  const fixture = JSON.parse(readFileSync(join(root, "world/fixtures/prism-session.json"), "utf8"));
  const at = fixture.envelope.body.at;
  const good = await verifyPrismSession(fixture, { origin: fixture.app, now: at });
  if (!good.ok || good.prism !== fixture.envelope.body.prism) prismSession.why.push(`a signed session was refused: ${good.reason ?? "no id"}`);
  const wrong = await verifyPrismSession(fixture, { origin: "https://evil.example", now: at });
  if (wrong.ok) prismSession.why.push("a session for another origin was accepted");
  const expired = await verifyPrismSession(fixture, { origin: fixture.app, now: fixture.envelope.body.payload.expires + 1 });
  if (expired.ok) prismSession.why.push("an expired session was accepted");
  if (prismSession.why.length) { prismSession.ok = false; failures.push(`the Prism verifier is broken: ${prismSession.why[0]}`); }
}

// L3: the session key challenge. A stolen token without the private key cannot
// answer; a signature for another nonce or counter is refused.
let sessionChallenge = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { sessionChallenge.ok = false; sessionChallenge.why.push(why); } };
  const origin = "https://play.r4labs.org";
  const now = Date.now();
  const session = await createPrism({});
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
  const envelope = await signAction(session, "prism/session/1", { sessionKey: raw, expires: now + 10 * 60 * 1000 }, { audience: origin, now });
  const verdict = await verifyPrismSession({ app: origin, envelope, records: [...session.log.values()] }, { origin, now });
  check(verdict.ok && verdict.sessionKey === raw, "the verifier did not return the session key");
  const nonce = "gate-session-nonce";
  const message = `prism/session-key/1 ${nonce} 0`;
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, Buffer.from(message))).toString("base64url");
  check(await verifySessionKey(verdict.sessionKey, nonce, 0, signature), "a valid session-key signature was refused");
  check(!(await verifySessionKey(verdict.sessionKey, nonce, 1, signature)), "a session-key signature was accepted for another counter");
  check(!(await verifySessionKey(verdict.sessionKey, "other-nonce", 0, signature)), "a session-key signature was accepted for another nonce");
  const thief = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const thiefSignature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, thief.privateKey, Buffer.from(message))).toString("base64url");
  check(!(await verifySessionKey(verdict.sessionKey, nonce, 0, thiefSignature)), "a stolen token answered with another key");
  if (sessionChallenge.why.length) { sessionChallenge.ok = false; failures.push(`the session-key challenge is broken: ${sessionChallenge.why[0]}`); }
}

// One accepted command per 250 ms, on every transport.
let allowance = { ok: true, why: [] };
{
  if (DEFAULT_INTERVAL_MS !== 250) { allowance.ok = false; allowance.why.push("the default interval is not 250 ms"); }
  if (!allowCommand(0, 1000)) { allowance.ok = false; allowance.why.push("the first command was refused"); }
  if (allowCommand(1000, 1100)) { allowance.ok = false; allowance.why.push("a command 100 ms later was accepted"); }
  if (allowCommand(1000, 1249)) { allowance.ok = false; allowance.why.push("a command 249 ms later was accepted"); }
  if (!allowCommand(1000, 1250)) { allowance.ok = false; allowance.why.push("a command 250 ms later was refused"); }
  if (!allowance.ok) failures.push(`the input allowance is broken: ${allowance.why[0]}`);
}

// A safe room refuses combat; an unsafe one begins it. The two-hour reset is
// the world's clock, not a heartbeat.
let safe = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  if (!world.rooms[1].safe || world.rooms[2].safe) { safe.ok = false; safe.why.push("the safe flags are wrong"); }
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 1, home: 1 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels);
  if (state.pulses.area.period !== AREA_PERIOD || AREA_PERIOD !== 28_800) { safe.ok = false; safe.why.push("the area reset is not two hours"); }
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  if (state.engagements.length !== 0) { safe.ok = false; safe.why.push("an attack began in a safe room"); }
  state.actors[0].room = 2;
  const guard = state.npcs.find((npc) => npc.id === "guard");
  guard.room = 2;
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  if (state.engagements.length !== 2) { safe.ok = false; safe.why.push("an attack in an unsafe room did not engage both sides"); }
  if (!safe.ok) failures.push(`safe rooms are broken: ${safe.why[0]}`);
}

// The model's context is a bounded window, not an ever-growing transcript.
let memory = { ok: true, why: [] };
{
  const messages = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 30; i += 1) messages.push({ role: i % 2 ? "assistant" : "user", content: String(i) });
  const trimmed = trimMessages(messages, 2);
  if (trimmed.length !== 5 || trimmed[0].content !== "sys") { memory.ok = false; memory.why.push("the system prompt or the last two turns were not kept"); }
  if (trimmed.at(-1).content !== "29") { memory.ok = false; memory.why.push("the newest turn was dropped"); }
  const noSystem = trimMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }], 1);
  if (noSystem.length !== 2 || noSystem.at(-1).content !== "c") { memory.ok = false; memory.why.push("a systemless window is wrong"); }
  if (DEFAULT_TURNS !== 12) { memory.ok = false; memory.why.push("the default window is not twelve turns"); }
  if (!memory.ok) failures.push(`the memory window is broken: ${memory.why[0]}`);
}

// Combat must actually resolve: an attack on a 12 hp guard kills it, round by
// round, and the damage reported sums to exactly its hit points. A duplicated
// span would double the sum, a missing round would fall short of it.
let combat = { rounds: 0, damage: 0, outcome: null, dead: false, afterDeath: 0, hpTraceOk: true };
// The generator must still produce variety when the world is old. Its multiply
// used to be done in doubles, whose low bits vanish after about tick 409,000 —
// every NPC then walked one way forever. A cheap assertion buys that back.
const oldSeed = 500000 * 31 + 4;
const oldDirs = new Set([0, 1, 2, 3].map((k) => nextFrom(oldSeed + k, 4)));
{
  const world = loadWorld({ mode: "single" });
  const guardHome = world.npcs.find((npc) => npc.id === "guard");
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 2, home: 2, damage: 0 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start);
  state = step({ state, rooms: world.rooms, intents: [{ kind: "join", actorId: "gate", name: "gate" }] }).state;
  state.actors[0].room = 2;
  state = step({ state, rooms: world.rooms, intents: [{ kind: "attack", actorId: "gate", targetId: "guard" }] }).state;

  for (let i = 0; i < 100; i += 1) {
    const { state: next, events } = step({ state, rooms: world.rooms, intents: [] });
    for (const event of events) {
      if (!event.combat || event.combat.target !== "guard") continue;
      // Hit points must fall by exactly the damage reported. A duplicated span
      // makes the trace jump; a missing round leaves it too high.
      combat.rounds += 1;
      combat.damage += event.combat.damage;
      combat.outcome = event.combat.outcome;
      if (combat.dead) combat.afterDeath += 1;
      if (event.combat.outcome === "killed") combat.dead = true;
      const expected = (combat.hpBefore ?? guardHome?.hp ?? 12) - event.combat.damage;
      if (event.combat.outcome === "killed" ? event.combat.hp !== 0 || expected > 0 : event.combat.hp !== expected) {
        combat.hpTraceOk = false;
      }
      combat.hpBefore = event.combat.hp;
    }
    state = next;
  }
  const guard = state.npcs.find((npc) => npc.id === "guard");
  combat.remainingHp = guard?.hp;
  combat.engagementsLeft = state.engagements.length;
  if (!guardHome) failures.push("the world has no guard to fight");
  if (oldDirs.size < 2) failures.push("the world's generator collapses at tick 500,000 — old worlds stop varying");
  if (!combat.hpTraceOk) failures.push("the combat hit-point trace does not fall by the damage each round — spans are missing or duplicated");
  if (combat.damage < (guardHome?.hp ?? 0)) failures.push(`combat dealt ${combat.damage} damage to a ${guardHome?.hp} hp guard — spans are missing`);
  if (combat.outcome !== "killed") failures.push(`40 ticks of combat never killed the guard (last outcome ${combat.outcome})`);
  if (!guard?.dead) failures.push("a guard that reached zero hit points is not dead");
  if (combat.afterDeath > 0) failures.push(`combat continued after death (${combat.afterDeath} extra rounds)`);
  if (combat.engagementsLeft !== 0) failures.push(`a finished engagement is still open (${combat.engagementsLeft})`);
}

// Item properties must actually change the world, and the area reset must put
// them back. Each step here is a state change a player can reach.
let items = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { items.ok = false; items.why.push(why); } };

  run([{ kind: "join", actorId: "gate", name: "gate" }]);
  state.actors[0].room = 2;

  run([{ kind: "open", actorId: "gate", objectId: "chest", messages: say("open") }]);
  run([{ kind: "takeFrom", actorId: "gate", objectId: "copper", containerId: "chest", messages: say("takeFrom") }]);
  check(object("copper").holder === "gate", "a coin could not be taken from an open chest");

  run([{ kind: "put", actorId: "gate", objectId: "copper", containerId: "chest", messages: say("put") }]);
  check(object("copper").inside === "chest", "a coin could not be put back in an open chest");

  run([{ kind: "close", actorId: "gate", objectId: "chest", messages: say("close") }]);
  run([{ kind: "takeFrom", actorId: "gate", objectId: "copper", containerId: "chest", messages: say("takeFrom") }]);
  check(object("copper").inside === "chest", "a closed chest gave up its contents");

  run([{ kind: "wear", actorId: "gate", objectId: "cloak", messages: say("wear") }]);
  check(!object("cloak").worn, "a cloak in another room could be worn from a distance");

  state.actors[0].room = 1;
  run([{ kind: "take", actorId: "gate", objectId: "cloak", messages: say("take") }]);
  run([{ kind: "wear", actorId: "gate", objectId: "cloak", messages: say("wear") }]);
  check(object("cloak").worn, "a carried cloak could not be worn");
  run([{ kind: "remove", actorId: "gate", objectId: "cloak", messages: say("remove") }]);
  check(!object("cloak").worn, "a worn cloak could not be removed");
  run([{ kind: "drop", actorId: "gate", objectId: "cloak", messages: say("drop") }]);

  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "gate", objectId: "bread", messages: say("take") }]);
  run([{ kind: "eat", actorId: "gate", objectId: "bread", messages: say("eat") }]);
  check(object("bread").bites === 1 && !object("bread").eaten, "one bite finished a two-bite loaf");
  run([{ kind: "eat", actorId: "gate", objectId: "bread", messages: say("eat") }]);
  check(object("bread").eaten, "a finished loaf is still in the world");

  // The old MUD reset: force the two-hour pulse and require everything home.
  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(!object("bread").eaten && object("bread").room === 5, "the area reset did not restore the eaten loaf");
  check(object("chest").inside === null && object("copper").inside === "chest", "the area reset did not return the coin to the chest");
  check(object("chest").open === false, "the area reset left the chest open");
  check(object("cloak").room === 1 && !object("cloak").worn, "the area reset did not return the cloak");
  if (!items.ok) failures.push(`item properties are broken: ${items.why[0]}`);
}

// Time and weather must move, and the night must change behaviour: a speaker
// sleeps when the world is dark and talks when it is light.
let climate = { ok: true, why: [], changes: 0, nightTalk: 0, dayTalk: 0 };
{
  const world = loadWorld({ mode: "single" });
  const hour = world.climate.dayLength / 24;
  const at = (h) => phaseAt(Math.round(h * hour), world.climate);
  if (at(0) !== "night" || at(9) !== "day" || at(18) !== "dusk") {
    climate.ok = false;
    climate.why.push(`phases are wrong: 00=${at(0)}, 09=${at(9)}, 18=${at(18)}`);
  }

  const speaker = { id: "gate-speaker", name: "a gate speaker", room: 1, home: 1, period: 1, jitter: 0, behaviour: "speaker", phrases: ["gate speaks"], hp: 1 };
  const npcs = world.npcs.filter((n) => n.id !== "bard").concat(speaker);
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate);

  for (let i = 0; i < world.climate.weatherPeriod + 2; i += 1) {
    const result = step({ state, rooms: world.rooms, intents: [] });
    state = result.state;
    for (const event of result.events) {
      if (event.weather) {
        climate.changes += 1;
        if (event.weather.from === event.weather.to) {
          climate.ok = false;
          climate.why.push("the weather changed to the state it was already in");
        }
      }
    }
  }
  if (climate.changes === 0) {
    climate.ok = false;
    climate.why.push("the weather never changed");
  }

  const countSpeaker = (from) => {
    let local = { ...state, tick: from, npcs: state.npcs.map((n) => ({ ...n, clock: { period: 1, remaining: 1 } })) };
    let spoken = 0;
    for (let i = 0; i < 6; i += 1) {
      const result = step({ state: local, rooms: world.rooms, intents: [] });
      local = result.state;
      spoken += result.events.filter((event) => event.source === speaker.id).length;
    }
    return spoken;
  };
  climate.nightTalk = countSpeaker(0);
  climate.dayTalk = countSpeaker(Math.round(12 * hour));
  if (climate.nightTalk !== 0) {
    climate.ok = false;
    climate.why.push("a speaker talked through the night");
  }
  if (climate.dayTalk === 0) {
    climate.ok = false;
    climate.why.push("a speaker stayed silent by day");
  }
  if (!climate.ok) failures.push(`climate is broken: ${climate.why[0]}`);
}

// A checkpoint written by an older release must still load. This is the exact
// failure a real deployment found: v0.4.0 crashed on a v0.3.0 save because the
// violence pulse did not exist when the save was written.
let resume = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const base = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const saved = JSON.parse(JSON.stringify(base));
  saved.tick = 12345;
  saved.identities = { old: { name: "old", room: 1, visited: [1], role: 0, tokenHash: null } };
  delete saved.pulses.violence;
  delete saved.climate;
  delete saved.weather;
  delete saved.engagements;
  delete saved.cycle;
  saved.objects = saved.objects.filter((o) => o.id !== "chest");
  saved.mail = [{ id: "mail-old", from: "alice", fromKey: "alice", toKey: "bob", text: "old letter", tick: 7, read: false }];
  const savedCoin = saved.objects.find((o) => o.id === "coin");
  savedCoin.flags = ["takeable"];
  const cloak = saved.objects.find((o) => o.id === "cloak");
  delete cloak.inside;
  delete cloak.worn;
  delete cloak.open;

  const upgraded = upgradeState(saved, base);
  if (upgraded.tick !== 12345) { resume.ok = false; resume.why.push("the tick was not preserved"); }
  if (!upgraded.pulses.violence) { resume.ok = false; resume.why.push("the violence pulse was not restored"); }
  if (upgraded.pulses.area.period !== AREA_PERIOD) { resume.ok = false; resume.why.push("the area pulse did not migrate to two hours"); }
  if (!upgraded.climate?.weather?.length) { resume.ok = false; resume.why.push("the climate was not restored"); }
  if (!upgraded.mail?.some((letter) => letter.id === "mail-old")) { resume.ok = false; resume.why.push("mail was lost on resume"); }
  if (!Array.isArray(upgraded.channels) || upgraded.channels.length === 0) { resume.ok = false; resume.why.push("channels were not restored"); }
  if (upgraded.identities.old?.level !== 1 || upgraded.identities.old?.xp !== 0 || upgraded.identities.old?.guild !== null) { resume.ok = false; resume.why.push("an old identity did not gain the progression fields"); }
  if ("inventory" in (upgraded.identities.old ?? {}) || "room" in (upgraded.identities.old ?? {})) { resume.ok = false; resume.why.push("an old identity kept session state"); }
  if (!Array.isArray(upgraded.engagements)) { resume.ok = false; resume.why.push("engagements were not restored"); }
  const chest = upgraded.objects.find((o) => o.id === "chest");
  if (!chest || chest.home === undefined) { resume.ok = false; resume.why.push("a newly added object is missing after resume"); }
  const restoredCoin = upgraded.objects.find((o) => o.id === "coin");
  if (!(restoredCoin.flags ?? []).includes("coin")) { resume.ok = false; resume.why.push("an object lost a flag the new model gave it"); }
  const restoredCloak = upgraded.objects.find((o) => o.id === "cloak");
  if (restoredCloak.worn !== false || restoredCloak.inside !== null) { resume.ok = false; resume.why.push("an old object kept an undefined property"); }

  const dropped = JSON.parse(JSON.stringify(upgraded));
  dropped.actors = [{ id: "lost", room: 3, name: "lost" }];
  const heldCoin = dropped.objects.find((o) => o.id === "coin");
  heldCoin.holder = "lost";
  heldCoin.room = null;
  const heldScroll = dropped.objects.find((o) => o.id === "scroll");
  heldScroll.holder = "lost";
  heldScroll.room = null;
  releaseHeldObjects(dropped, dropped.actors);
  if (heldCoin.holder !== null || heldCoin.room !== 3) { resume.ok = false; resume.why.push("a vanished player's coin was not released where they stood"); }
  if (heldScroll.holder !== null || heldScroll.room !== 3) { resume.ok = false; resume.why.push("a vanished player's scroll was not released where they stood"); }

  try {
    let state = upgraded;
    for (let i = 0; i < 10; i += 1) state = step({ state, rooms: world.rooms, intents: [] }).state;
  } catch (error) {
    resume.ok = false;
    resume.why.push(`stepping an upgraded save threw: ${error.message}`);
  }
  if (!resume.ok) failures.push(`resuming an old world is broken: ${resume.why[0]}`);
}

// A shop must sell only what it offers, take only what it is owed, and put the
// stock back when the area resets.
let shop = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { shop.ok = false; shop.why.push(why); } };
  const shopHere = world.shops.find((s) => s.room === 3);
  if (!shopHere) { shop.ok = false; shop.why.push("the world has no shop"); }

  run([{ kind: "join", actorId: "gate", name: "gate" }]);
  state.actors[0].room = 3;

  // Shoplifting: taking the lamp must not work.
  run([{ kind: "take", actorId: "gate", objectId: "lamp", messages: say("take") }]);
  check(object("lamp").room === 3 && object("lamp").forSale, "the lamp walked out of the shop for free");

  // Buying without money must not work.
  run([{ kind: "buy", actorId: "gate", objectId: "lamp", room: 3, coinIds: [], messages: say("buy") }]);
  check(object("lamp").forSale, "the shop sold a lamp to someone with no coins");

  // Find the silver coin and buy: 10 paid for an 8 coin lamp, no change.
  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "gate", objectId: "coin", messages: say("take") }]);
  check(object("coin").holder === "gate", "the silver coin could not be picked up");
  state.actors[0].room = 3;
  run([{ kind: "buy", actorId: "gate", objectId: "lamp", room: 3, coinIds: ["coin"], messages: say("buy") }]);
  check(object("lamp").holder === "gate" && !object("lamp").forSale, "the lamp was not bought");
  check(object("coin").room === 3, "the shop did not take the coins");

  // Selling: a 6-value cloak pays 3 copper, minted for the sale.
  state.actors[0].room = 1;
  run([{ kind: "take", actorId: "gate", objectId: "cloak", messages: say("take") }]);
  state.actors[0].room = 3;
  run([{ kind: "sell", actorId: "gate", objectId: "cloak", room: 3, messages: say("sell") }]);
  const minted = state.objects.filter((o) => o.ephemeral && o.holder === "gate");
  check(object("cloak").eaten, "a sold cloak is still in the world");
  check(minted.length === 3 && minted.every((c) => c.value === 1), `selling a 6-value cloak paid ${minted.length} coins`);

  // Reset: every object goes home, stock returns, sold things return, minted
  // coins are swept up.
  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(object("lamp").room === 3 && object("lamp").forSale, "the reset did not return the lamp to the shop");
  check(object("torch").room === 3 && object("torch").forSale, "the reset did not return the torch to the shelf");
  check(!object("cloak").eaten && object("cloak").room === 1, "the reset did not return the sold cloak");
  check(state.objects.every((o) => !o.ephemeral), "the reset left minted coins in the world");
  if (!shop.ok) failures.push(`the shop is broken: ${shop.why[0]}`);
}

// Communication must cross the right boundaries: a say stays in the room, a
// tell reaches one person, a channel reaches everyone, mail waits for an
// absent identity, and a social gives each listener exactly one line.
let comms = { ok: true, why: [], said: 0, told: 0, mailed: 0, gestured: 0 };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const check = (condition, why) => { if (!condition) { comms.ok = false; comms.why.push(why); } };
  const lines = (events) => events.filter((event) => event.onlyId !== undefined);

  run([
    { kind: "join", actorId: "a", name: "alice" },
    { kind: "join", actorId: "b", name: "bob" },
    { kind: "join", actorId: "c", name: "carol" },
  ]);
  run([
    { kind: "login", actorId: "a", key: "alice", token: null, role: 3, authenticated: true },
    { kind: "login", actorId: "b", key: "bob", token: null, role: 0, authenticated: true },
    { kind: "login", actorId: "c", key: "carol", token: null, role: 0, authenticated: true },
  ]);
  run([{ kind: "move", actorId: "b", dir: "north", to: 2 }]);

  comms.said = lines(run([{ kind: "say", actorId: "a", text: "hello", messages: { actor: "A", others: "O" } }])).length;
  check(comms.said === 1, "a say did not stay in its room");

  const gossip = lines(run([{ kind: "channel", actorId: "a", channelId: "gossip", messages: { actor: "CA", others: "CO" } }]));
  check(gossip.length === 3, `gossip reached ${gossip.length} of 3 awake actors`);
  const global = lines(run([{ kind: "channel", actorId: "a", channelId: "global", messages: { actor: "GA", others: "GO" } }]));
  check(global.length === 3, `global reached ${global.length} of 3 awake actors`);

  const wizard = lines(run([{ kind: "channel", actorId: "a", channelId: "wizards", messages: { actor: "WA", others: "WO" } }]));
  check(wizard.length === 3, "a role-3 actor could not use the wizards channel");
  const refused = lines(run([{ kind: "channel", actorId: "c", channelId: "wizards", messages: { actor: "WA", others: "WO" } }]));
  check(refused.length === 0, "a role-0 actor spoke on the wizards channel");

  const told = lines(run([{ kind: "tell", actorId: "a", targetId: "b", messages: { actor: "TA", target: "TB" } }]));
  comms.told = told.length;
  check(told.length === 2 && told.some((e) => e.text === "TB"), "a tell did not reach exactly its target");

  const mailed = lines(run([{ kind: "mail", actorId: "a", toKey: "bob", text: "first", messages: { actor: "MA", target: "MB" } }]));
  comms.mailed = mailed.length;
  check(mailed.length === 2, "mail to someone online did not reach them");
  check(state.mail.filter((l) => l.read).length === 1, "mail delivered online was not marked read");

  run([{ kind: "leave", actorId: "b" }]);
  const queued = lines(run([{ kind: "mail", actorId: "a", toKey: "bob", text: "second", messages: { actor: "MA", target: "MB" } }]));
  check(queued.length === 1, "mail to an absent identity was delivered to nobody or to the room");
  check(state.mail.some((l) => l.text === "second" && !l.read), "mail to an absent identity was not stored");

  run([{ kind: "join", actorId: "b2", name: "bob" }]);
  const delivered = lines(run([{ kind: "login", actorId: "b2", key: "bob", token: null, authenticated: true }]));
  check(delivered.some((e) => e.text.includes("second")), "a letter did not arrive on login");

  run([{ kind: "move", actorId: "b2", dir: "north", to: 2 }]);
  run([{ kind: "move", actorId: "a", dir: "north", to: 2 }]);
  const wave = lines(run([{ kind: "social", actorId: "a", targetId: "b2", messages: {
    actor: "WA", others: "WO", target: "WT", targeted: "WYOU", targetOthers: "WTO", self: "WS", selfOthers: "WSO",
  } }]));
  comms.gestured = wave.length;
  check(wave.length === 2, `a targeted social produced ${wave.length} lines for two people`);
  check(wave.some((e) => e.text === "WYOU") && wave.some((e) => e.text === "WT"), "the target and the actor did not get different lines");

  const shrug = lines(run([{ kind: "social", actorId: "a", targetId: null, messages: {
    actor: "UA", others: "UO", target: "UT", targeted: "UYOU", targetOthers: "UTO", self: "US", selfOthers: "USO",
  } }]));
  check(shrug.length === 2 && shrug.some((e) => e.text === "UO"), "an untargeted social did not reach the room once");

  if (!comms.ok) failures.push(`communication is broken: ${comms.why[0]}`);
}

// A character must survive a logout and a restart with the same room, the same
// hands and the same things inside the bag. The area reset must not take them.
let persistence = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => {
    const result = step({ state, rooms: world.rooms, intents });
    state = result.state;
    return result.events;
  };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { persistence.ok = false; persistence.why.push(why); } };

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);
  state.actors[0].level = 3;
  state.actors[0].xp = 120;
  state.guilds.wardens = { id: "wardens", name: "Wardens", founder: "alice", created: 0, members: { alice: "leader" }, invites: [] };
  state.actors[0].guild = "wardens";
  state.actors[0].guildRank = "leader";
  state.actors[0].quests = { active: [{ id: "word", progress: {} }], completed: ["scroll"] };
  run([{ kind: "take", actorId: "a", objectId: "satchel", messages: say("take") }]);
  run([{ kind: "take", actorId: "a", objectId: "cloak", messages: say("take") }]);
  run([{ kind: "put", actorId: "a", objectId: "cloak", containerId: "satchel", messages: say("put") }]);
  run([{ kind: "move", actorId: "a", dir: "north", to: 2 }]);
  run([{ kind: "take", actorId: "a", objectId: "scroll", messages: say("take") }]);
  run([{ kind: "leave", actorId: "a" }]);

  check(object("satchel").holder === null && object("satchel").room === 2, "a bag was not left where the character stood");
  check(object("scroll").holder === null && object("scroll").room === 2, "a carried scroll was not left where the character stood");
  check(object("cloak").inside === "satchel", "a bag lost what was inside it on logout");
  check(state.identities.alice.inventory === undefined, "the identity recorded an inventory it should not keep");
  check(state.identities.alice.level === 3 && state.identities.alice.xp === 120, "progression was not written on logout");
  check(state.identities.alice.guild === "wardens" && state.identities.alice.guildRank === "leader" && state.identities.alice.quests.completed.includes("scroll"), "guild or quest progress was lost on logout");

  run([{ kind: "join", actorId: "b", name: "alice" }]);
  run([{ kind: "login", actorId: "b", key: "alice", token: null, authenticated: true }]);
  const returning = state.actors.find((actor) => actor.id === "b");
  check(returning.room === 1, "the returning character did not wake at the start");
  check(returning.level === 3 && returning.xp === 120, "level or experience was not restored on login");
  check(returning.guild === "wardens" && returning.guildRank === "leader" && returning.quests.completed.includes("scroll"), "guild or quest progress was not restored on login");
  check(state.objects.every((o) => o.holder !== "b"), "items were restored to a hand across logout");
  check(object("satchel").room === 2 && object("scroll").room === 2, "logout items did not stay in the world");

  run([{ kind: "join", actorId: "c", name: "alice" }]);
  const second = run([{ kind: "login", actorId: "c", key: "alice", token: null, authenticated: true }]);
  check(second.some((event) => /already signed in/.test(event.text)), "a second sign-in with the same name was allowed");

  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(object("satchel").room === 1 && object("cloak").room === 1, "the reset did not return the dropped bag and cloak home");
  check(object("scroll").room === 2, "the reset did not return the dropped scroll home");
  check(object("cloak").inside === null, "the reset left an item inside a bag");

  checkpointIdentities(state);
  check(state.identities.alice.level === 3 && state.identities.alice.quests.active.some((q) => q.id === "word"), "checkpoint lost progression");
  check(!("room" in state.identities.alice) && !("visited" in state.identities.alice), "checkpoint wrote session state");
  const restarted = JSON.parse(JSON.stringify(state));
  const savedActors = state.actors;
  restarted.actors = [];
  releaseHeldObjects(restarted, savedActors);
  const joined = step({ state: restarted, rooms: world.rooms, intents: [{ kind: "join", actorId: "d", name: "alice" }] });
  const result = step({ state: joined.state, rooms: world.rooms, intents: [{ kind: "login", actorId: "d", key: "alice", token: null, authenticated: true }] });
  state = result.state;
  const afterRestart = state.actors.find((actor) => actor.id === "d");
  check(afterRestart.room === 1, "a restart did not start the character at the start room");
  check(afterRestart.level === 3 && afterRestart.xp === 120, "a restart lost level or experience");
  check(afterRestart.guild === "wardens" && afterRestart.quests.active.some((q) => q.id === "word"), "a restart lost guild or quest progress");
  check(state.objects.every((o) => o.holder !== "d"), "a restart restored items to a hand");

  if (!persistence.ok) failures.push(`persistence is broken: ${persistence.why[0]}`);
}

// Weapons, armour, food, flight and levels must all change the world.
let combat2 = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const levelTable = loadLevels();
  if (levelTable.errors.length > 0) { combat2.ok = false; combat2.why.push(`levels are invalid: ${levelTable.errors[0]}`); }
  const npcs = world.npcs.map((npc) => (npc.id === "guard" ? { ...npc, room: 2, home: 2, damage: 0 } : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels, levelTable.levels);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { combat2.ok = false; combat2.why.push(why); } };

  const bare = attackRoll({ tick: 10, attackerId: "x", weaponDamage: 0, targetArmor: 0 });
  const armed = attackRoll({ tick: 10, attackerId: "x", weaponDamage: 3, targetArmor: 0 });
  if (bare.hit) check(armed.damage === bare.damage + 3, "a weapon did not add its damage");
  let armourMatters = false;
  for (let tick = 0; tick < 1000 && !armourMatters; tick += 1) {
    const open = attackRoll({ tick, attackerId: "x", weaponDamage: 0, targetArmor: 0 });
    const closed = attackRoll({ tick, attackerId: "x", weaponDamage: 0, targetArmor: 100 });
    if (open.hit && open.chance > 5 && !closed.hit) armourMatters = true;
  }
  check(armourMatters, "armour did not reduce the chance to hit");

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);
  state.actors[0].room = 9;
  state.objects.find((o) => o.id === "sword").forSale = false;
  state.objects.find((o) => o.id === "jerkin").forSale = false;
  run([{ kind: "take", actorId: "a", objectId: "sword", messages: say("take") }]);
  run([{ kind: "take", actorId: "a", objectId: "jerkin", messages: say("take") }]);
  run([{ kind: "wield", actorId: "a", objectId: "sword", messages: say("wield") }]);
  run([{ kind: "wear", actorId: "a", objectId: "jerkin", messages: say("wear") }]);
  check(state.actors[0].wielding === "sword", "wielding did not take");
  check(armorOf(state.actors[0], state.objects) === 1, "worn armour was not counted");

  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "a", objectId: "bread", messages: say("take") }]);
  state.actors[0].hp = 5;
  run([{ kind: "eat", actorId: "a", objectId: "bread", messages: say("eat") }]);
  check(state.actors[0].hp === 7, `one bite healed to ${state.actors[0].hp} instead of 7`);
  run([{ kind: "eat", actorId: "a", objectId: "bread", messages: say("eat") }]);
  check(state.actors[0].hp === 9, `two bites healed to ${state.actors[0].hp} instead of 9`);

  state.actors[0].room = 2;
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  check(state.engagements.length === 2, "a PvE attack did not engage both sides");
  run([{ kind: "flee", actorId: "a", dir: "east", to: 4, messages: { actor: "FA", others: "FO" } }]);
  check(state.engagements.length === 0 && state.actors[0].room === 4, "flee did not end the fight and move");

  state.actors[0].room = 2;
  state.actors[0].xp = 95;
  const guard = state.npcs.find((npc) => npc.id === "guard");
  guard.hp = 1;
  guard.loot = ["boar-tusk"];
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  for (let i = 0; i < 120; i += 1) run([]);
  check(state.actors[0].level === 2 && state.actors[0].xp >= 107, `a kill did not grant experience and a level (level ${state.actors[0].level}, xp ${state.actors[0].xp})`);
  check(state.actors[0].maxHp === 12, "a level did not raise maximum hit points");
  const tusk = state.objects.find((object) => object.id === "boar-tusk");
  check(tusk.room === 2 && tusk.holder === null, "mob loot did not fall in the death room");

  // PvP: a second player in an unsafe room is a target; death wakes them at the
  // start and the killer gains experience.
  run([{ kind: "join", actorId: "b", name: "bob" }]);
  run([{ kind: "login", actorId: "b", key: "bob", token: null, authenticated: true }]);
  state.actors.find((actor) => actor.id === "b").room = 2;
  state.actors.find((actor) => actor.id === "b").hp = 1;
  const torch = state.objects.find((o) => o.id === "torch");
  torch.holder = "b";
  torch.room = null;
  torch.heldRoom = 2;
  const xpBefore = state.actors[0].xp;
  run([{ kind: "attack", actorId: "a", targetId: "b" }]);
  for (let i = 0; i < 80; i += 1) run([]);
  const deadBob = state.actors.find((actor) => actor.id === "b");
  const droppedTorch = state.objects.find((object) => object.id === "torch");
  check(deadBob.room === 1 && deadBob.hp === deadBob.maxHp, "a dead player did not wake at the start");
  check(droppedTorch.holder === null && droppedTorch.room === 2, "a dead player did not drop everything where they fell");
  check(state.engagements.length === 0, "a death left an engagement open");
  check(state.actors[0].xp > xpBefore, "a PvP kill did not grant experience");

  if (!combat2.ok) failures.push(`combat 2.0 is broken: ${combat2.why[0]}`);
}

// An aggressive mobile begins the fight on its own clock, and the victim is
// engaged back.
let aggression = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const npcs = world.npcs.map((npc) => (npc.id === "vault-guardian"
    ? { ...npc, room: 2, home: 2, period: 1, jitter: 0, aggression: 100 }
    : npc));
  let state = initialState(world.rooms, npcs, world.objects, world.start);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "a", name: "alice" }]);
  state.actors[0].room = 2;
  const events = [];
  for (let i = 0; i < 8; i += 1) events.push(...run([]));
  if (state.engagements.length !== 2) { aggression.ok = false; aggression.why.push("a guardian did not engage both sides"); }
  if (!events.some((event) => /attacks you/.test(event.text ?? ""))) { aggression.ok = false; aggression.why.push("the victim was not told"); }
  if (!aggression.ok) failures.push(`aggression is broken: ${aggression.why[0]}`);
}

// Quests advance from facts, complete once, and pay once.
let quests = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  for (const problem of validateQuestReferences(questTable.quests, { rooms: world.rooms, npcs: world.npcs, objects: world.objects })) {
    quests.ok = false;
    quests.why.push(problem);
  }
  const npcs = world.npcs.filter((npc) => npc.id !== "vault-guardian");
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const object = (id) => state.objects.find((o) => o.id === id);
  const check = (condition, why) => { if (!condition) { quests.ok = false; quests.why.push(why); } };
  const questState = () => state.actors[0].quests;

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);

  state.actors[0].level = 2;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(!questState().active.some((entry) => entry.id === "guardian"), "a quest whose prerequisite was unearned was accepted");
  state.actors[0].level = 1;

  run([{ kind: "questAccept", actorId: "a", questId: "scroll" }]);
  check(questState().active.some((entry) => entry.id === "scroll"), "a quest was not accepted");
  run([{ kind: "move", actorId: "a", dir: "north", to: 2 }]);
  run([{ kind: "take", actorId: "a", objectId: "scroll", messages: say("take") }]);
  check(questState().completed.includes("scroll"), "a collect quest did not complete when the item was held");
  check(questState().active.length === 0, "a completed quest stayed active");
  check(state.actors[0].xp >= 15, "a quest did not pay experience");
  run([{ kind: "questAccept", actorId: "a", questId: "scroll" }]);
  check(questState().active.length === 0, "a completed quest could be accepted again");

  run([{ kind: "questAccept", actorId: "a", questId: "word" }]);
  check(questState().active.some((entry) => entry.id === "word"), "the word quest was not accepted");
  run([{ kind: "move", actorId: "a", dir: "east", to: 4 }]);
  run([{ kind: "questAnswer", actorId: "a", word: "amber" }]);
  check(questState().completed.includes("word"), "the answer objective did not complete the word quest");
  check(state.actors[0].xp >= 65, "the word quest reward was not paid");

  state.actors[0].level = 1;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(!questState().active.some((entry) => entry.id === "guardian"), "a level-locked quest was accepted");
  state.actors[0].level = 2;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(questState().active.some((entry) => entry.id === "guardian"), "a level-2 quest was refused to a level-2 actor");

  run([{ kind: "questAccept", actorId: "a", questId: "bread" }]);
  state.actors[0].room = 5;
  run([{ kind: "take", actorId: "a", objectId: "bread", messages: say("take") }]);
  state.actors[0].room = 3;
  run([{ kind: "deliver", actorId: "a", objectId: "bread", npcId: "shopkeeper", messages: say("deliver") }]);
  check(questState().completed.includes("bread"), "a deliver quest did not complete");
  check(object("bread").eaten, "a delivered object was not consumed");

  state.npcs.push({ id: "vault-guardian", name: "a vault guardian", room: 4, home: 4, period: 1, jitter: 0, behaviour: "sentinel", hp: 1, maxHp: 8, damage: 0, armor: 0, aggression: 0, xp: 8 });
  state.actors[0].room = 4;
  run([{ kind: "attack", actorId: "a", targetId: "vault-guardian" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  check(questState().completed.includes("guardian"), "a kill quest did not complete");
  const xpAfterQuests = state.actors[0].xp;
  check(xpAfterQuests >= 155, `quest rewards totalled ${xpAfterQuests} instead of at least 155`);

  if (!quests.ok) failures.push(`quests are broken: ${quests.why[0]}`);
}

// Guilds: one name, a roster, ranks, a chat that reaches only members, and a
// membership that survives a restart.
let guilds = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { guilds.ok = false; guilds.why.push(why); } };
  const actor = (id) => state.actors.find((a) => a.id === id);
  const lines = (events) => events.filter((event) => event.onlyId !== undefined);

  if (validGuildName("x") || !validGuildName("Iron Wardens") || guildId("Iron Wardens") !== "iron-wardens") {
    guilds.ok = false;
    guilds.why.push("guild names or ids are wrong");
  }

  run([{ kind: "join", actorId: "a", name: "alice" }, { kind: "join", actorId: "b", name: "bob" }, { kind: "join", actorId: "c", name: "carol" }]);
  run([{ kind: "login", actorId: "a", key: "alice", authenticated: true }, { kind: "login", actorId: "b", key: "bob", authenticated: true }, { kind: "login", actorId: "c", key: "carol", authenticated: true }]);

  run([{ kind: "guildCreate", actorId: "a", name: "Iron Wardens", guildId: "iron-wardens" }]);
  check(state.guilds["iron-wardens"]?.members.alice === "leader", "a guild was not founded with its leader");
  check(actor("a").guild === "iron-wardens" && actor("a").guildRank === "leader", "the founder did not join the guild");
  check(state.identities.alice.guild === "iron-wardens" && state.identities.alice.guildRank === "leader", "the founder's identity did not join");

  run([{ kind: "guildCreate", actorId: "b", name: "Iron Wardens", guildId: "iron-wardens" }]);
  check(Object.keys(state.guilds).length === 1, "a duplicate guild was created");

  run([{ kind: "guildJoin", actorId: "b", guildId: "iron-wardens" }]);
  check(state.guilds["iron-wardens"].members.bob === "member" && actor("b").guildRank === "member", "a member did not join");

  const chat = lines(run([{ kind: "guildChat", actorId: "a", messages: { actor: "GA", others: "GO" } }]));
  check(chat.length === 2 && chat.some((event) => event.text === "GO"), "guild chat did not reach exactly the members");

  run([{ kind: "guildRank", actorId: "a", targetKey: "bob", rank: "officer" }]);
  check(state.guilds["iron-wardens"].members.bob === "officer" && actor("b").guildRank === "officer", "a rank was not set");

  const invited = lines(run([{ kind: "guildInvite", actorId: "a", targetKey: "carol", targetName: "carol" }]));
  check(invited.some((event) => /invites you/.test(event.text ?? "")), "an invitation was not delivered");
  run([{ kind: "guildJoin", actorId: "c", guildId: "iron-wardens" }]);
  check(Object.keys(state.guilds["iron-wardens"].members).length === 3, "the invited member did not join");

  run([{ kind: "guildLeave", actorId: "a" }]);
  check(actor("a").guild === null && state.identities.alice.guild === null, "a member did not leave");
  check(state.guilds["iron-wardens"].members.bob === "leader" && actor("b").guildRank === "leader", "the next leader was not promoted");

  checkpointIdentities(state);
  const restarted = JSON.parse(JSON.stringify(state));
  const savedActors = state.actors;
  restarted.actors = [];
  releaseHeldObjects(restarted, savedActors);
  const joined = step({ state: restarted, rooms: world.rooms, intents: [{ kind: "join", actorId: "d", name: "bob" }] });
  const result = step({ state: joined.state, rooms: world.rooms, intents: [{ kind: "login", actorId: "d", key: "bob", authenticated: true }] });
  state = result.state;
  check(actor("d")?.guild === "iron-wardens" && actor("d")?.guildRank === "leader", "a restart lost guild membership or rank");
  check(state.guilds["iron-wardens"]?.members.bob === "leader", "a restart lost the guild roster");

  run([{ kind: "guildDisband", actorId: "d" }]);
  check(!state.guilds["iron-wardens"], "the guild was not disbanded");
  check(actor("d").guild === null, "disbanding did not clear the online member");
  check(state.identities.carol.guild === null, "disbanding did not clear an offline member's identity");

  if (!guilds.ok) failures.push(`guilds are broken: ${guilds.why[0]}`);
}

// Duels are consensual in the Ring, and death there takes no goods.
let duels = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { duels.ok = false; duels.why.push(why); } };
  run([{ kind: "join", actorId: "a", name: "alice" }, { kind: "join", actorId: "b", name: "bob" }, { kind: "join", actorId: "c", name: "carol" }]);
  run([{ kind: "login", actorId: "a", key: "alice", authenticated: true }, { kind: "login", actorId: "b", key: "bob", authenticated: true }, { kind: "login", actorId: "c", key: "carol", authenticated: true }]);
  state.actors.forEach((actor) => { actor.room = 33; });

  run([{ kind: "duelChallenge", actorId: "a", targetId: "b" }]);
  check(state.duels.some((duel) => duel.state === "pending"), "a challenge did not become pending");
  run([{ kind: "duelAccept", actorId: "b" }]);
  check(state.duels.some((duel) => duel.state === "active"), "a challenge was not accepted");
  check(state.engagements.length === 2, "an accepted duel did not engage both sides");

  const torch = state.objects.find((object) => object.id === "torch");
  state.objects.find((object) => object.id === "torch").holder = "b";
  state.objects.find((object) => object.id === "torch").room = null;
  state.objects.find((object) => object.id === "torch").heldRoom = 33;
  state.actors.find((actor) => actor.id === "b").hp = 1;
  run([{ kind: "attack", actorId: "a", targetId: "b" }]);
  for (let i = 0; i < 120; i += 1) run([]);
  const fallen = state.actors.find((actor) => actor.id === "b");
  const kept = state.objects.find((object) => object.id === "torch");
  check(fallen.room === 1, "a defeated duellist did not wake at the start");
  check(kept.holder === "b", "the Ring took the defeated duellist's goods");

  state.actors.forEach((actor) => { actor.room = 33; });
  const before = state.engagements.length;
  run([{ kind: "attack", actorId: "a", targetId: "c" }]);
  check(state.engagements.length === before, "an arena attack began without a duel");

  run([{ kind: "duelChallenge", actorId: "a", targetId: "c" }]);
  run([{ kind: "duelDecline", actorId: "c" }]);
  check(!state.duels.some((duel) => duel.state === "pending" && duel.targetId === "c"), "a decline left the challenge pending");

  if (!duels.ok) failures.push(`duels are broken: ${duels.why[0]}`);
}

// Generated code must match the model it claims to come from.
const drift = spawnSync(process.execPath, ["tools/mechanize.mjs", "--check"], { encoding: "utf8" });
const driftOk = drift.status === 0;
if (!driftOk) {
  failures.push(`mechanized code drifted from the model: ${(drift.stderr || drift.stdout || "").trim().split("\n")[0]}`);
}

// The generated pacing file is the loop's only write surface. It is bound to
// the world it was measured against, may move only four numeric fields, and a
// stale value is refused rather than half-applied.
let pacing = { ok: true, why: [] };
{
  const dir = mkdtempSync(join(tmpdir(), "mudbench-pacing-"));
  const worldText = readFileSync(join(root, "world/data/world.json"), "utf8");
  const worldPath = join(dir, "world.json");
  writeFileSync(worldPath, worldText);
  mkdirSync(join(dir, "generated"), { recursive: true });
  const hash = createHash("sha256").update(worldText).digest("hex");
  const file = {
    schema: "mudbenchmark/pacing/1",
    candidate: "test-candidate",
    report: "test-report",
    worldHash: hash,
    changes: [{ group: "hostile-hp", collection: "npcs", target: "boar", field: "hp", from: 12, to: 14 }],
    admission: { identity: true, fidelity: true, benefit: true, bounds: true, checks: true },
  };
  const write = (value) => writeFileSync(join(dir, "generated/pacing.json"), JSON.stringify(value));
  const load = () => loadWorld({ mode: "single", path: worldPath });
  const check = (condition, why) => { if (!condition) { pacing.ok = false; pacing.why.push(why); } };

  write(file);
  const applied = load();
  check(applied.errors.length === 0, `a valid pacing file produced ${applied.errors[0]}`);
  check(applied.npcs.find((npc) => npc.id === "boar").hp === 14, "the generated hp was not applied");
  check(applied.npcs.find((npc) => npc.id === "boar").maxHp === 14, "maxHp did not follow the generated hp");
  check(applied.pacing?.candidate === "test-candidate", "the applied pacing was not reported");
  check(applied.pacing?.admission?.identity === true, "the applied admission record was not reported");

  write({ ...file, worldHash: "0".repeat(64) });
  const ignored = load();
  check(ignored.pacing === null, "a pacing file for another world was applied");
  check(ignored.npcs.find((npc) => npc.id === "boar").hp === 12, "an ignored pacing file still moved the world");

  write({ ...file, changes: [{ ...file.changes[0], from: 1 }] });
  const stale = load();
  check(stale.errors.some((error) => error.includes("but the world has")), "a stale generated value was not refused");

  write({ ...file, changes: [{ ...file.changes[0], field: "room" }] });
  const field = load();
  check(field.errors.some((error) => error.includes("not writable")), "a generated field outside the surface was not refused");

  rmSync(dir, { recursive: true, force: true });
  if (!pacing.ok) failures.push(`the pacing surface is broken: ${pacing.why[0]}`);
}

// The candidate loop: a finite, seeded inventory measured on hidden
// playthroughs. The gate proves the three properties the loop claims: the same
// seed gives the same inventory, a value outside a band is refused by name, and
// a winner is a candidate the measure actually admitted.
let loop = { ok: true, why: [], count: 0, admitted: 0, winner: null };
{
  const first = buildCandidates({ seed: "gate" });
  const second = buildCandidates({ seed: "gate" });
  if (first.hash !== second.hash) loop.why.push("the same seed produced two different inventories");
  if (first.candidates.length === 0) loop.why.push("the inventory is empty");
  loop.count = first.candidates.length;

  const report = measureCandidates(first);
  loop.admitted = report.results.filter((result) => result.status === "admitted").length;
  loop.winner = report.winner?.id ?? null;
  if (report.results.some((result) => !["admitted", "refused"].includes(result.status))) {
    loop.why.push("a candidate has no verdict");
  }
  if (report.winner && !report.results.some((result) => result.id === report.winner.id && result.status === "admitted")) {
    loop.why.push("the winner is not an admitted candidate");
  }

  const planted = JSON.parse(JSON.stringify(first));
  planted.candidates = [
    { id: "planted-band", changes: [{ group: "hostile-hp", collection: "npcs", target: "boar", field: "hp", from: 12, to: 9999 }] },
    { id: "planted-target", changes: [{ group: "hostile-hp", collection: "npcs", target: "wolf", field: "hp", from: 16, to: 17 }] },
    { id: "planted-stale", changes: [{ group: "hostile-hp", collection: "npcs", target: "boar", field: "hp", from: 1, to: 13 }] },
  ];
  const refused = measureCandidates(planted).results;
  for (const id of ["planted-band", "planted-target", "planted-stale"]) {
    if (refused.find((result) => result.id === id)?.status !== "refused") loop.why.push(`${id} was not refused`);
  }
  if (!(refused.find((result) => result.id === "planted-band")?.reason ?? "").includes("outside")) {
    loop.why.push("the out-of-band refusal did not name the band");
  }

  const stale = JSON.parse(JSON.stringify(first));
  stale.worldHash = "0".repeat(64);
  const staleResults = measureCandidates(stale).results;
  if (staleResults.some((result) => result.status !== "refused")) {
    loop.why.push("a report bound to another world was measured anyway");
  }

  // A settled inventory is a result, not a failure: the publisher exits 0,
  // writes `committed=false`, and the loop's release step is skipped.
  const settledInventory = JSON.parse(JSON.stringify(first));
  settledInventory.candidates = [{ id: "settled-noop", changes: [] }];
  const settledReport = measureCandidates(settledInventory);
  if (settledReport.winner) loop.why.push("the settled fixture has a winner");
  const settledDir = mkdtempSync(join(tmpdir(), "mudbench-settled-"));
  const settledCandidates = join(settledDir, "candidates.json");
  const settledResult = join(settledDir, "result.json");
  const settledOutput = join(settledDir, "output");
  writeFileSync(settledCandidates, `${JSON.stringify(settledInventory)}\n`);
  writeFileSync(settledResult, `${JSON.stringify(settledReport)}\n`);
  writeFileSync(settledOutput, "");
  const settledRun = spawnSync(process.execPath, ["tools/publish.mjs", "--candidates", settledCandidates, "--result", settledResult, "--dry-run"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: settledOutput },
  });
  if (settledRun.status !== 0) {
    loop.why.push(`a settled inventory exited ${settledRun.status}: ${(settledRun.stderr ?? "").slice(0, 160)}`);
  }
  if (!/settled/.test(settledRun.stderr ?? "")) loop.why.push("the settled publisher did not say settled");
  if (!/committed=false/.test(readFileSync(settledOutput, "utf8"))) {
    loop.why.push("the settled publisher did not report committed=false");
  }
  rmSync(settledDir, { recursive: true, force: true });

  const harness = readFileSync(join(root, "runtime/harness.mjs"), "utf8");
  if (!/function finish\(/.test(harness) || !/finish\(0\)/.test(harness)) {
    loop.why.push("the harness can still hang after a solved run");
  }

  if (loop.why.length) {
    loop.ok = false;
    failures.push(`the candidate loop is broken: ${loop.why[0]}`);
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ measured, ratchet, loop, failures }, null, 2)}\n`);
} else {
  console.log("metric                      value   bound");
  console.log("--------------------------  -----   -----");
  for (const [key, ceiling] of Object.entries(ratchet.mustNotGrow)) {
    console.log(`${key.padEnd(26)}  ${String(measured[key]).padStart(5)}   <= ${ceiling}`);
  }
  for (const [key, floor] of Object.entries(ratchet.mustNotFall)) {
    console.log(`${key.padEnd(26)}  ${String(measured[key]).padStart(5)}   >= ${floor}`);
  }
  for (const [key, exact] of Object.entries(ratchet.mustStayZero)) {
    console.log(`${key.padEnd(26)}  ${String(measured[key]).padStart(5)}   == ${exact}`);
  }
  console.log(`${"mechanizedDrift".padEnd(26)}  ${(driftOk ? "clean" : "DRIFT").padStart(5)}   == clean`);
  console.log(`${"loop".padEnd(26)}  ${(loop.ok ? String(loop.count) : "BROKEN").padStart(5)}   == ${loop.ok ? `${loop.admitted} admitted, bounded` : "no verdict"}`);
  console.log(`${"pacing".padEnd(26)}  ${(pacing.ok ? "14 hp" : "BROKEN").padStart(5)}   == applied, bound, refused`);
  console.log(`${"webAI".padEnd(26)}  ${(webAI.ok ? "19 checks" : "BROKEN").padStart(5)}   == parse, prompt, urls, keys, shapes`);
  console.log(`${"prismId".padEnd(26)}  ${(prismSession.ok ? "signed" : "BROKEN").padStart(5)}   == session verifier`);
  console.log(`${"sessionKey".padEnd(26)}  ${(sessionChallenge.ok ? "signed" : "BROKEN").padStart(5)}   == nonce, counter, key`);
  console.log(`${"prismLogin".padEnd(26)}  ${(prismLogin.ok ? "account" : "BROKEN").padStart(5)}   == id, character`);
  console.log(`${"state".padEnd(26)}  ${(durableState.ok ? "5 checks" : "BROKEN").padStart(5)}   == atomic, backup, fail-loud`);
  console.log(`${"claim".padEnd(26)}  ${(claim.ok ? "adds char" : "BROKEN").padStart(5)}   == owner, tombstone`);
  console.log(`${"rebind".padEnd(26)}  ${(rebind.ok ? "token, prism" : "BROKEN").padStart(5)}   == owner, online, once`);
  console.log(`${"delete".padEnd(26)}  ${(deletion.ok ? "bare only" : "BROKEN").padStart(5)}   == no refs, no progress`);
  console.log(`${"stream".padEnd(26)}  ${(stream.ok ? "public" : "BROKEN").padStart(5)}   == filters, events, watch`);
  console.log(`${"telemetry".padEnd(26)}  ${(telemetry.ok ? "trends" : "BROKEN").padStart(5)}   == ai, world, clients`);
  console.log(`${"pinned".padEnd(26)}  ${(identityPin.ok ? "revoked" : "BROKEN").padStart(5)}   == old log refused`);
  console.log(`${"takeover".padEnd(26)}  ${(takeover.ok ? "1 actor" : "BROKEN").padStart(5)}   == leave then login`);
  console.log(`${"characters".padEnd(26)}  ${(characters.ok ? "2 chars" : "BROKEN").padStart(5)}   == create, switch`);
  console.log(`${"persona".padEnd(26)}  ${(persona.ok ? "owner" : "BROKEN").padStart(5)}   == human, tombstone`);
  console.log(`${"recovery".padEnd(26)}  ${(recovery.ok ? "kit" : "BROKEN").padStart(5)}   == new device, old refused`);
  console.log(`${"handoff".padEnd(26)}  ${(handoff.ok ? "delegated" : "BROKEN").padStart(5)}   == owner kept`);
  console.log(`${"spans".padEnd(26)}  ${(spanView.ok ? "summary" : "BROKEN").padStart(5)}   == ticks, commands, redacted`);
  console.log(`${"admission".padEnd(26)}  ${(admission.ok ? "6 vectors" : "BROKEN").padStart(5)}   == model and JS`);
  console.log(`${"identity".padEnd(26)}  ${(identityKernel.ok ? "10 vectors" : "BROKEN").padStart(5)}   == model and JS`);
  console.log(`${"llms".padEnd(26)}  ${(llms.ok ? "verbs, rooms" : "STALE").padStart(5)}   == generated contract`);
  console.log(`${"claims".padEnd(26)}  ${(claimsCheck.status === 0 ? "levels ok" : "STALE").padStart(5)}   == build, open, some-true`);
  console.log(`${"commandsDoc".padEnd(26)}  ${(commandsCheck.status === 0 ? "current" : "STALE").padStart(5)}   == generated reference`);
  console.log(`${"worldMap".padEnd(26)}  ${(worldMap.ok ? `${worldMap.rooms} rooms` : "BROKEN").padStart(5)}   == exits, details, examine`);
  console.log(`${"worldArms".padEnd(26)}  ${(worldProblems.length === 0 ? "4 ok" : "BROKEN").padStart(5)}   == walkable`);
  console.log(`${"renderer".padEnd(26)}  ${(shown.includes("SECRET-NOTICE") && !hidden.includes("SECRET-NOTICE") ? "2 ok" : "BROKEN").padStart(5)}   == hides/shows`);
  console.log(`${"accounts".padEnd(26)}  ${(accounts.ok ? "hash, account" : "BROKEN").padStart(5)}   == names and passwords`);
  console.log(`${"allowance".padEnd(26)}  ${(allowance.ok ? "250 ms" : "BROKEN").padStart(5)}   == one command`);
  console.log(`${"memory".padEnd(26)}  ${(memory.ok ? `${DEFAULT_TURNS} turns` : "BROKEN").padStart(5)}   == rolling window`);
  console.log(`${"safe".padEnd(26)}  ${(safe.ok ? "2 rooms" : "BROKEN").padStart(5)}   == no combat`);
  console.log(`${"duels".padEnd(26)}  ${(duels.ok ? "Ring rules" : "BROKEN").padStart(5)}   == consent and no loot`);
  console.log(`${"guilds".padEnd(26)}  ${(guilds.ok ? "create, rank, chat" : "BROKEN").padStart(5)}   == roster and chat`);
  console.log(`${"quests".padEnd(26)}  ${(quests.ok ? "accept, advance, pay" : "BROKEN").padStart(5)}   == facts, once`);
  console.log(`${"aggression".padEnd(26)}  ${(aggression.ok ? "1 duel" : "BROKEN").padStart(5)}   == mobs start fights`);
  console.log(`${"combat2".padEnd(26)}  ${(combat2.ok ? "weapons, armour, xp" : "BROKEN").padStart(5)}   == fight and grow`);
  console.log(`${"combat".padEnd(26)}  ${(combat.outcome === "killed" ? `${combat.rounds} rounds` : "BROKEN").padStart(5)}   == kills`);
  console.log(`${"resume".padEnd(26)}  ${(resume.ok ? "1 save" : "BROKEN").padStart(5)}   == old checkpoint loads`);
  console.log(`${"climate".padEnd(26)}  ${(climate.ok ? `${climate.changes} changes` : "BROKEN").padStart(5)}   == day, night, weather`);
  console.log(`${"persistence".padEnd(26)}  ${(persistence.ok ? "progress, no hands" : "BROKEN").padStart(5)}   == survives logout/restart`);
  console.log(`${"commsTable".padEnd(26)}  ${(verbTable.errors.length + channelTable.errors.length + socialTable.errors.length === 0 ? `${channelTable.byAlias.size + socialTable.byAlias.size} keys` : "BROKEN").padStart(5)}   == resolves`);
  console.log(`${"comms".padEnd(26)}  ${(comms.ok ? `${comms.said}/${comms.told}/${comms.mailed}/${comms.gestured} ok` : "BROKEN").padStart(5)}   == say, tell, mail, social`);
  console.log(`${"shop".padEnd(26)}  ${(shop.ok ? "buy, sell, reset" : "BROKEN").padStart(5)}   == honest trade`);
  console.log(`${"items".padEnd(26)}  ${(items.ok ? "5 ok" : "BROKEN").padStart(5)}   == containers, wear, food, reset`);
  console.log(`${"generator@500k".padEnd(26)}  ${(oldDirs.size >= 2 ? `${oldDirs.size} dirs` : "BROKEN").padStart(5)}   == still varies`);
  console.log(`${"verbTable".padEnd(26)}  ${(verbTable.errors.length === 0 ? `${verbTable.byAlias.size} keys` : "BROKEN").padStart(5)}   == resolvable`);
  console.log("");
  if (failures.length === 0) {
    console.log("gate: passed");
  } else {
    console.log("gate: FAILED");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
}

process.exit(failures.length === 0 ? 0 : 1);
