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
import { hashPassword, verifyPassword, validName, validNewName, validPassword, accountCapReached } from "../runtime/accounts.mjs";
import { CHAT_LIMIT, CHAT_WINDOW_MS, REPORT_INTERVAL_MS, REPORT_REASON_MAX, chatAllowed, reportAllowed, reportRecord } from "../runtime/moderation.mjs";
import { ADJECTIVES, NOUNS, randomCharacterName, uniqueCharacterName, chooseCharacter } from "../runtime/web/names.mjs";
import { loadTitles, earnedTitles } from "../runtime/titles.mjs";
import { WORLDBREAKER_TITLE, completionLine, completionState, secretWays } from "../runtime/completion.mjs";
import { TECHNIQUES, techniqueForWeapon, techniqueReady } from "../runtime/techniques.mjs";
import { COMPONENTS, componentForItem, componentsText, salvageYield, upgradeCost } from "../runtime/forge.mjs";
import { loadFacts, contextHasWord } from "../runtime/facts.mjs";
import { allowCommand, DEFAULT_INTERVAL_MS } from "../runtime/allowance.mjs";
import { loadLevels, levelForXp } from "../runtime/levels.mjs";
import { loadQuestArchive, loadQuests, migrateQuestState, validateQuestReferences } from "../runtime/quests.mjs";
import { GUILD_HALL, GUILD_VAULT_CAPACITY, guildId, guildVaultHolder, validGuildName, guildLevelFor, perksFor, wardenBonus, nightBonus, guildBonus, progressionAtLeast } from "../runtime/guilds.mjs";
import { FACTIONS, factionAllows, factionRank, standingsText } from "../runtime/factions.mjs";
import { DEFAULT_TURNS, trimMessages } from "../runtime/memory.mjs";
import { buildLlms } from "../runtime/llms.mjs";
import { assemble } from "../runtime/router.mjs";
import { AREA_PERIOD, BASE_HP, HP_PER_LEVEL, armorOf, attackRoll, checkpointIdentities, initialState, maxHpForLevel, nextFrom, phaseAt, releaseHeldObjects, step, upgradeState } from "../runtime/world.mjs";
import { join } from "node:path";
import { buildCandidates } from "./candidate.mjs";
import { PROVIDERS, DEFAULT_GOAL, GOALS, buildSystemPrompt, buildUserPrompt, buildActionMenu, normalizeBase, parseBrain, readSseText, requestFor, replyFrom, trimHistory, validateCommand, repairCommand, coachCommand, coachAction, coachFallback, coachFallbackDue, isThrottledStatus, retryAfterMs, throttleWaitMs, throttlePlan } from "../runtime/web/ai.mjs";
import { emptyMind, updateMind, mindPrompt, addLesson } from "../runtime/web/mind.mjs";
import { focusFor, focusPrompt, focusGuard } from "../runtime/web/planner.mjs";
import { emptyMemory, noteRoom, rememberResult, memoryPrompt, loopWarning, breakLoop, shouldBreakLoop, pathTo, nextStep, routeHint, nearestTarget, seedMap, seedMapFromLlms, observedCommandSuccess, frontier } from "../runtime/web/memory.mjs";
import { verifyPrismSession, verifyPersonaOwner, verifyPrismAction, verifySessionKey, sessionWithinWindow } from "../runtime/prism-auth.mjs";
import { decodeIdentityRequest, identityAdmits } from "../runtime/identity.mjs";
import { loadStateFile, saveStateFile } from "../runtime/state.mjs";
import { acceptLinkRequest, completeLink, createDevice, createLinkOffer, createPrism, createRecovery, linkCode, recoverPrism, requestLink, revokeDevice, signAction, verifyAction } from "../runtime/web/prism-id.mjs";
import { openKit, sealKit } from "../runtime/web/recovery-kit.mjs";
import { readSpanTail, redactSpans, summarizeSpans } from "../runtime/spans.mjs";
import { PLAYER_SPAN_NAMES, selectPlayerLines } from "../runtime/telemetry.mjs";
import { admissionAdmits, decodeAdmissionRequest } from "./admission.mjs";
import { measureCandidates } from "./measure.mjs";
import { normalizePrismId, ownerAllowed, rebindPlan, tokenHash } from "../runtime/rebind.mjs";
import { deleteLegacy } from "./delete-legacy.mjs";
import { MAX_STREAM_DELAY, PVP_STREAM_DELAY, normalizeStreamEvent, publicStreamText, streamDelay } from "../runtime/stream.mjs";
import { normalizeAiTurn, aiTurnAttributes } from "../runtime/metrics.mjs";
import { summarizeSeries, summarizeTrends } from "../runtime/trends.mjs";
import { playerLines, summarizePlayers } from "../runtime/playerstats.mjs";
import { currentEvent, eventPrice } from "../runtime/events.mjs";
import { duelLadderRows, duelLadderText } from "../runtime/visibility.mjs";
import { worldOverview, worldStatus, worldStatusText } from "../runtime/worldstatus.mjs";
import { redactCommand, sanitizeIntent, sanitizeState, scrubSecrets, scrubSpan } from "../runtime/telemetry-policy.mjs";
import { planRetention } from "../runtime/retention.mjs";
import { equipmentOf, equipmentText, inventoryGroups, inventoryLabel, setBonus } from "../runtime/equipment.mjs";
import { hudChanged, hudSnapshot } from "../runtime/hud.mjs";
import { FEDERATION_PROTOCOL, TRAVEL_ACTION } from "../runtime/federation.mjs";
import { DEFAULT_AGENT_PROFILE, agentProfile } from "../runtime/web/agent-profile.mjs";
import { createAgentCore, beginTurn, decideTurn } from "../runtime/web/agent-core.mjs";
import { admissionWire } from "../runtime/admission-wire.mjs";
import { WAYFARER, markWayfarer, wayfarerLine, wayfarerState } from "../runtime/wayfarer.mjs";
import { maxManaFor, spellById, spellPower } from "../runtime/magic.mjs";
import { trainingCost } from "../runtime/magic.mjs";
import { findAction, loadActions } from "../runtime/actions.mjs";
import { auditAccounts } from "../runtime/account-audit.mjs";
import { levelsText, leaderboardText, mapText, shortcutsText } from "../runtime/visibility.mjs";
import { deleteBarePrismAccount, deletePrismIdentity } from "../runtime/account-delete.mjs";
import { wipePlayers } from "../runtime/account-wipe.mjs";

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
for (const id of ["login", "register", "prism-login", "mode-ai", "ai-provider", "ai-reset", "director-input", "telemetry-open", "trend-stats", "ai-stream", "model-edit", "model-apply", "observe-close", "watch-card", "live-card", "ai-plan", "player-stack"]) {
  if (!web.includes(`id="${id}"`)) failures.push(`the web shell lost its ${id} control`);
}
const webIds = [...web.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(webIds.filter((id, index) => webIds.indexOf(id) !== index))];
if (duplicateIds.length) failures.push(`the web shell has duplicate ids: ${duplicateIds.join(", ")}`);
const liveIndex = web.indexOf('id="ai-live"');
const railIndex = web.indexOf("<aside>");
if (liveIndex < 0 || railIndex < 0 || liveIndex > railIndex) {
  failures.push("the AI conversation is not the center panel before the model rail");
}
if (!web.includes("body.ai-mode.ai-running main") || !web.includes("--dock: 520px")) {
  failures.push("the live Studio dock sizing was lost");
}

// The browser AI: the parser, the prompt, and every provider request shape.
let webAI = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { webAI.ok = false; webAI.why.push(why); } };
  check(!PROVIDERS.ollama?.needsKey && !PROVIDERS.custom?.needsKey && !PROVIDERS["prime-router"]?.needsKey, "a no-key provider requires a key");
  check(!PROVIDERS.pollinations, "Pollinations is still offered");
  check(PROVIDERS.groq?.base === "https://api.groq.com/openai/v1" && PROVIDERS.groq?.keyMode === "required" && PROVIDERS.groq?.model === "openai/gpt-oss-20b", "the Groq fast provider is not configured");
  check(/console\.groq\.com\/keys/.test(PROVIDERS.groq?.hint ?? ""), "the Groq hint does not link the free key");
  check(PROVIDERS.deepseek?.base === "https://api.deepseek.com/v1" && PROVIDERS.deepseek?.keyMode === "required" && PROVIDERS.deepseek?.model === "deepseek-flash", "the DeepSeek provider is not configured");
  check(DEFAULT_AGENT_PROFILE.maxTokens === 1200 && DEFAULT_AGENT_PROFILE.temperature === 0.3 && DEFAULT_AGENT_PROFILE.reasoning === "medium", "the default agent profile is wrong");
  check(agentProfile({ weak: true }).maxTokens === 1200 && agentProfile({ weak: true }).weak === true, "a profile override lost the defaults");
  const core = createAgentCore({ name: "core-test", goal: "test" });
  const coreState = { self: { name: "core-test", level: 1, inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [], available_quests: [] }, room: { name: "A", exits: [{ dir: "north" }], objects: [], npcs: [] } };
  const coreTurn = beginTurn(core, { state: coreState, observation: "[A]", room: "A", turn: 1 });
  const coreDecision = decideTurn(core, { reply: "COMMAND: north", state: coreState, promptState: coreTurn.promptState, focus: coreTurn.focus, room: "A", turn: 1 });
  check(coreDecision.command === "north" && !coreDecision.blocked, "the shared agent core did not return a legal command");
  check(isThrottledStatus(402) && isThrottledStatus(429) && !isThrottledStatus(500), "the throttle status set is wrong");
  check(retryAfterMs(new Headers({ "retry-after": "32" }), 0) === 32_000, "Retry-After seconds are not parsed");
  check(retryAfterMs(new Headers({ "retry-after": new Date(60_000).toUTCString() }), 0) === 60_000, "Retry-After dates are not parsed");
  check(throttleWaitMs("groq", new Headers(), 0) === 15_000, "the throttle fallback wait is wrong");
  const shortPlan = throttlePlan({ provider: "groq", headers: new Headers({ "retry-after": "32" }), attempt: 1, now: 0 });
  const longPlan = throttlePlan({ provider: "groq", headers: new Headers({ "retry-after": "3600" }), attempt: 1, now: 0 });
  const spentPlan = throttlePlan({ provider: "groq", headers: new Headers({ "retry-after": "5" }), attempt: 4, now: 0 });
  check(shortPlan.waitMs === 32_000 && shortPlan.retry === true, "a short 429 wait is not retried");
  check(longPlan.retry === false && spentPlan.retry === false, "a long or exhausted rate limit is still retried");
  const groq = requestFor("groq", { base: PROVIDERS.groq.base, model: PROVIDERS.groq.model, key: "k" }, "sys", [{ role: "user", content: "hi" }]);
  check(groq.url === "https://api.groq.com/openai/v1/chat/completions" && groq.headers.authorization === "Bearer k", "the Groq request is wrong");
  const deepseek = requestFor("deepseek", { base: PROVIDERS.deepseek.base, model: PROVIDERS.deepseek.model, key: "k", fast: true }, "sys", [{ role: "user", content: "hi" }]);
  check(deepseek.url === "https://api.deepseek.com/v1/chat/completions" && deepseek.headers.authorization === "Bearer k", "the DeepSeek request is wrong");
  check(deepseek.body.reasoning_effort === "medium" && deepseek.body.max_tokens === 1200, "the default profile did not reach DeepSeek");
  const deepseekDeliberate = requestFor("deepseek", { base: PROVIDERS.deepseek.base, model: PROVIDERS.deepseek.model, key: "k", deliberate: true }, "sys", [{ role: "user", content: "hi" }]);
  const bonsai = requestFor("bonsai", { base: PROVIDERS.bonsai.base, model: PROVIDERS.bonsai.model, maxTokens: 1200 }, "sys", [{ role: "user", content: "hi" }]);
  check(PROVIDERS.bonsai?.model === "bonsai" && bonsai.url === "http://localhost:8085/v1/chat/completions" && bonsai.body.max_tokens === 1200 && bonsai.body.reasoning_effort === "medium", "the Bonsai provider preset is wrong");
  check(deepseekDeliberate.body.reasoning_effort === "medium" && deepseekDeliberate.body.max_tokens === 1200, "the default profile did not reach deliberate DeepSeek");
  check(/emptyRetry/.test(web) && /DeepSeek returned only reasoning/.test(web), "the DeepSeek empty-reply retry is missing");
  const noteParsed = parseBrain("THOUGHT: go\nREPLY: none\nNOTE: Goal: find the tide-stone\nCOMMAND: north");
  check(noteParsed.note === "Goal: find the tide-stone" && noteParsed.command === "north", "the parser lost NOTE");
  const planParsed = parseBrain("THOUGHT: look\nPLAN: read the plaque\nREPLY: none\nNOTE: none\nLESSON: read before walking\nCOMMAND: look");
  check(planParsed.plan === "read the plaque" && planParsed.lesson === "read before walking", "the parser lost PLAN or LESSON");
  check(/PLAN: one concrete step/.test(buildSystemPrompt({ name: "scout", fast: true })) && /LESSON: one durable rule/.test(buildSystemPrompt({ name: "scout" })), "the system prompt lost PLAN or LESSON");
  const mindState = { self: { name: "bob", level: 3, hp: 8, max_hp: 20, deaths: 1, coins: 4, completion: { maxLevel: 10, questsTotal: 25, puzzlesTotal: 25 }, enemies: [{ name: "a rat", hp: 2, maxHp: 4 }], wielding: null, worn: [], inventory_names: ["a short sword", "a leather jerkin"], techniques: [{ id: "bash" }] }, room: { name: "The Atrium", actors: ["ann"], npcs: [{ name: "a large bard" }] } };
  const mind = emptyMind();
  updateMind(mind, { state: mindState, observation: "You see no such target.", command: "say a large bard hello", validation: { ok: false, reason: "say is room speech" }, room: "The Atrium", tick: 1 });
  check(mind.lessons.some((lesson) => /say is room speech/i.test(lesson)) && mind.lessons.some((lesson) => /wield|unwielded/i.test(lesson)), "the mind lost social or gear lessons");
  check(mindPrompt(mind, { state: mindState }).includes("SOCIAL: players ann") && mindPrompt(mind, { state: mindState }).includes("NPCs a large bard") && mindPrompt(mind, { state: mindState }).includes("PLAN:"), "the mind prompt lost social or plan context");
  const coachSay = coachCommand("say a large bard hello", mindState, mind);
  check(coachSay.blocked && coachSay.repaired === "talk a large bard" && /room speech/i.test(coachSay.feedback), "the command coach did not redirect say to talk");
  const coachTell = coachCommand("tell bard hello", mindState, mind);
  check(coachTell.blocked && coachTell.repaired === "talk a large bard" && /NPCs do not receive tells/i.test(coachTell.feedback), "the command coach did not redirect an NPC tell");
  const coachAttack = coachCommand("attack rat", mindState, mind);
  check(coachAttack.blocked && /already fighting/i.test(coachAttack.feedback) && /technique bash|battle/i.test(coachAttack.repaired), "the command coach did not catch a repeat attack");
  const combatMenu = buildActionMenu(mindState);
  check(!combatMenu.includes("attack a rat") && !combatMenu.includes("battle") && combatMenu.includes("flee") && combatMenu.includes("technique bash"), "the combat action menu still offers attack or battle-instead-of-fight");
  const multi = coachCommand("take a short sword, take a leather jerkin", mindState, mind);
  check(multi.blocked && multi.repaired === "wield a short sword" && /one command per turn/i.test(multi.feedback), "the coach allows two commands on one line");
  const carried = coachCommand("take a short sword", mindState, mind);
  check(carried.blocked && carried.repaired === "wield a short sword" && /already carrying/i.test(carried.feedback), "the coach re-takes carried gear instead of wielding it");
  const roomVerb = validateCommand("turn winch", { room: { name: "The Winch Room", actions: [], group_actions: [{ verb: "turn", target: "winch", size: 2 }], exits: [], objects: [], npcs: [], actors: [] }, self: { inventory_names: [], enemies: [] } });
  check(roomVerb.ok, "a room action verb was rejected as unknown");
  const known = coachCommand("tell a bard hello", { room: { name: "The Corridor", actors: [], npcs: [], exits: [], objects: [], actions: [] }, self: { inventory_names: [], enemies: [] } }, { social: { knownNpcs: ["a bard"] } });
  check(known.blocked && /not in this room/i.test(known.feedback), "the coach told an NPC it is not in the room");
  const questUser = buildUserPrompt({ turn: 1, observation: "[The Atrium]", state: { self: { name: "bob", level: 3, hp: 20, max_hp: 30, quests: {}, inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ name: "The Salt Rose", objectives: ["[ ] Enter the captain's cabin"] }], available_quests: [] }, room: { name: "The Atrium", actors: [], npcs: [], exits: [], objects: [], actions: [], details: [] } }, fast: true, actions: ["look"] });
  check(questUser.includes("NEXT: The Salt Rose") && questUser.includes("Enter the captain's cabin"), "the prompt lost the next quest objective");
  const routeMemory = { rooms: { A: { exits: { north: "B" } }, B: { exits: { south: "A" } } }, map: { A: { north: "B" }, B: { south: "A" } } };
  const focusGear = focusFor({ state: { self: { inventory_names: ["a short sword"], worn: [], wielding: null, enemies: [] }, room: { name: "A", objects: [], exits: [], npcs: [] } }, memory: routeMemory });
  check(focusGear.kind === "equip" && focusGear.candidates.includes("wield a short sword"), "the focus planner did not prioritize carried gear");
  const focusQuest = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ id: "q", name: "The Salt Rose", objective_details: [{ kind: "visit", text: "Enter the cabin", roomName: "B", done: false }] }], available_quests: [] }, room: { name: "A", objects: [], exits: [{ dir: "north", room: "B" }], npcs: [] } }, memory: routeMemory });
  check(focusQuest.kind === "quest" && focusQuest.candidates[0] === "north" && /1 move/.test(focusQuest.routeText), "the focus planner did not route the next quest objective");
  const focusCombat = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [{ name: "a rat", hp: 1 }], techniques: [{ id: "bash" }], spells: [] }, room: { name: "A", objects: [], exits: [], npcs: [] } }, memory: routeMemory });
  check(focusCombat.kind === "combat" && focusCombat.candidates.includes("technique bash") && focusCombat.candidates.includes("flee") && !focusCombat.candidates.includes("battle") && !focusCombat.candidates.includes("attack a rat"), "the focus planner did not prioritize combat actions");
  const focusParty = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], party: null, active_quests: [], available_quests: [] }, room: { name: "The Winch Room", actors: ["ann"], npcs: [], objects: [], exits: [], actions: [], group_actions: [{ verb: "turn", target: "winch", size: 2 }] } }, memory: routeMemory });
  check(focusParty.kind === "party" && focusParty.candidates.includes("party invite ann"), "the focus planner did not form a party for a group action");
  const focusTogether = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], party: { members: ["ann", "bob"] }, active_quests: [], available_quests: [] }, room: { name: "The Winch Room", actors: ["ann"], npcs: [], objects: [], exits: [], actions: [], group_actions: [{ verb: "turn", target: "winch", size: 2 }] } }, memory: routeMemory });
  check(focusTogether.kind === "group action" && focusTogether.candidates.includes("turn winch"), "the focus planner did not use a ready group action");
  const frontierMemory = { rooms: { A: {}, B: {} }, map: { A: { east: "B" }, B: { east: "C" }, C: {} }, trail: ["A", "B"] };
  rememberResult(frontierMemory, { room: "B", command: "west", observation: "There is no west exit here.", tick: 1 });
  check(!frontierMemory.map.B.west && frontierMemory.map.B.east === "C", "a failed direction was not removed from the map");
  const ahead = frontier(frontierMemory, "B");
  check(ahead?.target === "C" && ahead.path[0] === "east", "the frontier did not find the nearest unvisited room");
  const exploreFocus = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [], available_quests: [] }, room: { name: "B", objects: [], exits: [{ dir: "east", room: "C" }], npcs: [] } }, memory: frontierMemory });
  const questState = { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ id: "visit", name: "Visit", objective_details: [{ kind: "visit", text: "Visit C", roomName: "C", done: false }] }], available_quests: [] }, room: { name: "A", objects: [], exits: [{ dir: "east", room: "B" }], npcs: [] } };
  const questFocus = focusFor({ state: questState, memory: frontierMemory, preferExplore: false });
  const stalledFocus = focusFor({ state: questState, memory: frontierMemory, preferExplore: true });
  check(questFocus.kind === "quest" && stalledFocus.kind === "explore", "plan arbitration did not switch a stalled quest to the frontier");
  check(exploreFocus.kind === "explore" && exploreFocus.candidates[0] === "east" && /C/.test(exploreFocus.label), "the planner did not route to the frontier");
  const noteMind = emptyMind();
  updateMind(noteMind, { parsed: { note: "Remember the amber door." }, state: { self: { name: "bob" }, room: { name: "A" } }, room: "A" });
  check(noteMind.notes.includes("Remember the amber door.") && mindPrompt(noteMind, { state: { self: { name: "bob" } } }).includes("NOTES"), "the Mind did not keep the model's note");
  const focusSwitch = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ id: "word", name: "The True Word", objective_details: [{ kind: "answer", text: "Answer at the Shrine", done: false }] }], available_quests: [{ id: "bread", name: "Bread for the Shop", level: 1, giverRoomName: "C" }] }, room: { name: "A", objects: [], exits: [{ dir: "east", room: "C" }], npcs: [] } }, memory: { rooms: { A: {}, C: {} }, map: { A: { east: "C" }, C: { west: "A" } } } });
  check(focusSwitch.kind === "quest offer" && focusSwitch.label.includes("Bread") && focusSwitch.candidates[0] === "east", "the focus planner did not switch from an unanswerable objective to a reachable offer");
  const wordMind = emptyMind();
  updateMind(wordMind, { state: { self: { name: "bob", level: 2 }, room: { name: "The Vault" } }, observation: "A door of grey wood bears a word carved deep into the grain. The word carved into the door is AMBER.", command: "look", room: "The Vault" });
  check(wordMind.knownWord === "amber", "the mind did not learn the Vault word");
  const answerFocus = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ id: "word", name: "The True Word", objective_details: [{ kind: "answer", text: "Answer at the Shrine", answerRoomName: "The Shrine", clueRoomName: "The Vault", done: false }] }], available_quests: [] }, room: { name: "The Shrine", objects: [], exits: [], npcs: [] } }, memory: { rooms: { "The Shrine": {} }, map: {} }, mind: wordMind });
  check(answerFocus.kind === "quest" && answerFocus.candidates.includes("answer amber"), "the planner did not answer with the learned word");
  const answerOverOffer = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ id: "word", name: "The True Word", objective_details: [{ kind: "answer", text: "Answer at the Shrine", answerRoomName: "The Shrine", clueRoomName: "The Vault", done: false }] }], available_quests: [{ id: "bread", name: "Bread for the Shop", level: 1, giverRoomName: "The Storeroom" }] }, room: { name: "The Corridor", objects: [], exits: [{ dir: "east", room: "The Shrine" }], npcs: [] } }, memory: { rooms: { "The Corridor": {}, "The Shrine": {}, "The Storeroom": {} }, map: { "The Corridor": { east: "The Shrine" }, "The Shrine": { west: "The Corridor" }, "The Storeroom": { west: "The Corridor" } } }, mind: wordMind });
  check(answerOverOffer.kind === "quest" && answerOverOffer.candidates[0] === "east", "a known answer did not outrank a tied offer route");
  const clueFocus = focusFor({ state: { self: { inventory_names: [], worn: [], wielding: null, enemies: [], active_quests: [{ id: "word", name: "The True Word", objective_details: [{ kind: "answer", text: "Answer at the Shrine", answerRoomName: "The Shrine", clueRoomName: "The Vault", done: false }] }], available_quests: [] }, room: { name: "The Vault", details: ["door"], objects: [], exits: [], npcs: [] } }, memory: { rooms: { "The Vault": {}, "The Shrine": {} }, map: {} }, mind: emptyMind() });
  check(clueFocus.candidates.includes("examine door"), "the planner did not examine the clue door when the word was unknown");
  const answerCoach = coachCommand("say amber", { room: { name: "The Shrine", actors: [], npcs: [], exits: [], objects: [], actions: [] }, self: { inventory_names: [], enemies: [] } }, wordMind);
  check(answerCoach.blocked && answerCoach.repaired === "answer amber", "the coach did not turn say <word> into answer <word> at the Shrine");
  const wrongAnswer = coachCommand("answer slate", { room: { name: "The Shrine", actors: [], npcs: [], exits: [], objects: [], actions: [] }, self: { inventory_names: [], enemies: [] } }, wordMind);
  check(wrongAnswer.blocked && wrongAnswer.repaired === "answer amber" && /AMBER/i.test(wrongAnswer.feedback), "the coach allowed a wrong known answer");
  const breadTake = coachCommand("take a loaf of bread", { room: { name: "The Cell", actors: [], npcs: [], exits: [], objects: [], actions: [] }, self: { inventory_names: ["a purse of 10 coins"], enemies: [] } }, emptyMind());
  check(!breadTake.blocked, "the coach mistook a purse of coins for a loaf of bread");
  const badExit = coachCommand("down", { room: { name: "The Root Gate", actors: [], npcs: [], exits: [{ dir: "west" }, { dir: "up" }], objects: [], actions: [] }, self: { inventory_names: [], enemies: [] } }, emptyMind());
  check(badExit.blocked && badExit.repaired === "west", "the coach did not repair an invalid direction to a legal exit");
  const fallbackState = { room: { name: "The Root Gate", actors: [], npcs: [], exits: [{ dir: "west" }, { dir: "up" }], objects: [], actions: [] }, self: { inventory_names: ["a grey cloak"], worn: [], enemies: [] } };
  const fallback = coachFallback({ candidates: ["take a grey cloak", "battle", "quests", "look"] }, fallbackState, emptyMind());
  check(fallback === "west" || fallback === "up", "the weak-model fallback did not choose a legal exit");
  const shrineState = { room: { name: "The Shrine", actors: [], npcs: [], exits: [{ dir: "south" }, { dir: "north" }, { dir: "east" }], objects: [], actions: [] }, self: { inventory_names: [], enemies: [] } };
  const sayAmber = coachCommand("say amber", shrineState, wordMind);
  check(coachAction({ candidates: ["quests", "look"] }, shrineState, wordMind, sayAmber.repaired) === "answer amber", "the coach fallback ignored the specific answer repair");
  check(!coachFallbackDue({ blocked: false, valid: false, count: 2 }) && coachFallbackDue({ blocked: false, valid: false, count: 3 }), "the invalid-target threshold is wrong");
  check(coachFallbackDue({ blocked: true, valid: false, count: 2 }), "the blocked-command threshold is wrong");
  const guard1 = focusGuard({ focus: { kind: "quest", label: "Q", route: ["east"], candidates: ["east"] }, command: "look", detours: 0 });
  const guard2 = focusGuard({ focus: { kind: "quest", label: "Q", route: ["east"], candidates: ["east"] }, command: "look", detours: 1, state: { room: { exits: [{ dir: "east" }] } } });
  check(!guard1.forced && guard1.detours === 1 && guard2.forced && guard2.command === "east", "the focus lock did not override two detours");
  const strictGuard = focusGuard({ focus: { kind: "explore", label: "E", route: ["north"], candidates: ["north"] }, command: "look", detours: 1, state: { room: { exits: [{ dir: "north" }] } }, strict: true });
  check(strictGuard.forced && strictGuard.command === "north", "strict focus did not take the route immediately");
  const guardBadExit = focusGuard({ focus: { kind: "quest", label: "Q", route: ["north"], candidates: ["north"] }, command: "look", detours: 1, state: { room: { exits: [{ dir: "west" }] } } });
  check(!guardBadExit.forced, "the focus lock forced an exit the room does not have");
  const focusUser = buildUserPrompt({ turn: 1, observation: "[A]", state: { self: { name: "bob", level: 3, hp: 20, max_hp: 30, quests: {}, inventory_names: [], worn: [], wielding: null, enemies: [] }, room: { name: "A", actors: [], npcs: [], exits: [], objects: [], actions: [], details: [] } }, focus: focusPrompt(focusGear), fast: true, actions: focusGear.candidates });
  check(focusUser.includes("FOCUS:") && focusUser.includes("CANDIDATES:"), "the prompt lost the focus/candidate block");
  check(buildActionMenu(mindState).includes("wield a short sword") && buildActionMenu(mindState).includes("wear a leather jerkin"), "the action menu lost gear actions");
  const mindUser = buildUserPrompt({ turn: 1, observation: "[The Atrium]", state: mindState, mind: mindPrompt(mind, { state: mindState }), fast: true, actions: combatMenu });
  check(mindUser.includes("MIND:") && mindUser.includes("LESSONS:") && mindUser.includes("players ann") && mindUser.includes("NPCs a large bard"), "the user prompt lost the mind or social split");
  const selfUser = buildUserPrompt({
    turn: 1, observation: "[The Cell]", fast: true, actions: ["attack a rat", "flee"], notebook: "- Goal: survive",
    state: { self: { name: "bob", level: 2, hp: 10, max_hp: 20, inventory: 1, inventory_names: ["a loaf of bread"], coins: 5, enemies: [{ name: "a rat", hp: 3, maxHp: 5, level: 1 }] }, room: { name: "The Cell", zone: "town", actors: ["ann"] } },
  });
  check(selfUser.includes("SELF: bob") && selfUser.includes("COMBAT: a rat") && selfUser.includes("PACK:") && selfUser.includes("NOTEBOOK:") && selfUser.includes("NOTE: one durable note"), "the prompt lost self/combat/pack/notebook context");
  const packMenu = buildActionMenu({ self: { inventory_names: ["a loaf of bread", "a brass lamp", "a short sword"], enemies: [{ name: "a rat" }], techniques: [{ id: "bash" }] }, room: { exits: [], objects: [], npcs: [], actions: [] } });
  check(packMenu.includes("flee") && packMenu.includes("eat a loaf of bread") && packMenu.includes("light a brass lamp") && packMenu.includes("wield a short sword") && packMenu.includes("technique bash"), "the action menu lost combat or pack actions");
  check(/NOTE: one durable note/.test(buildSystemPrompt({ name: "scout", fast: true })), "the system prompt lost the NOTE format");
  check(/ensureNotebook/.test(web) && /AI\.notebook/.test(web) && /id="notebook"/.test(web), "the browser notebook is missing");
  const serverSource2 = readFileSync(join(root, "runtime/server.mjs"), "utf8");
  const worldSource = readFileSync(join(root, "runtime/world.mjs"), "utf8");
  check(/MAX_CARRY = 20/.test(serverSource2) && /carryCount/.test(serverSource2), "the carry limit is missing");
  check(/named === "use"/.test(serverSource2) && /intent.kind === "teleportItem"/.test(worldSource), "the teleport item path is missing");
  check(/Movement is blocked in combat/.test(serverSource2) && /intent.kind === "flee"/.test(worldSource), "the combat movement/flee path is missing");
  check(/named === "hide"/.test(serverSource2) && /actor.hidden = true/.test(serverSource2) && /detectUntil/.test(worldSource) && /visibleActors/.test(serverSource2), "the Night Market hide/visibility path is missing");
  check(/pathname === "\/mind.mjs"/.test(serverSource2) && /from "\/mind.mjs"/.test(web), "the browser Mind module is not served or imported");
  check(/pathname === "\/planner.mjs"/.test(serverSource2) && /from "\/planner.mjs"/.test(web), "the browser focus planner is not served or imported");
  check(/already fighting/.test(serverSource2) && /state.engagements.some/.test(serverSource2), "the redundant-attack response is missing");
  check(/engagements.some\(\(entry\) => entry.attackerId === npc.id/.test(worldSource), "an engaged mobile can still wander out of combat");
  check(/lostXp/.test(worldSource) && /lostLevel/.test(worldSource) && /deaths/.test(serverSource2), "the death penalty is missing");
  check(/requires\?\.actors/.test(serverSource2) && /push-twin-door/.test(readFileSync(join(root, "world/data/actions.json"), "utf8")), "the two-player door is missing");
  const nightMenu = buildActionMenu({ self: { guild: "night-market", guild_rank: "cutpurse", inventory_names: [], enemies: [], techniques: [] }, room: { exits: [], objects: [], npcs: [], actions: [] } });
  check(nightMenu.includes("hide"), "the Night Market action menu lost hide");
  check(/Death is brutal/.test(buildSystemPrompt({ name: "scout", fast: true })) && /max level/.test(buildSystemPrompt({ name: "scout", fast: true })), "the agent prompt lost the death/win condition");
  check(Boolean(GOALS.completionist), "the completionist goal is missing");
  const goalUser = buildUserPrompt({ turn: 1, observation: "[The Atrium]", fast: true, actions: ["completion"], state: { self: { name: "bob", completion: { level: 10, maxLevel: 10, quests: 22, questsTotal: 22, puzzles: 25, puzzlesTotal: 25, achieved: true } }, room: {} } });
  check(goalUser.includes("GOAL: level 10/10") && goalUser.includes("hidden ways 25/25") && goalUser.includes("ACHIEVED") && goalUser.includes("completion"), "the agent prompt lost the completion goal");
  check(/named === "completion"/.test(serverSource2) && /completionState/.test(worldSource) && /actor.completion = record/.test(worldSource), "the completion command or record is missing");
  check(/waiting \$\{left\}s/.test(web) && /throttlePlan/.test(web) && /AI waiting/.test(web), "the AI does not wait for a rate-limit window");
  check(/console\.groq\.com\/keys/.test(web) && /DeepSeek/.test(web), "the UI does not offer the Groq free key or DeepSeek");
  check(!/Pollinations/i.test(web), "the web shell still mentions Pollinations");
  const serverSource = readFileSync(join(root, "runtime/server.mjs"), "utf8");
  check(!/\/api\/free|\/api\/gemini|FREE_AI_KEY|GEMINI_API_KEY/.test(serverSource), "the server still has a hosted model proxy");
  check(/pathname === "\/router.mjs"/.test(serverSource) && /assemble\(/.test(web) && /from "\/router.mjs"/.test(web), "the browser R4 router is missing");
  const streamed = await readSseText(new Response([
    'data: {"choices":[{"delta":{"content":"THOUGHT: look"}}]}',
    'data: {"choices":[{"delta":{"content":" around\\nCOMMAND: look"}}]}',
    'data: [DONE]',
    '',
  ].join("\n\n")), () => {});
  check(streamed.text.includes("COMMAND: look") && streamed.text.includes("THOUGHT: look"), "the SSE reader lost content");
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
  const replyOnly = parseBrain("THOUGHT: The exit is north.\nREPLY: north");
  check(replyOnly.command === "north" && replyOnly.reply === "", "the parser did not recover a command from REPLY");
  const quit = parseBrain("THOUGHT: done\nCOMMAND: quit");
  check(quit.command === "look", "the parser let the model quit the session");
  const system = buildSystemPrompt({ name: "scout" });
  check(system.includes("scout") && system.includes("COMMAND:"), "the system prompt lost the name or format");
  const user = buildUserPrompt({ turn: 2, observation: "[The Atrium]", director: ["go north"] });
  check(user.includes("TURN 2") && user.includes("go north"), "the user prompt lost the turn or direction");
  const fastFormatUser = buildUserPrompt({ turn: 2, observation: "[The Atrium]", fast: true, actions: ["look", "north"] });
  check(/THOUGHT: one short sentence/.test(fastFormatUser) && /PLAN: one concrete step/.test(fastFormatUser) && /LESSON: one durable rule/.test(fastFormatUser) && /COMMAND: one command/.test(fastFormatUser), "the fast prompt lost the six-line output format");
  const stateUser = buildUserPrompt({
    turn: 3,
    observation: "[The Atrium]",
    state: {
      world: { online: 2, phase: "day", weather: "rain", reset_seconds: 3600 },
      self: { level: 4, xp: 300, next_xp: 500, hp: 12, max_hp: 14, quests: { active: 1, completed: 2 }, inventory: 3, wielding: "a short sword", guild: "mages", guild_rank: "adept" },
    },
  });
  check(stateUser.includes("WORLD: 2 online") && stateUser.includes("YOU: level 4"), "the user prompt lost the world/self state");
  const routed = assemble({ events: "[The Atrium]\nExits: north.", world: "WORLD: 2 online · day" });
  check(routed.layers.includes("world") && routed.context.includes("WORLD: 2 online"), "the router lost the world layer");
  const openai = requestFor("openai", { base: "https://api.openai.com/v1", model: "m", key: "k", name: "scout" }, "sys", [{ role: "user", content: "hi" }]);
  check(openai.url.endsWith("/chat/completions") && openai.headers.authorization === "Bearer k", "the OpenAI request shape is wrong");
  const anthropic = requestFor("anthropic", { base: "https://api.anthropic.com/v1", model: "m", key: "k" }, "sys", [{ role: "user", content: "hi" }]);
  check(anthropic.headers["anthropic-dangerous-direct-browser-access"] === "true", "the Anthropic request lost the browser header");
  const ollama = requestFor("ollama", { base: "http://localhost:11434/v1", model: "qwen2.5:7b", fast: true, maxTokens: 80 }, "sys", [{ role: "user", content: "hi" }]);
  check(ollama.url.endsWith("/api/chat") && ollama.body.think === false && ollama.body.keep_alive === -1 && ollama.body.options.num_predict === 80, "the Ollama request does not disable thinking or bound output");
  const ollamaThink = requestFor("ollama", { base: "http://localhost:11434/v1", model: "qwen3:8b", fast: true, deliberate: true }, "sys", [{ role: "user", content: "hi" }]);
  check(ollamaThink.body.think === true, "deliberate mode did not allow Ollama thinking");
  const gemini = requestFor("custom", { base: "https://example.test/v1", model: "gemini-2.5-flash", fast: true, maxTokens: 80 }, "sys", [{ role: "user", content: "hi" }]);
  check(gemini.body.reasoning_effort === "medium" && gemini.body.max_tokens === 80, "the default profile did not reach the custom endpoint");
  const geminiThink = requestFor("custom", { base: "https://example.test/v1", model: "gemini-2.5-flash", fast: true, deliberate: true }, "sys", [{ role: "user", content: "hi" }]);
  check(geminiThink.body.reasoning_effort === "medium", "the default profile changed on a deliberate turn");
  const gpt5 = requestFor("custom", { base: "https://example.test/v1", model: "gpt-5-mini", fast: true, maxTokens: 80 }, "sys", [{ role: "user", content: "hi" }]);
  check(gpt5.body.reasoning_effort === "medium", "a reasoning model did not get the default effort");
  const deliberate = requestFor("custom", { base: "https://example.test/v1", model: "gemini-2.5-flash", fast: false }, "sys", [{ role: "user", content: "hi" }]);
  check(deliberate.body.reasoning_effort === "medium", "standard mode changed the default reasoning setting");
  const fastSystem = buildSystemPrompt({ name: "scout", fast: true });
  check(fastSystem.includes("ACTIONS is a shortlist") && fastSystem.includes("say <text>") && fastSystem.includes("THOUGHT"), "the fast system prompt lost the free-form/social contract");
  const r4User = buildUserPrompt({ turn: 1, observation: "[The Atrium]", r4: "vault: the true word is amber" });
  check(r4User.includes("R4 CONTEXT:") && r4User.includes("true word is amber"), "the R4 context block was not injected");
  const fastUser = buildUserPrompt({
    turn: 1,
    observation: "[The Atrium]",
    fast: true,
    state: {
      room: {
        name: "The Atrium", safe: true, details: ["plaque"],
        exits: [{ dir: "north" }], objects: [{ name: "a grey cloak", takeable: true }], npcs: [{ name: "a bard", aggression: 0 }], actions: [],
      },
    },
  });
  check(fastUser.includes("ACTIONS:") && fastUser.includes("north") && fastUser.includes("examine plaque") && fastUser.includes("take a grey cloak") && fastUser.includes("say <text>"), "the fast prompt did not inject the legal/social actions");
  const guardState = {
    room: {
      name: "The Atrium", safe: true, details: ["plaque"],
      exits: [{ dir: "north" }, { dir: "east" }],
      objects: [
        { name: "an oaken chest", open: true, container: true, contents: ["a copper coin"] },
        { name: "a grey cloak", takeable: true },
        { name: "a short sword", takeable: true, forSale: true, price: 30 },
      ],
      npcs: [{ name: "a bard", aggression: 0 }], actions: [],
    },
    self: { inventory_names: ["a grey cloak"], spells: ["spark"] },
  };
  check(validateCommand("look", guardState).ok, "a basic command was rejected");
  check(validateCommand("go north", guardState).ok, "go north was rejected");
  check(validateCommand("say hello", guardState).ok, "speech was rejected");
  check(!validateCommand("search an oaken chest", guardState).ok && repairCommand("search an oaken chest", guardState) === "search", "search target was not repaired");
  check(!validateCommand("take copper coin", guardState).ok && repairCommand("take copper coin", guardState).includes("from"), "a contained item was not repaired to take-from");
  check(!validateCommand("open an oaken chest", guardState).ok && repairCommand("open an oaken chest", guardState).startsWith("close"), "an already-open container was not repaired");
  check(!validateCommand("attack a bard", guardState).ok && repairCommand("attack a bard", guardState) === "look", "safe-room combat was not repaired");
  check(!validateCommand("take short sword", guardState).ok && repairCommand("take short sword", guardState).startsWith("buy"), "a for-sale take was not repaired to buy");
  const observed = { room: { name: "The Storeroom", text: "The shelves hold a short sword and a leather jerkin. Exits: west.", exits: [{ dir: "west" }], objects: [], npcs: [], details: [] } };
  check(validateCommand("take short sword", observed).ok, "observation names were not available to the validator");
  const reasoned = replyFrom("custom", { choices: [{ message: { content: "", reasoning_content: "COMMAND: look" } }] });
  check(reasoned.text === "", "reasoning content was treated as the answer");
  const native = replyFrom("ollama", { message: { content: "THOUGHT: x\nCOMMAND: look" } });
  check(native.text.includes("COMMAND: look"), "the native Ollama reply was not parsed");
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

// Persistent AI memory: room commands, stale repeats, unexplored exits, and
// a loop guard that chooses a different action.
let aiMemory = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { aiMemory.ok = false; aiMemory.why.push(why); } };
  const memory = emptyMemory();
  rememberResult(memory, { room: "The Atrium", command: "examine plaque", observation: "The plaque reads: the Vault keeps the word.", tick: 1 });
  rememberResult(memory, { room: "The Atrium", command: "examine plaque", observation: "The plaque reads: the Vault keeps the word.", tick: 2 });
  rememberResult(memory, { room: "The Atrium", command: "examine plaque", observation: "The plaque reads: the Vault keeps the word.", tick: 3 });
  rememberResult(memory, { room: "The Storeroom", command: "look", observation: "Shelves of empty crates.", tick: 4 });
  const prompt = memoryPrompt(memory, {
    room: "The Atrium",
    exits: [{ dir: "north", room: "The Corridor" }, { dir: "south", room: "Market Square" }],
  });
  check(prompt.includes("seen 2 times") || prompt.includes("seen 1 time"), "the memory lost the room visit");
  check(prompt.includes("stale 2"), "the memory did not mark the repeated result stale");
  check(prompt.includes("The Storeroom"), "the memory lost a visited room");
  const recall = memoryPrompt(memory, { room: "The Atrium", query: "What did the plaque say about the Vault?" });
  check(recall.includes("Known:") && recall.includes("Vault keeps the word"), "the prime concept index did not recall the plaque fact");
  const social = emptyMemory();
  rememberResult(social, { room: "The Atrium", command: "say", observation: "a bard says: The Vault keeps the word.\nA stranger tells you: the password is secret.\nPassword changed.", tick: 2 });
  const socialPrompt = memoryPrompt(social, { room: "The Atrium" });
  check(socialPrompt.includes("Voices:") && socialPrompt.includes("a bard") && socialPrompt.includes("Vault keeps the word"), "the social memory lost public speech");
  check(!/tells you|password is secret|Password changed/i.test(socialPrompt), "the social memory leaked a private line");
  check(prompt.includes("Unexplored exits"), "the memory lost the unexplored exits");
  check(prompt.includes("Route:"), "the memory lost the recent route");
  check(loopWarning(["north", "south", "north", "south"]).includes("LOOP"), "the memory did not detect a movement cycle");
  check(loopWarning(["look", "look", "look"]).includes("LOOP"), "the memory did not detect a repeated command");
  check(loopWarning([], ["The Atrium", "The Corridor", "The Atrium", "The Corridor"]).includes("ROUTE LOOP"), "the memory did not detect a room cycle");
  check(breakLoop(["north", "south", "north", "south"], [{ dir: "north" }, { dir: "south" }, { dir: "east" }]) === "east", "the loop guard did not choose a fresh exit");
  const route = emptyMemory();
  noteRoom(route, "The Atrium");
  noteRoom(route, "The Corridor");
  check(breakLoop(["north", "south", "north", "south"], [
    { dir: "north", room: "The Atrium" },
    { dir: "south", room: "The Corridor" },
    { dir: "east", room: "The Vault" },
  ], route) === "east", "the loop guard did not prefer an unvisited room");
  check(shouldBreakLoop(route, { room: "The Atrium", command: "north", recent: ["north", "south", "north", "south"] }), "the route loop did not trigger the loop guard");
  check(shouldBreakLoop(memory, { room: "The Atrium", command: "examine plaque", recent: [] }), "the stale memory did not trigger the loop guard");
  const graph = emptyMemory();
  noteRoom(graph, "The Atrium", [{ dir: "north", room: "The Corridor" }, { dir: "east", room: "The Storeroom" }]);
  noteRoom(graph, "The Corridor", [{ dir: "south", room: "The Atrium" }, { dir: "east", room: "The Vault" }]);
  noteRoom(graph, "The Vault", [{ dir: "west", room: "The Corridor" }]);
  const path = pathTo(graph, "The Atrium", "The Vault");
  check(path.length === 2 && path[0] === "north" && path[1] === "east", "the room graph did not find the shortest path");
  check(nextStep(graph, "The Atrium", "The Vault") === "north", "the next-step planner chose the wrong exit");
  check(routeHint(graph, "The Atrium", "The Vault").includes("north"), "the route hint did not name the next exit");
  check(routeHint(graph, "The Atrium", "The Moon").includes("No known route"), "the route hint invented an unknown path");
  const nearest = nearestTarget(graph, "The Atrium", ["The Moon", "The Vault"]);
  check(nearest?.target === "The Vault" && nearest.path.length === 2, "the nearest-objective planner chose the wrong target");
  const here = nearestTarget(graph, "The Vault", ["The Vault", "The Moon"]);
  check(here?.target === "The Vault" && here.path.length === 0, "the nearest-objective planner skipped the current room");
  const llmsSeeded = emptyMemory();
  seedMapFromLlms(llmsSeeded, "| 1 | The Atrium | temple | no | north 2, east 3 |\n| 2 | The Corridor | temple | no | south 1, east 4 |\n| 4 | The Vault | temple | no | west 2 |");
  check(pathTo(llmsSeeded, "The Atrium", "The Vault").join(",") === "north,east", "the llms room table did not seed the route graph");
  const seeded = emptyMemory();
  seedMap(seeded, [
    { name: "Market Square", exits: [{ dir: "west", room: "The Gilded Rat" }, { dir: "north", room: "The Atrium" }] },
    { name: "The Gilded Rat", exits: [{ dir: "east", room: "Market Square" }, { dir: "north", room: "The Guild Hall" }] },
    { name: "The Guild Hall", exits: [{ dir: "south", room: "The Gilded Rat" }] },
  ]);
  check(pathTo(seeded, "Market Square", "The Guild Hall").join(",") === "west,north", "the published map did not seed a route");
  check(observedCommandSuccess("take press seed", "You take a press seed."), "the take success check missed a take");
  check(!observedCommandSuccess("deliver seal", "Nobody here answers to that."), "the delivery check accepted a failure");
  check(observedCommandSuccess("recall orchard", "You recall: the orchard keeps ORCHARD."), "the recall success check missed a recall");
  check(!observedCommandSuccess("take press seed", "There is no press seed here."), "the take check accepted a miss");
  if (aiMemory.why.length) { aiMemory.ok = false; failures.push(`the AI memory is broken: ${aiMemory.why[0]}`); }
}

