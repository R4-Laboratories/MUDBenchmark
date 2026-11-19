// The browser AI player: provider metadata, prompt construction, reply parsing
// and request shapes. This module has no DOM and no server dependency, so the
// gate can test the parts that decide what the model sees and what command it
// sends.
//
// The game server never sees a provider key. The key lives in the browser's
// localStorage and goes only to the provider's own endpoint.

export const PROVIDERS = {
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
  custom: {
    label: "OpenAI-compatible (custom)",
    base: "http://localhost:8080/v1",
    model: "local-model",
    needsKey: false,
    keyMode: "optional",
    hint: "Any OpenAI-compatible /v1/chat/completions endpoint. Add a key if the gateway needs one; it stays in this browser.",
  },
  "gemini-demo": {
    label: "Gemini demo (Prism only)",
    base: "/api/gemini/v1",
    model: "gemini-3.1-flash-lite",
    needsKey: false,
    keyMode: "proxy",
    hint: "Operator-funded Gemini demo. Sign in with a Prism id; the server holds the key, enforces a small daily/minute quota and forces thinking off. Free-tier data may be used by Google to improve products.",
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
flee, wield <weapon>, unwield, inventory, take <thing>, drop <thing>, put <thing> in <thing>,
open <thing>, close <thing>, wear <thing>, remove <thing>, eat <thing>, light <thing>,
buy <thing>, sell <thing>, list, wait, wave, nod, bow, laugh, sigh, shrug, dance, score,
equipment, quests [active|available|done|all|<id>], quest accept <id>, quest abandon <id>, deliver <thing> to <name>,
levels, leaderboard (top/lb), map [zone], shortcuts,
guild create <name>, guild join <name>, guild leave, guild who, guild list, guild chat <text>,
guild rank <member> <rank>, guild disband, talk <name>, spells, train <spell>, cast <spell> [on <target>], study <scroll>, recite <scroll> [on <target>], search, turn, push, ring, world, help, go <direction>`;

const FAST_COMMANDS = "look, examine <thing>, inventory, score, equipment, quests, say <text>, tell <name> <text>, global <text>, talk <name>, who, north/south/east/west/up/down, take/drop/wear/wield, attack <name>, flee, cast <spell>, buy/sell/list, open/close, quest accept <id>, deliver <thing> to <name>, guild create/join/leave/who/chat, wait, search, world, help, wave/nod/bow/laugh";

const VERBS = new Set([
  "look", "l", "examine", "x", "ex", "who", "wh", "awake", "aw", "answer", "claim", "say", "tell", "mail", "go",
  "global", "gossip", "gos", "goss", "trade", "channels", "north", "south", "east", "west", "up", "down",
  "n", "s", "e", "w", "u", "d", "attack", "kill", "flee", "wield", "unwield", "inventory",
  "i", "inv", "equipment", "eq", "take", "get", "g", "grab", "drop", "dr", "put", "open", "close",
  "wear", "remove", "eat", "light", "extinguish", "buy", "sell", "list", "wait", "wave", "nod", "bow",
  "laugh", "sigh", "shrug", "dance", "score", "sc", "stats", "quests", "q", "j", "quest", "guild", "gc",
  "gchat", "deliver", "talk", "spells", "train", "cast", "study", "recite", "search", "sr", "turn", "push", "ring", "world", "status", "help", "h", "?",
  "levels", "leaderboard", "top", "lb", "ranks", "map", "shortcuts",
]);

export const DEFAULT_GOAL =
  "Explore the temple, the town and the wilds. Find the Vault word and answer at the Shrine. " +
  "Grow stronger, take on quests, and make the run interesting to watch. Stay alive.";

export function buildSystemPrompt({ name = "scout", goal = DEFAULT_GOAL, fast = false, deliberate = false } = {}) {
  if (fast) {
    return `You are ${name}, an autonomous player in MUDBench. You may reason when the situation needs it; this turn is ${deliberate ? "deliberate" : "direct"}.
Reply with exactly these three labelled lines:
THOUGHT: ${deliberate ? "up to three sentences of private reasoning" : "one short sentence of private reasoning"}.
REPLY: a short message to the director, or "none".
COMMAND: exactly one legal game command.

Rules:
- ACTIONS is a shortlist of what is in this room. You may use any legal command from the COMMANDS line, including speech.
- To talk to players, use say <text>, tell <name> <text>, or global <text>. To talk to an NPC, use talk <name>.
- Never invent a command. Never output quit. Keep the three labels.
- Use only what ROOM, STATE, R4 CONTEXT, MEMORY, QUESTS and DIRECTOR show.
- Follow the director unless it is impossible.
- If you are unsure, look, examine, inventory, or score.

COMMANDS: ${FAST_COMMANDS}

Goal: ${goal}`;
  }
  return `You are ${name}, an autonomous player in MUDBench, a persistent text world shared by people and agents.
You see the game exactly as a player does: the latest room, events, and the result of your last command. You type one command per turn through the same interface. The server enforces the same 250 ms input limit on you as on a human. You have no privileged view and no special commands.

Reply with exactly these three sections, in this order:
THOUGHT: one or two sentences of private reasoning about what you see and what you will do.
REPLY: a short message to the director, the human watching you. Use "none" if there is nothing to say.
COMMAND: exactly one game command, on one line.

Example reply:
THOUGHT: The plaque says the Vault keeps the word, and the Vault is north then east. I will head north first.
REPLY: Going to the Vault.
COMMAND: north

Rules:
- COMMAND must be one of the game commands below. Never invent a command.
- Never output quit; the director decides when the session ends.
- Use only what the game showed you. If you are unsure, look, examine, or check your inventory.
- The director can steer you. Follow the direction unless it is impossible or would break the rules.
- Keep THOUGHT honest and specific: what you know, what you want, what you will try next.
- You may explore, talk, fight, trade, quest, and use the map you build.

Commands:
${COMMANDS}

Goal: ${goal}`;
}

export function buildActionMenu(state = null) {
  const menu = new Set(["look", "score", "inventory", "search"]);
  const room = state?.room;
  if (room) {
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
    for (const action of room.actions ?? []) menu.add(`${action.verb} ${action.target}`);
  }
  for (const line of ["say <text>", "tell <name> <text>", "global <text>", "talk <name>", "wave", "nod", "bow", "laugh", "who", "leaderboard", "levels", "map", "shortcuts", "quests"]) {
    menu.add(line);
  }
  return [...menu].slice(0, 32);
}

const DIRECTION_ALIASES = {
  n: "north", s: "south", e: "east", w: "west", u: "up", d: "down",
};
const FREE_VERBS = new Set([
  "look", "l", "who", "wh", "awake", "aw", "say", "tell", "mail", "global",
  "gossip", "gos", "goss", "trade", "channels", "inventory", "i", "inv",
  "equipment", "eq", "score", "sc", "stats", "quests", "q", "j", "spells",
  "world", "status", "help", "h", "?", "wait", "wave", "nod", "bow", "laugh",
  "sigh", "shrug", "dance", "flee", "search", "sr", "answer", "claim",
  "guild", "gc", "gchat", "quest", "deliver", "train", "list", "buy", "sell",
  "levels", "leaderboard", "top", "lb", "ranks", "map", "shortcuts",
]);
const TARGET_VERBS = new Set([
  "examine", "x", "ex", "take", "get", "g", "grab", "drop", "dr", "discard",
  "wear", "don", "remove", "wield", "unwield", "eat", "light", "extinguish",
  "open", "close", "shut", "talk", "attack", "kill", "hit", "buy", "sell",
  "cast", "study", "recite",
]);

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
    for (const action of room.actions ?? []) { add(action.verb); add(action.target); }
  }
  for (const item of state?.self?.inventory_names ?? []) add(item);
  for (const item of state?.self?.worn ?? []) add(item);
  add(state?.self?.wielding);
  for (const spell of state?.self?.spells ?? []) add(spell);
  return known;
};

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
  if (!TARGET_VERBS.has(verb)) return { ok: false, reason: `unknown command ${verb}` };
  if (!rest.length) return { ok: false, reason: `${verb} needs a target` };
  const target = rest.join(" ");
  if (verb === "attack" && state?.room?.safe) return { ok: false, reason: "this is a safe room" };
  if (["take", "get", "g", "grab"].includes(verb)) {
    const forSale = (state?.room?.objects ?? []).find((object) => {
      const targetWords = new Set(wordsOf(target));
      const objectWords = wordsOf(object.name);
      return object.forSale && objectWords.length && objectWords.every((word) => targetWords.has(word));
    });
    if (forSale) return { ok: false, reason: `${forSale.name} is for sale; use buy` };
  }
  if (["take", "get", "g", "grab"].includes(verb) && !/\bfrom\b/i.test(target)) {
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

export function buildUserPrompt({ turn = 1, observation = "", director = [], state = null, note = "", fast = false, actions: injected = null, memory = "", r4 = "" } = {}) {
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
    ? `YOU: level ${state.self.level} · ${state.self.xp}/${state.self.next_xp ?? "?"} xp · ${state.self.hp ?? "?"}/${state.self.max_hp ?? "?"} hp · ${state.self.mana ?? "?"}/${state.self.max_mana ?? "?"} mana · ${state.self.quests?.active ?? 0} active / ${state.self.quests?.completed ?? 0} done quests · ${state.self.inventory ?? 0} items${state.self.spells?.length ? ` · spells ${state.self.spells.join(", ")}` : ""}${state.self.guild ? ` · ${state.self.guild}${state.self.guild_rank ? ` (${state.self.guild_rank})` : ""}` : ""}${state.self.wielding ? ` · wielding ${state.self.wielding}` : ""}`
    : "";
  const sheet = [world, self].filter(Boolean).join("\n");
  const menu = actions.join(", ");
  const questBlock = quests ? `QUESTS:\n${quests}` : "";
  const memoryBlock = memory ? `MEMORY:\n${memory}\n` : "";
  const r4Block = r4 ? `R4 CONTEXT:\n${r4}\n` : "";
  if (fast) {
    return `TURN ${turn}
ROOM:
${observation.trim() || "(no new text)"}
${sheet ? `\nSTATE:\n${sheet}\n` : ""}
ACTIONS: ${menu}
${r4Block ? `\n${r4Block}` : ""}
${memoryBlock ? `\n${memoryBlock}` : ""}
${questBlock ? `${questBlock}\n` : ""}
DIRECTOR:
${steering}
${note ? `\nNOTE: ${note}\n` : ""}
Choose one command. You may use say, tell or global to talk; ACTIONS is a shortlist, not a cage.`;
  }
  return `TURN ${turn}
ROOM:
${observation.trim() || "(no new text)"}
${sheet ? `\nSTATE:\n${sheet}\n` : ""}
${menu ? `ACTIONS: ${menu}\n` : ""}
${r4Block ? `${r4Block}\n` : ""}
${memoryBlock ? `${memoryBlock}\n` : ""}
${questBlock ? `${questBlock}\n` : ""}
DIRECTOR:
${steering}
${note ? `\nNOTE: ${note}\n` : ""}
What is your next move?`;
}

// The model is asked for three labelled sections, but a local model will
// sometimes add prose or omit a label. The parser accepts the sections, then
// falls back to the last line that starts with a known verb, then to look. It
// never sends quit: the director owns the session.
export function parseBrain(text) {
  const out = { thought: "", reply: "", command: "" };
  let section = null;
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const label = raw.match(/^\s*(THOUGHT|REPLY|COMMAND)\s*:\s*(.*)$/i);
    if (label) {
      section = label[1].toLowerCase();
      out[section] += `${out[section] ? "\n" : ""}${label[2]}`;
      continue;
    }
    if (section === "thought") out.thought += `\n${raw}`;
    if (section === "reply") out.reply += `\n${raw}`;
  }
  out.thought = out.thought.trim();
  out.reply = out.reply.trim();

  let command = out.command.split("\n")[0]
    .replace(/^[`"'*>-\s]+|[`"'*.\s]+$/g, "")
    .trim();

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
  return { thought: out.thought, reply: out.reply, command };
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
  if (/gemini-2\.5/.test(name)) return "none";
  if (/gemini-[34]|gpt-5|(^|[-/])o[134]/.test(name)) return "minimal";
  return null;
};

export function requestFor(provider, config, system, messages) {
  const base = normalizeBase(config.base);
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
  if (provider === "gemini-demo") {
    return {
      url: `${base}/chat/completions`,
      headers: {
        "content-type": "application/json",
        ...(config.demoToken ? { "x-demo-token": config.demoToken } : {}),
        ...(config.deliberate ? { "x-demo-reasoning": "low" } : { "x-demo-reasoning": "none" }),
      },
      body: {
        model: config.model,
        messages: [{ role: "system", content: system }, ...messages],
        temperature: 0,
        max_tokens: 160,
      },
    };
  }
  const reasoning = config.deliberate
    ? (reasoningEffortFor(config.model) ? "low" : null)
    : (config.fast ? reasoningEffortFor(config.model) : null);
  const reasoningModel = /gpt-5|(^|[-/])o[134]/i.test(String(config.model ?? ""));
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
        : { max_tokens: config.maxTokens ?? 400 }),
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
    },
  };
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
