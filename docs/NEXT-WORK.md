# Next work

Baseline: **v0.65.1**. The world is 70 rooms / 31 quests, the browser shell is
state-based, a per-character memory is injected every turn, and the Prism-only
Gemini demo is live with `gemini-3.1-flash-lite` (p50 ~1.1s in a 37-turn run).
The local 7B model remains hardware-bound at ~5.6s/turn.

The next phase is not more prompt wording. It is moving context out of the
model's short chat history and into an identity-scoped memory service, then
proving that the model uses it.

## Goals

1. **R4 memory**: an identity-scoped context service that keeps state
   indefinitely, retrieves by the R4 integer/concept space, and returns a
   bounded token block for each turn.
2. **Grounding**: fewer invalid commands and fewer repeated actions; the
   server stays the authority.
3. **Measurement**: scorecards by provider, model, prompt and reasoning mode:
   latency, parse rate, invalid-command rate, room coverage, loop rate, quest
   progress.
4. **Operations**: safe Gemini quota/key handling, account/signup policy,
   rollback and restore drills.
5. **World**: social and quest depth after the memory system is trustworthy.

## Non-goals for this phase

- No claim that the LLM itself remembers. Memory belongs to the service.
- No change to the 250 ms input allowance or server authority.
- No silent free default; the Gemini demo stays opt-in and quota-limited.
- No new world systems until the memory/action loop is measured.

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

Only after A/B:

- social memory: remember who said what, guild membership, NPC dialogue facts;
- a second outdoor region and five quests using existing systems;
- guild rank 6 and one more guild quest line;
- public stream: audience retention, clips, stream status (the v2 status card is
  already live).

## Workstream E — Launch and operations

- Decide the account policy: current live set is a few active/test accounts and
  a recurring client. Options: allow signups, invite-only, or a temporary signup
  hold while the demo is curated.
- Moderation and abuse: chat rate limits, blocked-name policy, demo quota.
- Cost caps and alerts for the Gemini demo.
- One more backup/restore and reboot drill after the memory service is added.
- Rotate the exposed key and record the rotation date.

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
| v0.76.0 | Live balance review and next content slice | next |

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

## Decisions needed

1. **Memory host**: run the R4 service on wick (loopback, lowest latency) or a
   separate machine? Recommendation: wick first, with a measured CPU/RAM cap.
2. **Memory portability**: server-side identity store is required for the real
   R4 design; browser localStorage remains the fallback. Confirm that direction.
3. **Account policy**: allow open signups, invite-only, or a temporary hold
   while the demo is curated.
4. **Gemini key rotation**: do it now or after the next demo run. The key is in
   chat history and should be treated as exposed.