// New AI/human characters get a random valid name and the AI never falls back
// to a separate standalone Prism account.
let characterNames = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { characterNames.ok = false; characterNames.why.push(why); } };
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const name = uniqueCharacterName([...seen], random);
    check(/^[a-z]+-[a-z]+-[0-9]{2,4}$/.test(name), `random name ${name} is not a valid character name`);
    check(name.length <= 24, `random name ${name} is too long`);
    check(!seen.has(name), `random name ${name} was repeated`);
    seen.add(name);
  }
  check(/^[a-z]+-[a-z]+-[0-9]{2,4}$/.test(randomCharacterName(random)), "randomCharacterName returned an invalid name");
  for (const adjective of ADJECTIVES) {
    for (const noun of NOUNS) {
      const generated = `${adjective}-${noun}-42`;
      check(validNewName(generated), `generated name ${generated} is refused by the new-name policy`);
    }
  }
  check(web.includes("/names.mjs"), "the page does not load the name generator");
  check((web.match(/prismSignIn\("ai"/g) ?? []).length === 1, "the old AI account path is not limited to recovery");
  check(web.includes("No old AI session is stored in this browser"), "the old AI recovery path is missing");
  check(web.includes("Recover old AI characters"), "the recovery panel is missing");
  check(serverSource.includes("recover-list") && serverSource.includes("transferCharacter"), "the server transfer path is missing");
  check(web.includes("AI personas use your Prism account"), "the AI does not require the human Prism login");
  check(web.includes("randomCharacterName()"), "the human create form does not suggest a random name");
  check(web.includes("chooseCharacter"), "the AI does not use the shared character choice");
  check(serverSource.includes("/names.mjs"), "the server does not serve the name generator");
  check(web.includes("Open a normal window or use a recovery kit before starting the AI"), "a memory-only window can still start an orphan AI persona");
  const existing = chooseCharacter({ wanted: "scout", explicit: false, characters: ["alder-fox-42"], random });
  check(existing.action === "play" && existing.name === "alder-fox-42", "the AI did not prefer an existing character");
  const explicitNew = chooseCharacter({ wanted: "scout", explicit: true, characters: ["alder-fox-42"], random });
  check(explicitNew.action === "create" && explicitNew.name === "scout", "an explicit new character was not created");
  const blankNew = chooseCharacter({ explicit: false, characters: [], random });
  check(blankNew.action === "create" && /^[a-z]+-[a-z]+-[0-9]{2,4}$/.test(blankNew.name), "a blank new account did not get a random name");
  const present = chooseCharacter({ wanted: "alder-fox-42", explicit: true, characters: ["alder-fox-42"], random });
  check(present.action === "play", "an existing explicit character was not played");
  if (characterNames.why.length) failures.push(`character names are broken: ${characterNames.why[0]}`);
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
      const backRoom = world.rooms[target];
      if (!back || (backRoom?.exits?.[back] !== Number(id) && backRoom?.secretExits?.[back] !== Number(id))) {
        worldMap.ok = false;
        worldMap.why.push(`exit ${id} ${direction} -> ${target} has no way back`);
      }
    }
    for (const [direction, target] of Object.entries(room.secretExits ?? {})) {
      const back = opposite[direction];
      const backRoom = world.rooms[target];
      if (!world.rooms[target] || (backRoom?.exits?.[back] !== Number(id) && backRoom?.secretExits?.[back] !== Number(id))) {
        worldMap.ok = false;
        worldMap.why.push(`secret ${id} ${direction} -> ${target} has no way back`);
      }
    }
  }
  if (!examine({ room: world.rooms[1], target: "plaque" })) { worldMap.ok = false; worldMap.why.push("the Atrium plaque cannot be examined"); }
  if (!examine({ room: world.rooms[1], target: "sword", objects: world.objects })) { worldMap.ok = false; worldMap.why.push("an object cannot be examined"); }
  if (!examine({ room: world.rooms[1], target: "bard", npcs: world.npcs })) { worldMap.ok = false; worldMap.why.push("a mobile cannot be examined"); }
  if (examine({ room: world.rooms[1], target: "nothing-at-all" })) { worldMap.ok = false; worldMap.why.push("a missing thing was examined"); }
  const start = String(world.start);
  if (Object.keys(world.rooms[start]?.exits ?? {}).length < 5) {
    worldMap.ok = false;
    worldMap.why.push("the start room is not a hub with at least five exits");
  }
  const reachableAvoiding = (avoid) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift();
      const exits = { ...(world.rooms[at]?.exits ?? {}), ...(world.rooms[at]?.secretExits ?? {}) };
      for (const target of Object.values(exits)) {
        const next = String(target);
        if (avoid.has(next) || seen.has(next) || !world.rooms[next]) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };
  if (!reachableAvoiding(new Set(["8"])).has("30")) {
    worldMap.ok = false;
    worldMap.why.push("the Harbor Quay is unreachable without crossing Market Square");
  }
  if (!reachableAvoiding(new Set(["11"])).has("31")) {
    worldMap.ok = false;
    worldMap.why.push("the Docks are unreachable without crossing the King's Road");
  }
  if (!worldMap.ok) failures.push(`the world map is broken: ${worldMap.why[0]}`);
}

// The small districts are folded into their parents; the rooms did not move.
let zoneMap = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const check = (condition, why) => { if (!condition) { zoneMap.ok = false; zoneMap.why.push(why); } };
  const zone = (id) => world.zones.find((entry) => entry.id === id);
  check(world.zones.length === 17, `the zone count is ${world.zones.length}, not 17`);
  check(zone("town")?.rooms.includes(30) && zone("town")?.rooms.includes(33), "the Harbor is not in the Town zone");
  check(zone("lantern")?.rooms.includes(25) && zone("lantern")?.rooms.includes(29), "the Undercroft is not in the Lantern Quarter zone");
  check(zone("moon")?.rooms.includes(92) && zone("moon")?.rooms.includes(97), "the Eclipse Court is not in the Moonlit Reach zone");
  check(!["harbor", "undercroft", "eclipse"].some((id) => zone(id)), "a folded zone id is still live");
  check(world.zones.reduce((sum, entry) => sum + entry.rooms.length, 0) === Object.keys(world.rooms).length, "the zones do not cover every room exactly once");
  const zoneOf = new Map(world.zones.flatMap((entry) => entry.rooms.map((room) => [String(room), entry.id])));
  const neighbours = new Map(world.zones.map((entry) => [entry.id, new Set()]));
  for (const [id, room] of Object.entries(world.rooms)) {
    const from = zoneOf.get(id);
    for (const target of [...Object.values(room.exits ?? {}), ...Object.values(room.secretExits ?? {})]) {
      const to = zoneOf.get(String(target));
      if (from && to && from !== to) { neighbours.get(from).add(to); neighbours.get(to).add(from); }
    }
  }
  for (const [id, set] of neighbours) check(set.size >= 2, `the ${id} zone has only ${set.size} neighbouring zone(s)`);
  if (!zoneMap.ok) failures.push(`the zone map is broken: ${zoneMap.why[0]}`);
}

// The opening rooms carry the first impression and the first clues. They must
// be more than a signpost: a scene, a few senses and something to examine.
let startRooms = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const check = (condition, why) => { if (!condition) { startRooms.ok = false; startRooms.why.push(why); } };
  const ids = [...Array(14)].map((_, index) => index + 1).concat([30, 31, 32, 33]);
  for (const id of ids) {
    const room = world.rooms[id];
    check(Boolean(room), `starting room ${id} is missing`);
    if (!room) continue;
    check(room.text.length >= 280, `starting room ${id} is ${room.text.length} characters, not 280`);
    check((room.ambient ?? []).length >= 3, `starting room ${id} has fewer than 3 ambient lines`);
    check(Object.keys(room.details ?? {}).length >= 2, `starting room ${id} has fewer than 2 details`);
  }
  if (!startRooms.ok) failures.push(`the opening rooms are thin: ${startRooms.why[0]}`);
}

// The verb table must resolve its own aliases and use only known codes.
const verbTable = loadVerbs();
if (verbTable.errors.length > 0) failures.push(`verbs are invalid: ${verbTable.errors[0]}`);

