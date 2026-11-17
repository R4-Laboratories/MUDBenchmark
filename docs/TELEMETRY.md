# Telemetry and trends

The game is the instrument. There is no pass/fail “model smart” benchmark here;
there is a stream of observations from every client and every world tick, and
queries over that stream. A benchmark claim is something we add later, when the
data shows a stable pattern worth testing.

## What is recorded

The server writes flat JSONL spans to `TELEMETRY_LOG` (default
`/tmp/mudbench-spans.jsonl`) and, when `OTEL_EXPORTER_OTLP_ENDPOINT` is set,
also exports OTLP. The local file is always written now: a collector is a
convenience, not the only record. The file rotates at
`TELEMETRY_MAX_BYTES` (64 MiB by default); the archive keeps a timestamp and a
new live file is started.

| Span | What it carries |
| --- | --- |
| `world.client` | transport, origin, connection id |
| `world.disconnect` | transport and connection duration |
| `world.session` | login/register, actor, account key, Prism or legacy |
| `world.input` | accepted or refused command, actor, tick, latency |
| `world.transition` | move, room from/to, admission verdict |
| `world.snapshot` | every 240 ticks: online, accounts, characters, rooms, mobiles, objects, reset countdown, phase, weather, actor levels/equipment/quests, guilds |
| `world.quest`, `world.combat`, `world.trade`, `world.object`, `world.guild`, `world.social`, `world.channel`, `world.tell`, `world.mail`, `world.claim`, `world.answer` | the corresponding game action |
| `ai.turn` | provider, model, latency, prompt/completion/thinking tokens, parse result, command, thought length, timeout/error, turn, tick |
| `agent.decision` | harness-only router context and layers |
| `stream.viewer` | public watch join/leave and viewer count |

`ai.turn` is sent by the browser AI panel after every turn and by the harness.
It carries only numbers and the command. Thoughts, prompts, replies and provider
keys never reach the server. The full Prism id is a stable pseudonym in the
span stream; the public `/spans` endpoint returns aggregates and redacted recent
command ticks, not command text, actors, rooms or private messages.

## World status

`worldStatus` (`runtime/worldstatus.mjs`) is one shape used by:

- the `world` command — online players, level/XP, room, guild, wielded gear,
  reset countdown, phase, weather;
- `GET /world` — the same status as JSON;
- the `world.snapshot` span — the same status every checkpoint.

It includes per-actor level, XP, HP, room, guild, quest counts, inventory count,
worn equipment and wielded item; guild membership counts; totals for accounts,
characters, rooms, mobiles and objects; and the two-hour reset countdown. It
does not include passwords, tokens, mail text or private tells.

## Trends

```sh
node tools/trends.mjs /path/to/spans.jsonl
node tools/trends.mjs --json /path/to/spans.jsonl
```

The report is descriptive: AI turns, latency p50/p95/max, token and thinking
counts, parse rate, timeouts, providers/models, command mix, accepted/refused
input, sessions/transports, and the latest world snapshot (online, accounts,
levels, reset). `--out` writes the JSON summary.

The first useful questions are:

- Which providers/models keep parse rate high while reducing latency?
- Which commands produce the most refusals, and where do players get stuck?
- How does online count and level distribution move across the reset?
- Which rooms and quests are actually used?
- Do audience messages change the AI's next command?

Once a question has enough data to state a rate with an interval, it can become
an `open` claim in `claims/ledger.json`; only a gate-tested checker becomes a
`build` claim.

## Retention and privacy

- Production should set `TELEMETRY_LOG` to a durable directory, not `/tmp`.
- The span log is server-side. `/spans` is the public redacted view.
- Do not add prompts, thoughts, replies, keys or private message text to
  spans. If a trend needs a private message, record its length or hash, not the
  text.
- The account lifecycle and retention policy are tracked in
  `docs/IDENTITY-ROADMAP.md` §E; telemetry retention is part of that decision.
