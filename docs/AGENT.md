# Connecting an LLM

The agent harness is a player. It connects to the same WebSocket, logs in with
the same account, receives the same room text and is bound by the same 250 ms
input allowance. It gets no privileged view and no special commands.

`/llms.txt` on the game origin is the machine-readable contract: connect, accounts, every verb, the map, the quests, the spans and the agent command. This file is the longer explanation.

## Start or watch an AI in the browser

Open the game and choose **Start a free agent**, or use the **Agents** workspace.
Bring your own provider key. **Groq** is the free option: create a key at
`console.groq.com/keys` (no card), paste it once, and the agent uses
`openai/gpt-oss-20b` on the free tier (about 30 requests per minute, 1,000 per
day). The key stays in this browser and goes only to `api.groq.com`.
**Anthropic**, **OpenAI**, **DeepSeek** and any OpenAI-compatible endpoint also
work. There is no server-hosted brain and no shared key. If the browser has no
Prism id yet, the free card creates one and registers it before starting the
persona. The agent gets its own character and plays through the same page: the
left pane is its view, the Director chat is yours, and the Mind panel is its
reasoning. **Use another model** opens the provider drawer; the provider key
never reaches the game server, stays in this browser's localStorage, and is
sent only to the provider's endpoint.

The free card offers six personas that change the system goal without changing
the provider: **Explorer**, **Duelist**, **Quest runner**, **Storyteller**,
**Speedrunner** and **Completionist**. The Run plan shows the selected persona.

| Brain | Base URL | Key |
| --- | --- | --- |
| Groq (free key, fast) | `https://api.groq.com/openai/v1` | required (free) |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | required |
| OpenAI | `https://api.openai.com/v1` | required |
| DeepSeek | `https://api.deepseek.com/v1` | required |
| OpenAI-compatible (custom) | any `/v1` endpoint | optional |
| Ollama (local) | `http://localhost:11434/v1` | none |
| Prime Router (hypersphere, local) | `http://localhost:8000` | none |

The browser harness runs the R4/hypersphere router for each AI user. It imports
`/router.mjs` and assembles the affordances, objective, world, resources,
persistence, social and recall layers locally, then injects that context into
the provider prompt. The game server does not hold the brain, the provider key
or the AI's R4 context. The **Reasoning** setting (Auto, Always, Never) controls
whether the provider may spend thinking tokens on a turn; the default Auto is
direct on routine turns and deliberate on first turns, director messages, low
HP, repeats and every eighth turn.

### Notebook, self and combat context

Every turn the prompt carries a `SELF` line (name, level, guild, zone and room),
`PACK` (items held, coins, wielded and worn gear, with the 20-item limit),
`COMBAT` (the engaged enemy's HP and the movement lock), `SOCIAL` (other
characters in the room and the guild) and `NOTEBOOK` (the agent's own durable
notes). The model may write one `NOTE:` line per turn; the browser keeps the
last 12 notes per persona in localStorage and injects them next turn. The
notebook is where long-term goals, discoveries, social promises and plans live.
It is private to that AI user and never sent to the game server.

While `COMBAT` is present the server refuses movement. The agent can attack,
use a weapon technique, eat/drink or cast a heal, or `flee` as a last resort.
Flee moves it to a random adjacent room, ends the fight and costs 10% of its
current XP; a duel forfeit also loses 12 rating.

### Danger, death and groups

Death is a real setback: a character death, PvE or PvP, costs **50% of current
XP and one level**. Equipment falls where they died; gold is kept. The agent
prompt states this and the win condition: **reach level 10, complete every
quest and find every hidden way**. The `completion` command (`goal`, `win`)
shows the tally, and the prompt carries the same `GOAL` line. Moderator/immortal
mode is not implemented yet.

Some content needs other players. The Twin Door in the Mistfall only opens when
two players are in the room; the prompt's `SOCIAL` line and the room detail tell
the agent to ask in `say` or `global`. Night Market cutpurses can `hide`: they
leave room descriptions, the actor list and `who` until they move or act, and
`detect` reveals them. A hidden rogue can still be the second pair of hands at
the Twin Door.

The Deepdelve mine below the graveyard uses a real **party**: `party invite
<name>`, `party accept`, `party decline`, `party who`, `party leave`, `party kick` and
`party disband`. Party members in the same room share 50% of kill XP and quest kill
credit. The winch, pump, mine cart and sealed seam each require a party of two
in the room, and a party action reveals the way to every member. The gas pocket
damages anyone without a canary; a canary warns for 30 seconds and then dies.
The prompt's `PARTY`, `PARTY INVITE` and `GAS` lines carry this state.

### The completion tally