// Channels and socials must resolve, and none may shadow a verb or each other.
const channelTable = loadChannels();
const socialTable = loadSocials();
const questTable = loadQuests();
measured.quests = questTable.quests.length;
if (measured.quests > ratchet.mustNotGrow.quests) failures.push(`quests are ${measured.quests}, above the frozen ceiling of ${ratchet.mustNotGrow.quests}; the target is 25`);

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
  if (!validName("alice-1") || validName("a b") || validName("admin") || validName("Moderator") || !validPassword("sixsix") || validPassword("short")) {
    accounts.ok = false;
    accounts.why.push("name or password validation is wrong");
  }
  // New names add a minimum length and a token-aware impersonation policy.
  // The shape check stays permissive so a legacy short name can still log in.
  if (!validName("ab") || validNewName("ab")) {
    accounts.ok = false;
    accounts.why.push("the new-name minimum length is wrong");
  }
  if (!validName("root") || validNewName("root")) {
    accounts.ok = false;
    accounts.why.push("the legacy-login and new-name reserved sets are not distinct");
  }
  for (const name of ["admin2", "the-admin", "4dm1n", "4dm1n1", "w1zard", "w1zard2", "mod_team", "gm", "sysadmin", "support", "root", "themod", "the4dm1n2", "game-master", "123", "___"]) {
    if (validNewName(name)) {
      accounts.ok = false;
      accounts.why.push(`the reserved-name policy admitted ${name}`);
    }
  }
  for (const name of ["alice-1", "badminton", "wizardry", "modest", "supportive", "a-b"]) {
    if (!validNewName(name)) {
      accounts.ok = false;
      accounts.why.push(`the reserved-name policy refused ${name}`);
    }
  }
  if (accountCapReached(499, 500) || !accountCapReached(500, 500) || accountCapReached(1, 0)) {
    accounts.ok = false;
    accounts.why.push("the account cap boundary is wrong");
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
  // Recovery moves an old AI account's character to the human account.
  const oldKey = `sha256:${"e".repeat(64)}`;
  const humanKey = `sha256:${"f".repeat(64)}`;
  run([{ kind: "join", actorId: "rec", name: "rec" }]);
  run([{ kind: "createCharacter", accountKey: oldKey, name: "oldscout", actorId: "rec" }]);
  run([{ kind: "transferCharacter", actorId: "rec", fromKey: oldKey, toKey: humanKey, characterKey: "oldscout" }]);
  if (state.identities.oldscout?.owner !== humanKey) prismLogin.why.push("the old AI character did not move to the human account");
  if ((state.accounts[humanKey]?.characters ?? []).includes("oldscout") !== true) prismLogin.why.push("the human account did not receive the recovered character");
  if ((state.accounts[oldKey]?.characters ?? []).includes("oldscout")) prismLogin.why.push("the old account kept the recovered character");

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

// Old AI transfers are signed by the old account and verified before a move.
let prismTransfer = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { prismTransfer.ok = false; prismTransfer.why.push(why); } };
  const origin = "https://play.r4labs.org";
  const now = Date.now();
  const oldAi = await createPrism({});
  const human = await createPrism({});
  const action = await signAction(oldAi, "prism/character-transfer/1", { character: "oldscout", to: human.prism, audience: origin }, { audience: origin, now });
  const records = [...oldAi.log.values()];
  const good = await verifyPrismAction(action, { origin, records, action: "prism/character-transfer/1", expected: { to: human.prism }, now });
  check(good.ok && good.prism === oldAi.prism && good.payload?.character === "oldscout", "a signed old-account transfer was not accepted");
  const wrongUser = await createPrism({});
  const wrongAction = await signAction(oldAi, "prism/character-transfer/1", { character: "oldscout", to: wrongUser.prism, audience: origin }, { audience: origin, now: now + 1 });
  const wrong = await verifyPrismAction(wrongAction, { origin, records, action: "prism/character-transfer/1", expected: { to: human.prism }, now: now + 1 });
  check(!wrong.ok, "a transfer to another account was accepted");
  if (prismTransfer.why.length) failures.push(`prism transfer is broken: ${prismTransfer.why[0]}`);
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
    quests: { active: [{ id: "word", progress: {} }], completed: ["guardian"] },
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
  check(claimed?.quests?.completed?.includes("guardian") && claimed?.quests?.active?.some((entry) => entry.id === "word"), "the claim lost the old quests");
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

// The account audit is read-only and never prints credential hashes.
let audit = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { audit.ok = false; audit.why.push(why); } };
  const report = auditAccounts({
    tick: 1_000_000,
    accounts: {
      a: { kind: "legacy", characters: ["a"], passwordHash: "h", lastSeenTick: 1_000_000 },
      b: { kind: "legacy", characters: ["b"], tokenHash: "t", lastSeenTick: 1_000_000 },
      c: { kind: "legacy", characters: [], retired: true },
      d: { kind: "legacy", characters: ["d"], passwordHash: null, tokenHash: null, lastSeenTick: 0 },
      p: { kind: "prism", characters: ["p"], lastSeenTick: 1_000_000 },
    },
    identities: { a: {}, b: {}, d: {}, p: {} },
  }, { inactiveDays: 1 });
  check(report.counts.accounts === 5 && report.counts.legacy === 4 && report.counts.prism === 1, "the audit account counts are wrong");
  check(report.counts.credentialless === 1 && report.credentialless[0] === "d", "the audit did not find the credentialless account");
  check(report.counts.inactive === 1 && report.inactive[0] === "d", "the audit did not find the inactive account");
  check(!JSON.stringify(report).includes("passwordHash"), "the audit exposed a credential field");
  if (audit.why.length) { audit.ok = false; failures.push(`the account audit is broken: ${audit.why[0]}`); }
}

// A disposable bare Prism account can be removed with its pin; an account with
// a character, owner or external reference is refused.
let accountDelete = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { accountDelete.ok = false; accountDelete.why.push(why); } };
  const bare = () => ({
    accounts: { p: { kind: "prism", characters: [], retired: false } },
    identities: {}, guilds: {}, mail: [], duels: [], actors: [],
  });
  let store = { prisms: { p: { root: "x" } } };
  let state = bare();
  const removed = deleteBarePrismAccount(state, store, "p");
  check(removed.ok && !state.accounts.p && !store.prisms.p, "a bare Prism account was not removed with its pin");
  check(removed.counts?.accounts === 0 && removed.counts?.pinned === 0, "the delete-account counts are wrong");
  state = bare(); state.accounts.p.characters.push("alice");
  check(!deleteBarePrismAccount(state, store, "p").ok, "an account with a character was deleted");
  state = bare(); state.accounts.p.owner = "human";
  check(!deleteBarePrismAccount(state, store, "p").ok, "a persona account was deleted");
  state = bare(); state.mail.push({ fromKey: "p", toKey: "friend" });
  check(!deleteBarePrismAccount(state, store, "p").ok, "an account with mail was deleted");
  state = { accounts: {}, identities: {}, guilds: {}, mail: [], duels: [], actors: [] };
  store = { prisms: { q: { root: "x" } } };
  const pin = deletePrismIdentity(state, store, "q");
  check(pin.ok && !store.prisms.q && pin.removed.account === null, "a bare Prism pin was not removed");
  if (accountDelete.why.length) { accountDelete.ok = false; failures.push(`the account delete is broken: ${accountDelete.why[0]}`); }
}

// The launch wipe removes every player record and pinned Prism log while
// keeping the world itself.
let accountWipe = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { accountWipe.ok = false; accountWipe.why.push(why); } };
  const state = {
    accounts: { a: { kind: "legacy" }, p: { kind: "prism" } },
    identities: { alice: { owner: "p" }, bob: {} },
    actors: [{ id: 1, key: "alice" }],
    mail: [{ fromKey: "p" }],
    duels: [{ challengerKey: "a" }],
    engagements: [{ attackerId: 1 }],
    guilds: {
      mages: { members: { alice: "member" }, invites: ["bob"], vault: ["shield"] },
      players: { members: { bob: "leader" }, invites: [], vault: ["sword"] },
    },
    objects: [{ id: "sword", holder: "guild:players" }, { id: "shield", holder: "guild:mages" }],
    rooms: { 1: { name: "The Atrium" } },
    npcs: [{ id: "rat" }],
  };
  const store = { prisms: { a: { root: "x" }, p: { root: "y" } } };
  const result = wipePlayers(state, store);
  check(result.before.accounts === 2 && result.before.identities === 2 && result.before.pinned === 2, "the wipe counts are wrong");
  check(result.after.accounts === 0 && result.after.identities === 0 && result.after.pinned === 0, "the wipe left player records");
  check(Number.isSafeInteger(store.revokedBefore) && result.revokedBefore === store.revokedBefore, "the wipe did not set a session revocation point");
  check(store.blocked?.includes("a") && store.blocked?.includes("p") && store.blocked?.length === 2, "the wipe did not block the removed pinned ids");
  check(result.after.actors === 0 && state.mail.length === 0 && state.duels.length === 0 && state.engagements.length === 0, "the wipe left player references");
  check(state.guilds.mages && Object.keys(state.guilds.mages.members).length === 0 && state.guilds.mages.invites.length === 0, "the mages roster was not cleared");
  check(!state.guilds.players, "a player guild survived the wipe");
  check(state.objects.every((object) => object.holder === null && object.room === GUILD_HALL), "the wipe did not release vault goods into the hall");
  check(state.rooms[1]?.name === "The Atrium" && state.npcs[0]?.id === "rat", "the wipe removed world content");
  if (accountWipe.why.length) { accountWipe.ok = false; failures.push(`the account wipe is broken: ${accountWipe.why[0]}`); }
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
  const meta = normalizeStreamEvent({ kind: "meta", provider: "groq", model: "llama-3.1-8b-instant", goal: "Explorer", character: "scout", owner: "secret" });
  check(meta?.model === "llama-3.1-8b-instant" && meta?.goal === "Explorer" && !("owner" in meta), "the stream meta event is wrong");
  const decision = normalizeStreamEvent({ kind: "decision", text: "I should examine the plaque.", command: "examine plaque", turn: 1 });
  check(decision?.command === "examine plaque" && decision?.text.includes("plaque"), "the decision event is wrong");
  check(normalizeStreamEvent({ kind: "decision", text: "A guard tells you x" }) === null, "a private decision was accepted");
  const streamState = normalizeStreamEvent({ kind: "state", hp: 12, maxHp: 20, mana: 5, maxMana: 5, level: 2, xp: 30, nextXp: 100, room: "The Atrium", quest: "A Curled Scroll", turn: 1 });
  check(streamState?.hp === 12 && streamState?.room === "The Atrium" && streamState?.quest === "A Curled Scroll", "the stream state event is wrong");
  const streamStats = normalizeStreamEvent({ kind: "stats", turn: 1, commands: 1, latencyMs: 1700, tokensIn: 800, model: "llama-3.1-8b-instant" });
  check(streamStats?.commands === 1 && streamStats?.latencyMs === 1700, "the stream stats event is wrong");
  check(streamDelay(0, false) === 0 && streamDelay(30, false) === 30, "the chosen stream delay is wrong");
  check(streamDelay(0, true) === PVP_STREAM_DELAY && streamDelay(30, true) === PVP_STREAM_DELAY, "the PvP stream delay floor is wrong");
  check(streamDelay(120, true) === 120 && streamDelay(MAX_STREAM_DELAY + 100, false) === MAX_STREAM_DELAY, "the stream delay ceiling is wrong");
  const serverText = readFileSync(join(root, "runtime/server.mjs"), "utf8");
  check(/pathname === "\/live"/.test(serverText), "the server has no /live spectator socket");
  check(/#stream-state/.test(serverText), "the server does not confirm stream state");
  check(/action === "poll"/.test(serverText) && /action === "chat"/.test(serverText), "the streamer has no poll or chat controls");
  check(/pathname === "\/stream"/.test(serverText) && /mudbenchmark\/stream\/1/.test(serverText), "the public stream status endpoint is missing");
  check(/named === "track"/.test(serverText) && /Only a Warden scout/.test(serverText), "the Warden track command is missing");
  check(/pathname === "\/stats"/.test(serverText) && /pathname === "\/leaderboard"/.test(serverText) && existsSync(join(root, "runtime/web/stats.html")), "the public stats page or leaderboard endpoint is missing");
  const statsPage = readFileSync(join(root, "runtime/web/stats.html"), "utf8");
  check(/pathname === "\/players"/.test(serverText) && /id="player-cards"/.test(statsPage) && /fetch\(\/players\)|get\("\/players"\)/.test(statsPage), "the public player statistics view is missing");
  check(/pathname === "\/reports"/.test(serverText) && /OWNER_TOKEN/.test(serverText) && /ownerAllowed/.test(serverText), "the owner reports endpoint is missing");
  check(/r4-context/.test(serverText) && /R4_URL/.test(serverText), "the R4 memory proxy is missing");
  check(/lastLive/.test(serverText) && /publicLast/.test(serverText), "the stream archive is missing");
  check(/mudbenchmark\/stream-archive\/1/.test(serverText) && /includeEvents/.test(serverText) && /live\.archive/.test(serverText), "the stream replay archive is missing");
  check(/STREAM_ARCHIVE_FILE/.test(serverText) && /saveStreamArchive/.test(serverText) && /loadStreamArchive/.test(serverText), "the durable stream archive is missing");
  check(/SIGNUP_MODE/.test(serverText) && /SIGNUPS_OPEN/.test(serverText), "the operator signup mode is missing");
  check(/Groq has a free key/.test(web) && /DeepSeek/.test(web) && /id="ai-key"/.test(web), "the BYO-key fields are missing");
  check(/inventory_names/.test(serverText) && /active_quests/.test(serverText) && /details: Object.keys\(room.details/.test(serverText), "the self state lost the injected room context");
  check(/isVote/.test(serverText) && /vote a or vote b/.test(serverText), "spectators cannot vote");
  check(/\^\(stream\|metric\|session-key\|rebind\|r4-context\|r4-remember\)/.test(serverText), "control verbs still consume the player rate limit");
  const page = readFileSync(join(root, "runtime/web/index.html"), "utf8");
  check(/class="skip"/.test(page) && /prefers-reduced-motion/.test(page) && /:focus-visible/.test(page) && /role="log"/.test(page) && /aria-live="polite"/.test(page), "the accessibility shell contract is missing");
  check(/id="mobile-nav-toggle"/.test(page) && /id="mobile-nav"/.test(page) && /body\.guest #latest/.test(page) && /min-height: 44px/.test(page), "the mobile navigation or guest status contract is missing");
  check(/id="first-steps"/.test(page) && /id="account-persistence"/.test(page) && /id="characters-close"/.test(page) && /charactersPanel\.hidden = playingCharacter/.test(page) && /createCharacterForm\.hidden = !prismAccount/.test(page), "the first-run onboarding contract is missing");
  check(/id="hud-reset"/.test(page) && /resetDeadline/.test(page), "the reset countdown is missing");
  check(/id="hud-combat"/.test(page) && /data-quick="battle"/.test(page) && /enemies,/.test(serverText), "the combat HUD is missing");
  check(/id="ai-stream"/.test(page) && /#stream-chat/.test(page), "the AI panel has no Go live path");
  check(/from "\/router.mjs"/.test(page) && /assemble\(/.test(page), "the UI has no browser R4 context path");
  const watch = readFileSync(join(root, "runtime/web/watch.html"), "utf8");
  check(/WebSocket\(`\$\{scheme\}\/\/\$\{location\.host\}\/live`\)/.test(watch), "the watch page does not connect to /live");
  check(/function renderPoll/.test(watch) && /highlight-card/.test(watch), "the watch page has no poll or highlight");
  check(/function renderReplay/.test(watch) && /Replay decisions/.test(watch) && /stream\?run=/.test(watch), "the watch replay UI is missing");
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
    fast: true, deliberate: true, reasoning: "auto", prompt_version: "r4-direct-2",
    invalid: true, invalid_reason: "already open", repair: "close chest", loop: true,
    memory_hit: true, r4_hit: true, rooms_seen: 5,
  });
  check(metric?.latency_ms === 1234 && metric?.command === "look", "a valid AI turn metric was refused");
  check(metric?.fast === true && metric?.deliberate === true && metric?.reasoning === "auto" && metric?.prompt_version === "r4-direct-2", "the AI turn metric lost its mode");
  check(metric?.invalid === true && metric?.loop === true && metric?.memory_hit === true && metric?.r4_hit === true && metric?.rooms_seen === 5, "the AI turn metric lost the scorecard fields");
  check(normalizeAiTurn({ kind: "other", provider: "x" }) === null, "an unknown metric kind was accepted");
  check(normalizeAiTurn({ kind: "ai.turn", provider: "x", error: "x".repeat(500) })?.error.length === 200, "an error string was not bounded");
  const attrs = aiTurnAttributes(metric);
  check(attrs["ai.latency_ms"] === 1234 && attrs["ai.command"] === "look", "the AI turn attributes are wrong");

  const spans = [
    { name: "world.client", at: "2026-11-17T00:00:00Z", "client.transport": "websocket" },
    { name: "world.disconnect", at: "2026-11-17T00:01:00Z", duration_ms: 60000, "client.transport": "websocket" },
    { name: "world.session", at: "2026-11-17T00:00:30Z", "session.kind": "login" },
    { name: "ai.turn", at: "2026-11-17T00:00:40Z", "ai.latency_ms": 1000, "ai.parse_ok": true, "ai.command": "look", "ai.prompt_tokens": 10, "ai.completion_tokens": 2, "ai.provider": "openai", "ai.model": "test", "ai.fast": true, "ai.prompt_version": "r4-direct-1", "ai.invalid": true, "ai.loop": true, "ai.memory_hit": true, "ai.r4_hit": true, "ai.rooms_seen": 5 },
    { name: "ai.turn", at: "2026-11-17T00:00:45Z", "ai.latency_ms": 3000, "ai.parse_ok": false, "ai.error": "timeout", "ai.timeout": true, "ai.provider": "openai" },
    { name: "world.input", at: "2026-11-17T00:00:41Z", text: "look" },
    { name: "world.input", at: "2026-11-17T00:00:42Z", text: "north" },
    { name: "world.input", at: "2026-11-17T00:00:43Z", text: "slow", refused: "too-fast" },
    { name: "world.quest", at: "2026-11-17T00:00:50Z", "quest.action": "complete", "quest.id": "q1" },
    { name: "world.combat", at: "2026-11-17T00:00:55Z", "actor.id": "h1", outcome: "hit" },
    { name: "world.snapshot", at: "2026-11-17T00:01:00Z", "world.online": 1, "world.reset_seconds": 3600, "world.accounts": 2, "world.characters": 2, "world.actors": JSON.stringify([{ name: "alice", level: 4 }]) },
  ];
  const trends = summarizeTrends(spans);
  check(trends.ai.turns === 2 && trends.ai.parsed === 0.5, "the AI trend counts are wrong");
  check(trends.ai.by_mode.direct.turns === 1 && trends.ai.by_mode.full.turns === 1 && trends.ai.prompt_versions["r4-direct-1"] === 1, "the AI mode trends are wrong");
  check(trends.ai.invalid === 1 && trends.ai.loops === 1 && trends.ai.rooms_seen_max === 5 && trends.ai.by_model.test?.turns === 1, "the AI scorecard trends are wrong");
  check(trends.ai.latency_ms.p50 === 1000 && trends.ai.latency_ms.max === 3000, "the AI latency percentiles are wrong");
  check(trends.commands.accepted === 2 && trends.commands.refused === 1, "the command trend counts are wrong");
  check(trends.world.online.latest === 1 && trends.world.levels.max === 4, "the world trend counts are wrong");
  check(trends.clients.connections === 1 && trends.clients.sessions === 1, "the client trend counts are wrong");
  const series = summarizeSeries(spans, { minutes: 5, bucketSeconds: 60, now: Date.parse("2026-11-17T00:02:00Z") });
  check(series.schema === "mudbenchmark/series/1" && series.window.bucket_seconds === 60 && series.series.length === 5, "the series window shape is wrong");
  check(series.totals.commands === 2 && series.totals.refused === 1 && series.totals.aiTurns === 2 && series.totals.quests === 1 && series.totals.combats === 1 && series.totals.online === 1, "the series totals are wrong");
  check(series.series.some((bucket) => bucket.commands > 0) && series.series.some((bucket) => bucket.aiTurns > 0), "the series buckets are empty");
  const now = 1_000_000_000_000;
  const retention = planRetention([
    { path: "/t/spans.jsonl", size: 10, mtimeMs: now - 80 * 86400000 },
    { path: "/t/spans.old", size: 10, mtimeMs: now - 40 * 86400000 },
    { path: "/t/spans.new", size: 10, mtimeMs: now - 1 * 86400000 },
    { path: "/t/spans.huge", size: 100, mtimeMs: now - 2 * 86400000 },
  ], { now, keepDays: 30, maxBytes: 50 });
  check(retention.keep.some((file) => file.path.endsWith("spans.jsonl")), "retention dropped the live span file");
  check(retention.remove.some((file) => file.path.endsWith("spans.old")), "retention kept an expired archive");
  check(retention.keep.some((file) => file.path.endsWith("spans.new")), "retention dropped a recent archive");
  check(retention.remove.some((file) => file.path.endsWith("spans.huge")), "retention did not enforce the byte cap");

  const compact = selectPlayerLines([
    JSON.stringify({ name: "world.tick", "world.tick": 1 }),
    JSON.stringify({ name: "world.session", "actor.id": "a", "session.ai": false }),
    JSON.stringify({ name: "world.prism", "prism.id": "acct-a", "prism.ai": true }),
    JSON.stringify({ name: "world.quest", "actor.id": "a", "quest.action": "accept" }),
    JSON.stringify({ name: "ai.turn", "ai.provider": "x" }),
  ].join("\n"));
  check(PLAYER_SPAN_NAMES.has("world.session") && PLAYER_SPAN_NAMES.has("world.prism") && PLAYER_SPAN_NAMES.has("world.quest") && !PLAYER_SPAN_NAMES.has("world.tick"), "the compact player span set is wrong");
  check(compact.includes("world.session") && compact.includes("world.prism") && compact.includes("world.quest") && !compact.includes("world.tick") && !compact.includes("ai.turn"), "the compact player log kept the wrong spans");
  check(/ensurePlayerLog\(\)/.test(serverSource), "the server does not seed the compact player log");

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
  const publicStatus = worldStatus(statusState, statusWorld.rooms, { detail: false });
  check(publicStatus.online === 1 && !("actors" in publicStatus) && !("top" in publicStatus), "the public world status still leaks actors");
  statusState.engagements = [{ attackerId: "t1", targetId: statusState.npcs[0].id }];
  const overview = worldOverview(statusState, statusWorld.rooms);
  check(overview.schema === "mudbenchmark/overview/1" && overview.actors.length === 1 && overview.fights.length === 1, "the in-client overview is wrong");
  check(overview.fights[0]?.attacker === "alice" && overview.fights[0]?.target === statusState.npcs[0].name, "the overview fight names are wrong");
  const pageSource = readFileSync(join(root, "runtime/web/index.html"), "utf8");
  const statsSource = readFileSync(join(root, "runtime/web/stats.html"), "utf8");
  const watchSource = readFileSync(join(root, "runtime/web/watch.html"), "utf8");
  check(/id="hud"/.test(pageSource) && /mudbench-command-history/.test(pageSource) && /id="world-panel"/.test(pageSource) && /#overview \(\.\*\)/.test(pageSource), "the terminal HUD or world panel is missing");
  check(/id="hero"/.test(pageSource) && /id="hero-agent"/.test(pageSource) && /id="ai-free"/.test(pageSource) && /id="ai-goal"/.test(pageSource) && /id="ai-custom"/.test(pageSource) && /id="ai-weak"/.test(pageSource) && /id="ai-strict"/.test(pageSource), "the landing hero, free-agent card or strict-focus control is missing");
  check(/from "\/agent-core.mjs"/.test(pageSource) && /beginTurn\(AI\.core/.test(pageSource) && /decideTurn\(AI\.core/.test(pageSource), "the browser is not using the shared agent core");
  check(/pathname === "\/agent-core.mjs"/.test(readFileSync(join(root, "runtime/server.mjs"), "utf8")), "the server does not serve the shared agent core");
  check(/startFreeAgent/.test(pageSource) && /ensurePrismOwner/.test(pageSource) && /id="agent-chip"/.test(pageSource), "the one-click free-agent flow is missing");
  check(/id="pulse-activity"/.test(statsSource) && /\/series\?minutes=/.test(statsSource), "the public world pulse chart is missing");
  check(/class="skip"/.test(watchSource) && /role="log"/.test(watchSource) && /role="tablist"/.test(watchSource) && /aria-controls="chat-panel"/.test(watchSource) && /id="watch-announcer"/.test(watchSource), "the watch accessibility contract is missing");
  check(/class="skip"/.test(statsSource) && /id="main"/.test(statsSource) && /aria-label="Quest completion"/.test(statsSource) && /aria-label="AI models"/.test(statsSource), "the stats accessibility contract is missing");
  check(/tools\/a11y\.mjs/.test(readFileSync(join(root, ".github/workflows/gate.yml"), "utf8")), "the browser accessibility audit is not in the Gate workflow");
  check(/pathname === "\/series"/.test(serverSource) && /summarizeSeries\(/.test(serverSource) && /verb === "overview"/.test(serverSource) && /worldStatus\(state, ROOMS, \{ detail: false \}\)/.test(serverSource), "the overview or series route is missing");
  check(/id="agent-cards"/.test(watchSource) && /decision-card/.test(watchSource) && /id="stats-panel"/.test(watchSource) && /id="delay-badge"/.test(watchSource) && /loadDirectory/.test(watchSource), "the watch directory, decisions or stats panel is missing");
  check(/flushLiveQueue/.test(serverSource) && /PVP_STREAM_DELAY/.test(serverSource) && /recentRuns/.test(serverSource) && /recent: recentRuns\.map\(publicRun\)/.test(serverSource) && /stream delay/.test(serverSource), "the stream delay or recent-run directory is missing");

  if (telemetry.why.length) { telemetry.ok = false; failures.push(`the telemetry foundation is broken: ${telemetry.why[0]}`); }
}

// Player statistics are aggregate-only: sessions, playtime, quest completion,
// combat and rooms are described without account keys or character names.
let playerStats = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { playerStats.ok = false; playerStats.why.push(why); } };
  const spans = [
    { name: "world.session", at: "2026-11-20T00:00:00Z", "actor.id": "h1", "actor.name": "alice", "account.key": "acct-h", "session.kind": "register", "session.prism": false, "session.ai": false },
    { name: "world.session", at: "2026-11-20T00:01:00Z", "actor.id": "a1", "actor.name": "ember-fox-42", "account.key": "acct-ai", "session.kind": "login", "session.prism": true },
    { name: "world.prism", at: "2026-11-20T00:01:00Z", "actor.id": "a1", "prism.id": "acct-ai", "prism.ai": true },
    { name: "world.session", at: "2026-11-20T00:02:00Z", "actor.id": "h2", "actor.name": "alice", "account.key": "acct-h", "session.kind": "login", "session.prism": false, "session.ai": false },
    { name: "world.disconnect", "actor.id": "h1", duration_ms: 60000 },
    { name: "world.disconnect", "actor.id": "a1", duration_ms: 120000 },
    { name: "world.quest", "actor.id": "h1", "quest.id": "q1", "quest.name": "The First Step", "quest.action": "accept" },
    { name: "world.quest", "actor.id": "h1", "quest.id": "q1", "quest.name": "The First Step", "quest.action": "complete" },
    { name: "world.quest", "actor.id": "a1", "quest.id": "q1", "quest.name": "The First Step", "quest.action": "accept" },
    { name: "world.transition", "actor.id": "h1", "room.to": 2, "action.kind": "move" },
    { name: "world.transition", "actor.id": "a1", "room.to": 2, "action.kind": "move" },
    { name: "world.transition", "actor.id": "h1", "room.to": 3, "action.kind": "move" },
    { name: "world.combat", "actor.id": "h1", "target.id": "npc", outcome: "killed", damage: 3 },
    { name: "world.combat", "actor.id": "h1", "target.id": "a1", outcome: "killed", damage: 2 },
    { name: "world.combat", "actor.id": "a1", "target.id": "h1", outcome: "miss", damage: 0 },
    { name: "world.snapshot", at: "2026-11-20T00:03:00Z", "world.actors": JSON.stringify([{ level: 3, guild: "mages" }, { level: 8, guild: null }]) },
    { name: "world.snapshot", at: "2026-11-20T00:04:00Z", "world.actors": "[]" },
    { name: "world.input", "actor.id": "h1", text: "look" },
    { name: "world.input", "actor.id": "a1", text: "north" },
    { name: "world.input", "actor.id": "h2", text: "slow", refused: "too-fast" },
  ];
  const stats = summarizePlayers(spans);
  check(stats.sessions.total === 3 && stats.sessions.logins === 2 && stats.sessions.registrations === 1, "the session counts are wrong");
  check(stats.sessions.prism === 1 && stats.sessions.legacy === 2 && stats.sessions.human === 2 && stats.sessions.ai === 1, "the session mix is wrong");
  check(stats.sessions.unique_accounts === 2 && stats.sessions.unique_characters === 2 && stats.sessions.returning_accounts === 1, "the unique-player counts are wrong");
  check(stats.playtime.connections === 3 && stats.playtime.completed === 2 && stats.playtime.open === 1, "the connection counts are wrong");
  check(stats.playtime.total_ms === 180000 && stats.playtime.average_ms === 90000 && stats.playtime.median_ms === 60000, "the playtime aggregates are wrong");
  check(stats.quests.accepted === 2 && stats.quests.completed === 1 && stats.quests.completion_rate === 0.5, "the quest counts are wrong");
  check(stats.quests.by_quest[0]?.actors === 2 && stats.quests.by_quest[0]?.completers === 1 && stats.quests.by_quest[0]?.completion_rate === 0.5, "the per-quest completion is wrong");
  check(stats.combat.rounds === 3 && stats.combat.kills === 2 && stats.combat.npc_kills === 1 && stats.combat.pvp_kills === 1 && stats.combat.player_deaths === 1, "the combat counts are wrong");
  check(stats.combat.hit_rate === 2 / 3 && stats.combat.average_damage === 2.5 && stats.combat.pvp_rounds === 2 && stats.combat.npc_rounds === 1, "the combat rates are wrong");
  check(stats.rooms.visits === 3 && stats.rooms.unique === 2 && stats.rooms.average_per_account === 1.5, "the room counts are wrong");
  check(stats.commands.accepted === 2 && stats.commands.refused === 1 && stats.commands.average_per_connection === 1, "the command counts are wrong");
  check(stats.levels.actors === 2 && stats.levels.average === 5.5 && stats.levels.max === 8 && stats.levels.distribution["1-4"] === 1 && stats.levels.distribution["8-10"] === 1 && stats.levels.guilded === 1, "the level distribution is wrong");
  const serialized = JSON.stringify(stats);
  check(!serialized.includes("acct-h") && !serialized.includes("acct-ai") && !serialized.includes("alice") && !serialized.includes("ember-fox-42"), "the player statistics leaked an account key or character name");
  check(playerLines(stats).some((line) => line.includes("sessions 3")) && playerLines(stats).some((line) => line.includes("quests accepted 2")), "the player summary lines are wrong");
  if (playerStats.why.length) { playerStats.ok = false; failures.push(`player statistics are broken: ${playerStats.why[0]}`); }
}

// Combat balance bands, including PvP and unseeded high-level play.
let balanceBands = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { balanceBands.ok = false; balanceBands.why.push(why); } };
  const run = spawnSync(process.execPath, ["tools/balance.mjs", "--json", "--seeds=120"], { cwd: root, encoding: "utf8" });
  check(run.status === 0, `balance sampler failed: ${(run.stderr || "").trim().split("\n")[0]}`);
  let rows = [];
  try { rows = JSON.parse(run.stdout).rows ?? []; } catch { check(false, "balance sampler did not return JSON"); }
  const band = (name) => rows.filter((row) => row.band === name);
  check(band("early").length === 2 && band("mid").length === 2 && band("high").length === 3 && band("capstone").length === 3, "a PvE balance band is missing");
  check(band("unseeded").length === 2 && band("pvp").length === 3, "the unseeded or PvP balance band is missing");
  const pvp = band("pvp");
  check(pvp.every((row) => row.win >= 0.25 && row.win <= 0.75), `a PvP matchup is outside 25-75%: ${pvp.map((row) => `${row.name} ${Math.round(row.win * 100)}%`).join(", ")}`);
  const unseeded = band("unseeded");
  const regent = unseeded.find((row) => row.name.includes("regent"));
  const star = unseeded.find((row) => row.name.includes("star hound"));
  check(regent && regent.win < 0.5 && star && star.win > 0.2, "an unseeded high-level band is outside its expected difficulty");
  if (balanceBands.why.length) { balanceBands.ok = false; failures.push(`the combat balance bands are broken: ${balanceBands.why[0]}`); }
}

// Weapon techniques are properties of the weapon, not a class.
let techniques = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { techniques.ok = false; techniques.why.push(why); } };
  for (const id of ["sword", "greatsword", "club", "forge-hammer", "ember-brand", "fen-staff", "dawn-blade", "ember-forge-blade"]) {
    check(Boolean(techniqueForWeapon(world.objects.find((object) => object.id === id))), `weapon ${id} has no technique`);
  }
  check(world.objects.find((object) => object.id === "ember-brand")?.damage === 8 && world.objects.find((object) => object.id === "red-helm")?.armor === 3, "the v0.91.36 PvP balance values are wrong");
  check(TECHNIQUES["power-strike"]?.bonus === 4 && TECHNIQUES.bash?.rounds === 12 && TECHNIQUES.guard?.armor === 3, "the technique definitions are wrong");
  run([{ kind: "join", actorId: "t", name: "tech" }]);
  run([{ kind: "login", actorId: "t", key: "tech", token: null, authenticated: true }]);
  let actor = state.actors.find((entry) => entry.id === "t");
  actor.room = 22;
  const sword = state.objects.find((object) => object.id === "sword");
  sword.holder = "t"; sword.room = null; sword.worn = false;
  actor.wielding = "sword";
  state.npcs.push({ id: "dummy", name: "a training dummy", room: 22, home: 22, hp: 100, maxHp: 100, damage: 0, armor: 0, aggression: 0, xp: 0, dead: false });
  run([{ kind: "attack", actorId: "t", targetId: "dummy" }]);
  run([{ kind: "technique", actorId: "t", techniqueId: "power-strike", targetId: "dummy" }]);
  check(state.actors.find((entry) => entry.id === "t").nextAttackBonus === 4, "power strike did not set the next-attack bonus");
  check(techniqueReady(state.actors.find((entry) => entry.id === "t"), "power-strike", 0) === false, "power strike was ready before its cooldown");
  const club = state.objects.find((object) => object.id === "club");
  club.holder = "t"; club.room = null;
  state.actors.find((entry) => entry.id === "t").wielding = "club";
  run([{ kind: "technique", actorId: "t", techniqueId: "bash", targetId: "dummy" }]);
  check(state.npcs.find((npc) => npc.id === "dummy").stunnedUntil > state.tick, "bash did not stun the target");
  const shield = state.objects.find((object) => object.id === "shield");
  shield.holder = "t"; shield.room = null; shield.worn = true;
  run([{ kind: "technique", actorId: "t", techniqueId: "guard", targetId: "dummy" }]);
  actor = state.actors.find((entry) => entry.id === "t");
  check(actor.guardArmor === 3 && actor.guardUntil > state.tick, "guard did not raise the shield bonus");
  check(/named === "technique"/.test(serverSource) && /world.technique/.test(serverSource), "the technique command or span is missing");
  if (techniques.why.length) { techniques.ok = false; failures.push(`techniques are broken: ${techniques.why[0]}`); }
}

