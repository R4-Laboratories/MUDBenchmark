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
    hint: "Run `ollama serve`, then `ollama pull qwen2.5:7b`. Use a 7B or larger model for coherent play; tiny models tend to repeat. If this page is not on localhost, start Ollama with OLLAMA_ORIGINS=https://play.r4labs.org (or *).",
  },
  openai: {
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
    hint: "The key stays in this browser and is sent only to api.openai.com.",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    base: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    needsKey: true,
    hint: "The key stays in this browser and is sent only to api.anthropic.com. The direct-browser header is set for you.",
  },
  custom: {
    label: "OpenAI-compatible (custom)",
    base: "http://localhost:8080/v1",
    model: "local-model",
    needsKey: false,
    hint: "Any endpoint with an OpenAI-compatible /v1/chat/completions. A key is optional.",
  },
  "prime-router": {
    label: "Prime Router (hypersphere, local)",
    base: "http://localhost:8000",
    model: "prime",
    needsKey: false,
    hint: "Run Prime Router locally on :8000. It adds the hypersphere injection before the model call.",
  },
};

export const COMMANDS = `look, look <thing>, examine <thing>, who, say <text>, global <text>,
tell <name> <text>, mail <name> <text>, channels, answer <word>, claim <word>,
claim unknown, north, south, east, west, up, down (n/s/e/w/u/d), attack <name>,
flee, wield <weapon>, unwield, inventory, take <thing>, drop <thing>, put <thing> in <thing>,
open <thing>, close <thing>, wear <thing>, remove <thing>, eat <thing>, light <thing>,
buy <thing>, sell <thing>, list, wait, wave, nod, bow, laugh, sigh, shrug, dance, score,
quests, quest accept <id>, quest abandon <id>, deliver <thing> to <name>,
guild create <name>, guild join <name>, guild leave, guild who, guild list, guild chat <text>,
guild rank <member> <rank>, guild disband, talk <name>, help`;

const VERBS = new Set([
  "look", "l", "examine", "x", "who", "awake", "answer", "claim", "say", "tell", "mail",
  "global", "gossip", "trade", "channels", "north", "south", "east", "west", "up", "down",
  "n", "s", "e", "w", "u", "d", "attack", "kill", "flee", "wield", "unwield", "inventory",
  "i", "take", "get", "drop", "put", "open", "close", "wear", "remove", "eat", "light",
  "extinguish", "buy", "sell", "list", "wait", "wave", "nod", "bow", "laugh", "sigh",
  "shrug", "dance", "score", "quests", "quest", "guild", "gc", "gchat", "deliver", "talk", "help",
]);

export const DEFAULT_GOAL =
  "Explore the temple, the town and the wilds. Find the Vault word and answer at the Shrine. " +
  "Grow stronger, take on quests, and make the run interesting to watch. Stay alive.";

export function buildSystemPrompt({ name = "scout", goal = DEFAULT_GOAL } = {}) {
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

export function buildUserPrompt({ turn = 1, observation = "", director = [], note = "" } = {}) {
  const steering = director.length
    ? director.map((line) => `- ${line}`).join("\n")
    : "none";
  return `TURN ${turn}
GAME:
${observation.trim() || "(no new text)"}

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

export function requestFor(provider, config, system, messages) {
  const base = String(config.base ?? "").replace(/\/+$/, "");
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
  return {
    url: `${base}/chat/completions`,
    headers: {
      "content-type": "application/json",
      ...(config.key ? { authorization: `Bearer ${config.key}` } : {}),
    },
    body: {
      model: config.model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 400,
    },
  };
}

export function replyFrom(provider, body) {
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
  return {
    text: String(message.content ?? message.reasoning_content ?? "").trim(),
    usage: body.usage ?? null,
  };
}