A run is beaten by **level 10, all 25 live quests and all 25 hidden ways**. The
prompt's `GOAL` line carries the live numbers; `completion` prints them for a
human. The first time all three are true, the engine records the tick and the
tally permanently and awards the **Worldbreaker** title. The record survives
death, reset, logout and restart; a later level loss or a new quest does not
take it away. Hidden ways are the same `found` facts the room descriptions use,
now saved with the identity. The rules are in `docs/COMPLETION.md`.

### Watching what the AI sees and does

The live panel has four tabs:

- **Mind** — the private thoughts. The star on a thought records a highlight:
  turn, tick, command, thought, room, persona and owner.
- **Run** — turn/command/token/latency stats, the highlight list, and the
  transcript download or copy.
- **Model** — the exact system and user prompt, the trimmed context, the raw
  reply, the parsed command, and the persona, owner and tick range.
- **Bench** — a benchmark over the server's span log: span count, tick range,
  command count, latency, actors, rooms, span kinds and recent command ticks.
  It is aggregates only; the command text stays on the server and in the Model
  tab.

Every accepted command is one `world.input` span with its tick. The same tick
arrives in a hidden `#tick` line, so a transcript turn and its span agree
exactly. `GET /spans` is the aggregate endpoint; `docs/STREAM.md` has the
schema.

### Ollama, the free local path

```sh
ollama serve
ollama pull qwen2.5:7b
```

If the page is not served from localhost, allow its origin:

```sh
OLLAMA_ORIGINS=https://play.r4labs.org ollama serve
```

Choose **Ollama**, press **Find** to list models, and pick one. A 7B or larger
model is the useful floor; 0.5B models tend to repeat a single command.

### OpenAI or Anthropic

Choose the provider, paste the key, and press **Find** to list the models the
key can see. The key is sent directly from the browser to that provider. For
Anthropic the page sets `anthropic-dangerous-direct-browser-access: true`,
which is Anthropic's required header for browser clients. **Forget key**
removes it from localStorage.

### The character

The AI registers its own character on first run. The name is in the setup
panel; **New** generates a fresh one. A generated password is stored per name in
this browser. If the name already exists with a different password, choose a
new name. One character has one controller, and the AI is a controller like any
other.

### What the AI sees and what it may do

The AI receives the same room blocks and events a person does, on the same
WebSocket, with the same 250 ms input allowance and the same command table. It
is asked for three sections each turn:

```
THOUGHT: one or two sentences of reasoning
REPLY: a short message to the director, or none
COMMAND: exactly one game command
```

The browser parser accepts a missing label, falls back to the last line that
starts with a known verb, and refuses `quit`. A reply with no usable command
becomes `look`. The game server sees only the command, never the thought, the
director message or the key.

### Director, Mind, Run

- **Director** is the chat on the right. A message is queued into the next
  prompt as `DIRECTOR:` and the AI answers in `REPLY:`.
- **Mind** is the thought stream, one card per turn. If the model returns no
  `THOUGHT`, the card says so rather than inventing one.
- **Run** shows turns, commands sent, average model latency, tokens, model and
  room. **Download transcript** writes a JSON record of every turn (observation,
  thought, reply, command, latency, usage) with no key in it. That is the
  benchmark artifact for a watched run.
- **Pause**, **Step** and **Stop** are in the live header. Pausing keeps the
  character in the world; Step runs exactly one model turn.

A repetition guard pauses the stream if the same command is chosen five times
in a row, and tells you to steer it. A director message clears the guard.

## The one-file player runner

For a player, download the runner from the game origin and run it on your own
machine:

```sh
curl -O https://play.r4labs.org/agent.mjs
MODEL_PROVIDER=ollama MODEL_BASE_URL=http://127.0.0.1:11434 \
MODEL_NAME=qwen2.5:7b HARNESS_NAME=my-agent HARNESS_PASSWORD='<your password>' \
WS_URL=wss://play.r4labs.org node agent.mjs
```

It has no dependencies beyond Node 22, uses a provider key only on your
machine, and connects on the same WebSocket a human uses. Quit the browser
character first: one character has one controller. A separate agent name gives
you a second character.

## The research harness

The repository harness remains for controlled runs and the benchmark:

```sh
cd runtime
HARNESS_NAME=my-agent \
HARNESS_PASSWORD=a-real-password \
BRAIN=llm \
MODEL_PROVIDER=ollama \
MODEL_BASE_URL=http://127.0.0.1:11434 \
MODEL_NAME=qwen2.5:7b \
WS_URL=wss://play.r4labs.org \
node harness.mjs
```

The first run registers `my-agent`; later runs log in with the same password.
If the name exists with another password, the harness stops instead of
guessing.

OpenAI-compatible providers use the default `MODEL_PROVIDER=openai`:

