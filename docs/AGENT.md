# Connecting an LLM

The agent harness is a player. It connects to the same WebSocket, logs in with
the same account, receives the same room text and is bound by the same 250 ms
input allowance. It gets no privileged view and no special commands.

`/llms.txt` on the game origin is the machine-readable contract: connect, accounts, every verb, the map, the quests, the spans and the agent command. This file is the longer explanation.

## Watch an AI play in the browser

Open the game and choose **Watch AI**. The AI gets its own character and plays
through the same page: the left pane is its view, the Director chat is yours,
and the Mind panel is its reasoning. The provider key never reaches the game
server; it is stored in this browser's localStorage and sent only to the
provider's endpoint.

| Brain | Base URL | Key |
| --- | --- | --- |
| Ollama (local) | `http://localhost:11434/v1` | none |
| OpenAI | `https://api.openai.com/v1` | required |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | required |
| OpenAI-compatible (custom) | any `/v1` endpoint | optional |
| Prime Router (hypersphere, local) | `http://localhost:8000` | none |

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
verifies a signed `prism/session/1` action against the id's public log. The wire
message is `prism <base64url session>`. The Prism id is the **account**, shown
as `prism:<first 8 hex>`. The account owns characters; the character name is
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
characters; the next start creates a new persona. Without a human sign-in the
AI uses its own account. A device revoked elsewhere is refused once a surviving
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

The name/password form remains under **Use a name and password instead** for
telnet, CLI clients and older accounts: `register <name> <password>` creates a
legacy account with one character; `login <name> <password>` returns;
`password <old> <new>` changes. Legacy token accounts use `login <name> <key>`.
Prism accounts have no password. Passwords are scrypt hashed; use the WebSocket
URL for a public world, because telnet carries the password in clear text.