// The world event rotates every reset; the Ring ladder is persistent.
let worldEvent = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { worldEvent.ok = false; worldEvent.why.push(why); } };
  check(currentEvent(0).id === "ember" && currentEvent(1).id === "fen" && currentEvent(4).id === "ember", "the event rotation is wrong");
  check(eventPrice({ forSale: true, price: 80, faction: "ember" }, 0) === 64, "the event discount is wrong");
  check(eventPrice({ forSale: true, price: 80, faction: "fen" }, 0) === 80, "the event discounted the wrong faction");
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  state.identities.alice = { name: "alice", kind: "character", owner: "alice", level: 5, quests: { active: [], completed: [] } };
  state.identities.bob = { name: "bob", kind: "character", owner: "bob", level: 5, quests: { active: [], completed: [] } };
  state.actors.push({ id: "a", key: "alice", account: "alice", name: "alice", room: 33, visited: [33], level: 5, xp: 1500, maxHp: 40, hp: 40, maxMana: 17, mana: 17, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, ignored: [], memory: { facts: {} } });
  state.actors.push({ id: "b", key: "bob", account: "bob", name: "bob", room: 33, visited: [33], level: 5, xp: 1500, maxHp: 40, hp: 1, maxMana: 17, mana: 17, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, ignored: [], memory: { facts: {} } });
  run([{ kind: "duelChallenge", actorId: "a", targetId: "b" }]);
  run([{ kind: "duelAccept", actorId: "b" }]);
  run([{ kind: "attack", actorId: "a", targetId: "b" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  const alice = state.identities.alice;
  const bob = state.identities.bob;
  check(alice.duelWins === 1 && alice.duelRating === 1016, "the duel winner was not recorded");
  check(bob.duelLosses === 1 && bob.duelRating === 984, "the duel loser was not recorded");
  check(duelLadderRows(state.identities).length === 2 && duelLadderText(state.identities).includes("alice"), "the duel ladder is wrong");
  const status = worldStatus(state, world.rooms);
  check(status.event?.id === "ember" && worldStatusText(status).includes("Event: The Ember Tide"), "the world status lost the event");
  if (worldEvent.why.length) { worldEvent.ok = false; failures.push(`the world event or ladder is broken: ${worldEvent.why[0]}`); }
}

// Forge: upgrades consume components and coins, salvage returns components,
// and three/four matching pieces give set bonuses.
let forge = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { forge.ok = false; forge.why.push(why); } };
  check(componentForItem(world.objects.find((object) => object.id === "ember-cloak")) === "ember-ore" && componentForItem(world.objects.find((object) => object.id === "fen-mantle")) === "wisp-glass", "the salvage component mapping is wrong");
  check(upgradeCost({ plus: 0, set: "ember" }).count === 2 && upgradeCost({ plus: 0, set: "ember" }).coins === 20, "the first upgrade cost is wrong");
  check(salvageYield({ value: 60, plus: 1 }) === 4, "the salvage yield is wrong");
  check(componentsText({ "ember-ore": 3, "wisp-glass": 1 }).includes("Ember ore ×3"), "the components text is wrong");
  run([{ kind: "join", actorId: "f", name: "forge" }]);
  run([{ kind: "login", actorId: "f", key: "forge", token: null, authenticated: true }]);
  state.actors.find((entry) => entry.id === "f").components = { "ember-ore": 10 };
  const sword = state.objects.find((object) => object.id === "sword");
  sword.holder = "f"; sword.room = null; sword.forSale = false; sword.plus = 0;
  for (const id of ["gold", "coin"]) {
    const coin = state.objects.find((object) => object.id === id);
    coin.holder = "f"; coin.room = null;
  }
  run([{ kind: "upgrade", actorId: "f", objectId: "sword", component: "ember-ore", count: 2, coins: 20, coinIds: ["gold", "coin"] }]);
  let actor = state.actors.find((entry) => entry.id === "f");
  check(state.objects.find((object) => object.id === "sword").plus === 1, "the upgrade did not raise the plus");
  check(actor.components["ember-ore"] === 8, "the upgrade did not consume components");
  check(state.objects.find((object) => object.id === "gold")?.eaten === true && state.objects.find((object) => object.id === "gold")?.room === null, "the upgrade did not consume coins");
  const jerkin = state.objects.find((object) => object.id === "jerkin");
  jerkin.holder = "f"; jerkin.room = null; jerkin.forSale = false; jerkin.worn = false;
  run([{ kind: "salvage", actorId: "f", objectId: "jerkin", component: "ember-ore", amount: 1 }]);
  actor = state.actors.find((entry) => entry.id === "f");
  check(actor.components["ember-ore"] === 9 && state.objects.find((object) => object.id === "jerkin").eaten === true, "salvage did not return a component");
  for (const id of ["ember-cloak", "ember-gauntlets", "ember-boots"]) {
    const object = state.objects.find((entry) => entry.id === id);
    object.holder = "f"; object.room = null; object.worn = true;
  }
  actor = state.actors.find((entry) => entry.id === "f");
  check(setBonus(actor, state.objects).armor === 1 && setBonus(actor, state.objects).damage === 0, "the three-piece set bonus is wrong");
  const brand = state.objects.find((object) => object.id === "ember-brand");
  brand.holder = "f"; brand.room = null; actor.wielding = "ember-brand";
  check(setBonus(actor, state.objects).damage === 1, "the four-piece set damage bonus is wrong");
  if (forge.why.length) { forge.ok = false; failures.push(`the forge is broken: ${forge.why[0]}`); }
}

// Controls: short take/kill/score, take-all, drink and grouped inventory.
let controls = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { controls.ok = false; controls.why.push(why); } };
  check(verbTable.byAlias.get("t") === "take", "t is not take");
  check(verbTable.byAlias.get("k") === "attack", "k is not attack");
  check(verbTable.byAlias.get("sc") === "score", "sc is not score");
  check(verbTable.byAlias.get("coins") === "coins" && verbTable.byAlias.get("money") === "coins", "coins/money are not registered");
  check(verbTable.byAlias.get("consider") === "consider" && verbTable.byAlias.get("con") === "consider", "consider/con are not registered");
  check(verbTable.byAlias.get("track") === "track" && verbTable.byAlias.get("seek") === "track", "track/seek are not registered");
  check(verbTable.byAlias.get("flee") === "flee" && verbTable.byAlias.get("retreat") === "flee", "flee/retreat are not registered");
  check(verbTable.byAlias.get("use") === "use" && verbTable.byAlias.get("activate") === "use", "use/activate are not registered");
  check(verbTable.byAlias.get("standing") === "standing" && verbTable.byAlias.get("reputation") === "standing" && verbTable.byAlias.get("factions") === "standing", "standing/reputation are not registered");
  check(factionRank("ember", 0).name === "outsider" && factionRank("ember", 3).name === "spark" && factionRank("ember", 6).name === "forgefriend" && factionRank("ember", 10).name === "ember-sworn", "the faction ranks are wrong");
  check(factionAllows({ ember: 5 }, "ember", 3) && !factionAllows({ ember: 2 }, "ember", 3), "the faction standing gate is wrong");
  check(standingsText({ ember: 4 }).includes("The Ember Forge: 4") && standingsText({}).includes("The Moon Wardens: 0"), "the standing text is wrong");
  check(verbTable.byAlias.get("drink") === "drink" && verbTable.byAlias.get("quaff") === "drink", "drink/quaff are not registered");
  check(verbTable.byAlias.get("takefrom") === "takeFrom", "takeFrom is not reachable after command lowercasing");
  check(FEDERATION_PROTOCOL === "mudbenchmark/region-transfer/2" && TRAVEL_ACTION === "mudbenchmark/region-travel/1", "the federation protocol names are wrong");
  for (const room of [1, 126, 127, 128, 162, 252, 253, 254]) {
    const move = admissionWire({ kind: 1, room, origin: room });
    check(Buffer.byteLength(move, "utf8") === 7 && move.charCodeAt(1) === move.charCodeAt(2), `the move wire record for room ${room} is not seven safe bytes`);
    const transfer = admissionWire({ kind: 2, room, origin: room, destination: room, held: 1, amount: 1, free: 1 });
    check(Buffer.byteLength(transfer, "utf8") === 7, `the transfer wire record for room ${room} is not seven safe bytes`);
  }
  const wayfarerWorld = loadWorld({ mode: "single" });
  const wayfarerZones = new Set(wayfarerWorld.zones.map((zone) => zone.id));
  check(WAYFARER.every((entry) => wayfarerWorld.rooms[entry.room] && wayfarerZones.has(entry.zone)), "a wayfarer landmark names a missing room or zone");
  const walker = { found: [] };
  const firstMark = markWayfarer(walker, 30);
  check(firstMark?.zone === "town" && !markWayfarer(walker, 30), "the wayfarer mark did not record once");
  const walkerState = wayfarerState(walker);
  check(walkerState.seen === 1 && walkerState.total === WAYFARER.length && walkerState.next, "the wayfarer tally is wrong");
  check(wayfarerLine(walker).includes("1/" + WAYFARER.length), "the wayfarer line is wrong");
  check(/verb === "study" \|\| verb === "recite"[\s\S]{0,900}skillAllowed\(FEDERATION, spell\.id\)/.test(serverSource), "recite bypasses the region skill policy");
  check(/const targetName = scrollTargetName\(restRaw, onIndex\)/.test(serverSource), "scroll targets are not parsed after on");
  const swordLabel = inventoryLabel({ name: "a short sword", value: 20, flags: ["weapon"] }, []);
  check(swordLabel.includes("worth 20c") && swordLabel.includes("sells 10c"), "inventory does not show what an item is worth");
  check(!inventoryLabel({ name: "a silver coin", value: 1, flags: ["coin"] }, []).includes("worth"), "coin value is duplicated in inventory");
  const hudBase = { hp: 20, max_hp: 20, enemies: [{ name: "a ghoul", hp: 10, maxHp: 10 }], effects: [] };
  check(hudChanged(hudSnapshot(hudBase), hudSnapshot({ ...hudBase, hp: 12 })), "the HUD did not notice combat damage");
  check(hudChanged(hudSnapshot(hudBase), hudSnapshot({ ...hudBase, enemies: [{ name: "a ghoul", hp: 4, maxHp: 10 }] })), "the HUD did not notice enemy damage");
  check(!hudChanged(hudSnapshot(hudBase), hudSnapshot({ ...hudBase })), "the HUD changed without a visible change");
  check(BASE_HP === 20 && HP_PER_LEVEL === 5 && maxHpForLevel(1) === 20 && maxHpForLevel(10) === 65, "the health curve is wrong");
  check(wardenBonus({ guild: "wardens", guildRank: "scout" }).armor === 1 && wardenBonus({ guild: "wardens", guildRank: "ranger" }).damage === 1 && wardenBonus({ guild: "wardens", guildRank: "warden" }).armor === 1 && wardenBonus({ guild: "wardens", guildRank: "warden" }).damage === 1, "the Wardens rank perks are wrong");
  check(wardenBonus({ guild: "mages", guildRank: "archmage" }).armor === 0 && wardenBonus({ guild: "wardens", guildRank: "member" }).damage === 0, "a non-Wardens actor received a Wardens perk");
  check(nightBonus({ guild: "night-market", guildRank: "cutpurse" }).armor === 1 && nightBonus({ guild: "night-market", guildRank: "shadow" }).damage === 1 && nightBonus({ guild: "night-market", guildRank: "master" }).armor === 1 && nightBonus({ guild: "night-market", guildRank: "master" }).damage === 1, "the Night Market rank perks are wrong");
  check(!progressionAtLeast("runner", "cutpurse", ["runner", "cutpurse", "shadow", "master"]) && progressionAtLeast("shadow", "cutpurse", ["runner", "cutpurse", "shadow", "master"]), "the ascending guild rank gate is wrong");
  check(guildBonus({ guild: "night-market", guildRank: "shadow" }).damage === 1 && guildBonus({ guild: "wardens", guildRank: "ranger" }).damage === 1 && guildBonus({ guild: "mages", guildRank: "archmage" }).damage === 0, "the guild bonus selector is wrong");
  check(TECHNIQUES.backstab?.bonus === 6 && TECHNIQUES.rage?.bonus === 5 && TECHNIQUES.drain?.effect === "drain", "the outlaw techniques are missing");
  check(/object.guild && object.minRank/.test(serverSource) && /The Night Market meets/.test(serverSource), "the Night Market join or shop lock is missing");
  const agentSource = readFileSync(join(root, "runtime/agent.mjs"), "utf8");
  const tuningSource = readFileSync(join(root, "tools/tuning-session.mjs"), "utf8");
  check(!/flee/.test(agentSource) && /take all/.test(agentSource) && /drink/.test(agentSource), "the CLI agent still exposes flee or lacks the new commands");
  check(/summarizePlayers/.test(tuningSource) && /mirror-wraith/.test(tuningSource) && /taskOk/.test(tuningSource), "the remote tuning harness is missing");
  const aiSource = readFileSync(join(root, "runtime/web/ai.mjs"), "utf8");
  const pvpAgentsSource = readFileSync(join(root, "tools/pvp-agents.mjs"), "utf8");
  const pvpSessionSource = readFileSync(join(root, "tools/pvp-session.mjs"), "utf8");
  check(/duel <name>, duel accept/.test(agentSource) && /"duel"/.test(agentSource) && /AGENT_SCENARIO/.test(agentSource), "the CLI agent is missing the PvP contract");
  check(/from "\.\/web\/agent-core.mjs"/.test(agentSource) && /beginTurn\(core/.test(agentSource) && /decideTurn\(core/.test(agentSource), "the CLI agent is not rebased on the shared core");
  check(/duel <name>/.test(aiSource) && /room\.actors/.test(aiSource) && /duel \$\{actor\}/.test(aiSource), "the browser AI is missing PvP actions");
  check(/actors: actor\?\.key \? state\.actors\.filter/.test(serverSource), "the room state does not expose other actors");
  check(/AGENT_SCENARIO: "pvp"/.test(pvpAgentsSource) && /duel/.test(pvpAgentsSource), "the two-agent PvP runner is missing");
  check(/dawn-ember/.test(pvpSessionSource) && /kitFor/.test(pvpSessionSource), "the asymmetric PvP matchup is missing");
  check(armorOf({ id: "w", guild: "wardens", guildRank: "scout" }, []) === 1, "the Wardens scout armour perk is not in armorOf");
  check(equipmentText({ id: "w", guild: "wardens", guildRank: "ranger" }, []).includes("+1 rank"), "the Wardens ranger damage perk is not in equipment");
  const groups = inventoryGroups([
    { flags: ["weapon"] }, { flags: ["armor", "wearable"] }, { flags: ["container"] },
    { flags: ["light"] }, { flags: ["food"] }, { flags: ["drink"] }, { flags: ["readable"] },
    { flags: ["coin"] }, { flags: [] },
  ]);
  check(groups.map((group) => group.id).join(",") === "weapons,armour,containers,light,food,scrolls,coins,other", "inventory grouping is wrong");

  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  run([{ kind: "join", actorId: "co", name: "cora" }]);
  run([{ kind: "login", actorId: "co", key: "cora", token: null, authenticated: true }]);
  state.actors.find((entry) => entry.id === "co").room = 5;
  const roomItemIds = state.objects.filter((object) => object.room === 5 && !object.inside && !object.forSale && !(object.flags ?? []).includes("fixed")).map((object) => object.id);
  check(roomItemIds.length >= 2, "the take-all room does not have two takeable objects");
  run([{ kind: "takeAll", actorId: "co", objectIds: roomItemIds, messages: { actor: "TA", others: "TO" } }]);
  check(roomItemIds.every((id) => {
    const object = state.objects.find((entry) => entry.id === id);
    return object?.holder === "co" && object?.room === null;
  }), "take all did not take every object");
  state.objects.push({ id: "test-ale", name: "test ale", flags: ["drink"], heal: 5, bites: 2, holder: "co", room: null, eaten: false });
  state.actors.find((entry) => entry.id === "co").hp = 5;
  run([{ kind: "drink", actorId: "co", objectId: "test-ale", messages: { actor: "D1", others: "D2" } }]);
  check(state.actors.find((entry) => entry.id === "co").hp === 10 && state.objects.find((object) => object.id === "test-ale").bites === 1, "drink did not heal or consume a sip");
  run([{ kind: "drink", actorId: "co", objectId: "test-ale", messages: { actor: "D3", others: "D4" } }]);
  check(state.actors.find((entry) => entry.id === "co").hp === 15 && state.objects.find((object) => object.id === "test-ale").eaten && state.objects.find((object) => object.id === "test-ale").holder === null, "the last drink did not heal and empty the vessel");
  if (controls.why.length) { controls.ok = false; failures.push(`controls are broken: ${controls.why[0]}`); }
}

// The short forms players type, and the equipment view they expose.
let aliases = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { aliases.ok = false; aliases.why.push(why); } };
  const serverText = readFileSync(join(root, "runtime/server.mjs"), "utf8");
  check(/l: "look"/.test(serverText) && /x: "examine"/.test(serverText), "look/examine aliases are missing");
  check(/g: "take"/.test(serverText) && /dr: "drop"/.test(serverText), "get/drop aliases are missing");
  check(/eq: "equipment"/.test(serverText) && /verb === "equipment"/.test(serverText), "the equipment alias or view is missing");
  check(/status: "world"/.test(serverText) && /time: "world"/.test(serverText), "the world status aliases are missing");
  check(/verb === "go" && restRaw.length/.test(serverText), "the go <direction> alias is missing");
  check(/armorOf\(actor, state\.objects\)/.test(serverText), "equipment does not pass the world objects to armorOf");
  if (aliases.why.length) { aliases.ok = false; failures.push(`the command aliases are broken: ${aliases.why[0]}`); }
}

// Equipment slots are a view of worn objects; a two-handed weapon clears the
// offhand, a second item in a slot replaces the first, and armour is the sum.
let equipment = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { equipment.ok = false; equipment.why.push(why); } };
  state.actors.push({ id: "a", key: "alice", account: "alice", name: "alice", room: 1, visited: [1], level: 1, xp: 0, maxHp: 10, hp: 10, wielding: null, guild: null, guildRank: null, quests: { active: [], completed: [] } });
  const gear = (id, name, slot, extra = {}) => ({ id, name, holder: "a", room: null, worn: false, eaten: false, flags: ["takeable", "wearable"], slot, ...extra });
  state.objects.push(gear("helmet-test", "an iron helmet", "head", { armor: 2 }));
  state.objects.push(gear("cap-test", "a cloth cap", "head", { armor: 1 }));
  state.objects.push(gear("shield-test", "a round shield", "offhand", { armor: 2, worn: true }));
  state.objects.push(gear("greatsword-test", "a greatsword", "mainhand", { damage: 5, twoHanded: true, flags: ["takeable", "weapon"] }));
  const messages = { actor: "equipped", others: "equipped" };
  run([{ kind: "wear", actorId: "a", objectId: "helmet-test", messages }]);
  let actor = state.actors.find((entry) => entry.id === "a");
  check(state.objects.find((o) => o.id === "helmet-test")?.worn === true, "wear did not set the head slot");
  check(armorOf(actor, state.objects) === 4, "armour did not include head and offhand");
  run([{ kind: "wear", actorId: "a", objectId: "cap-test", messages }]);
  check(state.objects.find((o) => o.id === "cap-test")?.worn === true && state.objects.find((o) => o.id === "helmet-test")?.worn === false, "a second head item did not replace the first");
  run([{ kind: "wield", actorId: "a", objectId: "greatsword-test", messages }]);
  actor = state.actors.find((entry) => entry.id === "a");
  check(actor?.wielding === "greatsword-test", "the two-handed weapon was not wielded");
  check(state.objects.find((o) => o.id === "shield-test")?.worn === false, "the two-handed weapon did not clear the offhand");
  const slots = equipmentOf(actor, state.objects);
  check(slots.mainhand?.id === "greatsword-test" && slots.head?.id === "cap-test" && slots.offhand === null, "the equipment map is wrong");
  check(equipmentText(actor, state.objects).includes("mainhand") && equipmentText(actor, state.objects).includes("a greatsword"), "the equipment text is wrong");
  run([{ kind: "remove", actorId: "a", objectId: "cap-test", messages }]);
  check(state.objects.find((o) => o.id === "cap-test")?.worn === false, "remove did not clear the slot");
  if (equipment.why.length) { equipment.ok = false; failures.push(`the equipment slots are broken: ${equipment.why[0]}`); }
}