```sh
MODEL_BASE_URL=https://api.example.com/v1 \
MODEL_NAME=your-model \
MODEL_API_KEY_FILE=$HOME/.config/mudbench-model.key \
BRAIN=llm node harness.mjs
```

The key file keeps the key out of the process list. The game server never sees
a provider key.

## What it does

1. Connects and authenticates.
2. Turns the event stream into a model turn (the router layers are unchanged).
3. Asks for exactly one command.
4. Parses it against the command table, records a parse failure as data, and
   sends the command no faster than the server allows.
5. Records every decision as an `agent.decision` span.

The harness stores a small recall file at
`HARNESS_MEMORY=/tmp/mudbench-memory-<name>.json`: rooms seen, the word found,
answers given. That is session memory, not the model's context.

## Remote models without a local GPU

The CLI agent can send each decision through the OpenCode CLI instead of a
local model:

```sh
MODEL_PROVIDER=opencode MODEL_NAME=deepseek/deepseek-flash \
HARNESS_NAME=my-agent HARNESS_PASSWORD=... \
WS_URL=wss://play.r4labs.org node agent.mjs
```

This runs `opencode run --model ... --format json` per turn, parses the text
event, and sends the command. The game server never sees a provider key, and no
local inference is needed. Each call carries the OpenCode system prompt, so it
is a paid/free remote-provider path, not a local/offline one.

## Route memory and the loop guard

The browser AI and the CLI agent share `runtime/web/memory.mjs`. It records a
short **route** of recent rooms as well as the commands tried in each room.
The prompt gets `Route: ...` and the exits whose target rooms have not been
seen. `loopWarning` detects both repeated commands and small room cycles
(`A → B → A → B`, `A → B → C → A → B → C`), and `breakLoop` prefers an exit
whose target is unvisited before it falls back to a direction not in the last
six commands. The CLI agent also uses the route on an unparseable reply:
instead of sending `look`, it takes an unexplored exit.

`pathTo` runs a breadth-first search over the known room graph and `routeHint`
prints the next step toward a destination. The CLI agent seeds that graph from
the public `/llms.txt` room table, so it can plan across rooms it has never
visited. `AGENT_DESTINATION` sets one target. `AGENT_OBJECTIVES` takes an
unordered list of `Room:action` entries and always chooses the nearest
unfinished target; when the room is reached, the action guard sends that
action. Append `>Room` to hold an objective until another objective is done,
for example `The Guild Hall:deliver seal>The Rat Warren`. `AGENT_WAYPOINTS="The Root Archive:talk|The First Bed:take"` is the
ordered variant. A movement command that contradicts the known next step is
replaced by that step, and an objective action attempted in the wrong room is
redirected onto the route. While a destination is known and no objective is
current, the route lock turns any non-quit command into the next BFS step, so
the model cannot spend turns looking around mid-route. Objective actions are
not cleared when sent: the next observation must confirm the take, delivery,
recall, talk or plant with the server's own success line. A failed action stays
on the objective list and can be retried. Non-movement actions at the right target remain the
model's choice. The CLI agent prints the hint as a `NAVIGATE:` block before
asking the model.

## Memory, the rolling window, and prime-router

The model conversation is a bounded window: `MEMORY_TURNS` (default 12) keeps
the system prompt and the last twelve user/assistant pairs. Older turns fall
out. The harness's recall file (`HARNESS_MEMORY`) adds the rooms seen, the word
found and the answers given; it is session memory, not the model's context.

**Prime-router as the provider.** Prime-router holds a per-identity brain and
indexes each input and response into its manifold:

```sh
BRAIN=llm \
MODEL_PROVIDER=prime-router \
PRIME_ROUTER_URL=http://127.0.0.1:8000 \
PRIME_ROUTER_IDENTITY=mudbench-my-agent \
HARNESS_NAME=my-agent HARNESS_PASSWORD=... \
node harness.mjs
```

The harness posts `{text, identity}` to `/api/chat` and reads `description`
from the response. Prime-router keeps the state and the corpus; the harness
sends a bounded prompt each turn and the parser still turns the answer into a
command. A mock endpoint returning `{"description":"look"}` is enough to test
the adapter; the real service uses its geometric or Ollama engine.

**Prime-router as a store beside another provider.** With
`MEMORY_BACKEND=prime-router` and an OpenAI/Ollama provider, each observation
and command is posted to `/api/corpus` under `PRIME_ROUTER_IDENTITY`. That
archives the turn for prime-router's recall; it does not make the current
provider's context unlimited.

There is no literal unlimited context. There is a bounded prompt window, a
persistent recall file, and an optional manifold store. The server never holds
a provider key, and the game never depends on prime-router being up.

## Fairness

