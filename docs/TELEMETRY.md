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

The full log is dominated by tick spans. A compact player log sits beside it
(`PLAYER_LOG`, default `spans.players.jsonl` next to `TELEMETRY_LOG`) and keeps
only `world.session`, `world.disconnect`, `world.prism`, `world.quest`,
`world.transition`, `world.combat`, `world.snapshot` and `world.input`. `GET /players` reads that
small file. On first start the server seeds it from the existing main log, so a
release does not start the player view empty; it rotates at
`PLAYER_MAX_BYTES` (16 MiB by default). The main log remains the complete
record.

| Span | What it carries |
| --- | --- |
| `world.client` | transport, origin, connection id |
| `world.disconnect` | transport and connection duration |
| `world.session` | login/register, actor, account key, Prism or legacy, AI/human, level, guild and completed-quest count |
| `world.input` | accepted or refused command, actor, tick, latency |
| `world.transition` | move, room from/to, admission verdict |
| `world.snapshot` | every 240 ticks: online, accounts, characters, rooms, mobiles, objects, reset countdown, phase, weather, actor levels/equipment/quests, guilds |
| `world.quest`, `world.combat`, `world.trade`, `world.object`, `world.guild`, `world.standing`, `world.forge`, `world.duel`, `world.social`, `world.channel`, `world.tell`, `world.mail`, `world.claim`, `world.answer` | the corresponding game action; `world.standing` records faction/value, `world.forge` upgrade/salvage and `world.duel` begin/win |
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

## Players

`GET /players` and `tools/players.mjs` answer the player-behaviour questions
that the AI trend view cannot. The endpoint reads the compact player log; the
CLI accepts either log:

```sh
node tools/players.mjs /path/to/spans.jsonl
node tools/players.mjs --json /path/to/spans.jsonl
```

The summary is aggregate-only:

- sessions: logins, registrations, Prism/legacy, human/AI, unique accounts and
  characters, returning accounts, active days (where `session.ai` is absent,
  the matching `world.prism` record supplies `prism.ai`; legacy sessions with
  neither stay in `ai_unknown`);
- playtime: completed connections, open connections, total/average/median/max
  duration (playtime covers completed connections; open ones are counted
  separately);
- quests: accepted, completed, abandoned, completion rate, and a per-quest
  actor/completer table;
- combat: rounds, hits, misses, NPC/PvP rounds, hit rate, kill rate, average damage, NPC kills, PvP kills, player deaths and player death rate;
- rooms: visits, unique rooms, average rooms per account and the top rooms;
- levels: the latest snapshot's average, maximum, distribution and guilded
  count;
- commands: accepted/refused and the average per connection.

The public `/stats` page renders the same summary. It never receives an account
key, character name, chat line, tell or mail body; the per-account join stays
inside the server process. `docs/MODERATION.md` covers the separate report
queue.

Once a question has enough data to state a rate with an interval, it can become
an `open` claim in `claims/ledger.json`; only a gate-tested checker becomes a
`build` claim.

## Retention

```sh
node tools/telemetry-retention.mjs --dir ~/.mudbench/telemetry
node tools/telemetry-retention.mjs --dir ~/.mudbench/telemetry --apply
```

The live `spans.jsonl` and `trace.jsonl` are never removed. Archived files older
than 90 days are removed first, then the oldest archives until the directory is
under 4 GiB. The default is a dry run; `--apply` deletes the listed archives.
The gate tests the planner with a live file, an expired archive, a recent
archive and a byte cap.

## Retention and privacy

- Production should set `TELEMETRY_LOG` to a durable directory, not `/tmp`.
- The span log is server-side. `/spans` is the public redacted view and `/players` is aggregate-only. The compact player log is server-side too; it is smaller but has the same privacy boundary.
- `login`, `register`, `password`, `adopt`, `prism`, `session-key`, `rebind` and
  `metric` inputs are recorded as verb + length + policy only. `tell`, `mail`
  and guild chat keep metadata, not bodies. `world.tick` intents and the
  `world.baseline` state are sanitized before writing; the trace file is too.
- `tools/scrub-telemetry.mjs --file <log> --in-place` rewrites logs written
  before the policy; it preserves counts and timings.
- Do not add prompts, thoughts, replies, keys or private message text to
  spans. If a trend needs a private message, record its length or hash, not the
  text.
- The account lifecycle and retention policy are tracked in
  `docs/IDENTITY-ROADMAP.md` §E; telemetry retention is part of that decision.