// Magic: a known spell spends mana and applies its effect, a trainer adds a
// spellbook entry, and the shield is an armour bonus that expires.
let magic = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { magic.ok = false; magic.why.push(why); } };
  state.actors.push({ id: "m", key: "mira", account: "mira", name: "mira", room: 1, visited: [1], level: 5, xp: 400, maxHp: 18, hp: 18, maxMana: 20, mana: 20, spellbook: ["spark", "mend", "shield", "recall"], guild: "mages", guildRank: "apprentice", wielding: null, quests: { active: [], completed: [] } });
  state.npcs.push({ id: "rat-magic", name: "a test rat", room: 1, home: 1, hp: 10, maxHp: 10, damage: 0, armor: 0, aggression: 0, xp: 0, dead: false });
  run([{ kind: "cast", actorId: "m", spellId: "spark", targetId: "rat-magic" }]);
  let actor = state.actors.find((entry) => entry.id === "m");
  let rat = state.npcs.find((npc) => npc.id === "rat-magic");
  check(rat && rat.hp < 10, "spark did not damage the target");
  check(rat?.effects?.some((effect) => effect.id === "burn"), "spark did not apply a burn");
  check(actor?.mana === 17, "spark did not spend three mana");
  actor.hp = 5;
  run([{ kind: "cast", actorId: "m", spellId: "mend" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check(actor.hp > 5, "mend did not heal");
  actor.effects = [{ id: "burn", name: "burning", damage: 1, rounds: 2 }];
  run([{ kind: "cast", actorId: "m", spellId: "mend" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check(!(actor.effects ?? []).some((effect) => effect.id === "burn"), "mend did not cleanse the burn");
  run([{ kind: "cast", actorId: "m", spellId: "shield" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check((actor.armorBonus ?? 0) >= 3 && actor.buffUntil > state.tick, "shield did not add a level-scaled timed armour bonus");
  check(armorOf(actor, state.objects) >= 3, "the shield bonus is not in armourOf");
  check(spellPower({ level: 1 }, 0) === 0 && spellPower({ level: 6 }, 0) === 2 && spellPower({ level: 6 }, 4) === 4, "spell power does not scale with level/focus");
  actor.room = 9;
  actor.mana = 20;
  run([{ kind: "cast", actorId: "m", spellId: "recall" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check(actor.room === 1, "recall did not return to the start");
  const before = actor.spellbook.length;
  run([{ kind: "train", actorId: "m", spellId: "detect" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check(actor.spellbook.length === before + 1 && actor.spellbook.includes("detect"), "training did not add the spell");
  checkpointIdentities(state);
  check(state.identities.mira?.spellbook?.includes("detect"), "training did not survive a checkpoint");
  check(maxManaFor(actor) === 3 + 5 * 2 + 4, "the mages mana bonus is wrong");
  check(trainingCost({ cost: 30 }, null) === 30 && trainingCost({ cost: 30 }, { perks: ["trainer-discount"] }) === 27, "the trainer discount is wrong");
  state.objects.push({ id: "scroll-light-test", name: "a scroll of light", holder: "m", room: null, eaten: false, flags: ["takeable", "readable"], spell: "light" });
  run([{ kind: "study", actorId: "m", objectId: "scroll-light-test" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check(actor.spellbook.includes("light") && state.objects.find((o) => o.id === "scroll-light-test")?.eaten === true, "study did not learn and consume the scroll");
  state.objects.push({ id: "scroll-mend-test", name: "a scroll of mending", holder: "m", room: null, eaten: false, flags: ["takeable", "readable"], spell: "mend" });
  actor.hp = 5;
  run([{ kind: "recite", actorId: "m", objectId: "scroll-mend-test" }]);
  actor = state.actors.find((entry) => entry.id === "m");
  check(actor.hp > 5 && state.objects.find((o) => o.id === "scroll-mend-test")?.eaten === true, "recite did not cast and consume the scroll");
  state.actors.push({ id: "m2", key: "mora", account: "mora", name: "mora", room: 34, visited: [34], level: 5, xp: 400, maxHp: 18, hp: 18, maxMana: 17, mana: 17, spellbook: [], guild: "mages", guildRank: "apprentice", wielding: null, quests: { active: [], completed: [] } });
  state.objects.push({ id: "coin-train", name: "a gold coin", holder: "m2", room: null, eaten: false, flags: ["takeable", "coin"], value: 27 });
  run([{ kind: "train", actorId: "m2", spellId: "detect", cost: 27, coinIds: ["coin-train"] }]);
  const trainee = state.actors.find((entry) => entry.id === "m2");
  check(trainee?.spellbook?.includes("detect"), "paid training did not add the spell");
  check(state.objects.find((o) => o.id === "coin-train")?.eaten === true && state.objects.find((o) => o.id === "coin-train")?.room === null, "paid training did not consume the coins");
  if (magic.why.length) { magic.ok = false; failures.push(`magic is broken: ${magic.why[0]}`); }
}

// The first Lantern Quarter slice: rooms are connected, the note/errand and
// familiar charm use only the existing quest facts, and the new gear/spells
// have a place to live.
let lantern = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { lantern.ok = false; lantern.why.push(why); } };
  check(world.rooms[35]?.exits?.down === 8 && world.rooms[8]?.exits?.up === 35, "the Lantern Stair is not connected to Market Square");
  check(world.rooms[115]?.exits?.down === 24 && world.rooms[24]?.exits?.up === 115, "the Wardens' Lodge is not connected to the Guild Hall");
  check(world.rooms[116]?.exits?.west === 24 && world.rooms[24]?.exits?.east === 116, "the Training Yard is not connected to the Guild Hall");
  check(world.npcs.some((npc) => npc.id === "training-master" && npc.room === 116) && world.npcs.some((npc) => npc.id === "training-dummy" && npc.room === 116), "the Training Yard trainer or dummy is missing");
  check(["practice-sword", "practice-shield", "training-board"].every((id) => world.objects.some((object) => object.id === id && object.room === 116)), "the Training Yard practice gear is missing");
  check(world.npcs.some((npc) => npc.id === "warden-captain" && npc.room === 115), "the warden-captain is missing from the lodge");
  for (const faction of ["fen", "salt", "moon"]) {
    check((world.shops ?? []).some((shop) => shop.id === `${faction}-quartermaster`), `the ${faction} quartermaster shop is missing`);
  }
  for (const [id, faction] of [["ember-forge-blade", "ember"], ["fen-warden-cloak", "fen"], ["salt-warden-shield", "salt"], ["moon-blessed-circlet", "moon"]]) {
    const object = world.objects.find((entry) => entry.id === id);
    check(object?.faction === faction && object?.minStanding === 6 && object?.forSale === true, `the ${faction} quartermaster item is missing`);
  }
  for (const [id, faction] of [["ashen-robe", "ashen"], ["unholy-mace", "ashen"], ["red-axe", "red"], ["red-boots", "red"]]) {
    const object = world.objects.find((entry) => entry.id === id);
    check(object?.faction === faction && object?.forSale === true, `the ${faction} outlaw item is missing`);
  }
  for (const [id, rank] of [["night-cloak", "cutpurse"], ["thief-dagger", "runner"], ["assassin-blade", "shadow"]]) {
    const object = world.objects.find((entry) => entry.id === id);
    check(object?.guild === "night-market" && object?.minRank === rank && object?.forSale === true, `the Night Market item ${id} is missing`);
  }
  check(world.npcs.some((npc) => npc.id === "night-broker" && npc.room === 29) && world.npcs.some((npc) => npc.id === "ashen-priest" && npc.room === 58) && world.npcs.some((npc) => npc.id === "red-captain" && npc.room === 71), "an outlaw contact is missing");
  for (const [setId, minimum] of [["ashen", 4], ["red", 4], ["night", 5]]) {
    check(world.objects.filter((object) => object.set === setId).length >= minimum, `the ${setId} set is incomplete`);
  }
  for (const id of ["ember-ledger", "fen-map", "salt-tablet", "moon-calendar", "garden-journal"]) {
    const object = world.objects.find((entry) => entry.id === id);
    check(object?.flags?.includes("readable") && typeof object?.examine === "string" && object.examine.length > 80, `the ${id} lore readable is missing`);
  }
  for (const id of ["night-market", "ashen-quartermaster", "red-quartermaster"]) {
    check((world.shops ?? []).some((shop) => shop.id === id), `the ${id} shop is missing`);
  }
  for (const [npcId, objectId, slot] of [["ember-warden", "ember-gauntlets", "hands"], ["bog-hound", "fen-mantle", "cloak"], ["salt-wraith", "salt-bracers", "hands"], ["moon-stag", "moon-greaves", "feet"]]) {
    const loot = world.npcs.find((npc) => npc.id === npcId)?.loot ?? [];
    const object = world.objects.find((entry) => entry.id === objectId);
    check(loot.includes(objectId) && object?.slot === slot && object?.armor === 2, `the ${npcId} gear drop is missing`);
  }
  check(/The Wardens meet in the lodge/.test(serverSource) && /next === "archmage"/.test(serverSource), "the guild join or archmage path is missing");
  check(world.rooms[37]?.exits?.west === 36 && world.rooms[36]?.exits?.east === 37, "the Spellwright's Shop is not connected");
  check(world.rooms[40]?.exits?.west === 39 && world.rooms[39]?.exits?.east === 40, "the High Walk is not connected");
  state.actors.push({ id: "l", key: "lina", account: "lina", name: "lina", room: 37, visited: [1, 35, 36, 37], level: 5, xp: 400, maxHp: 18, hp: 18, maxMana: 17, mana: 17, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] } });
  let actor = state.actors.find((entry) => entry.id === "l");
  actor.room = 38;
  state.objects.find((o) => o.id === "charm").holder = "l";
  run([{ kind: "questAccept", actorId: "l", questId: "familiar" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.quests?.completed?.includes("familiar"), "the familiar charm did not complete");
  check(state.objects.find((o) => o.id === "candle")?.holder === "l", "the familiar reward did not reach the actor");
  state.guilds.mages = { id: "mages", name: "The Mages' Guild", founder: "archmage", created: 0, members: { lina: "apprentice" }, invites: [], ranks: ["apprentice", "adept", "magician", "archmage"], xp: 0, level: 1 };
  actor.guild = "mages";
  actor.guildRank = "apprentice";
  state.objects.find((o) => o.id === "spell-scroll").holder = "l";
  run([{ kind: "questAccept", actorId: "l", questId: "guild-ledger" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.quests?.completed?.includes("guild-ledger"), "the guild ledger quest did not complete");
  check((state.guilds.mages.xp ?? 0) === 40, "the guild quest did not add guild XP");
  run([{ kind: "guildAdvance", actorId: "l", guildId: "mages", rank: "adept" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.guildRank === "adept" && state.guilds.mages.members.lina === "adept", "guild advance did not raise the rank");
  actor.level = 8;
  actor.quests.completed.push("mirror");
  state.guilds.mages.perks = [];
  run([{ kind: "questAccept", actorId: "l", questId: "guild-mirror" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  run([{ kind: "questAccept", actorId: "l", questId: "guild-warden" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.quests.active.filter((entry) => ["guild-mirror", "guild-warden"].includes(entry.id)).length === 1, "a second guild quest was accepted without guild-quest-2");
  state.guilds.mages.perks = ["guild-quest-2"];
  run([{ kind: "questAccept", actorId: "l", questId: "guild-warden" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.quests.active.filter((entry) => ["guild-mirror", "guild-warden"].includes(entry.id)).length === 2, "guild-quest-2 did not allow a second active guild quest");
  state.guilds.mages.perks = [];
  actor.quests.active = [];
  actor.room = 41;
  state.objects.find((o) => o.id === "mirror-shard").holder = "l";
  run([{ kind: "questAccept", actorId: "l", questId: "guild-mirror" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.quests.completed.includes("guild-mirror"), "the guild mirror quest did not complete");
  check(state.guilds.mages.xp === 100 && state.guilds.mages.level === 2 && state.guilds.mages.perks?.includes("hall-chest"), "guild xp did not raise the level/perk");
  actor.guildRank = "adept";
  actor.spellbook = ["spark", "mend", "light", "shield"];
  run([{ kind: "guildAdvance", actorId: "l", guildId: "mages", rank: "magician" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.guildRank === "magician" && state.guilds.mages.members.lina === "magician", "magician advancement did not take");
  actor.level = 10;
  actor.xp = 30000;
  actor.quests.completed.push("guild-warden", "reliquary");
  run([{ kind: "guildAdvance", actorId: "l", guildId: "mages", rank: "archmage" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.guildRank === "archmage" && state.guilds.mages.members.lina === "archmage", "archmage advancement did not take");
  state.guilds.mages.level = 6;
  state.guilds.mages.perks = ["guild-quest-3"];
  actor = state.actors.find((entry) => entry.id === "l");
  actor.room = 96;
  run([{ kind: "questAccept", actorId: "l", questId: "guild-dawn" }]);
  check(state.actors.find((entry) => entry.id === "l").quests.active.some((entry) => entry.id === "guild-dawn"), "the archmage dawn quest was not accepted");
  actor = state.actors.find((entry) => entry.id === "l");
  const crown = state.objects.find((object) => object.id === "dawn-crown");
  crown.holder = "l";
  crown.inside = null;
  crown.room = null;
  actor.room = 97;
  run([{ kind: "move", actorId: "l", dir: "down", to: 96 }]);
  run([{ kind: "move", actorId: "l", dir: "up", to: 97 }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.quests.completed.includes("guild-dawn"), "the archmage dawn quest did not complete");
  check(state.objects.find((object) => object.id === "archmage-signet")?.holder === "l", "the archmage signet reward was not paid");
  run([{ kind: "questAccept", actorId: "l", questId: "guild-trial" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.quests.active.some((entry) => entry.id === "guild-trial"), "the archmage trial was not accepted");
  actor.room = 96;
  state.npcs.find((npc) => npc.id === "eclipse-regent").hp = 1;
  run([{ kind: "attack", actorId: "l", targetId: "eclipse-regent" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  run([{ kind: "take", actorId: "l", objectId: "regent-sigil", messages: { actor: "taken", others: "takes" } }]);
  actor = state.actors.find((entry) => entry.id === "l");
  actor.room = 34;
  run([{ kind: "deliver", actorId: "l", objectId: "regent-sigil", npcId: "archmage", messages: { actor: "delivered", others: "delivers", target: "receives" } }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.quests.completed.includes("guild-trial"), "the archmage trial did not complete");
  state.cycle = (state.cycle ?? 0) + 1;
  run([{ kind: "questAccept", actorId: "l", questId: "guild-trial" }]);
  check(state.actors.find((entry) => entry.id === "l").quests.active.some((entry) => entry.id === "guild-trial"), "the archmage trial did not return next cycle");
  check(state.objects.find((o) => o.id === "spell-scroll").holder === "l", "the spell scroll was not held for the guild quest");
  actor = state.actors.find((entry) => entry.id === "l");
  actor.room = 40;
  run([{ kind: "move", actorId: "l", dir: "down", to: 41 }]);
  check(actor.room === 40, "the secret exit was usable before it was found");
  run([{ kind: "search", actorId: "l", room: 40, dirs: ["down"] }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.found?.includes("40:down"), "search did not record the secret exit");
  run([{ kind: "move", actorId: "l", dir: "down", to: 41 }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor.room === 41, "the secret exit did not lead to the Mirror Pool");

  state.guilds.wardens = { id: "wardens", name: "The Wardens", founder: "warden-captain", created: 0, members: { lina: "scout" }, invites: [], ranks: ["scout", "ranger", "warden"], xp: 0, level: 1 };
  actor = state.actors.find((entry) => entry.id === "l");
  actor.guild = "wardens";
  actor.guildRank = "scout";
  actor.level = 5;
  actor.visited = Array.from({ length: 20 }, (_, index) => index + 1);
  run([{ kind: "guildAdvance", actorId: "l", guildId: "wardens", rank: "ranger" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.guildRank === "ranger" && state.guilds.wardens.members.lina === "ranger", "the Wardens did not advance a ranger");

  state.guilds["night-market"] = { id: "night-market", name: "The Night Market", founder: "night-broker", created: 0, members: { lina: "runner" }, invites: [], ranks: ["runner", "cutpurse", "shadow", "master"], xp: 0, level: 1 };
  actor = state.actors.find((entry) => entry.id === "l");
  actor.guild = "night-market";
  actor.guildRank = "runner";
  actor.level = 10;
  run([{ kind: "guildAdvance", actorId: "l", guildId: "night-market", rank: "cutpurse" }]);
  actor = state.actors.find((entry) => entry.id === "l");
  check(actor?.guildRank === "cutpurse" && state.guilds["night-market"].members.lina === "cutpurse", "the Night Market did not advance a cutpurse");
  if (lantern.why.length) { lantern.ok = false; failures.push(`the Lantern Quarter is broken: ${lantern.why[0]}`); }
}

// Room actions are data: the loader validates their rooms, objects and spells;
// the reducer reveals an exit, opens a container and emits room text.
let actions = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const table = loadActions({ world });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { actions.ok = false; actions.why.push(why); } };
  check(table.errors.length === 0, `action validation failed: ${table.errors[0] ?? ""}`);
  check(findAction(table.actions, { verb: "turn", target: "mirror", room: 41 })?.id === "turn-mirror", "the mirror action does not resolve");
  state.actors.push({ id: "x", key: "xena", account: "xena", name: "xena", room: 41, visited: [41], level: 5, xp: 400, maxHp: 18, hp: 18, maxMana: 17, mana: 17, spellbook: ["detect"], guild: "mages", guildRank: "apprentice", wielding: null, quests: { active: [], completed: [] }, found: [] });
  run([{ kind: "action", actorId: "x", actionId: "turn-mirror", messages: { actor: "turned", others: "turns" } }]);
  let actor = state.actors.find((entry) => entry.id === "x");
  check(actor.found?.includes("41:down"), "turn mirror did not reveal the secret exit");
  run([{ kind: "move", actorId: "x", dir: "down", to: 45 }]);
  actor = state.actors.find((entry) => entry.id === "x");
  check(actor.room === 45, "the revealed exit did not reach the Mirror's Other Side");
  actor.room = 43;
  run([{ kind: "action", actorId: "x", actionId: "push-statue", messages: { actor: "pushed", others: "pushes" } }]);
  check(state.objects.find((o) => o.id === "ward-chest")?.open === true, "push statue did not open the ward chest");
  actor = state.actors.find((entry) => entry.id === "x");
  actor.room = 39;
  const bellEvents = run([{ kind: "action", actorId: "x", actionId: "ring-bell", messages: { actor: "rung", others: "rings" } }]);
  check(bellEvents.some((event) => /door answers/.test(event.text ?? "")), "ring bell did not emit its room message");
  actor = state.actors.find((entry) => entry.id === "x");
  actor.room = 44;
  run([{ kind: "action", actorId: "x", actionId: "unlock-deep-door", messages: { actor: "unlocked", others: "unlocks" } }]);
  check(!(state.actors.find((entry) => entry.id === "x")?.found ?? []).includes("44:down"), "the deep door opened without the ward key");
  state.objects.find((o) => o.id === "ward-key").holder = "x";
  run([{ kind: "action", actorId: "x", actionId: "unlock-deep-door", messages: { actor: "unlocked", others: "unlocks" } }]);
  actor = state.actors.find((entry) => entry.id === "x");
  check(actor.found?.includes("44:down"), "the ward key did not open the deep door");
  run([{ kind: "move", actorId: "x", dir: "down", to: 46 }]);
  check(state.actors.find((entry) => entry.id === "x")?.room === 46, "the deep door did not lead to the Chained Niche");
  const noSpell = { id: "y", key: "yara", account: "yara", name: "yara", room: 41, visited: [41], level: 5, xp: 400, maxHp: 18, hp: 18, maxMana: 13, mana: 13, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] };
  state.actors.push(noSpell);
  run([{ kind: "action", actorId: "y", actionId: "turn-mirror", messages: { actor: "turned", others: "turns" } }]);
  check(!(state.actors.find((entry) => entry.id === "y")?.found ?? []).includes("41:down"), "an action with an unmet spell requirement fired");
  actor = state.actors.find((entry) => entry.id === "x");
  actor.room = 6;
  actor.hp = 5;
  run([{ kind: "action", actorId: "x", actionId: "pray-shrine", messages: { actor: "prayed", others: "prays" } }]);
  actor = state.actors.find((entry) => entry.id === "x");
  check(actor.hp === 7, "praying at the shrine did not heal");
  actor.room = 50;
  const wardEvents = run([{ kind: "action", actorId: "x", actionId: "touch-wardstone", messages: { actor: "touched", others: "touches" } }]);
  check(wardEvents.some((event) => /turns over and settles/.test(event.text ?? "")), "touching the wardstone did not emit its message");
  actor = state.actors.find((entry) => entry.id === "x");
  actor.room = 58;
  run([{ kind: "action", actorId: "x", actionId: "open-reliquary", messages: { actor: "opened", others: "opens" } }]);
  check(state.objects.find((o) => o.id === "reliquary-chest")?.open === true, "the reliquary action did not open the chest");
  actor = state.actors.find((entry) => entry.id === "x");
  actor.room = 59;
  const lanternEvents = run([{ kind: "action", actorId: "x", actionId: "fill-lantern", messages: { actor: "filled", others: "fills" } }]);
  check(lanternEvents.some((event) => /door is listening/.test(event.text ?? "")), "the last lantern action did not emit its message");
  if (actions.why.length) { actions.ok = false; failures.push(`the action engine is broken: ${actions.why[0]}`); }
}

// The Ember Deep: the quiet door opens for the last lantern, the rooms form a
// loop, the quest chain pays out, the chest needs the ash key, and the first
// flame is a way back.
let ember = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const table = loadActions({ world });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  const action = (id) => table.actions.find((entry) => entry.id === id);
  const check = (condition, why) => { if (!condition) { ember.ok = false; ember.why.push(why); } };
  check(table.errors.length === 0, `action validation failed: ${table.errors[0] ?? ""}`);
  check(world.rooms[60]?.secretExits?.east === 61 && world.rooms[61]?.exits?.west === 60, "the quiet door does not lead to the Ember Deep");
  check(world.rooms[64]?.exits?.west === 62 && world.rooms[62]?.exits?.east === 64, "the bellows do not connect to the cinder hall");
  check(action("touch-quiet-door")?.requires?.item === "last-lantern", "the quiet door does not require the last lantern");
  check(action("enter-first-flame")?.effects?.some((effect) => effect.kind === "teleport" && effect.room === 61), "the first flame has no shortcut");
  state.actors.push({ id: "e", key: "ember", account: "ember", name: "ember", room: 60, visited: [60], level: 9, xp: 5000, maxHp: 24, hp: 24, maxMana: 23, mana: 23, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: ["last"] }, found: [] });
  state.objects.find((o) => o.id === "last-lantern").holder = "e";
  run([{ kind: "action", actorId: "e", actionId: "touch-quiet-door", messages: { actor: "touched", others: "touches" } }]);
  let actor = state.actors.find((entry) => entry.id === "e");
  check(actor?.found?.includes("60:east"), "touching the quiet door did not reveal the way east");
  run([{ kind: "move", actorId: "e", dir: "east", to: 61 }]);
  actor = state.actors.find((entry) => entry.id === "e");
  check(actor.room === 61, "the quiet door did not open into the Ashen Threshold");
  state.objects.find((o) => o.id === "first-coal").holder = "e";
  for (const [dir, to] of [["east", 63], ["north", 64], ["north", 66], ["north", 68], ["north", 69], ["east", 70]]) {
    run([{ kind: "move", actorId: "e", dir, to }]);
  }
  actor = state.actors.find((entry) => entry.id === "e");
  check(actor.room === 70, "the Ember Deep walk did not reach the First Flame");
  state.cycle = 1; // Fen event, so the Ember award stays at its base value.
  const emberWarden = state.npcs.find((npc) => npc.id === "ember-warden");
  emberWarden.hp = 1;
  emberWarden.damage = 0;
  run([{ kind: "attack", actorId: "e", targetId: "ember-warden" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  check(state.objects.find((object) => object.id === "ember-gauntlets")?.room === 70, "the ember gauntlets did not drop in the First Flame");
  actor = state.actors.find((entry) => entry.id === "e");
  check(actor.standing?.ember === 2, "the ember warden kill did not award Ember standing");
  actor = state.actors.find((entry) => entry.id === "e");
  actor.room = 69;
  state.objects.find((o) => o.id === "ash-key").holder = "e";
  run([{ kind: "action", actorId: "e", actionId: "unlock-ember-chest", messages: { actor: "unlocked", others: "unlocks" } }]);
  check(state.objects.find((o) => o.id === "ember-chest")?.open === true, "the ash key did not open the ember chest");
  actor = state.actors.find((entry) => entry.id === "e");
  actor.room = 70;
  run([{ kind: "action", actorId: "e", actionId: "enter-first-flame", messages: { actor: "entered", others: "enters" } }]);
  actor = state.actors.find((entry) => entry.id === "e");
  check(actor.room === 61, "the first flame shortcut did not return to the threshold");
  if (ember.why.length) { ember.ok = false; failures.push(`the Ember Deep is broken: ${ember.why[0]}`); }
}

// The level table must cap at ten. The old eleven-entry table made 30,000 XP
// level 11 while every quest and document called level 10 the cap.
let levelCap = { ok: true, why: [] };
{
  const table = loadLevels();
  const check = (condition, why) => { if (!condition) { levelCap.ok = false; levelCap.why.push(why); } };
  check(table.errors.length === 0, `level validation failed: ${table.errors[0] ?? ""}`);
  check(table.levels.length === 10, `the table has ${table.levels.length} levels, not 10`);
  check(levelForXp(table.levels, 0) === 1, "0 xp is not level 1");
  check(levelForXp(table.levels, 15000) === 9, "15,000 xp is not level 9");
  check(levelForXp(table.levels, 29999) === 9, "29,999 xp passed level 9");
  check(levelForXp(table.levels, 30000) === 10, "30,000 xp is not the level-10 cap");
  if (levelCap.why.length) failures.push(`the level cap is broken: ${levelCap.why[0]}`);
}

// Visibility commands: levels, leaderboard, map and shortcuts.
let visibility = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { visibility.ok = false; visibility.why.push(why); } };
  const levels = levelsText({ levels: [0, 100, 300] }, 2);
  check(levels.includes("Levels (3)") && levels.includes("→ 2") && levels.includes("100–299"), "the level view is wrong");
  const board = leaderboardText({
    a: { name: "ana", level: 3, xp: 400, quests: { completed: ["x"] }, guild: "mages", guildRank: "adept" },
    b: { name: "bob", level: 5, xp: 100, quests: { completed: [] } },
  }, 2);
  check(board.includes("bob") && board.indexOf("bob") < board.indexOf("ana") && board.includes("adept"), "the leaderboard order is wrong");
  const map = mapText({
    1: { name: "The Atrium", zone: "temple" },
    2: { name: "The Corridor", zone: "temple" },
  }, [{ id: "temple", name: "The Temple", rooms: [1, 2] }], [1, 2], 1, "temple");
  check(map.includes("The Atrium") && map.includes("The Corridor") && map.includes("→"), "the zone map is wrong");
  const hidden = mapText({ 1: { name: "A", zone: "z" }, 2: { name: "B", zone: "z" } }, [{ id: "z", name: "Z", rooms: [1, 2] }], [1], 1, "z");
  check(hidden.includes("unexplored") && !hidden.includes("B (") && hidden.includes("1/2"), "the map exposed an unvisited room");
  check(shortcutsText().includes("recall") && shortcutsText().includes("leaderboard"), "the shortcut view is incomplete");
  if (visibility.why.length) { visibility.ok = false; failures.push(`visibility is broken: ${visibility.why[0]}`); }
}

// First Steps: the guided level-1 tour and its tutorial command.
let firstSteps = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { firstSteps.ok = false; firstSteps.why.push(why); } };
  const quest = questTable.quests.find((entry) => entry.id === "first-steps");
  check(Boolean(quest) && quest.level === 1, "the First Steps quest is missing");
  state.actors.push({ id: "n", key: "new", account: "new", name: "new", room: 1, visited: [1], level: 1, xp: 0, maxHp: 10, hp: 10, maxMana: 5, mana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] } });
  run([{ kind: "questAccept", actorId: "n", questId: "first-steps" }]);
  for (const [dir, to] of [["north", 2], ["south", 1], ["south", 8], ["west", 10], ["north", 24], ["east", 116]]) {
    run([{ kind: "move", actorId: "n", dir, to }]);
  }
  const actor = state.actors.find((entry) => entry.id === "n");
  check(actor.quests.completed.includes("first-steps"), "the First Steps tour did not complete");
  check(actor.xp >= 20, "the First Steps quest did not pay XP");
  check(state.objects.some((object) => object.holder === "n" && (object.flags ?? []).includes("coin") && object.value === 10), "the First Steps quest did not pay coins");
  if (firstSteps.why.length) { firstSteps.ok = false; failures.push(`first steps are broken: ${firstSteps.why[0]}`); }
}

// The Hollow Fen: a second outdoor region, the green key/chest and the
// green-heart shortcut.
let fen = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const table = loadActions({ world });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { fen.ok = false; fen.why.push(why); } };
  check(table.errors.length === 0, `fen action validation failed: ${table.errors[0] ?? ""}`);
  check(world.rooms[20]?.exits?.east === 71 && world.rooms[71]?.exits?.west === 20, "the Hollow Fen is not connected to the mill");
  check(world.rooms[80]?.exits?.west === 79 && world.rooms[79]?.exits?.east === 80, "the Green Heart is not connected");
  state.actors.push({ id: "f", key: "fen", account: "fen", name: "fen", room: 71, visited: [71], level: 8, xp: 4000, maxHp: 22, hp: 22, maxMana: 21, mana: 21, spellbook: [], guild: "mages", guildRank: "magician", wielding: null, quests: { active: [], completed: ["fen-beacon"] }, found: [] });
  for (const [dir, to] of [["east", 73], ["north", 74], ["north", 76], ["north", 77], ["east", 78], ["north", 79]]) {
    run([{ kind: "move", actorId: "f", dir, to }]);
  }
  let actor = state.actors.find((entry) => entry.id === "f");
  check(actor.room === 79, "the fen walk did not reach the vault");
  state.objects.find((o) => o.id === "green-key").holder = "f";
  run([{ kind: "action", actorId: "f", actionId: "unlock-fen-chest", messages: { actor: "unlocked", others: "unlocks" } }]);
  check(state.objects.find((o) => o.id === "fen-chest")?.open === true, "the green key did not open the fen chest");
  run([{ kind: "move", actorId: "f", dir: "east", to: 80 }]);
  state.objects.find((o) => o.id === "green-seed").holder = "f";
  run([{ kind: "action", actorId: "f", actionId: "enter-green-heart", messages: { actor: "entered", others: "enters" } }]);
  actor = state.actors.find((entry) => entry.id === "f");
  check(actor.room === 71, "the green-heart shortcut did not return to the fen gate");
  if (fen.why.length) { fen.ok = false; failures.push(`the Hollow Fen is broken: ${fen.why[0]}`); }
}

// The Salt Caves: a second new zone with a keyed chest and a shortcut.
let salt = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const table = loadActions({ world });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { salt.ok = false; salt.why.push(why); } };
  check(table.errors.length === 0, `salt action validation failed: ${table.errors[0] ?? ""}`);
  check(world.rooms[32]?.exits?.down === 81 && world.rooms[81]?.exits?.up === 32, "the Salt Caves are not connected to the lighthouse");
  check(world.rooms[85]?.exits?.west === 83 && world.rooms[85]?.exits?.south === 84, "the Salt Heart exits are wrong");
  state.actors.push({ id: "s", key: "salt", account: "salt", name: "salt", room: 81, visited: [81], level: 7, xp: 3000, maxHp: 22, hp: 22, maxMana: 20, mana: 20, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  for (const [dir, to] of [["east", 82], ["east", 84]]) run([{ kind: "move", actorId: "s", dir, to }]);
  let actor = state.actors.find((entry) => entry.id === "s");
  check(actor.room === 84, "the salt walk did not reach the vault");
  state.objects.find((o) => o.id === "brine-key").holder = "s";
  run([{ kind: "action", actorId: "s", actionId: "unlock-salt-chest", messages: { actor: "unlocked", others: "unlocks" } }]);
  check(state.objects.find((o) => o.id === "salt-chest")?.open === true, "the brine key did not open the salt chest");
  run([{ kind: "move", actorId: "s", dir: "north", to: 85 }]);
  run([{ kind: "action", actorId: "s", actionId: "enter-salt-heart", messages: { actor: "entered", others: "enters" } }]);
  actor = state.actors.find((entry) => entry.id === "s");
  check(actor.room === 81, "the salt-heart shortcut did not return to the stair");
  if (salt.why.length) { salt.ok = false; failures.push(`the Salt Caves are broken: ${salt.why[0]}`); }
}

// The Moonlit Reach: six rooms beyond the deep forest, a moon-keyed chest,
// the moonwell and the crescent shortcut.
let moon = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const table = loadActions({ world });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { moon.ok = false; moon.why.push(why); } };
  check(table.errors.length === 0, `moon action validation failed: ${table.errors[0] ?? ""}`);
  check(world.rooms[18]?.exits?.east === 86 && world.rooms[86]?.exits?.west === 18, "the Moonlit Reach is not connected to the deep forest");
  check(world.zones.some((zone) => zone.id === "moon" && zone.rooms.includes(91)), "the Moonlit Reach zone is missing");
  check(world.objects.find((o) => o.id === "moon-key")?.room === 88, "the moon key is not in the owl grove");
  check(findAction(table.actions, { verb: "open", target: "chest", room: 89 })?.id === "open-moon-chest", "open chest does not resolve in the Moonwell");
  check(findAction(table.actions, { verb: "enter", target: "moon", room: 91 })?.id === "enter-moon", "enter moon does not resolve at the Moon Throne");
  state.actors.push({ id: "mo", key: "moon", account: "moon", name: "moon", room: 86, visited: [86], level: 9, xp: 5000, maxHp: 24, hp: 24, maxMana: 22, mana: 22, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  for (const [dir, to] of [["north", 87], ["east", 89], ["south", 88]]) run([{ kind: "move", actorId: "mo", dir, to }]);
  let actor = state.actors.find((entry) => entry.id === "mo");
  check(actor.room === 88, "the moon walk did not reach the owl grove");
  state.objects.find((o) => o.id === "moon-key").holder = "mo";
  run([{ kind: "move", actorId: "mo", dir: "north", to: 89 }]);
  run([{ kind: "action", actorId: "mo", actionId: "open-moon-chest", messages: { actor: "opened", others: "opens" } }]);
  check(state.objects.find((o) => o.id === "moon-chest")?.open === true, "the moon key did not open the pale chest");
  run([{ kind: "move", actorId: "mo", dir: "east", to: 90 }]);
  run([{ kind: "move", actorId: "mo", dir: "north", to: 91 }]);
  run([{ kind: "action", actorId: "mo", actionId: "enter-moon", messages: { actor: "entered", others: "enters" } }]);
  actor = state.actors.find((entry) => entry.id === "mo");
  check(actor.room === 86, "the crescent shortcut did not return to the gate");
  if (moon.why.length) { moon.ok = false; failures.push(`the Moonlit Reach is broken: ${moon.why[0]}`); }
}

// The Eclipse Court: the level-10 capstone above the Moon Throne. The walk
// covers the full quest chain, the keyed vault, the regent kill and the dawn
// gate back to the Moonlit Reach.
let eclipse = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, world.levels, questTable.quests);
  const table = loadActions({ world });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { eclipse.ok = false; eclipse.why.push(why); } };
  const actorNow = () => state.actors.find((entry) => entry.id === "ec");
  check(table.errors.length === 0, `eclipse action validation failed: ${table.errors[0] ?? ""}`);
  check(world.rooms[91]?.exits?.up === 92 && world.rooms[92]?.exits?.down === 91, "the Eclipse Court is not connected to the Moon Throne");
  check(world.rooms[97]?.exits?.down === 96, "the Dawn Gate does not return to the throne");
  check(world.zones.some((zone) => zone.id === "moon" && zone.rooms.includes(97)), "the Eclipse Court is not in the Moonlit Reach zone");
  check(findAction(table.actions, { verb: "open", target: "chest", room: 95 })?.id === "open-eclipse-chest", "open chest does not resolve in the Mirror Vault");
  check(findAction(table.actions, { verb: "enter", target: "gate", room: 97 })?.id === "enter-dawn-gate", "enter gate does not resolve at the Dawn Gate");

  state.actors.push({ id: "ec", key: "eclipse", account: "eclipse", name: "eclipse", room: 91, visited: [91], level: 10, xp: 30000, maxHp: 28, hp: 28, maxMana: 27, mana: 27, spellbook: ["spark", "mend", "shield"], guild: "mages", guildRank: "magician", wielding: null, quests: { active: [], completed: [] }, found: [] });
  for (const [dir, to] of [["up", 92], ["north", 93]]) run([{ kind: "move", actorId: "ec", dir, to }]);
  let actor = actorNow();
  check(actor.room === 93, "the Eclipse walk did not reach the Starless Hall");
  state.npcs.find((npc) => npc.id === "star-hound").hp = 1;
  run([{ kind: "attack", actorId: "ec", targetId: "star-hound" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  run([{ kind: "move", actorId: "ec", dir: "east", to: 94 }]);
  run([{ kind: "take", actorId: "ec", objectId: "eclipse-key", messages: { actor: "taken", others: "takes" } }]);
  actor = actorNow();
  check(state.objects.find((object) => object.id === "eclipse-key")?.holder === "ec", "the eclipse key was not taken");

  run([{ kind: "move", actorId: "ec", dir: "west", to: 93 }]);
  run([{ kind: "move", actorId: "ec", dir: "west", to: 95 }]);
  run([{ kind: "action", actorId: "ec", actionId: "open-eclipse-chest", messages: { actor: "opened", others: "opens" } }]);
  check(state.objects.find((object) => object.id === "eclipse-chest")?.open === true, "the eclipse key did not open the black chest");
  run([{ kind: "takeFrom", actorId: "ec", objectId: "dawn-crown", containerId: "eclipse-chest", messages: { actor: "taken", others: "takes" } }]);
  check(state.objects.find((object) => object.id === "dawn-crown")?.holder === "ec", "the dawn crown was not taken");

  run([{ kind: "move", actorId: "ec", dir: "east", to: 93 }]);
  run([{ kind: "move", actorId: "ec", dir: "east", to: 94 }]);
  run([{ kind: "move", actorId: "ec", dir: "north", to: 96 }]);
  state.npcs.find((npc) => npc.id === "eclipse-regent").hp = 1;
  run([{ kind: "attack", actorId: "ec", targetId: "eclipse-regent" }]);
  for (let i = 0; i < 40; i += 1) run([]);
  run([{ kind: "take", actorId: "ec", objectId: "regent-sigil", messages: { actor: "taken", others: "takes" } }]);
  actor = actorNow();
  check(state.objects.find((object) => object.id === "regent-sigil")?.holder === "ec", "the regent sigil was not taken");

  run([{ kind: "move", actorId: "ec", dir: "up", to: 97 }]);
  run([{ kind: "action", actorId: "ec", actionId: "enter-dawn-gate", messages: { actor: "entered", others: "enters" } }]);
  actor = actorNow();
  check(actor.room === 86, "the dawn gate did not return to the Moonlit Gate");
  if (eclipse.why.length) { eclipse.ok = false; failures.push(`the Eclipse Court is broken: ${eclipse.why[0]}`); }
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
  const blocked = await verifyPrismSession(fixture, { origin: fixture.app, now: at, blocked: [fixture.envelope.body.prism] });
  if (blocked.ok) prismSession.why.push("a blocked Prism id was accepted");
  const good = await verifyPrismSession(fixture, { origin: fixture.app, now: at });
  if (!good.ok || good.prism !== fixture.envelope.body.prism) prismSession.why.push(`a signed session was refused: ${good.reason ?? "no id"}`);
  const wrong = await verifyPrismSession(fixture, { origin: "https://evil.example", now: at });
  if (wrong.ok) prismSession.why.push("a session for another origin was accepted");
  const expired = await verifyPrismSession(fixture, { origin: fixture.app, now: fixture.envelope.body.payload.expires + 1 });
  if (expired.ok) prismSession.why.push("an expired session was accepted");
  const revoked = await verifyPrismSession(fixture, { origin: fixture.app, now: at, revokedBefore: at + 1 });
  if (revoked.ok) prismSession.why.push("a session issued before the reset was accepted");

  if (!sessionWithinWindow(at, at + 2 * 60 * 1000)) prismSession.why.push("a two-minute-slow clock was refused");
  if (sessionWithinWindow(at, at + 6 * 60 * 1000)) prismSession.why.push("a six-minute-skewed session was accepted");
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
  const fresh = await createPrism({});
  const freshEnvelope = await signAction(fresh, "prism/session/1", { sessionKey: raw, expires: now + 10 * 60 * 1000 }, { audience: origin, now: now + 1 });
  const afterReset = await verifyPrismSession(
    { app: origin, envelope: freshEnvelope, records: [...fresh.log.values()] },
    { origin, now: now + 1, revokedBefore: now - 1000 },
  );
  check(afterReset.ok, "a session minted after the reset was refused");
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

// Chat has its own rolling window, separate from the 250 ms input allowance.
let chatGuard = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { chatGuard.ok = false; chatGuard.why.push(why); } };
  let recent = [];
  for (let i = 0; i < CHAT_LIMIT; i += 1) {
    const verdict = chatAllowed(recent, 1000 + i);
    check(verdict.allowed, `line ${i + 1} was refused inside the window`);
    recent = verdict.recent;
  }
  const refused = chatAllowed(recent, 2000);
  check(!refused.allowed, "a ninth line was allowed inside the window");
  check(chatAllowed(refused.recent, 1000 + CHAT_WINDOW_MS + 1).allowed, "the window never reopened");
  if (chatGuard.why.length) failures.push(`the chat guard is broken: ${chatGuard.why[0]}`);
}

// A player report is a durable operator record, never world state. The verb is
// present, an empty reason is refused, and the stored text is bounded.
let moderation = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { moderation.ok = false; moderation.why.push(why); } };
  const base = {
    at: "2026-11-20T00:00:00.000Z",
    tick: 42,
    reporter: "alice",
    reporterName: "alice",
    target: "bob",
    targetName: "bob",
  };
  check(verbTable.verbs.report?.argument === "actor text", "the report verb is missing or has the wrong argument");
  check(reportRecord({ ...base, reason: "   " }) === null, "an empty report reason was accepted");
  check(reportRecord({ ...base, target: "", reason: "spam" }) === null, "a report with no target was accepted");
  const record = reportRecord({ ...base, reason: "  repeated spam  " });
  check(record?.reason === "repeated spam", "the report reason was not trimmed");
  check(reportRecord({ ...base, reason: "x".repeat(REPORT_REASON_MAX + 50) }).reason.length === REPORT_REASON_MAX, "the report reason was not capped");
  check(reportAllowed(undefined, 1000), "a first report was refused");
  check(!reportAllowed(1000, 1000 + REPORT_INTERVAL_MS - 1), "a second report was allowed inside the interval");
  check(reportAllowed(1000, 1000 + REPORT_INTERVAL_MS), "the report interval never reopened");
  if (moderation.why.length) { moderation.ok = false; failures.push(`moderation is broken: ${moderation.why[0]}`); }
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

// The Grey Keep: a 45-room questless site with keys, a locked shortcut, dark
// rooms, a guild-only pick, a scout trail skill and the reliquary sink.
let keep = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const check = (condition, why) => { if (!condition) { keep.ok = false; keep.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "grey-keep");
  check(Boolean(zone) && zone.rooms.length === 45 && zone.rooms.every((room) => world.rooms[room]), "the Grey Keep zone is not 45 connected rooms");
  check(world.rooms[11]?.exits?.south === 117 && world.rooms[15]?.exits?.north === 117
    && world.rooms[117]?.exits?.north === 11 && world.rooms[117]?.exits?.south === 15, "the Grey Keep road does not connect to the King's Road and Forest Edge");
  check(world.rooms[118]?.secretExits?.north === 125 && world.rooms[125]?.exits?.south === 118, "the postern shortcut is not connected");
  check(world.rooms[130]?.secretExits?.east === 131 && world.rooms[131]?.exits?.west === 130, "the vault door is not connected");
  check(["124", "128", "131", "146", "147", "152", "153", "160", "161"].every((room) => world.rooms[room]?.dark === true), "a dark keep room is missing its dark flag");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("keep-gate-key")?.inside === "keep-barracks-chest" && object("keep-vault-key")?.inside === "keep-solar-chest", "the keep keys are not in their chests");
  check(object("keep-reliquary")?.room === 126 && object("keep-crown")?.value >= 50 && object("keep-captain-signet")?.value >= 40, "the reliquary or keep treasure is missing");
  check(object("keep-library-cabinet")?.room === 136 && object("keep-star-chart")?.inside === "keep-library-cabinet" && object("keep-first-coin")?.room === 160, "the library cabinet or sealed treasure is missing");
  check(world.npcs.some((npc) => npc.id === "keep-curator" && npc.room === 126) && world.npcs.some((npc) => npc.id === "keep-captain" && npc.room === 129) && world.npcs.some((npc) => npc.id === "keep-sealed-guardian" && npc.room === 160), "the curator, captain or sealed guardian is missing");
  check(table.errors.length === 0, `the keep action table is invalid: ${table.errors[0]}`);
  const pick = table.actions.find((action) => action.id === "pick-postern");
  const unlock = table.actions.find((action) => action.id === "unlock-postern");
  const vault = table.actions.find((action) => action.id === "unlock-vault");
  check(pick?.requires?.guild === "night-market" && pick?.requires?.rank === "runner", "the postern pick is not Night Market rank-gated");
  check(unlock?.requires?.item === "keep-gate-key" && vault?.requires?.item === "keep-vault-key", "the keep key actions are wrong");
  const dark = renderRoom({
    room: world.rooms[124], role: 0, others: ["a guard"], objects: ["a chest"], light: false,
  });
  check(dark.includes("well of cold dark") && !dark.includes("a chest") && !dark.includes("a guard"), "dark rooms leak objects or actors without light");
  const lit = renderRoom({
    room: world.rooms[124], role: 0, others: ["a guard"], objects: ["a chest"], light: true,
  });
  check(lit.includes("[The Cellar]") && lit.includes("a chest") && lit.includes("a guard"), "lit rooms do not render objects or actors");
  let state = initialState(world.rooms, world.npcs, world.objects, 117, world.climate, channelTable.channels, world.levels, questTable.quests);
  state.actors.push({ id: "k", key: "k", account: "k", name: "k", room: 126, visited: [126], level: 4, xp: 0, maxHp: 35, hp: 35, mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] } });
  state.objects.push({ id: "keep-test-treasure", name: "a test treasure", room: null, holder: "k", inside: null, flags: ["takeable"], value: 20, eaten: false });
  const result = step({ state, rooms: world.rooms, intents: [{ kind: "offer", actorId: "k", objectId: "keep-test-treasure" }] });
  state = result.state;
  const offered = state.objects.find((entry) => entry.id === "keep-test-treasure");
  check(state.actors[0].xp === 10 && offered?.eaten === true, "the reliquary did not consume a treasure for XP");
  state.actors[0].sacrificeCycle = state.cycle ?? 0;
  state.actors[0].sacrificeXp = 100;
  state.objects.push({ id: "keep-test-full", name: "a capped treasure", room: null, holder: "k", inside: null, flags: ["takeable"], value: 20, eaten: false });
  const capped = step({ state, rooms: world.rooms, intents: [{ kind: "offer", actorId: "k", objectId: "keep-test-full" }] });
  state = capped.state;
  check(state.actors[0].xp === 10 && state.objects.find((entry) => entry.id === "keep-test-full")?.eaten === false, "the reliquary did not enforce the reset cap");
  if (!keep.ok) failures.push(`the Grey Keep is broken: ${keep.why[0]}`);
}

// The Arcanum: a 21-room Mages' tower with detect/shield gates, dark rooms and
// a prism vault, reached from the one-room guild hall.
let arcanum = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const check = (condition, why) => { if (!condition) { arcanum.ok = false; arcanum.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "arcanum");
  check(Boolean(zone) && zone.rooms.length === 21 && zone.rooms.every((room) => world.rooms[room]), "the Arcanum zone is not 21 connected rooms");
  check(world.rooms[34]?.exits?.up === 162 && world.rooms[162]?.exits?.down === 34, "the Arcanum stair does not connect to the guild hall");
  check(world.rooms[171]?.secretExits?.north === 177 && world.rooms[177]?.exits?.south === 171, "the rune gallery secret door is not connected");
  check(world.rooms[180]?.secretExits?.east === 181 && world.rooms[181]?.exits?.west === 180, "the star well ward is not connected");
  check(["169", "177", "180", "181"].every((room) => world.rooms[room]?.dark === true), "a dark Arcanum room is missing its dark flag");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("arcanum-codex")?.inside === "arcanum-study-chest" && object("arcanum-seal")?.inside === "arcanum-seal-chest" && object("arcanum-prism-heart")?.room === 181, "the Arcanum treasures are missing");
  check(world.npcs.some((npc) => npc.id === "arcanum-prism-keeper" && npc.room === 181 && npc.loot?.includes("arcanum-prism-heart")) && world.npcs.some((npc) => npc.id === "arcanum-apprentice" && npc.room === 163) && world.npcs.some((npc) => npc.id === "arcanum-astronomer" && npc.room === 168), "an Arcanum NPC is missing");
  check(table.errors.length === 0, `the Arcanum action table is invalid: ${table.errors[0]}`);
  const runes = table.actions.find((action) => action.id === "read-runes");
  const ward = table.actions.find((action) => action.id === "pass-ward");
  check(runes?.room === 171 && runes?.requires?.spell === "detect" && runes?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "north"), "the rune-wall detect action is wrong");
  check(ward?.room === 180 && ward?.requires?.spell === "shield" && ward?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "east"), "the star-well shield action is wrong");
  check(["detect", "light", "shield"].every((id) => spellById(id)), "a spell gate names a missing spell");
  let state = initialState(world.rooms, world.npcs, world.objects, 171, world.climate, channelTable.channels, world.levels, questTable.quests);
  state.actors.push({ id: "m", key: "m", account: "m", name: "m", room: 171, visited: [171], level: 3, xp: 0, maxHp: 30, hp: 30, mana: 9, maxMana: 9, spellbook: ["detect"], guild: "mages", guildRank: "apprentice", wielding: null, quests: { active: [], completed: [] } });
  const result = step({ state, rooms: world.rooms, intents: [{ kind: "action", actorId: "m", actionId: "read-runes" }], actions: table.actions });
  state = result.state;
  check(state.actors[0].found?.includes("171:north") === true, "the detect action did not reveal the rune door");
  if (!arcanum.ok) failures.push(`the Arcanum is broken: ${arcanum.why[0]}`);
}

// The Mistfall: a 14-room island reached by ferry, with a dark wreck, an
// identical-room hold maze, a story quest, a teleport stone and a carry test.
let mistfall = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const quests = loadQuests();
  const check = (condition, why) => { if (!condition) { mistfall.ok = false; mistfall.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "mistfall");
  check(Boolean(zone) && zone.rooms.length === 16 && zone.rooms.every((room) => world.rooms[room]), "the Mistfall zone is not 16 connected rooms");
  check(world.rooms[30]?.secretExits?.west === 182 && world.rooms[182]?.exits?.east === 30, "the Mistfall ferry is not connected");
  check(world.rooms[190]?.exits?.west === 184, "the drowned cave does not connect to the wreck");
  check(world.rooms[191]?.minLevel === 4 && world.rooms[197]?.minLevel === 6, "the Mistfall level gates are missing");
  check(world.rooms[194]?.exits?.east === 196 && world.rooms[196]?.secretExits?.east === 197 && world.rooms[197]?.exits?.west === 196, "the twin door or tide vault is not connected");
  check(["184", "185", "186", "187", "188", "190", "191", "192", "194"].every((room) => world.rooms[room]?.dark === true), "a dark Mistfall room is missing its dark flag");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("mistfall-captain-log")?.room === 188 && object("mistfall-tide-stone")?.room === 192 && object("mistfall-wayfarer-stone")?.teleport === 30, "a Mistfall treasure is missing");
  check(object("mistfall-storm-lantern")?.flags?.includes("light") && object("mistfall-ferry-token")?.forSale === true, "the lantern or ferry token is missing");
  check(world.npcs.some((npc) => npc.id === "tide-guardian" && npc.room === 191) && world.npcs.some((npc) => npc.id === "mistfall-castaway" && npc.room === 183), "a Mistfall NPC is missing");
  check(quests.quests.some((quest) => quest.id === "salt-rose" && quest.repeat === "reset" && quest.objectives.length === 4), "the Salt Rose quest is missing");
  check(table.errors.length === 0, `the Mistfall action table is invalid: ${table.errors[0]}`);
  const ferry = table.actions.find((action) => action.id === "board-mistfall-ferry");
  check(ferry?.requires?.item === "mistfall-ferry-token" && ferry?.effects?.some((effect) => effect.kind === "teleport" && effect.room === 182), "the ferry action is wrong");
  const twin = table.actions.find((action) => action.id === "push-twin-door");
  check(twin?.requires?.actors === 2 && twin?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "east"), "the twin door is not a two-player action");
  const dark = renderRoom({ room: { name: "Test Dark", text: "A test room.", exits: {}, dark: true }, role: 0, others: ["a rat"], objects: ["a knife"], light: false });
  check(dark.includes("It is dark") && !dark.includes("a rat"), "the dark room leaked people or objects without light");
  let state = initialState(world.rooms, world.npcs, world.objects, 1, world.climate, channelTable.channels, world.levels, quests.quests);
  state.actors.push({ id: "m", key: "m", account: "m", name: "m", room: 1, visited: [1], level: 1, xp: 100, maxHp: 20, hp: 20, mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  state.actors[0].room = 190;
  state.actors[0].level = 1;
  const gated = step({ state, rooms: world.rooms, intents: [{ kind: "move", actorId: "m", dir: "east", to: 191 }], actions: [] });
  check(gated.state.actors[0].room === 190, "a level-1 actor entered the level-4 drowned cave");
  state = gated.state;
  state.actors[0].room = 1;
  state.actors[0].level = 8;
  state.objects.push({ id: "mist-test-stone", name: "a test wayfarer stone", holder: "m", room: null, inside: null, teleport: 5, charges: 1, eaten: false, flags: ["takeable"] });
  const moved = step({ state, rooms: world.rooms, intents: [{ kind: "teleportItem", actorId: "m", objectId: "mist-test-stone", to: 5 }], actions: [] });
  state = moved.state;
  check(state.actors[0].room === 5 && state.objects.find((entry) => entry.id === "mist-test-stone")?.eaten === true, "the teleport item did not move and spend a charge");
  if (!mistfall.ok) failures.push(`the Mistfall is broken: ${mistfall.why[0]}`);
}

// The Deepdelve: a 16-room working mine reached from the graveyard, with a
// party winch/pump/cart/seam, a gas pocket and canary, and an ore contract.
let deepdelve = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const quests = loadQuests();
  const check = (condition, why) => { if (!condition) { deepdelve.ok = false; deepdelve.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "deepdelve");
  check(Boolean(zone) && zone.rooms.length === 16 && zone.rooms.every((room) => world.rooms[room]), "the Deepdelve zone is not 16 connected rooms");
  check(world.rooms[17]?.exits?.west === 198 && world.rooms[198]?.exits?.east === 17, "the mine head does not open off the graveyard");
  check(world.rooms[17]?.exits?.down === 213 && world.rooms[213]?.exits?.up === 17, "the old shaft does not return to the graveyard");
  check(world.rooms[198]?.exits?.down === 199 && world.rooms[199]?.exits?.up === 198, "the cage landing is not below the mine head");
  check(world.rooms[199]?.exits?.west === 200 && world.rooms[200]?.secretExits?.down === 202 && world.rooms[202]?.exits?.up === 200, "the winch or lower tunnel is not connected");
  check(world.rooms[199]?.exits?.down === 201 && world.rooms[201]?.secretExits?.east === 202 && world.rooms[202]?.exits?.west === 201, "the pump or lower tunnel is not connected");
  check(world.rooms[204]?.exits?.east === 205 && world.rooms[205]?.exits?.west === 204, "the surveyor's camp is not off the ore face");
  check(world.rooms[204]?.secretExits?.down === 209 && world.rooms[209]?.exits?.up === 204, "the mine cart or deep gallery is not connected");
  check(world.rooms[206]?.gas === true && world.rooms[205]?.gas !== true, "the gas pocket is missing");
  check(world.rooms[198]?.minLevel === 6 && world.rooms[199]?.minLevel === 6 && world.rooms[200]?.minLevel === 7 && world.rooms[206]?.minLevel === 7 && world.rooms[207]?.minLevel === 8 && world.rooms[213]?.minLevel === 8, "the Deepdelve level gates are missing");
  check(["199", "200", "201", "202", "203", "204", "206", "207", "208", "209", "210", "211", "212", "213"].every((room) => world.rooms[room]?.dark === true), "a dark Deepdelve room is missing its dark flag");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("mine-lantern")?.room === 198 && object("mine-canary")?.room === 198 && object("mine-surveyor-notes")?.room === 205, "a Deepdelve tool or note is missing");
  check(object("mine-sealed-ore")?.room === 208 && object("mine-foreman-chest")?.flags?.includes("container") && object("mine-foreman-map")?.inside === "mine-foreman-chest", "the sealed ore or foreman chest is missing");
  check(world.npcs.some((npc) => npc.id === "mine-captain" && npc.room === 198) && world.npcs.some((npc) => npc.id === "mine-surveyor" && npc.room === 205) && world.npcs.some((npc) => npc.id === "mine-guardian" && npc.room === 210), "a Deepdelve NPC is missing");
  const quest = quests.quests.find((entry) => entry.id === "deepdelve");
  check(quest?.level === 6 && quest?.repeat === "reset" && quest?.objectives?.length === 4, "the Deepdelve quest is missing");
  check(table.errors.length === 0, `the Deepdelve action table is invalid: ${table.errors[0]}`);
  const winch = table.actions.find((action) => action.id === "turn-deepdelve-winch");
  const pump = table.actions.find((action) => action.id === "pump-deepdelve-shaft");
  const cart = table.actions.find((action) => action.id === "board-deepdelve-cart");
  const seam = table.actions.find((action) => action.id === "strike-deepdelve-seam");
  check(winch?.requires?.party === 2 && pump?.requires?.party === 2 && cart?.requires?.party === 2 && seam?.requires?.party === 2, "a Deepdelve action is not party-gated");
  check(winch?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "down") && seam?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "east"), "a Deepdelve action does not open its way");
  const coracle = table.actions.find((action) => action.id === "board-deepdelve-coracle");
  check(coracle?.requires?.party === undefined && coracle?.effects?.some((effect) => effect.kind === "teleport" && effect.room === 213), "the coracle is wrong");

  // Party state, party-wide reveal and shared kill/quest credit.
  let state = initialState(world.rooms, [], [], 200, world.climate, channelTable.channels, world.levels, quests.quests);
  const actor = (id, name) => ({ id, key: id, account: id, name, room: 200, visited: [200], level: 7, xp: 1000, maxHp: 40, hp: 40, mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  state.actors.push(actor("a", "ana"), actor("b", "bob"));
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyDecline", actorId: "b" }]);
  check(state.parties[0].invites.length === 0 && !state.actors[1].party, "the invitation was not declined");
  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyAccept", actorId: "b" }]);
  check(state.parties.length === 1 && state.parties[0].members.length === 2 && state.parties[0].leaderId === "a", "the party did not form");
  run([{ kind: "action", actorId: "a", actionId: "turn-deepdelve-winch", messages: {} }]);
  check(state.actors.every((entry) => entry.found.includes("200:down")), "a party action did not reveal the way to every member");
  run([{ kind: "partyDisband", actorId: "a" }]);
  check(state.parties.length === 0 && state.actors.every((entry) => entry.party === null), "the party did not disband");
  state.actors.forEach((entry) => { entry.found = []; });
  run([{ kind: "action", actorId: "a", actionId: "turn-deepdelve-winch", messages: {} }]);
  check(state.actors.every((entry) => entry.found.length === 0), "a solo actor used a party-only action");

  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyAccept", actorId: "b" }]);
  run([{ kind: "partyKick", actorId: "a", targetId: "b" }]);
  check(state.parties.length === 1 && state.parties[0].members.length === 1 && state.actors[1].party === null, "the leader could not kick a member");
  run([{ kind: "partyLeave", actorId: "a" }]);
  check(state.parties.length === 0 && state.actors[0].party === null, "the last member could not leave the party");

  state.quests = [...state.quests, { id: "party-test", name: "Party Test", level: 1, repeat: "reset", objectives: [{ kind: "kill", npc: "party-mob", count: 1, text: "Kill the dummy" }], rewards: { xp: 0, coins: 0 }, requires: [] }];
  state.actors[1].quests = { active: [{ id: "party-test", progress: {} }], completed: [] };
  state.npcs.push({ id: "party-mob", name: "a party dummy", room: 200, home: 200, zone: "deepdelve", period: 180, jitter: 0, behaviour: "sentinel", level: 1, hp: 1, maxHp: 1, damage: 0, armor: 0, aggression: 0, xp: 100, loot: [], dead: false, clock: { period: 180, remaining: 180 } });
  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyAccept", actorId: "b" }]);
  const beforeB = state.actors[1].xp;
  run([{ kind: "attack", actorId: "a", targetId: "party-mob" }]);
  for (let i = 0; i < 240 && !state.npcs.find((npc) => npc.id === "party-mob").dead; i += 1) run([]);
  check(state.actors[1].xp >= beforeB + 50, "a party member did not share kill experience");
  check(state.actors[1].quests.completed.includes("party-test"), "a party member did not share quest kill credit");

  // Gas: a canary buys five breaths, then dies; without one the air burns.
  let gas = initialState(world.rooms, [], world.objects, 206, world.climate, channelTable.channels, world.levels, quests.quests);
  gas.actors.push({ id: "g", key: "g", account: "g", name: "g", room: 206, visited: [206], level: 8, xp: 0, maxHp: 40, hp: 40, mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  const canary = gas.objects.find((entry) => entry.id === "mine-canary");
  canary.holder = "g"; canary.room = null;
  const gasRun = (count) => { for (let i = 0; i < count; i += 1) { const result = step({ state: gas, rooms: world.rooms, intents: [], actions: table.actions }); gas = result.state; } };
  gasRun(48);
  check(gas.actors[0].hp === 40 && gas.actors[0].gasUntil > 0, "the canary did not protect against gas");
  gasRun(96);
  check(gas.objects.find((entry) => entry.id === "mine-canary").eaten === true, "the canary did not die after five breaths");
  gasRun(24);
  check(gas.actors[0].hp === 38, `gas did not damage an unprotected actor (${gas.actors[0].hp} hp)`);
  gas.actors[0].hp = 1;
  gasRun(24);
  check(gas.actors[0].hp === 1, "gas killed a character instead of leaving them at 1 hp");

  if (!deepdelve.ok) failures.push(`the Deepdelve is broken: ${deepdelve.why[0]}`);
}

// The Drowned Foundry: a 12-room level 9/10 party dungeon below the Deepdelve
// pool, with five party actions, a Night Market valve shortcut and a boss.
let foundry = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const quests = loadQuests();
  const check = (condition, why) => { if (!condition) { foundry.ok = false; foundry.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "foundry");
  check(Boolean(zone) && zone.rooms.length === 12 && zone.rooms.every((room) => world.rooms[room]), "the Foundry zone is not 12 connected rooms");
  check(world.rooms[212]?.secretExits?.down === 214 && world.rooms[214]?.exits?.up === 212, "the drowned stair is not below the pool");
  check(world.rooms[215]?.secretExits?.down === 218 && world.rooms[218]?.exits?.up === 215, "the valve stair is not connected");
  check(world.rooms[218]?.secretExits?.east === 219 && world.rooms[219]?.exits?.west === 218, "the sluice passage is not connected");
  check(world.rooms[219]?.secretExits?.down === 222 && world.rooms[222]?.exits?.up === 219, "the crane shaft is not connected");
  check(world.rooms[222]?.secretExits?.east === 223 && world.rooms[223]?.exits?.west === 222, "the bellows passage is not connected");
  check(world.rooms[219]?.exits?.east === 220 && world.rooms[220]?.exits?.west === 219 && world.rooms[220]?.exits?.down === 221 && world.rooms[221]?.exits?.up === 220 && world.rooms[221]?.exits?.east === 222, "the office or cooling tunnels are not connected");
  check(world.rooms[223]?.exits?.east === 224 && world.rooms[224]?.exits?.west === 223 && world.rooms[224]?.exits?.north === 225 && world.rooms[225]?.exits?.south === 224, "the foundry heart or master's forge is not connected");
  check(["214", "215", "218", "219", "220", "221", "222", "223"].every((room) => world.rooms[room]?.dark === true) && ["216", "217", "224", "225"].every((room) => world.rooms[room]?.dark !== true), "a Foundry dark flag is wrong");
  check(["214", "215", "216", "217", "218", "219"].every((room) => world.rooms[room]?.minLevel === 9) && ["220", "221", "222", "223", "224", "225"].every((room) => world.rooms[room]?.minLevel === 10), "the Foundry level gates are missing");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("foundry-lantern")?.room === 214 && object("foundry-hammer")?.damage === 6 && object("foundry-ledger")?.room === 220 && object("foundry-apron")?.armor === 3, "a Foundry tool or treasure is missing");
  check(object("foundry-master-core")?.room === 225 && object("foundry-coins")?.value === 40, "the master's core or coins are missing");
  check(world.npcs.some((npc) => npc.id === "foundry-foreman" && npc.room === 214) && world.npcs.some((npc) => npc.id === "foundry-master" && npc.room === 225 && npc.loot?.includes("foundry-master-core")), "a Foundry NPC is missing");
  const quest = quests.quests.find((entry) => entry.id === "foundry");
  check(quest?.level === 9 && quest?.repeat === "reset" && quest?.objectives?.length === 4, "the Foundry quest is missing");
  check(table.errors.length === 0, `the Foundry action table is invalid: ${table.errors[0]}`);
  const wheel = table.actions.find((action) => action.id === "turn-foundry-wheel");
  const valve = table.actions.find((action) => action.id === "turn-foundry-valve");
  const sluice = table.actions.find((action) => action.id === "open-foundry-sluice");
  const crane = table.actions.find((action) => action.id === "turn-foundry-crane");
  const bellows = table.actions.find((action) => action.id === "pump-foundry-bellows");
  check(wheel?.requires?.party === 2 && valve?.requires?.party === 2 && sluice?.requires?.party === 2 && crane?.requires?.party === 2 && bellows?.requires?.party === 2, "a Foundry action is not party-gated");
  check(wheel?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "down") && bellows?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "east"), "a Foundry action does not open its way");
  const pick = table.actions.find((action) => action.id === "pick-foundry-valve");
  check(pick?.requires?.guild === "night-market" && pick?.requires?.rank === "runner" && pick?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "down"), "the Night Market valve shortcut is wrong");

  let state = initialState(world.rooms, [], [], 212, world.climate, channelTable.channels, loadLevels().levels, quests.quests);
  const actor = (id, name) => ({ id, key: id, account: id, name, room: 212, visited: [212], level: 10, xp: 30000, maxHp: maxHpForLevel(10), hp: maxHpForLevel(10), mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  state.actors.push(actor("a", "ana"), actor("b", "bob"));
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyAccept", actorId: "b" }]);
  run([{ kind: "action", actorId: "a", actionId: "turn-foundry-wheel", messages: {} }]);
  check(state.actors.every((entry) => entry.found.includes("212:down")), "the Foundry wheel did not open the stair for the party");
  state.actors.forEach((entry) => { entry.found = []; entry.room = 215; });
  run([{ kind: "action", actorId: "a", actionId: "pick-foundry-valve", messages: {} }]);
  check(state.actors.every((entry) => entry.found.length === 0), "a non-guild actor picked the Foundry valve");
  state.guilds["night-market"] = { id: "night-market", name: "The Night Market", founder: "night-broker", created: 0, members: { a: "runner" }, invites: [], ranks: ["runner", "cutpurse", "shadow", "master"], xp: 0, level: 1, perks: [], vault: [] };
  state.actors[0].guild = "night-market"; state.actors[0].guildRank = "runner";
  run([{ kind: "action", actorId: "a", actionId: "pick-foundry-valve", messages: {} }]);
  check(state.actors[0].found.includes("215:down"), "the Night Market actor did not pick the Foundry valve");
  if (!foundry.ok) failures.push(`the Foundry is broken: ${foundry.why[0]}`);
}

// The Flooded Monastery: a 14-room level 8/9/10 site below the Grey Keep
// ossuary, with a keyed chest, a party bell rope, a crypt and a drowned abbot.
let monastery = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const quests = loadQuests();
  const check = (condition, why) => { if (!condition) { monastery.ok = false; monastery.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "monastery");
  check(Boolean(zone) && zone.rooms.length === 14 && zone.rooms.every((room) => world.rooms[room]), "the Monastery zone is not 14 connected rooms");
  check(world.rooms[147]?.exits?.down === 226 && world.rooms[226]?.exits?.up === 147, "the monastery is not below the ossuary");
  check(world.rooms[235]?.secretExits?.south === 237 && world.rooms[237]?.exits?.north === 235, "the bell shortcut is not connected");
  check(world.rooms[234]?.exits?.down === 236 && world.rooms[236]?.exits?.up === 234 && world.rooms[236]?.exits?.east === 237 && world.rooms[237]?.exits?.east === 238 && world.rooms[238]?.exits?.north === 239, "the crypt, chapel or reliquary is not connected");
  check(["226", "228", "229", "230", "231", "232", "233", "234", "236", "237"].every((room) => world.rooms[room]?.dark === true) && ["227", "235", "238", "239"].every((room) => world.rooms[room]?.dark !== true), "a Monastery dark flag is wrong");
  check(["226", "227", "228", "229", "230", "231", "232"].every((room) => world.rooms[room]?.minLevel === 8) && ["233", "234", "235", "236", "237"].every((room) => world.rooms[room]?.minLevel === 9) && ["238", "239"].every((room) => world.rooms[room]?.minLevel === 10), "the Monastery level gates are missing");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("monastery-lantern")?.room === 226 && object("monastery-key")?.room === 229 && object("monastery-chest")?.flags?.includes("container") && object("abbey-clapper")?.inside === "monastery-chest", "a Monastery key, chest or clapper is missing");
  check(object("abbot-relic")?.room === 239 && object("abbot-relic")?.slot === "neck" && object("monastery-ledger")?.readable === true, "a Monastery treasure or ledger is missing");
  check(world.npcs.some((npc) => npc.id === "bellkeeper" && npc.room === 226) && world.npcs.some((npc) => npc.id === "drowned-abbot" && npc.room === 238), "a Monastery NPC is missing");
  const quest = quests.quests.find((entry) => entry.id === "monastery");
  check(quest?.level === 8 && quest?.repeat === "reset" && quest?.objectives?.length === 4, "the Monastery quest is missing");
  check(table.errors.length === 0, `the Monastery action table is invalid: ${table.errors[0]}`);
  const unlock = table.actions.find((action) => action.id === "unlock-monastery-chest");
  const bell = table.actions.find((action) => action.id === "pull-monastery-bell");
  check(unlock?.requires?.item === "monastery-key" && unlock?.effects?.some((effect) => effect.kind === "open" && effect.object === "monastery-chest"), "the sacristy chest action is wrong");
  check(bell?.requires?.party === 2 && bell?.requires?.item === "abbey-clapper" && bell?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "south"), "the bell action is wrong");

  let state = initialState(world.rooms, [], world.objects, 234, world.climate, channelTable.channels, loadLevels().levels, quests.quests);
  const actor = (id, name) => ({ id, key: id, account: id, name, room: 234, visited: [234], level: 10, xp: 30000, maxHp: maxHpForLevel(10), hp: maxHpForLevel(10), mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  state.actors.push(actor("a", "ana"), actor("b", "bob"));
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  run([{ kind: "action", actorId: "a", actionId: "unlock-monastery-chest", messages: {} }]);
  check(state.objects.find((entry) => entry.id === "monastery-chest").open !== true, "a keyless actor opened the sacristy chest");
  const key = state.objects.find((entry) => entry.id === "monastery-key"); key.holder = "a"; key.room = null;
  run([{ kind: "action", actorId: "a", actionId: "unlock-monastery-chest", messages: {} }]);
  check(state.objects.find((entry) => entry.id === "monastery-chest").open === true, "the key did not open the sacristy chest");
  const clapper = state.objects.find((entry) => entry.id === "abbey-clapper"); clapper.holder = "a"; clapper.inside = null;
  state.actors.forEach((entry) => { entry.room = 235; entry.found = []; });
  run([{ kind: "action", actorId: "a", actionId: "pull-monastery-bell", messages: {} }]);
  check(state.actors.every((entry) => !entry.found.includes("235:south")), "a solo actor pulled the party bell");
  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyAccept", actorId: "b" }]);
  state.actors.forEach((entry) => { entry.found = []; });
  run([{ kind: "action", actorId: "a", actionId: "pull-monastery-bell", messages: {} }]);
  check(state.actors.every((entry) => entry.found.includes("235:south")), "the bell did not open the shortcut for a formed party");
  if (!monastery.ok) failures.push(`the Monastery is broken: ${monastery.why[0]}`);
}

// The Merry Dancer: a 12-room level 7/8/9 sunken wreck reached by a salvage
// skiff, with a party capstan, a keyed strongbox and a drowned captain.
let wreck = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const quests = loadQuests();
  const check = (condition, why) => { if (!condition) { wreck.ok = false; wreck.why.push(why); } };
  const zone = world.zones.find((entry) => entry.id === "wreck");
  check(Boolean(zone) && zone.rooms.length === 12 && zone.rooms.every((room) => world.rooms[room]), "the Wreck zone is not 12 connected rooms");
  check(world.rooms[31]?.secretExits?.south === 240 && world.rooms[240]?.exits?.north === 31 && world.rooms[240]?.exits?.down === 241 && world.rooms[241]?.exits?.up === 240, "the skiff route or drowned deck is not connected");
  check(world.rooms[241]?.secretExits?.down === 245 && world.rooms[245]?.exits?.up === 241, "the capstan hatch is not connected");
  check(world.rooms[242]?.exits?.west === 241 && world.rooms[242]?.exits?.east === 243 && world.rooms[242]?.exits?.south === 245 && world.rooms[243]?.exits?.down === 244 && world.rooms[244]?.exits?.up === 243, "the mast, cabin or strongbox is not connected");
  check(world.rooms[245]?.exits?.east === 246 && world.rooms[246]?.exits?.east === 247 && world.rooms[247]?.exits?.down === 248 && world.rooms[248]?.exits?.east === 249 && world.rooms[249]?.exits?.east === 250 && world.rooms[250]?.exits?.east === 251, "the hold, galley, orlop or captain is not connected");
  check(["241", "242", "243", "244", "245", "246", "247", "248", "249", "250", "251"].every((room) => world.rooms[room]?.dark === true) && world.rooms[240]?.dark !== true, "a Wreck dark flag is wrong");
  check(["240", "241", "242", "243", "244", "245"].every((room) => world.rooms[room]?.minLevel === 7) && ["246", "247", "248", "249"].every((room) => world.rooms[room]?.minLevel === 8) && ["250", "251"].every((room) => world.rooms[room]?.minLevel === 9), "the Wreck level gates are missing");
  const object = (id) => world.objects.find((entry) => entry.id === id);
  check(object("wreck-lantern")?.room === 240 && object("wreck-lantern-2")?.room === 245, "the wreck lanterns are missing");
  check(object("captain-log")?.room === 243 && object("strongbox-key")?.room === 246 && object("captain-strongbox")?.flags?.includes("container") && object("tide-glass")?.inside === "captain-strongbox" && object("wreck-coins")?.value === 45, "a Wreck quest item or treasure is missing");
  check(world.npcs.some((npc) => npc.id === "salvager" && npc.room === 240) && world.npcs.some((npc) => npc.id === "drowned-captain" && npc.room === 251), "a Wreck NPC is missing");
  const quest = quests.quests.find((entry) => entry.id === "wreck");
  check(quest?.level === 7 && quest?.repeat === "reset" && quest?.objectives?.length === 4, "the Wreck quest is missing");
  check(table.errors.length === 0, `the Wreck action table is invalid: ${table.errors[0]}`);
  const skiff = table.actions.find((action) => action.id === "board-salvage-skiff");
  const capstan = table.actions.find((action) => action.id === "turn-wreck-capstan");
  const strongbox = table.actions.find((action) => action.id === "unlock-captain-strongbox");
  check(skiff?.effects?.some((effect) => effect.kind === "teleport" && effect.room === 240) && skiff?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "south"), "the salvage skiff action is wrong");
  check(capstan?.requires?.party === 2 && capstan?.effects?.some((effect) => effect.kind === "revealExit" && effect.dir === "down"), "the capstan action is wrong");
  check(strongbox?.requires?.item === "strongbox-key" && strongbox?.effects?.some((effect) => effect.kind === "open" && effect.object === "captain-strongbox"), "the strongbox action is wrong");

  let state = initialState(world.rooms, [], world.objects, 31, world.climate, channelTable.channels, loadLevels().levels, quests.quests);
  const actor = (id, name, room = 31) => ({ id, key: id, account: id, name, room, visited: [room], level: 9, xp: 15000, maxHp: maxHpForLevel(9), hp: maxHpForLevel(9), mana: 5, maxMana: 5, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  state.actors.push(actor("a", "ana"), actor("b", "bob"));
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  run([{ kind: "action", actorId: "a", actionId: "board-salvage-skiff", messages: {} }]);
  check(state.actors[0].room === 240, "the skiff did not carry the actor");
  state.actors.forEach((entry) => { entry.room = 241; entry.found = []; });
  run([{ kind: "partyInvite", actorId: "a", targetId: "b" }]);
  run([{ kind: "partyAccept", actorId: "b" }]);
  run([{ kind: "action", actorId: "a", actionId: "turn-wreck-capstan", messages: {} }]);
  check(state.actors.every((entry) => entry.found.includes("241:down")), "the capstan did not open the hold for the party");
  state.actors.forEach((entry) => { entry.room = 244; });
  run([{ kind: "action", actorId: "a", actionId: "unlock-captain-strongbox", messages: {} }]);
  check(state.objects.find((entry) => entry.id === "captain-strongbox").open !== true, "a keyless actor opened the strongbox");
  const key = state.objects.find((entry) => entry.id === "strongbox-key"); key.holder = "a"; key.room = null;
  run([{ kind: "action", actorId: "a", actionId: "unlock-captain-strongbox", messages: {} }]);
  check(state.objects.find((entry) => entry.id === "captain-strongbox").open === true, "the key did not open the strongbox");
  if (!wreck.ok) failures.push(`the Wreck is broken: ${wreck.why[0]}`);
}

// Persistence: gold is banked on logout/death and survives reset; equipment
// does not follow the character offline.
let goldPersistence = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { goldPersistence.ok = false; goldPersistence.why.push(why); } };
  run([{ kind: "join", actorId: "p", name: "persist" }]);
  const actor = state.actors[0];
  Object.assign(actor, {
    key: "p", account: "p", name: "p", room: 1, level: 3, xp: 250,
    maxHp: maxHpForLevel(3), hp: maxHpForLevel(3), wielding: "sword-p",
  });
  state.accounts.p = {
    kind: "legacy", name: "p", characters: ["p"], passwordHash: null, salt: null,
    tokenHash: null, retired: false, mergedInto: null,
  };
  state.identities.p = {
    kind: "character", owner: "p", name: "p", role: 0, level: 3, xp: 250, gold: 0,
    guild: null, guildRank: null, quests: { active: [], completed: [] },
    spellbook: [], maxMana: 7, questCycles: {},
  };
  const coin = {
    id: "coin-p", name: "a gold coin", flags: ["takeable", "coin"], value: 10,
    holder: "p", room: null, inside: null, home: null, homeInside: null,
    worn: false, open: false, lit: false, eaten: false, forSale: false, ephemeral: true,
  };
  const sword = {
    id: "sword-p", name: "a short sword", flags: ["takeable", "weapon"], damage: 3,
    holder: "p", room: null, inside: null, home: 9, homeInside: null,
    worn: false, open: false, lit: false, eaten: false, forSale: false,
  };
  state.objects.push(coin, sword);
  run([{ kind: "leave", actorId: "p" }]);
  check(state.identities.p.gold === 10, "logout did not bank the carried gold");
  check(state.objects.find((object) => object.id === "coin-p")?.eaten === true, "logout left the carried coin in the world");
  check(state.objects.find((object) => object.id === "sword-p")?.holder === null && state.objects.find((object) => object.id === "sword-p")?.room === 1, "logout did not drop the sword where the character stood");
  check(state.identities.p.level === 3 && state.identities.p.xp === 250, "logout did not keep level and XP");

  run([{ kind: "join", actorId: "p2", name: "p" }]);
  run([{ kind: "login", actorId: "p2", key: "p", account: "p", token: null, authenticated: true }]);
  const returned = state.actors.find((entry) => entry.id === "p2");
  const bankCoin = state.objects.find((object) => object.holder === "p2" && (object.flags ?? []).includes("coin"));
  check(bankCoin?.value === 10, "login did not mint the banked gold");
  check(returned.wielding === null, "login restored a weapon");
  check(state.objects.find((object) => object.id === "sword-p")?.holder === null, "login restored the dropped sword");
  check(returned.level === 3 && returned.xp === 250, "login lost level or XP");

  const resetCoin = {
    id: "coin-reset", name: "a silver mark", flags: ["takeable", "coin"], value: 7,
    holder: "p2", room: null, inside: null, home: null, homeInside: null,
    worn: false, open: false, lit: false, eaten: false, forSale: false, ephemeral: true,
  };
  const resetSword = {
    id: "sword-reset", name: "a practice sword", flags: ["takeable", "weapon"], damage: 1,
    holder: "p2", room: null, inside: null, home: 116, homeInside: null,
    worn: false, open: false, lit: false, eaten: false, forSale: false,
  };
  state.objects.push(resetCoin, resetSword);
  returned.wielding = "sword-reset";
  state.pulses.area = { period: 1, remaining: 1 };
  run([]);
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  check(state.objects.find((object) => object.id === "coin-reset")?.holder === "p2", "the reset took held gold");
  check(state.objects.find((object) => object.id === "sword-reset")?.holder === null && state.objects.find((object) => object.id === "sword-reset")?.room === 116, "the reset did not return equipment home");
  check(state.actors.find((entry) => entry.id === "p2")?.wielding === null, "the reset left a weapon wielded");
  check(returned.level === 3 && returned.xp === 250, "the reset lost level or XP");
  state.pulses.area = { period: AREA_PERIOD, remaining: 1201 };
  const warningEvents = run([]);
  check(warningEvents.some((event) => /resets in 5 minutes/.test(event.text ?? "")), "the 5-minute reset warning is missing");
  state.pulses.area = { period: AREA_PERIOD, remaining: AREA_PERIOD };
  if (!goldPersistence.ok) failures.push(`persistence is broken: ${goldPersistence.why[0]}`);
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
  check(object("coin").eaten === true && object("coin").room === null, "the shop did not consume the payment");

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
  check(state.objects.every((o) => !o.ephemeral || (o.holder && (o.flags ?? []).includes("coin"))), "the reset left minted coins on the floor");
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
  state.actors[0].quests = { active: [{ id: "word", progress: {} }], completed: ["guardian"] };
  state.actors[0].standing = { ember: 4 };
  state.actors[0].components = { "ember-ore": 2 };
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
  check(state.identities.alice.guild === "wardens" && state.identities.alice.guildRank === "leader" && state.identities.alice.quests.completed.includes("guardian"), "guild or quest progress was lost on logout");
  check(state.identities.alice.standing?.ember === 4, "standing was lost on logout");
  check(state.identities.alice.components?.["ember-ore"] === 2, "forge components were lost on logout");

  run([{ kind: "join", actorId: "b", name: "alice" }]);
  run([{ kind: "login", actorId: "b", key: "alice", token: null, authenticated: true }]);
  const returning = state.actors.find((actor) => actor.id === "b");
  check(returning.room === 1, "the returning character did not wake at the start");
  check(returning.level === 3 && returning.xp === 120, "level or experience was not restored on login");
  check(returning.guild === "wardens" && returning.guildRank === "leader" && returning.quests.completed.includes("guardian"), "guild or quest progress was not restored on login");
  check(returning.standing?.ember === 4, "standing was not restored on login");
  check(returning.components?.["ember-ore"] === 2, "forge components were not restored on login");
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
  state.actors[0].xp = 100;
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  check(state.engagements.length === 2, "a PvE attack did not engage both sides");
  run([{ kind: "move", actorId: "a", dir: "east", to: 4 }]);
  check(state.engagements.length === 2 && state.actors[0].room === 2, "combat allowed movement");
  run([{ kind: "flee", actorId: "a", dir: "east", to: 4, messages: { actor: "FA", others: "FO" } }]);
  check(state.engagements.length === 0 && state.actors[0].room === 4, "flee did not move and end combat");
  check(state.actors[0].xp < 100, "flee did not cost experience");

  state.actors[0].room = 2;
  state.actors[0].xp = 95;
  const guard = state.npcs.find((npc) => npc.id === "guard");
  guard.hp = 1;
  guard.loot = ["boar-tusk"];
  run([{ kind: "attack", actorId: "a", targetId: "guard" }]);
  for (let i = 0; i < 120; i += 1) run([]);
  check(state.actors[0].level === 2 && state.actors[0].xp >= 107, `a kill did not grant experience and a level (level ${state.actors[0].level}, xp ${state.actors[0].xp})`);
  check(state.actors[0].maxHp === maxHpForLevel(2), `a level did not raise maximum hit points to ${maxHpForLevel(2)}`);
  const tusk = state.objects.find((object) => object.id === "boar-tusk");
  check(tusk.room === 2 && tusk.holder === null, "mob loot did not fall in the death room");

  // PvP: a second player in an unsafe room is a target; death wakes them at the
  // start and the killer gains experience.
  run([{ kind: "join", actorId: "b", name: "bob" }]);
  run([{ kind: "login", actorId: "b", key: "bob", token: null, authenticated: true }]);
  const bob = state.actors.find((actor) => actor.id === "b");
  bob.room = 2;
  bob.level = 3;
  bob.xp = 400;
  bob.maxHp = maxHpForLevel(3);
  bob.hp = 1;
  bob.deaths = 0;
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
  check(deadBob.level === 2 && deadBob.xp === 200 && deadBob.deaths === 1, `a PvP death did not cost XP and a level (level ${deadBob.level}, xp ${deadBob.xp}, deaths ${deadBob.deaths})`);
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
  const rat = state.npcs.find((npc) => npc.id === "sewer-rat");
  rat.room = 2; rat.home = 2; rat.period = 1; rat.jitter = 0; rat.aggression = 100; rat.behaviour = "wander"; rat.zone = null;
  const events = [];
  for (let i = 0; i < 8; i += 1) events.push(...run([]));
  if (state.engagements.length < 2) { aggression.ok = false; aggression.why.push("a guardian did not engage both sides"); }
  if (!events.some((event) => /attacks you/.test(event.text ?? ""))) { aggression.ok = false; aggression.why.push("the victim was not told"); }
  for (let i = 0; i < 12; i += 1) run([]);
  if (state.npcs.find((npc) => npc.id === "sewer-rat")?.room !== 2) { aggression.ok = false; aggression.why.push("an engaged mobile wandered out of the fight"); }
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
  const archive = loadQuestArchive();
  const check = (condition, why) => { if (!condition) { quests.ok = false; quests.why.push(why); } };
  check(questTable.quests.length === 25, `the live quest count is ${questTable.quests.length}, not 25`);
  check(archive.quests.length === 41 && archive.errors.length === 0, "the retired quest archive is not 41 valid definitions");
  const liveIds = new Set(questTable.quests.map((quest) => quest.id));
  const archiveIds = new Set(archive.quests.map((quest) => quest.id));
  check([...liveIds].every((id) => !archiveIds.has(id)), "a quest is both live and archived");
  check(questTable.quests.every((quest) => (quest.requires ?? []).every((id) => liveIds.has(id))), "a kept quest requires a retired quest");
  for (const problem of validateQuestReferences(archive.quests, { rooms: world.rooms, npcs: world.npcs, objects: world.objects })) {
    quests.ok = false;
    quests.why.push(`archive: ${problem}`);
  }
  const migrated = migrateQuestState({
    active: [
      { id: "ember-door", progress: { visits: [61, 70], collected: { "first-coal": 1 } } },
      { id: "fen-heart", progress: {} },
      { id: "guardian", progress: {} },
    ],
    completed: ["scroll", "word"],
  }, questTable.quests, archive.quests);
  check(migrated.quests.active.length === 1 && migrated.quests.active[0].id === "guardian", "migration dropped a live active quest");
  check(migrated.quests.completed.length === 2 && migrated.quests.completed.includes("word") && migrated.quests.completed.includes("scroll"), "migration kept a retired completion");
  check(migrated.notes.length === 2 && migrated.notes.find((note) => note.id === "ember-door")?.status === "completed" && migrated.notes.find((note) => note.id === "fen-heart")?.status === "abandoned", "migration notes are wrong");
  const npcs = world.npcs.filter((npc) => npc.id !== "vault-guardian");
  let state = initialState(world.rooms, npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const say = (text) => ({ actor: text, others: text });
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const object = (id) => state.objects.find((o) => o.id === id);
  const questState = () => state.actors[0].quests;

  run([{ kind: "join", actorId: "a", name: "alice" }]);
  run([{ kind: "login", actorId: "a", key: "alice", token: null, authenticated: true }]);

  state.actors[0].level = 2;
  run([{ kind: "questAccept", actorId: "a", questId: "guardian" }]);
  check(!questState().active.some((entry) => entry.id === "guardian"), "a quest whose prerequisite was unearned was accepted");
  state.actors[0].level = 1;

  state.actors[0].level = 2;
  run([{ kind: "questAccept", actorId: "a", questId: "telescope" }]);
  check(questState().active.some((entry) => entry.id === "telescope"), "a quest was not accepted");
  state.actors[0].room = 32;
  run([{ kind: "take", actorId: "a", objectId: "telescope", messages: say("take") }]);
  check(questState().completed.includes("telescope"), "a collect quest did not complete when the item was held");
  check(questState().active.length === 0, "a completed quest stayed active");
  check(state.actors[0].xp >= 30, "a quest did not pay experience");
  run([{ kind: "questAccept", actorId: "a", questId: "telescope" }]);
  check(questState().active.length === 0, "a completed quest could be accepted again");
  state.actors[0].room = 2;

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

// Repeatable work is covered by the guild trial in the Lantern block.

// Social quests: talking to a named mobile advances a talk objective.
let social = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { social.ok = false; social.why.push(why); } };
  state.actors.push({ id: "s", key: "social", account: "social", name: "social", room: 8, visited: [8], level: 2, xp: 100, maxHp: 12, hp: 12, maxMana: 7, mana: 7, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, found: [] });
  run([{ kind: "questAccept", actorId: "s", questId: "hall-word" }]);
  let actor = state.actors.find((entry) => entry.id === "s");
  check(actor.quests.active.some((entry) => entry.id === "hall-word"), "the social quest was not accepted");
  run([{ kind: "talk", actorId: "s", npcId: "market-woman" }]);
  actor = state.actors.find((entry) => entry.id === "s");
  actor.room = 24;
  run([{ kind: "talk", actorId: "s", npcId: "guild-clerk" }]);
  actor = state.actors.find((entry) => entry.id === "s");
  check(actor.quests.completed.includes("hall-word"), "the social quest did not complete");
  check(actor.xp >= 170, "the social quest did not pay its xp");
  if (social.why.length) { social.ok = false; failures.push(`the social quest is broken: ${social.why[0]}`); }
}

// Ignore lists are persistent, and they cover every addressed channel: tells,
// mail, global chat, guild chat, socials and the room's account of a say.
let ignore = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { ignore.ok = false; ignore.why.push(why); } };
  const lines = (events) => events.filter((event) => event.onlyId !== undefined);
  run([{ kind: "join", actorId: "a", name: "alice" }, { kind: "join", actorId: "b", name: "bob" }]);
  run([{ kind: "login", actorId: "a", key: "alice", authenticated: true }, { kind: "login", actorId: "b", key: "bob", authenticated: true }]);
  run([{ kind: "ignore", actorId: "b", targetKey: "alice", messages: { added: "IG" } }]);
  check(state.actors.find((entry) => entry.id === "b")?.ignored?.includes("alice"), "the ignore was not stored on the actor");
  check(state.identities.bob?.ignored?.includes("alice"), "the ignore was not stored on the identity");
  const told = lines(run([{ kind: "tell", actorId: "a", targetId: "b", messages: { actor: "TA", target: "TB" } }]));
  check(told.length === 1 && told[0].text.includes("not listening"), "an ignored tell reached its target");
  const channel = lines(run([{ kind: "channel", actorId: "a", channelId: "global", messages: { actor: "CA", others: "CO" } }]));
  check(channel.length === 1 && channel[0].onlyId === "a", "an ignored global line reached the listener");
  const social = lines(run([{ kind: "social", actorId: "a", targetId: null, messages: { actor: "UA", others: "UO", target: "UT", targeted: "UYOU", targetOthers: "UTO", self: "US", selfOthers: "USO" } }]));
  check(social.length === 1 && social[0].onlyId === "a", "an ignored social reached the listener");
  const mailed = lines(run([{ kind: "mail", actorId: "a", toKey: "bob", text: "hidden", messages: { actor: "MA", target: "MB" } }]));
  check(mailed.length === 1 && mailed[0].text.includes("not accepting"), "an ignored letter was accepted or delivered");
  check((state.mail ?? []).length === 0, "an ignored letter was stored");
  const sayEvents = run([{ kind: "say", actorId: "a", text: "hello", messages: { actor: "SA", others: "SO" } }]);
  check(sayEvents.some((event) => event.fromKey === "alice"), "a say did not carry the speaker key for delivery filtering");
  run([{ kind: "unignore", actorId: "b", targetKey: "alice", messages: { removed: "UG" } }]);
  check(!(state.actors.find((entry) => entry.id === "b")?.ignored ?? []).includes("alice"), "the unignore did not clear the list");
  const again = lines(run([{ kind: "tell", actorId: "a", targetId: "b", messages: { actor: "TA2", target: "TB2" } }]));
  check(again.length === 2, "a tell was still blocked after unignore");
  checkpointIdentities(state);
  check(state.identities.bob?.ignored?.length === 0, "the ignore list did not survive a checkpoint");
  if (ignore.why.length) { ignore.ok = false; failures.push(`the ignore list is broken: ${ignore.why[0]}`); }
}

// Titles are earned facts: one completed quest unlocks one title, and the
// chosen title is part of the character.
let titles = { ok: true, why: [] };
{
  const table = loadTitles();
  const check = (condition, why) => { if (!condition) { titles.ok = false; titles.why.push(why); } };
  check(table.errors.length === 0, `title validation failed: ${table.errors[0] ?? ""}`);
  for (const title of table.titles) {
    if (title.completion === true) continue;
    if (!questTable.quests.some((quest) => quest.id === title.quest)) {
      titles.ok = false;
      titles.why.push(`${title.id} names unknown quest ${title.quest}`);
    }
  }
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  state.actors.push({ id: "t", key: "titled", account: "titled", name: "titled", room: 1, visited: [1], level: 10, xp: 30000, maxHp: 28, hp: 28, maxMana: 27, mana: 27, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: ["first-steps", "guild-dawn"] }, ignored: [], title: null });
  const earned = earnedTitles(table.titles, state.actors[0].quests.completed);
  check(earned.length === 2, "the earned titles do not follow completed quests");
  check(table.titles.some((title) => title.id === "dawnbringer" && title.quest === "guild-dawn"), "the dawn title is missing");
  check(table.titles.some((title) => title.id === "worldbreaker" && title.completion === true), "the Worldbreaker title is missing");
  check(earnedTitles(table.titles, [], false).length === 0, "a completion title was earned without a completed run");
  check(earnedTitles(table.titles, [], true).some((title) => title.id === "worldbreaker"), "the Worldbreaker title was not earned by a completed run");
  run([{ kind: "setTitle", actorId: "t", title: "Dawnbringer" }]);
  let actor = state.actors.find((entry) => entry.id === "t");
  check(actor.title === "Dawnbringer", "the title was not worn");
  checkpointIdentities(state);
  check(state.identities.titled?.title === "Dawnbringer", "the title did not survive a checkpoint");
  run([{ kind: "setTitle", actorId: "t", title: null }]);
  actor = state.actors.find((entry) => entry.id === "t");
  check(actor.title === null, "the title was not cleared");
  if (titles.why.length) { titles.ok = false; failures.push(`titles are broken: ${titles.why[0]}`); }
}

// The win condition: max level, every live quest and every hidden way. The
// tally is derived; the first completion is recorded permanently.
let completion = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const quests = loadQuests();
  const levelTable = loadLevels();
  const ways = secretWays(world.rooms);
  const allQuests = quests.quests.map((quest) => quest.id);
  const check = (condition, why) => { if (!condition) { completion.ok = false; completion.why.push(why); } };
  check(ways.length === 25, `the hidden-way count is ${ways.length}, not 25`);
  const base = {
    level: 10, xp: 30000, quests: { active: [], completed: allQuests }, found: [...ways],
  };
  const done = completionState({ actor: base, rooms: world.rooms, quests: quests.quests, levels: levelTable.levels });
  check(done.done && done.achieved && done.quests === 25 && done.questsTotal === 25 && done.puzzles === 25 && done.puzzlesTotal === 25 && done.maxLevel === 10, "the completed tally is wrong");
  check(completionLine(done).includes("Run beaten") && completionLine(done).includes(WORLDBREAKER_TITLE), "the completion line is wrong");
  check(!completionState({ actor: { ...base, level: 9 }, rooms: world.rooms, quests: quests.quests, levels: levelTable.levels }).done, "level 9 counted as a completed run");
  check(!completionState({ actor: { ...base, quests: { active: [], completed: allQuests.slice(1) } }, rooms: world.rooms, quests: quests.quests, levels: levelTable.levels }).done, "a missing quest counted as a completed run");
  check(!completionState({ actor: { ...base, found: ways.slice(1) }, rooms: world.rooms, quests: quests.quests, levels: levelTable.levels }).done, "a missing hidden way counted as a completed run");
  const kept = completionState({ actor: { ...base, level: 9, found: [], quests: { active: [], completed: [] }, completion: { tick: 42 } }, rooms: world.rooms, quests: quests.quests, levels: levelTable.levels });
  check(kept.achieved && !kept.done && kept.achievedAt === 42, "a recorded run did not survive a later reduced tally");

  let state = initialState(world.rooms, [], [], 1, world.climate, channelTable.channels, levelTable.levels, quests.quests);
  state.actors.push({
    id: "w", key: "w", account: "w", name: "w", room: 1, visited: [1],
    level: 10, xp: 30000, maxHp: maxHpForLevel(10), hp: maxHpForLevel(10), mana: 5, maxMana: 5,
    spellbook: [], guild: null, guildRank: null, wielding: null,
    quests: { active: [], completed: allQuests }, found: [...ways], completion: null, title: null,
  });
  state.identities.w = { kind: "character", owner: "w", name: "w", level: 10, xp: 30000, quests: { active: [], completed: allQuests }, found: [...ways], title: null };
  const first = step({ state, rooms: world.rooms, intents: [], actions: [] });
  state = first.state;
  const actor = state.actors.find((entry) => entry.id === "w");
  check(Number.isInteger(actor.completion?.tick) && actor.completion.level === 10 && actor.completion.quests === 25 && actor.completion.puzzles === 25, "the reducer did not record the completed run");
  check(actor.title === WORLDBREAKER_TITLE, "the completed run did not wear the Worldbreaker title");
  check(first.events.some((event) => event.completion && event.onlyId === "w"), "the completed run did not announce itself");
  const record = { ...actor.completion };
  const second = step({ state, rooms: world.rooms, intents: [], actions: [] });
  state = second.state;
  check(state.actors.find((entry) => entry.id === "w").completion.tick === record.tick, "the completed run was recorded twice");
  checkpointIdentities(state);
  check(state.identities.w?.found?.length === 25, "the found hidden ways did not survive a checkpoint");
  check(state.identities.w?.completion?.tick === record.tick, "the completed run did not survive a checkpoint");
  check(state.identities.w?.title === WORLDBREAKER_TITLE, "the Worldbreaker title did not survive a checkpoint");
  if (!completion.ok) failures.push(`completion is broken: ${completion.why[0]}`);
}

// The Memory Garden is exploration now: facts, a fact-gated action and the
// rooms survive, while the retired Garden quests do not.
let memoryGarden = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  const table = loadActions({ world });
  const facts = loadFacts();
  const check = (condition, why) => { if (!condition) { memoryGarden.ok = false; memoryGarden.why.push(why); } };
  check(table.errors.length === 0, `action validation failed: ${table.errors[0] ?? ""}`);
  check(facts.errors.length === 0, `fact validation failed: ${facts.errors[0] ?? ""}`);
  check(facts.byWord.has("garden") && facts.byWord.has("ledger") && facts.byWord.has("crescent"), "a garden fact is missing");
  check(!questTable.quests.some((quest) => quest.id === "memory-garden"), "the retired memory quest is still loaded");
  check(world.rooms[98]?.exits?.east === 99 && world.rooms[98]?.exits?.north === 100 && world.rooms[100]?.exits?.south === 98, "the Memory Garden is not connected");
  check(world.rooms[8]?.exits?.down === 105 && world.rooms[105]?.exits?.up === 8, "the root road is not connected to Market Square");
  check(world.rooms[104]?.exits?.down === 106 && world.rooms[106]?.exits?.up === 104, "the orchard is not connected to the root road");
  check(world.rooms[109]?.exits?.north === 111 && world.rooms[112]?.exits?.east === 113 && world.rooms[113]?.exits?.north === 114, "the orchard undercroft or cider spring exits are wrong");
  check(findAction(table.actions, { verb: "plant", target: "rose", room: 98 })?.id === "plant-memory", "plant rose does not resolve");
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents, actions: table.actions }); state = result.state; return result.events; };
  state.actors.push({ id: "mq", key: "memory", account: "memory", name: "memory", room: 98, visited: [98], level: 4, xp: 400, maxHp: 18, hp: 18, maxMana: 11, mana: 11, spellbook: [], guild: null, guildRank: null, wielding: null, quests: { active: [], completed: [] }, ignored: [], memory: { facts: {} }, found: [] });
  state.objects.find((object) => object.id === "memory-rose").holder = "mq";
  run([{ kind: "action", actorId: "mq", actionId: "plant-memory", messages: { actor: "planted", others: "plants" } }]);
  let actor = state.actors.find((entry) => entry.id === "mq");
  check(!(actor.found ?? []).includes("98:down"), "the fact-gated action opened without the fact");
  run([{ kind: "learnFact", actorId: "mq", fact: facts.byWord.get("garden") }]);
  actor = state.actors.find((entry) => entry.id === "mq");
  check(actor.memory?.facts?.["garden-word"]?.word === "garden", "the garden fact was not learned");
  run([{ kind: "action", actorId: "mq", actionId: "plant-memory", messages: { actor: "planted", others: "plants" } }]);
  actor = state.actors.find((entry) => entry.id === "mq");
  check(actor.found.includes("98:down"), "the fact-gated action did not reveal the stair");
  check(state.objects.find((object) => object.id === "memory-rose")?.eaten === true, "the planted rose was not consumed");
  run([{ kind: "move", actorId: "mq", dir: "down", to: 101 }]);
  actor = state.actors.find((entry) => entry.id === "mq");
  check(actor.room === 101, "the hidden Remembered Bed was not reachable");
  check(!loadTitles().titles.some((title) => title.quest === "remembered-bed"), "a retired Garden title is still loaded");
  if (memoryGarden.why.length) { memoryGarden.ok = false; failures.push(`the Memory Garden is broken: ${memoryGarden.why[0]}`); }
}

// Guilds: one name, a roster, ranks, a chat that reaches only members, and a
// membership that survives a restart.
let guilds = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { guilds.ok = false; guilds.why.push(why); } };
  check(guildLevelFor(1600) === 6 && perksFor(6).includes("guild-quest-3"), "guild level 6 or its third-quest perk is missing");
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

// The guild vault is per guild, survives a reset and a restart, and releases
// its goods into the shared hall when the guild disbands.
let guildVault = { ok: true, why: [] };
{
  const world = loadWorld({ mode: "single" });
  let state = initialState(world.rooms, world.npcs, world.objects, world.start, world.climate, channelTable.channels, undefined, questTable.quests);
  const run = (intents) => { const result = step({ state, rooms: world.rooms, intents }); state = result.state; return result.events; };
  const check = (condition, why) => { if (!condition) { guildVault.ok = false; guildVault.why.push(why); } };
  run([{ kind: "join", actorId: "v", name: "vera" }, { kind: "login", actorId: "v", key: "vera", authenticated: true }]);
  run([{ kind: "guildCreate", actorId: "v", name: "Vaulters", guildId: "vaulters" }]);
  const actor = state.actors.find((entry) => entry.id === "v");
  actor.room = GUILD_HALL;
  actor.visited = [...new Set([...actor.visited, GUILD_HALL])];
  const sword = state.objects.find((object) => object.id === "sword");
  sword.holder = "v";
  sword.room = null;
  sword.heldRoom = GUILD_HALL;
  run([{ kind: "guildDeposit", actorId: "v", objectId: "sword" }]);
  check(state.guilds.vaulters.vault.includes("sword"), "the sword was not recorded in the vault");
  check(state.objects.find((object) => object.id === "sword")?.holder === guildVaultHolder("vaulters"), "the sword did not move into guild storage");
  check(state.guilds.vaulters.vault.length <= GUILD_VAULT_CAPACITY, "the vault exceeded its capacity");
  run([{ kind: "guildWithdraw", actorId: "v", objectId: "sword" }]);
  check(state.objects.find((object) => object.id === "sword")?.holder === "v" && !state.guilds.vaulters.vault.includes("sword"), "the sword was not withdrawn");
  run([{ kind: "guildDeposit", actorId: "v", objectId: "sword" }]);
  const satchel = state.objects.find((object) => object.id === "satchel");
  satchel.holder = "v";
  satchel.room = null;
  satchel.heldRoom = GUILD_HALL;
  const bread = state.objects.find((object) => object.id === "bread");
  bread.holder = null;
  bread.room = null;
  bread.inside = "satchel";
  run([{ kind: "guildDeposit", actorId: "v", objectId: "satchel" }]);
  state.pulses.area = { period: AREA_PERIOD, remaining: 1 };
  run([]);
  check(state.objects.find((object) => object.id === "sword")?.holder === guildVaultHolder("vaulters"), "the area reset pulled the vault sword onto the floor");
  check(state.objects.find((object) => object.id === "satchel")?.holder === guildVaultHolder("vaulters"), "the area reset pulled the vault satchel onto the floor");
  check(state.objects.find((object) => object.id === "bread")?.inside === "satchel", "the area reset spilled a vault container's contents");
  const restarted = JSON.parse(JSON.stringify(state));
  const savedActors = state.actors;
  restarted.actors = [];
  releaseHeldObjects(restarted, savedActors);
  check(restarted.objects.find((object) => object.id === "sword")?.holder === guildVaultHolder("vaulters"), "a restart emptied the guild vault");
  run([{ kind: "guildDisband", actorId: "v" }]);
  check(!state.guilds.vaulters, "the guild was not disbanded");
  check(state.objects.find((object) => object.id === "sword")?.holder === null && state.objects.find((object) => object.id === "sword")?.room === GUILD_HALL, "disbanding did not release the vault goods");
  check(state.objects.find((object) => object.id === "satchel")?.room === GUILD_HALL && state.objects.find((object) => object.id === "bread")?.inside === "satchel", "disbanding did not release the container with its contents");
  if (guildVault.why.length) { guildVault.ok = false; failures.push(`the guild vault is broken: ${guildVault.why[0]}`); }
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

// A release is a tagged, hash-manifested artifact; the pull deployer verifies it.
let releaseManifest = { ok: true, why: [] };
{
  const check = (condition, why) => { if (!condition) { releaseManifest.ok = false; releaseManifest.why.push(why); } };
  const dir = mkdtempSync(join(tmpdir(), "mudbench-release-"));
  const holo = join(dir, "MUDBench.holo");
  const runtime = join(dir, "runtime.tar.gz");
  const out = join(dir, "release-manifest.json");
  writeFileSync(holo, "holo");
  writeFileSync(runtime, "runtime");
  const run = spawnSync("python3", [
    join(root, "deploy/release-manifest.py"),
    "--tag", "v9.9.9", "--commit", "abc", "--gate-run", "123",
    "--holo", holo, "--runtime", runtime, "--out", out,
  ], { cwd: root, encoding: "utf8" });
  check(run.status === 0, `release manifest exited ${run.status}: ${(run.stderr ?? "").slice(0, 160)}`);
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(out, "utf8")); } catch {}
  check(manifest?.schema === "mudbenchmark/release/1" && manifest?.tag === "v9.9.9", "release manifest shape/tag is wrong");
  check(manifest?.assets?.["MUDBench.holo"]?.sha256 === createHash("sha256").update("holo").digest("hex"), "release manifest holo hash is wrong");
  check(manifest?.assets?.["runtime.tar.gz"]?.size === 7, "release manifest runtime size is wrong");
  const deployScript = readFileSync(join(root, "deploy/mudbench-deploy.sh"), "utf8");
  check(deployScript.includes("release-manifest.json") && deployScript.includes("ALLOW_UNMANIFESTED"), "deployer does not verify the release manifest");
  check(deployScript.includes("--ignore-scripts"), "deployer installs runtime scripts");
  const publishWorkflow = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");
  check(publishWorkflow.includes("workflow_run") && publishWorkflow.includes("merged_at") && publishWorkflow.includes("merge_commit_sha") && publishWorkflow.includes(`base.ref == "main"`), "merged-PR publisher is missing or does not require the merge commit");
  check(publishWorkflow.includes("release-manifest.py") && publishWorkflow.includes("AUTO_RELEASE"), "publisher lacks the manifest or pause switch");
  rmSync(dir, { recursive: true, force: true });
  if (releaseManifest.why.length) failures.push(`release publishing is broken: ${releaseManifest.why[0]}`);
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
  console.log(`${"webAI".padEnd(26)}  ${(webAI.ok ? "22 checks" : "BROKEN").padStart(5)}   == parse, prompt, urls, keys, state`);
  console.log(`${"prismId".padEnd(26)}  ${(prismSession.ok ? "signed" : "BROKEN").padStart(5)}   == session verifier`);
  console.log(`${"sessionKey".padEnd(26)}  ${(sessionChallenge.ok ? "signed" : "BROKEN").padStart(5)}   == nonce, counter, key`);
  console.log(`${"prismLogin".padEnd(26)}  ${(prismLogin.ok ? "account" : "BROKEN").padStart(5)}   == id, character`);
  console.log(`${"state".padEnd(26)}  ${(durableState.ok ? "5 checks" : "BROKEN").padStart(5)}   == atomic, backup, fail-loud`);
  console.log(`${"claim".padEnd(26)}  ${(claim.ok ? "adds char" : "BROKEN").padStart(5)}   == owner, tombstone`);
  console.log(`${"rebind".padEnd(26)}  ${(rebind.ok ? "token, prism" : "BROKEN").padStart(5)}   == owner, online, once`);
  console.log(`${"delete".padEnd(26)}  ${(deletion.ok ? "bare only" : "BROKEN").padStart(5)}   == no refs, no progress`);
  console.log(`${"audit".padEnd(26)}  ${(audit.ok ? "read-only" : "BROKEN").padStart(5)}   == kinds, credentials`);
  console.log(`${"accountDel".padEnd(26)}  ${(accountDelete.ok ? "bare only" : "BROKEN").padStart(5)}   == no chars, pin`);
  console.log(`${"accountWipe".padEnd(26)}  ${(accountWipe.ok ? "all players" : "BROKEN").padStart(5)}   == accounts, pins, refs`);
  console.log(`${"stream".padEnd(26)}  ${(stream.ok ? "public" : "BROKEN").padStart(5)}   == filters, events, watch`);
  console.log(`${"telemetry".padEnd(26)}  ${(telemetry.ok ? "trends" : "BROKEN").padStart(5)}   == ai, world, clients`);
  console.log(`${"aliases".padEnd(26)}  ${(aliases.ok ? "short" : "BROKEN").padStart(5)}   == get, eq, status`);
  console.log(`${"equipment".padEnd(26)}  ${(equipment.ok ? "8 slots" : "BROKEN").padStart(5)}   == wear, wield, replace`);
  console.log(`${"magic".padEnd(26)}  ${(magic.ok ? "6 spells+scrolls" : "BROKEN").padStart(5)}   == mana, cast, study`);
  console.log(`${"lantern".padEnd(26)}  ${(lantern.ok ? "60 rooms" : "BROKEN").padStart(5)}   == errand, charm, secret`);
  console.log(`${"actions".padEnd(26)}  ${(actions.ok ? "11 verbs" : "BROKEN").padStart(5)}   == reveal, open, last`);
  console.log(`${"ember".padEnd(26)}  ${(ember.ok ? "10 rooms" : "BROKEN").padStart(5)}   == door, chest, shortcut`);
  console.log(`${"aiMemory".padEnd(26)}  ${(aiMemory.ok ? "rooms, stale" : "BROKEN").padStart(5)}   == exits, loop guard`);
  console.log(`${"characterNames".padEnd(26)}  ${(characterNames.ok ? "random, scoped" : "BROKEN").padStart(5)}   == AI, human`);
  console.log(`${"releaseManifest".padEnd(26)}  ${(releaseManifest.ok ? "hash, tag" : "BROKEN").padStart(5)}   == pull deploy`);
  console.log(`${"guildLine".padEnd(26)}  ${(lantern.ok ? "2 quests" : "BROKEN").padStart(5)}   == archmage`);
  console.log(`${"archmageTrial".padEnd(26)}  ${(lantern.ok ? "2 cycles" : "BROKEN").padStart(5)}   == repeat`);
  console.log(`${"fen".padEnd(26)}  ${(fen.ok ? "10 rooms" : "BROKEN").padStart(5)}   == key, chest, shortcut`);
  console.log(`${"visibility".padEnd(26)}  ${(visibility.ok ? "levels, map" : "BROKEN").padStart(5)}   == board, shortcuts`);
  console.log(`${"salt".padEnd(26)}  ${(salt.ok ? "5 rooms" : "BROKEN").padStart(5)}   == key, chest, shortcut`);
  console.log(`${"moon".padEnd(26)}  ${(moon.ok ? "6 rooms" : "BROKEN").padStart(5)}   == key, chest, shortcut`);
  console.log(`${"eclipse".padEnd(26)}  ${(eclipse.ok ? "6 rooms" : "BROKEN").padStart(5)}   == chest, regent, gate`);
  console.log(`${"firstSteps".padEnd(26)}  ${(firstSteps.ok ? "20 xp" : "BROKEN").padStart(5)}   == tour, quest`);
  console.log(`${"pinned".padEnd(26)}  ${(identityPin.ok ? "revoked" : "BROKEN").padStart(5)}   == old log refused`);
  console.log(`${"takeover".padEnd(26)}  ${(takeover.ok ? "1 actor" : "BROKEN").padStart(5)}   == leave then login`);
  console.log(`${"characters".padEnd(26)}  ${(characters.ok ? "2 chars" : "BROKEN").padStart(5)}   == create, switch`);
  console.log(`${"prismTransfer".padEnd(26)}  ${(prismTransfer.ok ? "signed" : "BROKEN").padStart(5)}   == old AI, human`);
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
  console.log(`${"levelCap".padEnd(26)}  ${(levelCap.ok ? "10 @ 30k" : "BROKEN").padStart(5)}   == level table`);
  console.log(`${"guildVault".padEnd(26)}  ${(guildVault.ok ? "20 slots" : "BROKEN").padStart(5)}   == deposit, reset, disband`);
  console.log(`${"social".padEnd(26)}  ${(social.ok ? "70 xp" : "BROKEN").padStart(5)}   == talk, quest`);
  console.log(`${"controls".padEnd(26)}  ${(controls.ok ? "t, all, drink" : "BROKEN").padStart(5)}   == short commands`);
  console.log(`${"factions".padEnd(26)}  ${(factionAllows({ ember: 6 }, "ember", 6) ? "6 contacts" : "BROKEN").padStart(5)}   == standing, shops`);
  console.log(`${"outlaws".padEnd(26)}  ${(nightBonus({ guild: "night-market", guildRank: "master" }).damage === 1 ? "Night Market" : "BROKEN").padStart(5)}   == guild, factions`);
  console.log(`${"techniques".padEnd(26)}  ${(techniques.ok ? "7 weapon moves" : "BROKEN").padStart(5)}   == cooldown, stun`);
  console.log(`${"lore".padEnd(26)}  ${(loadWorld({ mode: "single" }).objects.some((object) => object.id === "ember-ledger") ? "5 books" : "BROKEN").padStart(5)}   == retired zones`);
  console.log(`${"forge".padEnd(26)}  ${(forge.ok ? "+1, salvage" : "BROKEN").padStart(5)}   == components, sets`);
  console.log(`${"worldEvent".padEnd(26)}  ${(worldEvent.ok ? "Ember Tide" : "BROKEN").padStart(5)}   == rotation, ladder`);
  console.log(`${"balanceBands".padEnd(26)}  ${(balanceBands.ok ? "PvE, PvP" : "BROKEN").padStart(5)}   == seeded bands`);
  console.log(`${"chatGuard".padEnd(26)}  ${(chatGuard.ok ? "8/10s" : "BROKEN").padStart(5)}   == rate limit`);
  console.log(`${"moderation".padEnd(26)}  ${(moderation.ok ? "names, report" : "BROKEN").padStart(5)}   == new-name policy`);
  console.log(`${"playerStats".padEnd(26)}  ${(playerStats.ok ? "sessions, quests" : "BROKEN").padStart(5)}   == aggregate only`);
  console.log(`${"ignore".padEnd(26)}  ${(ignore.ok ? "5 paths" : "BROKEN").padStart(5)}   == tell, mail, chat`);
  console.log(`${"titles".padEnd(26)}  ${(titles.ok ? "2 earned" : "BROKEN").padStart(5)}   == select, persist`);
  console.log(`${"memoryGarden".padEnd(26)}  ${(memoryGarden.ok ? "rooms, rose" : "BROKEN").padStart(5)}   == fact, action`);
  console.log(`${"quests".padEnd(26)}  ${(quests.ok ? "accept, advance, pay" : "BROKEN").padStart(5)}   == facts, once`);
  console.log(`${"aggression".padEnd(26)}  ${(aggression.ok ? "1 duel" : "BROKEN").padStart(5)}   == mobs start fights`);
  console.log(`${"combat2".padEnd(26)}  ${(combat2.ok ? "weapons, armour, xp" : "BROKEN").padStart(5)}   == fight and grow`);
  console.log(`${"deepdelve".padEnd(26)}  ${(deepdelve.ok ? "16 rooms, party, gas" : "BROKEN").padStart(5)}   == mine, winch, canary`);
  console.log(`${"completion".padEnd(26)}  ${(completion.ok ? "level, quests, ways" : "BROKEN").padStart(5)}   == Worldbreaker`);
  console.log(`${"foundry".padEnd(26)}  ${(foundry.ok ? "12 rooms, party, valve" : "BROKEN").padStart(5)}   == drowned forge`);
  console.log(`${"zones".padEnd(26)}  ${(zoneMap.ok ? "17 districts" : "BROKEN").padStart(5)}   == harbor, undercroft, eclipse`);
  console.log(`${"startRooms".padEnd(26)}  ${(startRooms.ok ? "scene, senses" : "BROKEN").padStart(5)}   == 18 opening rooms`);
  console.log(`${"monastery".padEnd(26)}  ${(monastery.ok ? "14 rooms, bell, crypt" : "BROKEN").padStart(5)}   == key, party, abbot`);
  console.log(`${"wreck".padEnd(26)}  ${(wreck.ok ? "12 rooms, skiff, glass" : "BROKEN").padStart(5)}   == boat, capstan, captain`);
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
