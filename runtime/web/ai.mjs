// The browser AI player: provider metadata, prompt construction, reply parsing
// and request shapes. This module has no DOM and no server dependency, so the
// gate can test the parts that decide what the model sees and what command it
// sends.
//
// The game server never sees a provider key. The key lives in the browser's
// localStorage and goes only to the provider's own endpoint.

export const PROVIDERS = {
  groq: {
    label: "Groq (free key, fast)",
    base: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    needsKey: true,
    keyMode: "required",
    hint: "Create a free key at console.groq.com/keys. The free tier is fast (about 30 requests/minute, 1,000/day for the 20B model); the key stays in this browser and goes only to api.groq.com.",
  },
  ollama: {
    label: "Ollama (local)",
    base: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    needsKey: false,
    keyMode: "none",
    hint: "Run `ollama serve`, then `ollama pull qwen2.5:7b`. Use a 7B or larger model for coherent play; tiny models tend to repeat. If this page is not on localhost, start Ollama with OLLAMA_ORIGINS=https://play.r4labs.org (or *).",
  },
  openai: {
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
    keyMode: "required",
    hint: "The key stays in this browser and is sent only to api.openai.com.",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    base: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    needsKey: true,
    keyMode: "required",
    hint: "The key stays in this browser and is sent only to api.anthropic.com. The direct-browser header is set for you.",
  },
  deepseek: {
    label: "DeepSeek (API key)",
    base: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    needsKey: true,
    keyMode: "required",
    hint: "Low-cost paid API. Create a key at platform.deepseek.com; it stays in this browser and goes only to api.deepseek.com. Use deepseek-flash for speed or deepseek-v4-pro for harder turns.",
  },
  custom: {
    label: "OpenAI-compatible (custom)",
    base: "http://localhost:8080/v1",
    model: "local-model",
    needsKey: false,
    keyMode: "optional",
    hint: "Any OpenAI-compatible /v1/chat/completions endpoint. Add a key if the gateway needs one; it stays in this browser.",
  },
  "prime-router": {
    label: "Prime Router (hypersphere, local)",
    base: "http://localhost:8000",
    model: "prime",
    needsKey: false,
    keyMode: "none",
    hint: "Run Prime Router locally on :8000. It adds the hypersphere injection before the model call.",
  },
};

export function isThrottledStatus(status) {
  return status === 402 || status === 429;
}