The server refuses a command that arrives inside 250 ms of the last accepted
one and records `world.input`. The harness waits 300 ms between sends. A model
cannot out-click a human, and a human cannot out-click a model.

## Accounts

The browser signs in with a **Prism id**: **Use my Prism id**. The id is
created and kept in the browser's IndexedDB, no password is sent, and the server
verifies a signed `prism/session/1` action against the id's public log. After every accepted command the server sends hidden `#tick <n>` and
`#state <json>` lines. `#state` carries the world reset countdown, online count,
phase and weather, plus the actor's level, XP to next, HP, quests, inventory
count, guild/rank, wielded item and worn items. It is the same information the
player can already learn from `score`, `quests`, `equipment`, `world` and
`look`; it is not a privileged view. The web client hides the line; the harness
and browser AI use it as the current game context.

The wire
message is `prism <base64url session>`. The session then answers a server nonce
with `prism/session-key/1 <nonce> <counter>`; `characters`, `play` and `create`
are refused until the signed challenge passes, so a stolen session token alone
cannot play. The Prism id is the **account**, shown as `prism:<first 8 hex>`. The account owns characters; the character name is
the in-game name. After signing in the page lists them: `play <name>` enters
one, `create <name>` adds one. A second `play` for a character already online
takes it over. The id is browser-local: clearing site data or losing the
browser loses the account until you link another device. **Prism devices** in the signed-in panel creates
an out-of-band link offer, accepts a request with a six-digit code, lists the
id's devices and revokes one. A second login for the same account takes over:
the old socket is told, closed, and its actor leaves before the new one enters.
The old page shows the notice and can sign in again to take the account back.
The browser re-signs with a fresh Prism session after a reconnect; the AI does
too. A socket that stops answering the server's 30-second ping is terminated.
The server pins the public log; a revoked device is refused after the owner
signs in again. A **recovery kit** on the signed-in panel downloads an encrypted file holding a
paper recovery share and the public log. On a new browser, **Restore from a
recovery kit** binds the new device and revokes the old one; the account and its
characters return, and the old browser's stale log is refused. Keep the kit
offline; the passphrase is not stored. When you are signed in, the AI is a persona of your
Prism id: your device signs a `prism/persona-owner/1` action, the server
verifies it against your pinned log, and the persona account stores `owner` and
`ai: true`. The AI panel names the character; you can play another character at
the same time. **Reset identity** retires the persona and tombstones its
characters; the next start creates a new persona. The free card creates a
browser Prism account automatically when needed; the AI is a persona of that
human account and no longer creates a standalone AI account. A new persona opens its
existing characters first; otherwise it creates a random name. If this browser
still has an old standalone AI session, the characters panel can recover its
characters with an explicit old-account-signed transfer. A device
revoked elsewhere is refused once a surviving
device has logged in with the newer public log; the server pins that log in
`identities.json`.

A signed-in human can hand one of their characters to the AI persona from
**Hand off a character to the AI**. The character keeps its human owner and
progress; the AI's character list includes it; the human can play another
character at the same time. Revoking stops the AI's next login as that
character. One delegate per character; retiring the persona clears its
delegations.

A legacy account can be adopted once by a signed-in Prism account: **Claim an
old name** in the signed-in panel, or the wire command
`adopt <old-name> <password-or-token>`. The server checks the old credential
against the record's kind — a password never matches a passwordless record —
then asks the proved Identity kernel through the holo. If the kernel is
unavailable the claim fails closed; login itself never calls the holo. The old
character becomes another character on the Prism account, keeping its own
level, guild, quests and mail; the old account is retired. One claim per Prism
account.

An account with **no** credential cannot be adopted. The operator resolves it
with the owner-authorized `rebind` on the loopback console, never on the public
socket: `rebind <name> token <sha256>` gives it a token login (the operator tool
writes the plaintext once), and `rebind <name> prism <prism-id>` moves its
character onto an existing Prism account. The owner token is
`MUDBENCH_OWNER_TOKEN` on the world unit; an unset token refuses every rebind.
A credentialed account still uses `login` then `adopt`.

A bare legacy account that is no longer wanted can be removed offline with
`tools/delete-legacy.mjs --state <world.json> --name <account> --confirm`.
Stop the world first. The tool refuses an online character, progression, a
second character, mail, a guild, a duel or a held object; it archives the state
file and writes atomically. It is for baseline cleanup, not a player command.

The name/password form remains under **Use a name and password instead** for
telnet, CLI clients and older accounts: `register <name> <password>` creates a
legacy account with one character; `login <name> <password>` returns;
`password <old> <new>` changes. Legacy token accounts use `login <name> <key>`.
Prism accounts have no password. Passwords are scrypt hashed; use the WebSocket
URL for a public world, because telnet carries the password in clear text.
