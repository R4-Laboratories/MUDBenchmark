# Next work

Baseline: **v0.85.0**. The world has 103 rooms, 14 zones, 53 quests, 48 mobiles
and 98 objects. R4 memory, command grounding, scorecards
and the public stats surface are live; signups are open and the Gemini demo is
disabled and unconfigured.

The next phase is **endgame depth and evidence from real play**, not another
memory or prompt system.

## Current roadmap

| Release | Scope | Status |
| --- | --- | --- |
| v0.77.0 | The Eclipse Court: six-room level-10 capstone, quest chain, keyed vault, dawn gate; balance sampler reads real world data | **done** (MB-125) |
| v0.78.0 | Per-guild hall vault and the repeatable clerk's errand | **done** (MB-127) |
| v0.79.0 | Social talk quest, chat-rate guard and reserved names | **done** (MB-129) |
| v0.80.0 | Persistent ignore lists, quest-earned titles and telemetry tuning | **done** (MB-131) |
| v0.81.0 | The Memory Garden fact/recall quest and R4 fallback | **done** (MB-133) |
| v0.82.0 | The crescent garden quest, facts command and live level-10 run | **done** (MB-135) |
| v0.83.0 | The Remembered Bed fact-gated action and unscripted run | **done** (MB-137) |
| v0.84.0 | Route memory, room-loop detection and unscripted completion | **done** (MB-139) |
| v0.85.0 | Root Archive, BFS route hints and waypoint run | **done** (MB-141) |
| v0.86.0 | Broader live sessions and the next world slice | next |

## What is next

1. **Live-run tuning.** The sampler is deterministic, not live evidence. Run
   human/AI sessions, read `/stats` and the combat spans, and tune status
   durations, aggression, mana costs and the level 8-10 reward curve.
2. **Guild depth.** The guild hall vault now stores 20 goods per guild, with
   deposit/withdraw and reset/restart/disband coverage. A high-rank guild quest
   line remains open.
3. **Repeatable content.** The clerk's errand is the second reset-cycle quest.
   Add a higher-rank repeatable and a weekly cadence if the live data warrants
   it.
4. **Memory quests and actions.** `memory-garden` and `garden-moon` record
   facts learned from NPCs. The Remembered Bed uses a fact-gated `plant rose`
   action to open a hidden room, and `facts` lists what the character knows.
5. **Moderation.** Chat has an eight-line/ten-second guard, reserved names and
   a persistent ignore list across tells, mail, channels, guild chat, socials
   and room speech. A fuller blocked-name policy remains open.

## Historical workstreams

The sections below are the v0.66-v0.70 plan. Workstreams A-C are complete and
are kept as a record of the contracts they established; D and E carry the
remaining items.

## Workstream A — R4 memory service

### A1. Contract spike (one release, no production dependency)

Run `casey-allard/prime-router` on a development port. Add or wrap one endpoint:

```http
POST /api/context
{
  "identity": "prism:<public-id>:<character>",
  "text": "the current room, events and command result",
  "limit": 8
}
```

It must return:

```json
{
  "concepts": [{ "term": "vault", "score": 0.93, "source": "room:4" }],
  "context": "bounded token block for the model",
  "tokens": 320,
  "latency_ms": 12,
  "state_version": 41
}
```

Acceptance:

- identity state survives a service restart;
- two characters of the same Prism account do not share memory;
- retrieved concepts explain why a room, object or fact was chosen;
- context is capped at 400 tokens;
- p95 retrieval under 150 ms on wick;
- the service can be stopped without stopping the game.

If prime-router cannot expose retrieval without becoming the voice model, put a
thin adapter around `prime_router_package.py` and leave its chat endpoint alone.
The spike produces a short report: API, dependencies, CPU/RAM, persistence and
quality on 30 fixed game observations.

### A2. Production memory service

- systemd user unit `mudbench-memory.service`, loopback only;
- snapshots under `~/.mudbench/memory/`, atomic writes, retention;
- `/health` and `/metrics`;
- game server proxy, never exposed through Cloudflare;
- browser asks for context over the authenticated game socket, not with a new
  public endpoint.

Fallback: if the service is down, the game uses the current browser-local
`MEMORY` block and keeps playing. The service is an enhancement, not a
single point of failure.

Acceptance:

- 20-turn scripted revisit: the AI recalls the plaque word, a chest's contents,
  a visited room and one unexplored exit;
- no cross-character or cross-account context;
- restart restores the same state version;
- context injection is visible in the Model inspector;
- a service outage produces a visible “memory fallback” status, not a stall.

### A3. R4 token injection

The R4 block joins the existing prompt as `R4 CONTEXT`, ahead of the local
`MEMORY` block:

```
R4 CONTEXT:
- vault: seen at The Vault, word AMBER; source room:4
- shrine: answer here; source room:6
- chest: open, contained a copper coin; source room:2
```

The local memory remains the fallback and the loop guard. The R4 block is
retrieval, not a second chat model.

## Workstream B — Grounded actions and scorecards

### B1. Command grounding

Add a pure `validateCommand(command, promptState)` in `runtime/web/ai.mjs`:

- legal verb, known target, known exit, known item or template;
- if invalid, one repair attempt with the validation reason;
- if still invalid, fall back to `look` and record `ai.invalid`.

