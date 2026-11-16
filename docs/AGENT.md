# Connecting an LLM

The agent harness is a player. It connects to the same WebSocket, logs in with
the same account, receives the same room text and is bound by the same 250 ms
input allowance. It gets no privileged view and no special commands.

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

## Memory and prime-router

The model conversation is a bounded window; when it grows, the oldest turns
fall out. A long-term memory backend is the next phase: a `memory` interface
with `window`, `file`, `summary`, and an optional `prime-router` HTTP adapter
that stores observations and recalls related ones. Prime-router would be a
memory store beside the bridge, not a privileged client and not a replacement
for the server's state.

## Fairness

The server refuses a command that arrives inside 250 ms of the last accepted
one and records `world.input`. The harness waits 300 ms between sends. A model
cannot out-click a human, and a human cannot out-click a model.

## Accounts

`register <name> <password>` creates; `login <name> <password>` returns;
`password <old> <new>` changes. Legacy token identities use `login <name>
<key>`. Passwords are scrypt hashed; use the WebSocket URL for a public world,
because telnet carries the password in clear text.
