# Watching a run

The live AI panel has four tabs, and the human and the AI can be online at once.

| Tab | Shows |
| --- | --- |
| Mind | The AI's private thoughts. The star records a highlight. |
| Run | Turn, command, token and latency stats; the highlight list; transcript download/copy. |
| Model | The exact system and user prompt, the trimmed context, the raw reply, the parsed command, the persona, the owner and the tick range. |
| Bench | A benchmark over the server's span log: count, ticks, commands, latency, actors, rooms, kinds, recent command ticks. |

## Ticks

Every accepted command records one `world.input` span with the command text and
the world tick. The server also sends a hidden `#tick <n>` line to the client.
The AI records that tick on the transcript turn, so the turn and the span agree
exactly:

```json
{ "name": "world.input", "text": "score", "world.tick": 124, "at": "..." }
```

```json
{ "turn": 16, "command": "score", "tick": 124, "thought": "..." }
```

The transcript itself carries `persona`, `owner`, `tick_from`, `tick_to` and
every turn's `tick`. The span log is the server's own record; the transcript is
the client's.

## Highlights

The star on a thought records:

```json
{
  "turn": 16,
  "tick": 124,
  "command": "score",
  "thought": "The room is quiet. I will score.",
  "room": "The Atrium",
  "persona": "sha256:…",
  "owner": "sha256:…",
  "at": "…"
}
```

The highlight is reproducible from the span log: the `world.input` span at the
same tick has the same command. The Run tab lists the highlights; the
transcript download and copy include them.

## Bench

`GET /spans?limit=100` returns:

```json
{
  "schema": "mudbenchmark/spans/1",
  "count": 203,
  "kinds": { "world.input": 28, "world.tick": 130, "world.npc": 24 },
  "ticks": { "min": 0, "max": 146 },
  "latency": { "count": 4, "avg_ms": 3, "max_ms": 12 },
  "actors": 2,
  "rooms": 10,
  "commands": 28,
  "recent": [{ "tick": 146, "at": "…" }],
  "file": "/tmp/mudbench-spans.jsonl"
}
```

The endpoint returns aggregates and recent command ticks, **not** command
text. The full log has the command text for the server's own replay and
dataset tools; the public page never receives private tells or mail text
through the bench.

## Local models

Ollama, an OpenAI-compatible endpoint and Prime Router need no key. The setup
shows the provider status; **Find** lists the models the endpoint exposes. The
key field is hidden for a no-key provider, and the hint explains how to start
Ollama if it is not answering.
