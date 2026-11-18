# Watching a run

The interface is three panels: the game stage, the AI conversation/Studio, and
the Model Control rail. The model rail is first, so provider, model, fast mode
and Start are visible before the run; once live, the conversation and Mind
share the center. Telemetry opens from the header as a focus drawer. The page
stacks to one column below 980px.

The live AI Studio has four tabs, and the human and the AI can be online at once.

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

## The public watch page

`/watch` is a read-only spectator view of one live run. The AI panel has a
**Go live** button next to Pause/Step/Stop. Nothing is published until the
owner presses it; pressing it again stops the stream, and a disconnect or
`quit` clears it. Only one run can be live at a time.

The page shows the run's character, current room, tick, viewer count, the
commands the AI issued and the public text it saw. Audience messages go to the
AI as director input, labelled as untrusted:

```
Audience viewer-1 (untrusted viewer): check the north corridor
```

The wire is one WebSocket at `/live`. Spectators receive `#stream` JSON:
a `snapshot` on connect, then `live`, `event`, `chat`, `viewers` and `off`.
They can send only `chat <text>`; the server refuses anything else and limits a
connection to one message per 1.5 seconds.

The AI publishes `command`, `room`, `status` and `text` events over its
authenticated game socket with `stream event <json>`. The server filters every
text event again with `runtime/stream.mjs`, which removes tells, mail, account,
password and session lines. Private thoughts, the Model tab and the transcript
are **not** published unless the owner stars a thought as a clip. The stream is
a public projection, not a screen share.

### Highlights and clips

The star on a thought is the publish control. If the run is live, starring a
thought also sends a `highlight` event. The watch page shows it as a clip card
with a **Copy clip** button. The owner is choosing to publish that thought;
without a star it stays private.

### Audience polls

The run panel has **Start poll** and **Close poll**. A poll is a question and
two options; the wire is:

```
stream poll Which way? | north | east
stream poll close
```

Spectators vote with `vote a` or `vote b`. Each viewer gets one vote per poll;
the counts update live, and the streamer receives the closed result as director
input. A vote is rate-limited with chat.

### Moderation

**Chat off** stops audience messages without stopping the run; **Chat on**
restores them. The server rejects a message while chat is off. Viewer messages
and poll votes are limited to one action per 1.5 seconds per connection.

## Local models

Ollama, an OpenAI-compatible endpoint and Prime Router need no key. The setup
shows the provider status; **Find** lists the models the endpoint exposes. The
key field is hidden for a no-key provider, and the hint explains how to start
Ollama if it is not answering.