Acceptance: invalid-command rate below 2% over a 50-turn Gemini run; no valid
social command is blocked.

### B2. Scorecards

Extend `ai.turn` and `/trends` with:

- `ai.invalid`, `ai.loop`, `ai.memory_hit`, `ai.rooms_seen`;
- latency p50/p95 by model and reasoning mode;
- parse rate, invalid rate, room coverage, repeat rate, quest progress;
- a Model dashboard card showing the current run against its recent baseline.

The benchmark remains descriptive, not a pass/fail “smart” score.

### B3. Deterministic loop test

Extend the gate with a 20-turn mock that always repeats one command. It must:

- trigger the memory warning;
- traverse at least three distinct rooms;
- never pause the run;
- never emit an impossible exit when the current room's exits are known.

## Workstream C — Gemini and provider operations

- Rotate the Gemini key that was pasted into chat; replace it in
  `~/.mudbench/owner.env` without printing it.
- Add a quota readout to the Model/Telemetry panel: used/remaining daily and
  minute turns, configured model, last 429.
- Confirm free-tier limits for the configured model and tune
  `GEMINI_DAILY_TURNS` / `GEMINI_MINUTE_TURNS` against them.
- Add a `Reset demo token` path for operator key rotation.
- Keep a documented fallback: own key, local Ollama, or custom endpoint.

Acceptance: a real 429 is shown as a clear message; a token after key rotation
works; no key reaches the browser, transcript or telemetry.

## Workstream D — World, social and stream

- social memory: **done** — public speech with private-line filtering and R4
  retrieval;
- a second outdoor region and five quests: **done** — the Hollow Fen, Salt
  Caves and Moonlit Reach followed;
- guild rank 6 and one more guild quest line: **done** — guild level 6 and the
  Ember/Fen guild quests are live;
- public stream: **done** — archives, clips and the live status card;
- next: a guild vault/bank, repeatable guild work and social quests that use
  the memory layer.

## Workstream E — Launch and operations

- Account policy: **decided** — signups stay open.
- Gemini: **retired** — the testing key was removed, its backup deleted, and
  `/api/demo` reports `configured:false`.
- Moderation and abuse: still open — chat rate limits, mute/ignore and a
  blocked-name policy.
- One more backup/restore and reboot drill after the v0.77 deployment.

## Sequence

| Release | Scope | Status |
| --- | --- | --- |
| v0.66.0 | R4 spike report, native prime/GCD concept index | **done** (MB-100) |
| v0.67.0 | R4 loopback sidecar, scoped retrieval, note journal, game proxy, fallback | **done** (MB-101/102) |
| v0.68.0–3 | Command grounding, scorecards, deploy readiness, R4 journal/benchmark hardening | **done** (MB-103–107) |
| v0.69.0 | Social memory, Hollow Fen, guild level 6 | **done** (MB-108/109/110) |
| v0.70.0 | Stream archive/clips, quota alerts, signup mode, restore drill | **done** (MB-111/112) |
| v0.71.0 | Visibility commands: who, quests, levels, leaderboard, map, shortcuts | **done** (MB-113) |
| v0.72.0 | Full shortcut map, socials, battle/stat visibility, public stats | **done** (MB-114/115) |
| v0.73.0 | Scaled spells, Salt Caves, first-run/spectator prompts | **done** (MB-117/118) |
| v0.74.0 | Combat status effects, enemy tactics, spell/gear scaling | **done** (MB-119) |
| v0.75.0 | First Steps tutorial and deeper Salt/Fen quest chains | **done** (MB-121) |
| v0.76.0 | Live balance review and the Moonlit Reach | **done** (MB-123) |
| v0.77.0 | The Eclipse Court level-10 capstone and real-data balance sampler | **done** (MB-125) |
| v0.78.0 | Per-guild hall vault and the repeatable clerk's errand | **done** (MB-127) |
| v0.79.0 | Social talk quest, chat-rate guard and reserved names | **done** (MB-129) |
| v0.80.0 | Persistent ignore lists, quest-earned titles and telemetry tuning | **done** (MB-131) |
| v0.81.0 | Memory-aware conversation quest and the next content slice | next |

## Risks

- **Prime-router persistence**: its state may be process-local and its corpus
  large. The spike must prove snapshot/restore before production.
- **Dependency weight**: NumPy/GloVe/zeta data may be heavy on wick; measure
  CPU/RAM and keep the service optional.
- **Retrieval quality**: geometric similarity may return interesting but
  irrelevant concepts; the 30-observation report is the go/no-go gate.
- **Privacy**: identity-scoped memory must never cross characters; the service
  is loopback and the game proxies only the current character's context.
- **Latency**: a memory lookup must not add more than ~100ms to a 1s Gemini
  turn; fall back to local memory if it does.
- **Free tier**: quotas and data terms can change; the demo remains opt-in and
  replaceable.
- **Account churn**: a live client can recreate test accounts; a signup policy
  is an operator decision, not a code accident.

## Decisions taken

1. **Memory host**: wick, loopback only, with local-memory fallback.
2. **Memory portability**: the server-side identity store is authoritative;
   browser localStorage remains the fallback.
3. **Account policy**: signups stay open.
4. **Level cap**: level 10 stays the cap for v0.77, with the Eclipse Court as
   the endgame. Raising it is a later decision.
5. **Gemini**: retired; the testing key is no longer stored.
