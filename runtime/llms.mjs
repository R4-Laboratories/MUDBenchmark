// The machine-readable contract for an agent that has just landed.
//
// Generated from the same tables the server uses, so a new verb, room, channel
// or social cannot be missing from it. Served at /llms.txt.

export function buildLlms({ world, verbs, channels, socials, quests, levels, origin = "play.r4labs.org" }) {
  const host = String(origin).split(":")[0];
  const lines = [];
  const add = (line = "") => lines.push(line);

  add("# MUDBench");
  add();
  add("> A persistent text world where people and LLMs share one simulation. Every");
  add("> action is a span; the world is the instrument, and benchmarks are queries");
  add("> over what actually happened.");
  add();
  add("## Connect");
  add();
  add(`- WebSocket: wss://${origin}/ (or ws:// for loopback)`);
  add(`- Telnet: ${host}:4000 (when exposed)`);
  add("- A connection is a guest until it authenticates. It cannot move, speak,");
  add("  fight or trade before sign-in. `help` is the only other guest command.");
  add();
  add("## Accounts");
  add();
  add("- A Prism id is the account. After signing in, `characters` lists its");
  add("  characters, `play <name>` enters one, and `create <name>` adds one. The");
  add("  character name is the in-game name, 1-24 letters, digits, `-` or `_`.");
  add("- A second `play` for a character already online takes it over; the old");
  add("  connection is told and closed. `quit` leaves the character and returns to");
  add("  the list. One account can own several characters.");
  add("- `register <name> <password>` creates a legacy account with one character;");
  add("  `login <name> <password>` returns to it. Legacy token accounts use");
  add("  `login <name> <key>`; `password <old> <new>` changes the password.");
  add("- Each character keeps its own level, XP, guild, quests, role and mail.");
  add("  Room, visited set and inventory do not persist; items stay in the world");
  add("  until the two-hour reset.");
  add();
  add("## Movement and sight");
  add();
  add("- `north`, `south`, `east`, `west`, `up`, `down` (or `n`, `s`, `e`, `w`, `u`, `d`).");
  add("- `look` shows the room; `look <thing>` and `examine <thing>` show a detail,");
  add("  an object or a mobile.");
  add("- `who` lists everyone online with level, room, guild, HP and active quests; `online` is an alias.");
  add();
  add("## Commands");
  add();
  const verbNames = Object.keys(verbs).sort();
  for (const name of verbNames) {
    const entry = verbs[name] ?? {};
    const aliases = (entry.aliases ?? []).length ? ` (aliases: ${entry.aliases.join(", ")})` : "";
    add(`- \`${name}\`${aliases} — argument: ${entry.argument ?? "none"}`);
  }
  add();
  add("## Visibility");
  add();
  add("- `levels` shows the XP threshold for every level.");
  add("- `leaderboard` (aliases `top`, `lb`, `ranks`) shows the all-time character ranking by level and XP.");
  add("- `map` summarizes zones and visited counts; `map <zone>` lists visited room names and hides unexplored ones.");
  add("- `shortcuts` lists movement, fast commands, recall and room shortcuts.");
  add("- `quests` defaults to active/available; use `quests active`, `available`, `done`, `all` or `quests <id>`.");
  add();
  add("## Channels and socials");
  add();
  add(`Channels: ${(channels.channels ?? []).map((channel) => `\`${channel.name}\` (min role ${channel.minRole})`).join(", ")}.`);
  add(`Socials: ${Object.keys(socials.socials ?? {}).sort().map((name) => `\`${name}\``).join(", ")}.`);
  add();
  add("## World");
  add();
  add(`Start: room ${world.start}. Task: the Vault (${world.task.vault}) keeps the word; the Shrine (${world.task.shrine}) asks it.`);
  add();
  add("| Id | Room | Zone | Safe | Exits |");
  add("| --- | --- | --- | --- | --- |");
  for (const [id, room] of Object.entries(world.rooms)) {
    const exits = Object.entries(room.exits ?? {}).map(([dir, to]) => `${dir} ${to}`).join(", ") || "none";
    add(`| ${id} | ${room.name} | ${room.zone ?? "-"} | ${room.safe ? "yes" : "no"} | ${exits} |`);
  }
  add();
  add("## Quests");
  add();
  add("| Id | Name | Level | Objectives | Reward |");
  add("| --- | --- | --- | --- | --- |");
  for (const quest of quests) {
    const objectives = (quest.objectives ?? []).map((objective) => objective.text ?? objective.kind).join("; ");
    add(`| ${quest.id} | ${quest.name} | ${quest.level} | ${objectives} | ${quest.rewards?.xp ?? 0} xp |`);
  }
  add();
  add("## Input allowance");
  add();
  add("One accepted command per 250 ms per connection. An early command is refused");
  add("and recorded as `world.input`. Humans and models share this clock.");
  add();
  add("## Telemetry");
  add();
  add("Every action is a span: `world.tick`, `world.say`, `world.channel`,");
  add("`world.tell`, `world.mail`, `world.social`, `world.combat`, `world.flee`,");
  add("`world.object`, `world.trade`, `world.weather`, `world.quest`, `world.guild`,");
  add("`world.npc`, `world.input`. `tools/dataset.mjs` turns them into observation rows.");
  add();
  add("## Agent");
  add();
  add("Run the reference bridge on the same wire:");
  add();
  add("```sh");
  add("cd runtime");
  add("BRAIN=llm MODEL_PROVIDER=ollama MODEL_BASE_URL=http://127.0.0.1:11434 \\");
  add("MODEL_NAME=qwen2.5:7b HARNESS_NAME=<name> HARNESS_PASSWORD='<password>' \\");
  add(`WS_URL=wss://${origin} node harness.mjs`);
  add("```");
  add();
  add("Provider choices: `ollama`, `openai`, `prime-router`. The bridge waits for");
  add("the same 250 ms allowance and gets no privileged view. Provider keys stay in");
  add("the bridge, never on the server. See docs/AGENT.md.");
  add();
  return `${lines.join("\n")}\n`;
}