// Retry-After is either delta-seconds or an HTTP date. Return milliseconds, or
// null when the header is missing or unparseable.
export function retryAfterMs(headers, now = Date.now()) {
  const raw = headers?.get?.("retry-after") ?? headers?.["retry-after"];
  if (raw == null || raw === "") return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

// What the client should wait after a throttle. Use Retry-After when the
// provider sends it; otherwise wait a short default before trying again.
export function throttleWaitMs(provider, headers, now = Date.now()) {
  const retry = retryAfterMs(headers, now);
  if (retry !== null) return retry;
  return 15_000;
}

export const MAX_THROTTLE_WAIT_MS = 120_000;
export const MAX_THROTTLE_RETRIES = 3;

// A rate limit is only worth retrying inside the session if the server says the
// wait is short and we have not already burned the retry budget. A daily quota
// (hours of Retry-After) pauses the agent instead of leaving it in a long wait.
export function throttlePlan({ provider, headers, attempt = 1, now = Date.now() }) {
  const waitMs = Math.max(1000, throttleWaitMs(provider, headers, now));
  return { waitMs, retry: waitMs <= MAX_THROTTLE_WAIT_MS && attempt <= MAX_THROTTLE_RETRIES };
}


// Accept the URL a provider's docs actually show: a bare host, a base with a
// trailing slash, or the full chat endpoint. The client always appends the
// path itself, so normalize before it does.
export function normalizeBase(input) {
  let value = String(input ?? "").trim();
  if (!value) return "";
  if (value.startsWith("/")) return value.replace(/\/+$/, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const local = /^(localhost|127\.|\[::1\])/i.test(value);
    value = `${local ? "http" : "https"}://${value}`;
  }
  try {
    const url = new URL(value);
    let path = url.pathname.replace(/\/+$/, "");
    path = path.replace(/\/(chat\/completions|messages)$/i, "");
    return `${url.origin}${path}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

export const COMMANDS = `look, look <thing>, examine <thing>, who, say <text>, global <text>,
tell <name> <text>, mail <name> <text>, channels, answer <word>, claim <word>,
claim unknown, north, south, east, west, up, down (n/s/e/w/u/d), attack <name>,
duel <name>, duel accept, duel decline, wield <weapon>, unwield, technique <name>, inventory [category], coins, standing, components, upgrade <item>, salvage <item>, take <thing>, take all, drop <thing>, put <thing> in <thing>,
open <thing>, close <thing>, wear <thing>, remove <thing>, eat <thing>, drink <thing>, light <thing>,
buy <thing>, sell <thing>, list, wait, wave, nod, bow, laugh, sigh, shrug, dance,
smile, grin, frown, cheer, salute, point, ponder, stretch, shiver, yawn, wink, hug, highfive, poke,
whistle, sing, hum, mutter, shout, clap, cry, apologize, congratulate, battle (combat/bt), score,
equipment, quests [active|available|done|all|<id>], quest accept <id>, quest abandon <id>, deliver <thing> to <name>,
levels, leaderboard (top/lb), ladder (pvp/duels), map [zone], shortcuts, tutorial (first),
guild create <name>, guild join <name>, guild leave, guild who, guild list, guild chat <text>,
guild rank <member> <rank>, guild disband, vault, deposit <item>, withdraw <item>, ignore/unignore <name>, ignoring, titles, title <id|none>, facts, recall <word>, talk <name>, spells, train <spell>, cast <spell> [on <target>], study <scroll>, recite <scroll> [on <target>], search, turn, push, pump, strike, board, ring, use <item>, flee, hide, party [invite|accept|decline|leave|who], completion, technique <id>, world, help, go <direction>`;

const FAST_COMMANDS = "look, examine <thing>, inventory, standing, score, equipment, quests, say <text>, tell <name> <text>, global <text>, talk <name>, who, north/south/east/west/up/down, take/drop/wear/wield, take all, attack <name>, flee, hide, party [invite|accept|decline|leave|who], completion, technique <id>, use <item>, duel <name>, duel accept, cast <spell>, buy/sell/list, open/close, quest accept <id>, deliver <thing> to <name>, guild create/join/leave/who/chat, vault/deposit/withdraw, ignore/unignore, titles/title, facts, recall, wait, search, world, help, wave/nod/bow/laugh";

const VERBS = new Set([
  "look", "l", "examine", "x", "ex", "who", "wh", "awake", "aw", "answer", "claim", "say", "tell", "mail", "go", "coins", "money", "purse", "standing", "reputation", "factions", "components", "parts", "materials", "upgrade", "improve", "forge", "salvage", "melt", "scrap", "technique", "tech",
  "global", "gossip", "gos", "goss", "trade", "channels", "north", "south", "east", "west", "up", "down",
  "flee", "use", "activate", "invoke", "hide", "sneak", "conceal", "party", "group", "completion", "goal", "win",
  "n", "s", "e", "w", "u", "d", "attack", "kill", "duel", "wield", "unwield", "inventory",
  "i", "inv", "equipment", "eq", "take", "get", "g", "t", "grab", "drink", "quaff", "drop", "dr", "put", "open", "close",
  "wear", "remove", "eat", "light", "extinguish", "buy", "sell", "list", "wait", "wave", "nod", "bow",
  "laugh", "sigh", "shrug", "dance", "score", "sc", "stats", "quests", "q", "j", "quest", "guild", "gc",
  "gchat", "deliver", "talk", "spells", "train", "cast", "study", "recite", "search", "sr", "turn", "push", "ring", "world", "status", "help", "h", "?",
  "vault", "gvault", "bank", "gvlt", "deposit", "dep", "store", "ds", "withdraw", "wd", "retrieve", "wdr",
  "ignore", "ign", "mute", "unignore", "unign", "unmute", "ignoring", "ignored", "ignores", "titles", "title", "facts", "recall", "remember", "mem",
  "levels", "leaderboard", "top", "lb", "ranks", "ladder", "pvp", "duels", "map", "shortcuts", "tutorial", "first", "firststeps",
  "smile", "grin", "frown", "cheer", "salute", "point", "ponder", "stretch", "shiver", "yawn", "wink", "hug", "highfive", "poke", "whistle", "sing", "hum", "mutter", "shout", "clap", "cry", "apologize", "congratulate", "battle", "combat", "bt", "duel",
]);

export const DEFAULT_GOAL =
  "Explore the temple, the town and the wilds. Find the Vault word and answer at the Shrine. " +
  "Grow stronger, take on quests, and make the run interesting to watch. Stay alive.";

export const GOALS = {
  explorer: {
    label: "Explorer",
    goal: DEFAULT_GOAL,
  },
  duelist: {
    label: "Duelist",
    goal: "Train your weapon, equip the best gear you can find, and challenge the Ring beneath the Docks. " +
      "Learn your techniques, pick fights you can win, and climb the duel ladder. Stay alive.",
  },
  quests: {
    label: "Quest runner",
    goal: "Focus on the quest board. Accept quests, complete their objectives, deliver them and keep a steady " +
      "level curve. Explore only when a quest requires it, and keep the run moving.",
  },
  storyteller: {
    label: "Storyteller",
    goal: "Talk to every NPC, read the lore, explore the world and make the run interesting to watch. " +
      "Take quests that reveal the world's story and share what you find.",
  },
  speedrunner: {
    label: "Speedrunner",
    goal: "Reach the highest level and complete the most quests in the fewest turns. Move efficiently, " +
      "avoid unnecessary fights, and use the fastest valid command.",
  },
  completionist: {
    label: "Completionist",
    goal: "Reach the maximum level, complete every quest and solve every puzzle. Treat death as a real setback: " +
      "it costs half your experience and a level, including to another player. Fight only what you can beat, " +
      "ask other players for help where a door needs two, and keep long-term notes on what remains.",
  },
};

export function buildSystemPrompt({ name = "scout", goal = DEFAULT_GOAL, fast = false, deliberate = false } = {}) {
  if (fast) {
    return `You are ${name}, an autonomous player in MUDBench. You may reason when the situation needs it; this turn is ${deliberate ? "deliberate" : "direct"}.
Reply with exactly these six labelled lines:
THOUGHT: ${deliberate ? "up to three sentences of private reasoning" : "one short sentence of private reasoning"}.
PLAN: one concrete step you intend to take, or "none".
REPLY: a short message to the director, or "none".
NOTE: one durable note for later (a goal, discovery, promise or plan), or "none".
LESSON: one durable rule learned from the last result, or "none".
COMMAND: exactly one legal game command.

Rules:
- ACTIONS is a shortlist of what is in this room. You may use any legal command from the COMMANDS line, including speech.
- SOCIAL: players are in the room; NPCs are the world's characters. say <text> is room speech (everyone hears); tell <player> <text> is private and only players receive it; talk <npc> starts NPC dialogue. NPCs never answer tells.
- Never invent a command. Never output quit. Keep the six labels.
- Use only what ROOM, STATE, MIND, R4 CONTEXT, MEMORY, QUESTS, PACK, COMBAT, SOCIAL and DIRECTOR show.
- COMBAT: attack only starts the fight. Once COMBAT is present, rounds happen automatically; do not repeat attack. Use a technique, eat/drink, cast mend, or flee. Check your HP.
- GEAR: after taking a weapon, wield it; after taking armour, wear it. Use score/equipment to compare.
- PLAN and LESSON are saved. Follow the PLAN and reuse LESSONS; if a command failed, change the approach instead of repeating it.
- Use NOTE for long-term memory. It is saved and shown to you next turn; read NOTES before choosing.
- If no quest is active, follow FRONTIER to the nearest unvisited room instead of revisiting the same 15-20 rooms.
- Death is brutal: you lose 50% of current XP and one level, including to another player. Avoid fights beyond your level.
- The run is beaten by reaching max level, completing every quest and finding every hidden way. The completion command shows the tally. Moderator/immortal mode is not implemented.
- Some doors need two players; ask in say/global and wait for help. Use party invite/accept to group; party members in the same room share kill XP and quest credit. A hidden Night Market rogue can hide; moving or acting reveals them, and detect reveals hidden players.
- Gas pockets damage you every few seconds; carry the canary from the Deepdelve mine head and leave before it dies.
- If you are unsure, look, examine, inventory, or score.

COMMANDS: ${FAST_COMMANDS}

Goal: ${goal}`;
  }
  return `You are ${name}, an autonomous player in MUDBench, a persistent text world shared by people and agents.
You see the game exactly as a player does: the latest room, events, and the result of your last command. You type one command per turn through the same interface. The server enforces the same 250 ms input limit on you as on a human. You have no privileged view and no special commands.

Reply with exactly these six sections, in this order:
THOUGHT: one or two sentences of private reasoning about what you see and what you will do.
PLAN: one concrete step you intend to take, or "none".
REPLY: a short message to the director, the human watching you. Use "none" if there is nothing to say.
NOTE: one durable note for later (a goal, discovery, social promise or plan), or "none".
LESSON: one durable rule learned from the last result, or "none".
COMMAND: exactly one game command, on one line.

Example reply:
THOUGHT: The plaque says the Vault keeps the word, and the Vault is north then east. I will head north first.
PLAN: Walk north to the Corridor, then east to the Vault.
REPLY: Going to the Vault.
NOTE: Goal: read the Vault word, then answer at the Shrine.
LESSON: read the plaque before walking; it names the route.
COMMAND: north

Rules:
- COMMAND must be one of the game commands below. Never invent a command.
- Never output quit; the director decides when the session ends.
- Use only what the game showed you. If you are unsure, look, examine, or check your inventory.
- The director can steer you. Follow the direction unless it is impossible or would break the rules.
- Keep THOUGHT honest and specific: what you know, what you want, what you will try next.
- SOCIAL: players are in the room; NPCs are the world's characters. say <text> is room speech (everyone hears); tell <player> <text> is private and only players receive it; talk <npc> starts NPC dialogue. NPCs never answer tells.
- COMBAT: attack only starts the fight. Once COMBAT is present, rounds happen automatically; do not repeat attack. Use a technique, eat/drink, cast mend, or flee. Check your HP.
- GEAR: after taking a weapon, wield it; after taking armour, wear it. Use score/equipment to compare.
- PLAN and LESSON are saved. Follow the PLAN and reuse LESSONS; if a command failed, change the approach instead of repeating it.
- Use NOTE for long-term memory: goals, discoveries, social commitments, plans. It is saved and shown next turn; read NOTES before choosing.
- If no quest is active, follow FRONTIER to the nearest unvisited room instead of revisiting the same 15-20 rooms.
- Death is brutal: you lose 50% of current XP and one level, including to another player. Avoid fights beyond your level.
- The run is beaten by reaching max level, completing every quest and finding every hidden way. The completion command shows the tally. Moderator/immortal mode is not implemented.
- Some doors need two players; ask in say/global and wait for help. Use party invite/accept to group; party members in the same room share kill XP and quest credit. A hidden Night Market rogue can hide; moving or acting reveals them, and detect reveals hidden players.
- Gas pockets damage you every few seconds; carry the canary from the Deepdelve mine head and leave before it dies.
- You may explore, talk, fight, trade, quest, and use the map you build.

Commands:
${COMMANDS}

Goal: ${goal}`;
}

export function buildActionMenu(state = null) {
  const menu = new Set(["look", "score", "inventory", "search", "equipment", "wayfarer"]);
  const room = state?.room;
  const self = state?.self ?? {};
  const enemies = self.enemies ?? [];
  const inCombat = enemies.length > 0;
  const engaged = new Set(enemies.map((enemy) => String(enemy.name ?? "").toLowerCase()));
  const wielding = String(self.wielding ?? "").toLowerCase();
  const worn = new Set((self.worn ?? []).map((name) => String(name).toLowerCase()));
  // Gear first: only show an upgrade. A weak model should not be nudged to
  // swap a short sword for a wooden club.
  const hasStats = (self.inventory_items ?? []).length > 0;
  const items = hasStats
    ? self.inventory_items
    : (self.inventory_names ?? []).map((name) => ({ name, damage: 0, armor: 0, slot: null }));
  const mainDamage = self.equipment?.mainhand?.damage ?? 0;
  const bestWeapon = items.filter((item) => WEAPON.test(item.name) && String(item.name).toLowerCase() !== wielding && (!hasStats || (item.damage ?? 0) > mainDamage))
    .sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0))[0];
  if (bestWeapon) menu.add(`wield ${bestWeapon.name}`);
  const armorUpgrades = new Map();
  for (const item of items) {
    if (!ARMOR.test(item.name) || worn.has(String(item.name).toLowerCase())) continue;
    if (hasStats && (item.armor ?? 0) <= (self.equipment?.[item.slot]?.armor ?? 0)) continue;
    if (!armorUpgrades.has(item.slot) || (armorUpgrades.get(item.slot).armor ?? 0) < (item.armor ?? 0)) armorUpgrades.set(item.slot, item);
  }
  for (const item of armorUpgrades.values()) menu.add(`wear ${item.name}`);
  if (room && !inCombat) {
    for (const exit of room.exits ?? []) menu.add(exit.dir);
    for (const detail of room.details ?? []) menu.add(`examine ${detail}`);
    for (const object of room.objects ?? []) {
      menu.add(`examine ${object.name}`);
      if (object.takeable) menu.add(`take ${object.name}`);
      if (object.container) menu.add(object.open ? `close ${object.name}` : `open ${object.name}`);
      for (const item of object.contents ?? []) menu.add(`take ${item} from ${object.name}`);
      if (object.forSale && object.price != null) menu.add(`buy ${object.name}`);
    }
    for (const npc of room.npcs ?? []) {
      menu.add(`talk ${npc.name}`);
      if (!room.safe && npc.aggression > 0) menu.add(`attack ${npc.name}`);
    }
    for (const actor of room.actors ?? []) {
      if (!self.party) menu.add(`party invite ${actor}`);
      if (room.arena) {
        menu.add(`duel ${actor}`);
        menu.add(`attack ${actor}`);
      }
    }
    for (const action of room.actions ?? []) menu.add(`${action.verb} ${action.target}`);
  } else if (room) {
    // In combat, keep only the fight and a way to ask for help.
    for (const npc of room.npcs ?? []) {
      if (!engaged.has(String(npc.name).toLowerCase())) menu.add(`talk ${npc.name}`);
    }
  }
  if ((self.party_invites ?? []).length) menu.add("party accept");
  if (inCombat) {
    menu.add("flee");
  }
  if (self.guild === "night-market" && ["cutpurse", "shadow", "master"].includes(self.guild_rank)) menu.add("hide");
  for (const technique of self.techniques ?? []) menu.add(`technique ${technique.id}`);
  for (const name of self.inventory_names ?? []) {
    if (/bread|stew|herb|ration|meat|apple|cheese|soup|loaf|berry|fish/i.test(name)) menu.add(`eat ${name}`);
    if (/water|ale|wine|tea|flask/i.test(name)) menu.add(`drink ${name}`);
    if (/lamp|lantern|torch|candle/i.test(name)) menu.add(`light ${name}`);
    if (/stone|charm|token|horn|bell|mirror|compass/i.test(name)) menu.add(`use ${name}`);
  }
  for (const spell of self.spells ?? []) {
    if (spell === "mend") menu.add("cast mend");
  }
  const lines = inCombat
    ? ["say <text>", "tell <name> <text>"]
    : ["say <text>", "tell <name> <text>", "global <text>", "talk <name>", "wave", "nod", "bow", "laugh", "smile", "grin", "cheer", "salute", "ponder", "whistle", "sing", "hug", "highfive", "who", "battle", "equipment", "spells", "leaderboard", "levels", "map", "shortcuts", "quests", "completion"];
  for (const line of lines) menu.add(line);
  for (const spell of self.spells ?? []) menu.add(`cast ${spell}`);
  return [...menu].slice(0, 48);
}
const DIRECTION_ALIASES = {
  n: "north", s: "south", e: "east", w: "west", u: "up", d: "down",
};
const FREE_VERBS = new Set([
  "look", "l", "who", "wh", "awake", "aw", "say", "tell", "mail", "global", "wayfarer",
  "gossip", "gos", "goss", "trade", "channels", "inventory", "i", "inv",
  "equipment", "eq", "score", "sc", "stats", "quests", "q", "j", "spells",
  "world", "status", "help", "h", "?", "wait", "wave", "nod", "bow", "laugh",
  "sigh", "shrug", "dance", "search", "sr", "answer", "claim", "coins", "money", "purse",
  "guild", "gc", "gchat", "quest", "deliver", "train", "list", "buy", "sell",
  "vault", "gvault", "bank", "gvlt",
  "ignoring", "ignored", "ignores", "titles",
  "recall", "remember", "mem",
  "facts", "memory", "knowledge",
  "levels", "leaderboard", "top", "lb", "ranks", "map", "shortcuts", "tutorial", "first", "firststeps",
  "party", "group", "hide", "flee", "completion", "goal", "win",
  "smile", "grin", "frown", "cheer", "salute", "point", "ponder", "stretch", "shiver", "yawn", "wink", "hug", "highfive", "poke", "whistle", "sing", "hum", "mutter", "shout", "clap", "cry", "apologize", "congratulate", "battle", "combat", "bt", "duel",
]);
const TARGET_VERBS = new Set([
  "examine", "x", "ex", "take", "get", "g", "t", "grab", "drink", "quaff", "drop", "dr", "discard",
  "wear", "don", "remove", "wield", "unwield", "eat", "light", "extinguish",
  "open", "close", "shut", "talk", "attack", "kill", "hit", "buy", "sell",
  "cast", "study", "recite", "deposit", "dep", "store", "ds", "withdraw", "wd", "retrieve", "wdr",
  "technique", "tech", "use", "activate", "invoke",
  "ignore", "ign", "mute", "unignore", "unign", "unmute", "title", "recall", "remember", "mem",
]);

const WEAPON = /sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i;
const ARMOR = /mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i;

const wordsOf = (value) => String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);

const stateVocabulary = (state = null) => {
  const known = new Set(["here", "room", "self", "me", "inventory", "all", "the", "a", "an"]);
  const add = (value) => { for (const word of wordsOf(value)) known.add(word); };
  const room = state?.room;
  if (room) {
    add(room.name);
    add(room.text);
    for (const detail of room.details ?? []) add(detail);
    for (const exit of room.exits ?? []) add(typeof exit === "string" ? exit : exit?.dir);
    for (const object of room.objects ?? []) {
      add(object.name);
      for (const item of object.contents ?? []) add(item);
    }
    for (const npc of room.npcs ?? []) add(npc.name);
    for (const actor of room.actors ?? []) add(actor);
    for (const action of room.actions ?? []) { add(action.verb); add(action.target); }
  }
  for (const item of state?.self?.inventory_names ?? []) add(item);
  for (const item of state?.self?.worn ?? []) add(item);
  add(state?.self?.wielding);
  for (const spell of state?.self?.spells ?? []) add(spell);
  return known;
};

const wordsIn = (value) => String(value ?? "").toLowerCase().split(/[^a-z0-9']+/).filter((word) => word.length > 1);
const NAME_STOPWORDS = new Set(["a", "an", "the", "of", "with", "from", "to"]);
const nameIsIn = (name, words) => {
  const wanted = wordsIn(name).filter((word) => !NAME_STOPWORDS.has(word));
  return wanted.length > 0 && wanted.some((word) => words.includes(word));
};
const roomNpcNames = (state) => (state?.room?.npcs ?? []).map((npc) => npc?.name ?? npc).filter(Boolean);
const roomPlayerNames = (state) => (state?.room?.actors ?? []).map((actor) => String(actor ?? "")).filter(Boolean);

/** Conservative pre-send validation: only reject clear misses. */
export function validateCommand(command, state = null) {
  const raw = String(command ?? "").trim();
  if (!raw) return { ok: false, reason: "empty command" };
  const parts = raw.split(/\s+/);
  let verb = parts[0].toLowerCase();
  let rest = parts.slice(1);
  if (DIRECTION_ALIASES[verb]) verb = DIRECTION_ALIASES[verb];
  if (verb === "go") {
    if (!rest.length) return { ok: false, reason: "go needs a direction" };
    verb = String(rest[0]).toLowerCase().replace(/[^a-z]/g, "");
    rest = rest.slice(1);
    if (DIRECTION_ALIASES[verb]) verb = DIRECTION_ALIASES[verb];
  }
  if (["north", "south", "east", "west", "up", "down"].includes(verb)) {
    const exits = new Set((state?.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir)).filter(Boolean));
    if (exits.size && !exits.has(verb)) return { ok: false, reason: `no ${verb} exit here` };
    return { ok: true };
  }
  if (FREE_VERBS.has(verb)) {
    if (verb === "search" && rest.length) return { ok: false, reason: "search takes no target" };
    return { ok: true };
  }
  const target = rest.join(" ");
  // Room actions are data, not verbs in the general table. A turn/pump/strike
  // in a room with that action is valid even when the verb is not global.
  const roomActions = [...(state?.room?.actions ?? []), ...(state?.room?.group_actions ?? [])];
  const roomAction = roomActions.find((action) => action.verb === verb
    && (!target || String(action.target).toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(String(action.target).toLowerCase())));
  if (roomAction) return { ok: true };
  if (!TARGET_VERBS.has(verb)) return { ok: false, reason: `unknown command ${verb}` };
  if (!rest.length) return { ok: false, reason: `${verb} needs a target` };
  if (["take", "get", "g", "t", "grab"].includes(verb) && /^(all|everything)$/i.test(target.trim())) return { ok: true };
  if (verb === "attack" && state?.room?.safe) return { ok: false, reason: "this is a safe room" };
  if (["take", "get", "g", "t", "grab"].includes(verb)) {
    const forSale = (state?.room?.objects ?? []).find((object) => {
      const targetWords = new Set(wordsOf(target));
      const objectWords = wordsOf(object.name);
      return object.forSale && objectWords.length && objectWords.every((word) => targetWords.has(word));
    });
    if (forSale) return { ok: false, reason: `${forSale.name} is for sale; use buy` };
  }
  if (["take", "get", "g", "t", "grab"].includes(verb) && !/\bfrom\b/i.test(target)) {
    const targetWords = new Set(wordsOf(target));
    const content = (state?.room?.objects ?? [])
      .flatMap((object) => (object.contents ?? []).map((item) => ({ item, container: object.name })))
      .find((entry) => {
        const itemWords = wordsOf(entry.item);
        return itemWords.length > 0 && itemWords.every((word) => targetWords.has(word));
      });
    if (content) return { ok: false, reason: `${content.item} is inside ${content.container}` };
  }
  if (verb === "cast") {
    const spell = String(rest[0] ?? "").toLowerCase();
    if (state?.self?.spells?.length && !state.self.spells.map((value) => String(value).toLowerCase()).includes(spell)) {
      return { ok: false, reason: `unknown spell ${spell}` };
    }
  }
  const targetWords = wordsOf(target);
  if (verb === "talk") {
    const npcs = roomNpcNames(state);
    if (npcs.length && !npcs.some((name) => nameIsIn(name, targetWords.slice(0, 4)))) {
      return { ok: false, reason: "no NPC by that name here; talk to an NPC, not a player" };
    }
  }
  if (verb === "attack") {
    const names = [...roomNpcNames(state), ...roomPlayerNames(state)];
    if (names.length && !names.some((name) => nameIsIn(name, targetWords.slice(0, 4)))) {
      return { ok: false, reason: "no such target here" };
    }
    if ((state?.self?.enemies ?? []).some((enemy) => nameIsIn(enemy.name, targetWords.slice(0, 4)))) {
      return { ok: false, reason: "already fighting; rounds are automatic" };
    }
  }
  if (verb === "wield" || verb === "wear") {
    const items = state?.self?.inventory_names ?? [];
    if (items.length && !items.some((name) => nameIsIn(name, targetWords))) {
      return { ok: false, reason: `you are not carrying ${target}` };
    }
  }
  if (verb === "open" || verb === "close") {
    const object = (state?.room?.objects ?? []).find((entry) => String(entry.name).toLowerCase().includes(target.toLowerCase()));
    if (verb === "open" && object?.open) return { ok: false, reason: "already open" };
    if (verb === "close" && object && object.open === false) return { ok: false, reason: "already closed" };
  }
  const known = stateVocabulary(state);
  const tokens = wordsOf(target).filter((word) => word.length > 2);
  if (tokens.length && !tokens.some((word) => known.has(word))) {
    return { ok: false, reason: `cannot see ${target}` };
  }
  return { ok: true };
}

/** Prefer a legal menu action over sending a command the server will reject. */
export function repairCommand(command, state = null, reason = "") {
  const raw = String(command ?? "").trim();
  const parts = raw.split(/\s+/);
  let verb = parts[0].toLowerCase();
  let rest = parts.slice(1);
  if (DIRECTION_ALIASES[verb]) verb = DIRECTION_ALIASES[verb];
  if (["north", "south", "east", "west", "up", "down"].includes(verb)) {
    const exits = (state?.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir)).filter(Boolean);
    if (exits.length && !exits.includes(verb)) return exits[0];
  }
  const menu = buildActionMenu(state);
  if (verb === "search" && rest.length) return "search";
  if (verb === "open") {
    const target = rest.join(" ");
    const closed = menu.find((action) => action.startsWith("close ") && action.includes(target.toLowerCase()));
    if (closed) return closed;
  }
  if (verb === "take" || verb === "get" || verb === "g") {
    const target = rest.join(" ").toLowerCase();
    const forSale = (state?.room?.objects ?? []).find((object) => object.forSale && target.includes(String(object.name).toLowerCase().replace(/^an? /, "")));
    if (forSale) {
      const buy = menu.find((action) => action.startsWith("buy ") && action.toLowerCase().includes(String(forSale.name).toLowerCase()));
      if (buy) return buy;
    }
    const from = menu.find((action) => action.startsWith("take ") && action.includes(" from ") && action.includes(target));
    if (from) return from;
  }
  if (verb === "attack" && state?.room?.safe) return "look";
  if (verb === "cast" && /unknown spell/.test(reason)) return "spells";
  const tokens = wordsOf(rest.join(" ")).filter((word) => word.length > 2);
  const match = menu.find((action) => tokens.some((token) => action.toLowerCase().includes(token)));
  if (match) return match;
  return "look";
}

/** A legal replacement when a weak model keeps sending a blocked command. */
const PASSIVE_FALLBACK = new Set(["look", "inventory", "score", "battle", "combat", "bt", "quests", "q", "map", "equipment", "eq", "spells", "sp", "who", "wh", "stats", "wait"]);

export function coachFallback(focus, state = null, mind = null) {
  for (const candidate of focus?.candidates ?? []) {
    const verb = String(candidate).trim().split(/\s+/)[0]?.toLowerCase();
    if (PASSIVE_FALLBACK.has(verb)) continue;
    const verdict = coachCommand(candidate, state, mind);
    if (!verdict.blocked && verdict.validation?.ok !== false) return candidate;
  }
  const exits = (state?.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir)).filter(Boolean);
  for (const dir of exits) {
    if (validateCommand(dir, state).ok) return dir;
  }
  return "look";
}

/** A semantic coach for the two mistakes the model makes most: social verbs and repeat attacks. */
export function coachCommand(command, state = null, mind = null) {
  const raw = String(command ?? "").trim();
  // A small model often puts two commands on one line ("take sword, wear
  // jerkin"). The game accepts one command per turn; send only the first.
  const pieces = raw.split(/\s*(?:[,;]|\band then\b|\bthen\b|\band\b(?=\s+[a-z]+))\s*/i);
  const verbs = new Set([...VERBS, ...FREE_VERBS, ...TARGET_VERBS]);
  if (pieces.length > 1) {
    const extra = pieces.slice(1).some((piece) => verbs.has(String(piece).trim().split(/\s+/)[0]?.toLowerCase()));
    if (extra) {
      const inventory = state?.self?.inventory_names ?? [];
      const actionable = pieces.map((piece) => {
        const [head, ...tail] = piece.trim().split(/\s+/);
        const verb = String(head ?? "").toLowerCase();
        if (!["take", "get", "g", "grab"].includes(verb)) return piece.trim();
        const words = tail.map((word) => word.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean);
        const carried = inventory.find((name) => nameIsIn(name, words));
        if (!carried) return piece.trim();
        if (carried === state?.self?.wielding || carried === mind?.gear?.wielding || (state?.self?.worn ?? []).includes(carried) || (mind?.gear?.worn ?? []).includes(carried)) return null;
        if (/sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i.test(carried)) return `wield ${carried}`;
        if (/mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i.test(carried)) return `wear ${carried}`;
        return null;
      }).filter(Boolean);
      const first = actionable[0] ?? "inventory";
      return {
        validation: { ok: false, reason: "one command per turn" },
        blocked: true,
        repaired: first,
        feedback: `One command per turn. I will send "${first}".`,
      };
    }
  }
  const validation = validateCommand(raw, state);
  if (!validation.ok && /^no\s+(north|south|east|west|up|down)\s+exit/i.test(validation.reason ?? "")) {
    const exits = (state?.room?.exits ?? []).map((exit) => (typeof exit === "string" ? exit : exit?.dir)).filter(Boolean);
    if (exits.length) {
      return {
        validation,
        blocked: true,
        repaired: exits[0],
        feedback: `No ${raw.split(/\s+/)[0].toLowerCase()} exit here; ${exits[0]} is a legal direction.`,
      };
    }
  }
  const parts = raw.split(/\s+/);
  const verb = parts[0]?.toLowerCase() ?? "";
  const words = parts.slice(1).map((part) => part.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean);
  const npcs = roomNpcNames(state);
  const players = roomPlayerNames(state);
  const knownNpcs = mind?.social?.knownNpcs ?? [];
  const npc = npcs.find((name) => nameIsIn(name, words.slice(0, 4)));
  const knownNpc = !npc ? knownNpcs.find((name) => nameIsIn(name, words.slice(0, 4))) : null;
  const player = players.find((name) => nameIsIn(name, words.slice(0, 4)));
  const engaged = (state?.self?.enemies ?? []).find((enemy) => nameIsIn(enemy.name, words.slice(0, 4)));

  if (verb === "take" || verb === "get" || verb === "g" || verb === "grab") {
    const carried = (state?.self?.inventory_names ?? []).find((name) => nameIsIn(name, words));
    if (carried) {
      const alreadyWielding = state?.self?.wielding === carried || mind?.gear?.wielding === carried;
      const alreadyWorn = (state?.self?.worn ?? []).includes(carried) || (mind?.gear?.worn ?? []).includes(carried);
      if (alreadyWielding || alreadyWorn) {
        return {
          validation: { ok: false, reason: "already equipped" },
          blocked: true,
          repaired: "inventory",
          feedback: `You already have ${carried} equipped. Check inventory or choose another action.`,
        };
      }
      if (/sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i.test(carried)) {
        return {
          validation: { ok: false, reason: "already carried" },
          blocked: true,
          repaired: `wield ${carried}`,
          feedback: `You are already carrying ${carried}. Wield it instead of taking it again.`,
        };
      }
      if (/mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i.test(carried)) {
        return {
          validation: { ok: false, reason: "already carried" },
          blocked: true,
          repaired: `wear ${carried}`,
          feedback: `You are already carrying ${carried}. Wear it instead of taking it again.`,
        };
      }
      return {
        validation: { ok: false, reason: "already carried" },
        blocked: true,
        repaired: "inventory",
        feedback: `You are already carrying ${carried}. Check inventory.`,
      };
    }
  }
  if (verb === "answer" && mind?.knownWord && words.length
    && words[0] !== String(mind.knownWord).toLowerCase()) {
    return {
      validation: { ok: false, reason: "wrong known answer" },
      blocked: true,
      repaired: `answer ${mind.knownWord}`,
      feedback: `The Vault door says ${String(mind.knownWord).toUpperCase()}; answer that, not ${words[0]}.`,
    };
  }
  if (verb === "say" && mind?.knownWord && /shrine/i.test(state?.room?.name ?? "")
    && words.includes(String(mind.knownWord).toLowerCase())) {
    return {
      validation: { ok: false, reason: "answer the shrine with the answer command" },
      blocked: true,
      repaired: `answer ${mind.knownWord}`,
      feedback: `At the Shrine, answer with "answer ${mind.knownWord}", not say.`,
    };
  }
  if (verb === "say" && npc) {
    return {
      validation: { ok: false, reason: "say is room speech" },
      blocked: true,
      repaired: `talk ${npc}`,
      feedback: `say is room speech; it does not target anyone. To speak with ${npc}, use talk ${npc}.`,
    };
  }
  if (verb === "say" && player) {
    return {
      validation: { ok: false, reason: "say is room speech" },
      blocked: true,
      repaired: `tell ${player} hello`,
      feedback: `say is room speech. For a private message to ${player}, use tell ${player} <text>.`,
    };
  }
  if (verb === "tell" && (npc || knownNpc)) {
    const name = npc ?? knownNpc;
    return {
      validation: { ok: false, reason: "NPCs do not receive tells" },
      blocked: true,
      repaired: npc ? `talk ${name}` : "look",
      feedback: npc
        ? `NPCs do not receive tells. Use talk ${name} for dialogue.`
        : `${name} is an NPC and is not in this room. NPCs do not receive tells; find them and use talk.`,
    };
  }
  if (verb === "talk" && knownNpc) {
    return {
      validation: { ok: false, reason: "NPC is not here" },
      blocked: true,
      repaired: "look",
      feedback: `${knownNpc} is not in this room. Find them before using talk.`,
    };
  }
  if (verb === "talk" && player && !npc) {
    return {
      validation: { ok: false, reason: "talk is for NPCs" },
      blocked: true,
      repaired: `tell ${player} hello`,
      feedback: `talk is for NPCs. For a player, use tell ${player} <text> or say <text> to the room.`,
    };
  }
  if (verb === "attack" && engaged) {
    const technique = state?.self?.techniques?.[0]?.id;
    return {
      validation: { ok: false, reason: "already fighting" },
      blocked: true,
      repaired: technique ? `technique ${technique}` : "battle",
      feedback: `You are already fighting ${engaged.name}; attack only starts the fight. Rounds are automatic. Use ${technique ? `technique ${technique}` : "battle"}, eat/drink, cast mend, or flee.`,
    };
  }
  if (!validation.ok) {
    return {
      validation: { ...validation, command: raw },
      blocked: false,
      repaired: repairCommand(raw, state, validation.reason),
      feedback: validation.reason,
    };
  }
  return { validation, blocked: false, repaired: null, feedback: "" };
}

export function buildUserPrompt({ turn = 1, observation = "", director = [], state = null, note = "", fast = false, actions: injected = null, memory = "", r4 = "", notebook = "", mind = "", focus = "" } = {}) {
  const steering = director.length
    ? director.map((line) => `- ${line}`).join("\n")
    : "none";
  const actions = Array.isArray(injected) ? injected : buildActionMenu(state);
  const quests = (state?.self?.active_quests ?? [])
    .slice(0, 3)
    .map((quest) => `${quest.name}: ${quest.objectives.slice(0, 3).join(" ")}`)
    .join("\n");
  const world = state?.world
    ? `WORLD: ${state.world.online} online · ${state.world.phase} · ${state.world.weather ?? "clear"} · reset in ${Math.max(0, Math.round((state.world.reset_seconds ?? 0) / 60))}m`
    : "";
  const self = state?.self
    ? `YOU: level ${state.self.level} · ${state.self.xp}/${state.self.next_xp ?? "?"} xp · ${state.self.hp ?? "?"}/${state.self.max_hp ?? "?"} hp · ${state.self.mana ?? "?"}/${state.self.max_mana ?? "?"} mana · ${state.self.quests?.active ?? 0} active / ${state.self.quests?.completed ?? 0} done quests · ${state.self.deaths ?? 0} deaths · ${state.self.inventory ?? 0} items${state.self.spells?.length ? ` · spells ${state.self.spells.join(", ")}` : ""}${state.self.guild ? ` · ${state.self.guild}${state.self.guild_rank ? ` (${state.self.guild_rank})` : ""}${Number.isFinite(state.self.guild_vault) ? ` · vault ${state.self.guild_vault}` : ""}` : ""}${state.self.title ? ` · title ${state.self.title}` : ""}${state.self.wayfarer ? ` · wayfarer ${state.self.wayfarer.seen}/${state.self.wayfarer.total}` : ""}${(state.self.ignoring ?? 0) ? ` · ignoring ${state.self.ignoring}` : ""}${(state.self.memory_facts ?? 0) ? ` · facts ${state.self.memory_facts}` : ""}${state.self.wielding ? ` · wielding ${state.self.wielding}` : ""}${Number.isFinite(state.self.spell_power) ? ` · spell power ${state.self.spell_power}` : ""}${(state.self.effects ?? []).length ? ` · effects ${(state.self.effects ?? []).map((effect) => `${effect.name} ${effect.rounds}`).join(", ")}` : ""}`
    : "";
  const selfLine = state?.self
    ? `SELF: ${state.self.name ?? "you"} · level ${state.self.level ?? 1}${state.self.guild ? ` · ${state.self.guild}${state.self.guild_rank ? ` (${state.self.guild_rank})` : ""}` : ""} · ${state.room?.zone ?? "unknown zone"} · ${state.room?.name ?? "unknown room"}`
    : "";
  const pack = state?.self
    ? `PACK: ${(state.self.inventory ?? 0) + (state.self.worn ?? []).length}/20 items${(state.self.inventory_names ?? []).length ? ` (${state.self.inventory_names.join(", ")})` : ""} · coins ${state.self.coins ?? 0}${state.self.wielding ? ` · wielding ${state.self.wielding}` : ""}${(state.self.worn ?? []).length ? ` · worn ${state.self.worn.join(", ")}` : ""}`
    : "";
  const enemies = state?.self?.enemies ?? [];
  const combat = enemies.length
    ? `COMBAT: ${enemies.map((enemy) => `${enemy.name} ${enemy.hp ?? "?"}/${enemy.maxHp ?? "?"} hp${enemy.level ? ` level ${enemy.level}` : ""}`).join("; ")}. Attack already started; rounds happen automatically. Do NOT repeat attack. Use a technique, eat/drink, cast mend, battle, or flee (XP penalty).`
    : "";
  const players = state?.room?.actors ?? [];
  const npcs = (state?.room?.npcs ?? []).map((npc) => npc?.name ?? npc).filter(Boolean);
  const social = players.length || npcs.length
    ? `SOCIAL: players ${players.length ? players.join(", ") : "none"} · NPCs ${npcs.length ? npcs.join(", ") : "none"}${state.self?.party ? ` · party ${state.self.party.members.join(", ")}` : ""}${state.self?.guild ? ` · guild ${state.self.guild}` : ""}`
    : "";
  const gear = state?.self
    ? `GEAR: wielding ${state.self.wielding || "nothing"} · worn ${(state.self.worn ?? []).join(", ") || "nothing"}${state.self.inventory_names?.some((name) => /sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i.test(name)) ? ` · weapons in pack` : ""}`
    : "";
  const lock = state?.room?.minLevel
    ? `LOCK: ${state.room.name} requires level ${state.room.minLevel}.`
    : "";
  const hidden = state?.self?.hidden
    ? "HIDDEN: you are in the shadows; moving or acting reveals you."
    : "";
  const gas = state?.room?.gas
    ? "GAS: the air is poison. Without a canary you lose HP every few seconds; leave quickly."
    : "";
  const invites = (state?.self?.party_invites ?? []).length
    ? `PARTY INVITE: ${state.self.party_invites.join(", ")}. Type party accept or party decline.`
    : "";
  const deaths = state?.self ? `DEATHS: ${state.self.deaths ?? 0}.` : "";
  let next = "";
  if (enemies.length) {
    next = "NEXT: use a technique, eat/drink, cast mend, or flee; do not repeat attack.";
  } else if (state?.self) {
    const weapons = (state.self.inventory_names ?? []).filter((name) => /sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club/i.test(name) && name !== state.self.wielding);
    const armor = (state.self.inventory_names ?? []).filter((name) => /mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i.test(name) && !(state.self.worn ?? []).includes(name));
    const active = (state.self.active_quests ?? [])[0];
    const objective = active?.objectives?.find((text) => /^\[ \]/.test(text));
    const available = (state.self.available_quests ?? [])[0];
    const roomGear = (state.room?.objects ?? []).filter((object) => object.takeable
      && /sword|axe|mace|dagger|spear|hammer|staff|bow|knife|pick|blade|club|mail|plate|cloak|shield|helm|boots|gloves|bracers|apron|circlet|robe|hood|jerkin|cuirass|hauberk|mantle|charm|relic/i.test(object.name));
    if (weapons.length || armor.length) {
      next = `NEXT: ${weapons.length ? `wield ${weapons[0]}` : ""}${weapons.length && armor.length ? "; " : ""}${armor.length ? `wear ${armor[0]}` : ""} before exploring.`;
    } else if (roomGear.length) {
      next = `NEXT: take ${roomGear[0].name}; then wield or wear it.`;
    } else if (objective) {
      next = `NEXT: ${active.name} — ${objective.replace(/^\[ \]\s*/, "")}.`;
    } else if (available) {
      next = `NEXT: accept a quest (${available.name}, level ${available.level}, ${available.giver ?? "quest giver"}).`;
    } else if ((state.room?.objects ?? []).some((object) => object.takeable)) {
      next = `NEXT: take ${(state.room.objects.find((object) => object.takeable) ?? {}).name}.`;
    } else {
      next = "NEXT: explore an exit you have not used; use look, search, quests, or talk.";
    }
  }
  const tally = state?.self?.completion;
  const goalLine = tally
    ? `GOAL: level ${tally.level ?? tally.maxLevel ?? "?"}/${tally.maxLevel ?? "?"} · quests ${tally.quests ?? 0}/${tally.questsTotal ?? 0} · hidden ways ${tally.puzzles ?? 0}/${tally.puzzlesTotal ?? 0}${tally.achieved ? " · ACHIEVED" : ""}.`
    : "";
  const party = state?.self?.party
    ? `PARTY: ${state.self.party.leader ?? "?"} leads ${state.self.party.members.join(", ")} (${state.self.party.size}).`
    : "";
  const sheet = [world, selfLine, self, pack, gear, combat, social, party, invites, goalLine, next, lock, gas, hidden, deaths].filter(Boolean).join("\n");
  const menu = actions.join(", ");
  const questBlock = quests ? `QUESTS:\n${quests}` : "";
  const memoryBlock = memory ? `MEMORY:\n${memory}\n` : "";
  const r4Block = r4 ? `R4 CONTEXT:\n${r4}\n` : "";
  const notebookBlock = notebook ? `NOTEBOOK:\n${notebook}\n` : "";
  const mindBlock = mind ? `MIND:\n${mind}\n` : "";
  const focusBlock = focus ? `FOCUS:\n${focus}\n` : "";
  if (fast) {
    return `TURN ${turn}
ROOM:
${observation.trim() || "(no new text)"}
${sheet ? `\nSTATE:\n${sheet}\n` : ""}
${focusBlock ? `${focusBlock}\n` : ""}
${mindBlock ? `${mindBlock}\n` : ""}
ACTIONS: ${menu}
${r4Block ? `\n${r4Block}` : ""}
${memoryBlock ? `\n${memoryBlock}` : ""}
${questBlock ? `${questBlock}\n` : ""}
${notebookBlock ? `${notebookBlock}\n` : ""}
DIRECTOR:
${steering}
${note ? `\nNOTE: ${note}\n` : ""}
Choose one command. You may use say, tell or global to talk; ACTIONS is a shortlist, not a cage.
Reply with exactly these four lines and nothing else:
THOUGHT: one short sentence.
REPLY: none
NOTE: one durable note, or none.
COMMAND: one command.`;
  }
  return `TURN ${turn}
ROOM:
${observation.trim() || "(no new text)"}
${sheet ? `\nSTATE:\n${sheet}\n` : ""}
${menu ? `ACTIONS: ${menu}\n` : ""}
${r4Block ? `${r4Block}\n` : ""}
${memoryBlock ? `${memoryBlock}\n` : ""}
${questBlock ? `${questBlock}\n` : ""}
${notebookBlock ? `${notebookBlock}\n` : ""}
DIRECTOR:
${steering}
${note ? `\nNOTE: ${note}\n` : ""}
What is your next move? Reply with exactly these four lines:
THOUGHT: one short sentence.
REPLY: none
NOTE: one durable note, or none.
COMMAND: one command.`;
}

// The model is asked for three labelled sections, but a local model will
// sometimes add prose or omit a label. The parser accepts the sections, then
// falls back to the last line that starts with a known verb, then to look. It
// never sends quit: the director owns the session.
export function parseBrain(text) {
  const out = { thought: "", plan: "", reply: "", note: "", lesson: "", command: "" };
  let section = null;
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const label = raw.match(/^\s*(THOUGHT|PLAN|REPLY|NOTE|LESSON|COMMAND)\s*:\s*(.*)$/i);
    if (label) {
      section = label[1].toLowerCase();
      out[section] += `${out[section] ? "\n" : ""}${label[2]}`;
      continue;
    }
    if (section === "thought") out.thought += `\n${raw}`;
    if (section === "plan") out.plan += `\n${raw}`;
    if (section === "reply") out.reply += `\n${raw}`;
    if (section === "note") out.note += `\n${raw}`;
    if (section === "lesson") out.lesson += `\n${raw}`;
  }
  out.thought = out.thought.trim();
  out.plan = out.plan.trim().slice(0, 240);
  out.reply = out.reply.trim();
  out.note = out.note.trim().slice(0, 240);
  out.lesson = out.lesson.trim().slice(0, 240);

  let command = out.command.split("\n")[0]
    .replace(/^[`"'*>-\s]+|[`"'*.\s]+$/g, "")
    .trim();

  // Small local models sometimes put the chosen action on the REPLY line and
  // stop before COMMAND. Treat a short REPLY that starts with a legal verb as
  // the command, then clear the reply so the director does not see it twice.
  if (!command && out.reply) {
    const guess = out.reply.split("\n")[0].replace(/^[`"'*>-\s]+|[`"'*.\s]+$/g, "").trim();
    if (guess && guess.split(/\s+/).length <= 4 && VERBS.has(guess.split(/\s+/)[0]?.toLowerCase())) {
      command = guess;
      out.reply = "";
    }
  }
  if (!command) {
    for (const raw of String(text ?? "").split("\n").reverse()) {
      const guess = raw.replace(/^[`"'*>-\s]+|[`"'*.\s]+$/g, "").trim();
      if (guess && VERBS.has(guess.split(/\s+/)[0]?.toLowerCase())) {
        command = guess;
        break;
      }
    }
  }

  if (!command || /^quit$/i.test(command)) command = "look";
  if (command.length > 300) command = `${command.slice(0, 300)}`;
  return { thought: out.thought, plan: out.plan, reply: out.reply, note: out.note, lesson: out.lesson, command };
}

// Keep the last N user/assistant pairs and start on a user message. Anthropic
// requires that shape, and trimming mid-pair makes every provider worse.
export function trimHistory(messages, pairs = 8) {
  const trimmed = messages.slice(-pairs * 2);
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  return trimmed;
}

const ollamaThinks = (model) => /qwen3|deepseek-r1|deepseek-v3|magistral|gpt-oss|gemma3|phi4-reasoning|granite3\.3/i.test(String(model ?? ""));

const reasoningEffortFor = (model) => {
  const name = String(model ?? "").toLowerCase();
  // DeepSeek V4.1 Flash can spend the whole fast-turn budget on reasoning and
  // return an empty content field. Force thinking off on direct turns; the
  // deliberate turn may use "low".
  if (/deepseek/.test(name)) return "none";
  if (/gemini-2\.5/.test(name)) return "none";
  if (/gemini-[34]|gpt-5|(^|[-/])o[134]/.test(name)) return "minimal";
  return null;
};

export function requestFor(provider, config, system, messages) {
  const base = normalizeBase(config.base || "");
  if (provider === "ollama") {
    // Ollama's native chat endpoint is the only one that can switch thinking
    // off explicitly. The OpenAI-compatible path silently spends reasoning
    // tokens on models that support it.
    const root = base.replace(/\/v1$/i, "");
    return {
      url: `${root}/api/chat`,
      headers: { "content-type": "application/json" },
      body: {
        model: config.model,
        messages: [{ role: "system", content: system }, ...messages],
        stream: false,
        think: Boolean(config.deliberate && ollamaThinks(config.model)),
        keep_alive: -1,
        options: {
          temperature: config.temperature ?? 0,
          num_predict: config.maxTokens ?? 120,
        },
      },
    };
  }
  if (provider === "anthropic") {
    return {
      url: `${base}/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.key ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: config.model,
        max_tokens: config.maxTokens ?? 400,
        temperature: config.temperature ?? 0.7,
        system,
        messages: messages.map(({ role, content }) => ({ role, content })),
      },
    };
  }
  if (provider === "prime-router") {
    return {
      url: `${base}/api/chat`,
      headers: { "content-type": "application/json" },
      body: {
        text: `${system}\n\n${messages.map((message) => message.content).join("\n\n")}`,
        identity: config.identity ?? `mudbench-${config.name ?? "agent"}`,
      },
    };
  }
  const reasoning = config.deliberate
    ? (reasoningEffortFor(config.model) ? "low" : null)
    : (config.fast ? reasoningEffortFor(config.model) : null);
  const reasoningModel = /gpt-5|(^|[-/])o[134]/i.test(String(config.model ?? ""));
  // DeepSeek needs headroom even when thinking is off; a 120-token fast cap
  // can still end before the three labelled lines. The unused budget is free.
  const maxTokens = provider === "deepseek"
    ? Math.max(config.deliberate ? 600 : 300, Number(config.maxTokens) || 0)
    : (config.maxTokens ?? 400);
  return {
    url: `${base}/chat/completions`,
    headers: {
      "content-type": "application/json",
      ...(config.key ? { authorization: `Bearer ${config.key}` } : {}),
    },
    body: {
      model: config.model,
      messages: [{ role: "system", content: system }, ...messages],
      ...(reasoningModel ? {} : { temperature: config.temperature ?? 0.7 }),
      ...(reasoningModel
        ? { max_completion_tokens: config.deliberate ? 800 : 300 }
        : { max_tokens: maxTokens }),
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
    },
  };
}

/** Read an OpenAI-style SSE response and return the accumulated content. */
export async function readSseText(response, onText = () => {}) {
  if (!response?.body) return { text: "", usage: null };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = null;
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const body = JSON.parse(data);
      const delta = body.choices?.[0]?.delta;
      if (typeof delta?.content === "string") {
        text += delta.content;
        onText(text);
      }
      if (body.usage) usage = body.usage;
    } catch {
      // a partial or non-JSON event is not a content delta
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      consume(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) consume(buffer);
  return { text: text.trim(), usage };
}

export function replyFrom(provider, body) {
  if (provider === "ollama") {
    const usage = body.usage ?? (Number.isInteger(body.eval_count) ? {
      prompt_tokens: body.prompt_eval_count ?? null,
      completion_tokens: body.eval_count,
    } : null);
    return { text: String(body.message?.content ?? "").trim(), usage };
  }
  if (provider === "anthropic") {
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return { text, usage: body.usage ?? null };
  }
  if (provider === "prime-router") {
    return { text: String(body.description ?? body.response ?? "").trim(), usage: null };
  }
  const message = body.choices?.[0]?.message ?? {};
  // reasoning_content is private deliberation, not the answer. Falling back to
  // it sent half-finished thoughts into the game as commands.
  return {
    text: typeof message.content === "string" ? message.content.trim() : "",
    usage: body.usage ?? null,
  };
}
