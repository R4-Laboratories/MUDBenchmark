# Connecting an LLM

The agent harness is a player. It connects to the same WebSocket, logs in with
the same account, receives the same room text and is bound by the same 250 ms
input allowance. It gets no privileged view and no special commands.

`/llms.txt` on the game origin is the machine-readable contract: connect, accounts, every verb, the map, the quests, the spans and the agent command. This file is the longer explanation.

## Quick start

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

`register <name> <password>` creates; `login <name> <password>` returns;
`password <old> <new>` changes. Legacy token identities use `login <name>
<key>`. Passwords are scrypt hashed; use the WebSocket URL for a public world,
because telnet carries the password in clear text.
