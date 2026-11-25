# Next work

Baseline: **v0.91.69**. The world has 251 rooms, 17 zones, 25 quests, 114 mobiles
and 263 objects. The run has a recorded win condition: level 10, all 25 quests
and all 25 hidden ways, with the permanent Worldbreaker title. R4 memory, command grounding, scorecards
and the public stats surface are live; signups are open. Every AI key is
supplied by the player; Groq is the free option, and each browser harness runs
its own R4 router. The server hosts no model and holds no provider key.

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
| v0.86.0 | Root Road, Long Remembering and map-seeded route guard | **done** (MB-143) |
| v0.87.0 | Sunken Orchard and per-target multi-objective planning | **done** (MB-145) |
| v0.88.0 | Remote DeepSeek validation and multi-objective completion | **done** (MB-147) |
| v0.89.0 | Orchard Undercroft and two-quest remote completion | **done** (MB-149) |
| v0.90.0 | Cider Spring, route lock and three-quest remote completion | **done** (MB-151) |
| v0.91.0 | Observed-action verification and repeatable orchard work | **done** (MB-153) |
| v0.91.1 | Prism AI login and random character names | **done** (MB-155) |
| v0.91.2 | Memory-only AI start guard | **done** (MB-156) |
| v0.91.3 | Old AI character recovery | **done** (MB-158) |
| v0.91.4 | Merged-PR auto release and hash-verified pull deploy | **done** (MB-160) |
| v0.91.5 | Browser session reconnect and resume | **done** (MB-162) |
| v0.91.6 | Archmage Eclipse guild line | **done** (MB-163) |
| v0.91.7 | Repeatable Archmage's Trial | **done** (MB-165) |
| v0.91.8 | Blocked-name policy and player reports | **done** (MB-167) |
| v0.91.9 | Generated names pass the new-name policy | **done** (MB-169) |
| v0.91.10 | Player-session, quest and combat statistics | **done** (MB-171) |
| v0.91.11 | Compact player log for the player view | **done** (MB-172) |
| v0.91.12 | Historical AI/human session inference | **done** (MB-173) |
| v0.91.13 | Level distribution from the last populated snapshot | **done** (MB-175) |
| v0.91.14 | Publisher requires the PR merge commit | **done** (MB-176) |
| v0.91.15 | Short commands, combat/economy, Wardens guild and free streaming default | **done** (MB-178–181) |
| v0.91.16 | 20-quest spine, archive and migration | **done** (MB-183) |
| v0.91.17 | Zone gear drops and Wardens rank perks | **done** (MB-185) |
| v0.91.18 | Body/offhand gear depth and combat rates | **done** (MB-187) |
| v0.91.19 | Remote tuning harness and no-change decision | **done** (MB-189) |
| v0.91.20 | PvP and unseeded balance bands | **done** (MB-191) |
| v0.91.21 | Faction standing and quartermasters | **done** (MB-193) |
| v0.91.22 | Weapon-family techniques | **done** (MB-195) |
| v0.91.23 | Outlaw paths: Night Market, Ashen Hand, Red Company | **done** (MB-197) |
| v0.91.24 | Forge upgrades, salvage and set bonuses | **done** (MB-199) |
| v0.91.25 | Rotating world event and Ring duel ladder | **done** (MB-201) |
| v0.91.26 | Unseeded high-level tuning scenario | **done** (MB-203) |
| v0.91.27 | Set completion, character sheet, Guard and Training Yard | **done** (MB-205) |
| v0.91.28 | Owner report view and accessibility pass | **done** (MB-207) |
| PR #11 | Federated regions prototype: rebased onto v0.91.28, handoff/fingerprint fixes, CI green | **reviewed** (`f99bf75`, draft) |
| v0.91.29 | Terminal history, Play HUD and public world-pulse charts | **done** (MB-209) |
| v0.91.30 | Free-agent front door, personas and custom-provider drawer | **done** (MB-211) |
| v0.91.31 | Watch directory, decision cards, run stats and PvP delay | **done** (MB-213) |
| v0.91.32 | Browser accessibility audit and ARIA/focus fixes | **done** (MB-215) |
| PvP | Live mirror, two-agent, asymmetric and random-tick samples | **done** (MB-217/219/221) |
| v0.91.33 | Agent PvP contract and stay-in-the-Ring guard | **done** (MB-218) |
| v0.91.34 | First PvP adjustment: ember brand and Red Company helm | **done** (MB-222/223; confirmed MB-225) |
| v0.91.35 | Mobile header menu, text connection status and phone audit | **done** (MB-226/227) |
| PvP model | Fixed-damage model validates v0.91.34 and the ember-8 target | **done** (MB-229) |
| v0.91.36 | Second PvP adjustment: ember brand 7 → 8 after a paired live sample | **done** (MB-230/231) |
| v0.91.37 | First-time human onboarding: character panel, First steps, recovery note | **done** (MB-233/234) |
| v0.91.38 | Post-tick HUD refresh for pending command intents | **done** (MB-236/237) |
| v0.91.39 | Signed-in accessibility audit and 24px HUD targets | **done** (MB-239/240) |
| v0.91.40 | Watch replay: archived run events, Replay view and browser test | **done** (MB-242/243) |
| v0.91.41 | Durable replay archive across server restarts | **done** (MB-245/246) |
| v0.91.42 | Core loop: quest coins, Training Yard tour, coin sinks | **done** (MB-248/249) |
| v0.91.43 | Persistent gold across logout, death and reset; equipment reset | **done** (MB-251/252) |
| v0.91.44 | Reset countdown, warnings and gold/equipment messages | **done** (MB-254/255) |
| v0.91.45 | Combat HUD: current enemy name/HP and Battle action | **done** (MB-257/258) |
| v0.91.46 | `consider`/`con` target stats and danger read | **done** (MB-260/261) |
| PvE sample | Live geared boar/wolf 20/20 each; no balance change | **done** (MB-263) |
| v0.91.47 | The Grey Keep: 15-room questless castle shell, keys, dark, pick, reliquary | **done** (MB-264/265) |
| v0.91.48 | Grey Keep fill to 45 rooms; Warden track; reliquary cap | **done** (MB-267/268) |
| v0.91.49 | The Arcanum: 21-room Mages' tower; detect/shield gates; light-gated dark rooms | **done** (MB-270/271) |
| v0.91.50 | Fast agent: remove Pollinations; Groq free key; operator fast proxy; 429 backoff | **done** (MB-273/274, production MB-275) |
| v0.91.51 | Local free agent: Qwen2.5-3B on CPU, no key, no per-request cost; high quotas | **done** (MB-276), removed in v0.91.52 |
| v0.91.52 | Bring your own key: Groq free, Anthropic/OpenAI/DeepSeek/custom; browser R4 router | **done** (MB-278/279) |
| v0.91.53 | DeepSeek: thinking off fast, 300/600 token floors, empty-reply retry; key preservation | **done** (MB-281/282) |
| v0.91.54 | Agent notebook/self/combat context; combat lock + costly flee; 20-slot pack; Mistfall dark/maze/ferry/teleport quest | **done** (MB-283/284/285) |
| v0.91.55 | Death penalty (50% XP + level); level gates; two-player Twin Door; Night Market hide/detect; Completionist | **done** (MB-286/287/288) |
| v0.91.56 | Party system (invite/accept/leave/kick/disband, shared kill XP and quest credit); Deepdelve party mine with winch, pump, cart, gas/canary, seam, coracle and ore contract | **done** (MB-289/290) |
| v0.91.57 | Deepdelve guardian tuned from 70/7/4 to 55/5/3 after a two-actor balance sample | **done** (MB-292) |
| v0.91.58 | Win condition: completion tally, permanent record, Worldbreaker title, persisted hidden ways, `completion` command and AI `GOAL` | **done** (MB-293/294) |
| v0.91.59 | The Drowned Foundry: 12-room level 9/10 party dungeon below the Deepdelve, five party actions, Night Market valve shortcut, foundry gear, repeatable quest and a party-scale master | **done** (MB-296/297) |
| v0.91.60 | Zone consolidation: Harbor into Town, Undercroft into the Lantern Quarter, Eclipse Court into the Moonlit Reach; 18 -> 15 zones, no room/quest changes | **done** (MB-299/300) |
| v0.91.61 | The Flooded Monastery: 14-room level 8/9/10 story dungeon below the Grey Keep, keyed sacristy chest, party bell rope, crypt, drowned abbot and repeatable quest; 24 quests and 23 hidden ways | **done** (MB-301/302) |
| v0.91.62 | The Merry Dancer: 12-room level 7/8/9 sunken wreck off the docks, free salvage skiff, party capstan, keyed strongbox, tide-glass quest and drowned captain; 25 quests and 25 hidden ways | **done** (MB-304/305) |
| v0.91.63 | Agent mind: PLAN/LESSON, persistent attempts and lessons, player/NPC social split, combat/gear coaching, engaged-NPC hold, opening-room prose | **done** (MB-307) |
| v0.91.64 | Agent coach hardening: NEXT priority, one-command guard, carried-gear wield/wear, known-NPC-elsewhere guard, combat menu trimming; local 3B model run | **done** (MB-309) |
| v0.91.65 | Focus planner: structured quest objectives, FOCUS/ROUTE/CANDIDATES, combat/equip/take/quest/offer/explore priority; 15-turn DeepSeek run equipped, socialized, accepted a quest and fought | **done** (MB-311) |
| v0.91.66 | Route seed from `/llms.txt`; room-action validation; upgrade-only gear; party focus and group_actions; no fake `battle` fight action; 80-turn and Deepdelve party DeepSeek runs | **done** (MB-313) |
| v0.91.67 | Objective lock and quest switching: score active objectives, fall back to a reachable offer when one is unanswerable, force the focus after two detours; 100-turn DeepSeek run completes 4 quests | **done** (MB-315) |
| v0.91.68 | Answer/fact focus: learn the Vault door word, route the Shrine and answer; retain active objectives over tied offers; validate focus exits; live death smoke | **done** (MB-317) |
| v0.91.69 | Answer completion: `answer` advances the word quest, wrong answers repair to the known word, item matching ignores stopwords; focused answer, boss-kill and model-death evidence; 120-turn three-quest run | **done** (MB-319) |
| backlog | Longer DeepSeek/Groq evidence; moderator/immortal decision; larger PvP sample; federation rework | optional |

## What is next

1. **Live-run tuning.** The sampler is deterministic, not live evidence. Two
   remote DeepSeek Mirror Pool sessions produced 14 rounds, a 64.3% hit rate,
   4.67 average damage and no deaths. The live two-client PvP mirror sample adds
   240 level-5 attacks (40.0% hit rate, 6.5 damage) and 192 level-10 attacks
   (41.7% hit rate, 11.4 damage), with winners at 4/40 and 11/65 HP and no
   one-shot. The mirror is deterministic, so a win-rate estimate still needs
   asymmetric gear, model-driven clients or human players. No balance change
   is justified.
2. **Outlaw paths.** The Night Market is the third rank guild; the Ashen Hand
   and Red Company are standing factions. Thieves/assassins use daggers and
   Backstab, barbarians use axes and Rage, dark priests use unholy maces and
   Drain. No further rank guilds are planned for these archetypes.
3. **Quest budget.** The live table is now 25; 41 retired definitions are in
   `world/data/quests-archive.json`, and active characters are migrated with a
   completion/abandon note. `docs/QUEST-BUDGET.md` records the spine.
4. **Repeatable content.** The Archmage's Trial is the reset-cycle repeatable.
   Add a weekly cadence or a second high-rank loop if the play data warrants
   it.
5. **Memory Garden actions.** The Garden keeps its facts and its fact-gated
   `plant rose` action, but its quests are retired. Use the rooms for
   exploration and gear, not another checklist.
6. **Moderation.** Chat has an eight-line/ten-second guard, reserved names and
   a persistent ignore list across tells, mail, channels, guild chat, socials
   and room speech. New names enforce a 3-24 character shape and a token-aware
   reserved-word policy; `report <name> <reason>` writes a durable operator
   queue while sharing the chat guard. The remaining gap is a routine operator
   review loop, not another player-facing control.
7. **Accessibility evidence.** Source checks and the desktop plus 390x844
   mobile browser audits pass (landmarks, names, first-Tab skip links, tabs,
   tables, contrast, reduced motion, no overflow, 24px targets and the mobile
   menu). A human VoiceOver/NVDA pass and a final hands-on phone review remain
   open.
8. **Federation.** Draft PR #11 remains open. The owner decision is to reject
   its current trust model: a mutually trusted peer receives legacy password
   hashes and salts and can assert a character's progression. Federation must
   use Prism-signed character grants, never transfer passwords, and fail closed
   on an unknown grant. The draft is kept for the contributor to rework against
   that model; production is unaffected while the federation environment
   variables are unset.

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

Acceptance: invalid-command rate below 2% over a 50-turn provider run; no valid
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

## Workstream C — Provider operations

- **Done:** Groq is listed as the free key; Anthropic, OpenAI, DeepSeek and
  custom OpenAI-compatible endpoints use the player's own key.
- **Done:** no provider key, model or R4 context lives on the game server.
- Keep the provider hints and free-key links current (Groq's model and limits
  change).
- Keep the browser R4 router (`router.mjs`) as the per-agent context path; the
  server R4 sidecar is optional for external agents/tools.
- A real 429 is shown as a clear message and retried with `Retry-After`; after
  the retry budget the agent pauses without losing the observation.

Acceptance: no key in `owner.env`, the page, transcript or telemetry; a real
429/402 is clear; the browser request contains the routed R4 context.

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
- **Latency**: a memory lookup must not add more than ~100ms to a 1s provider turn
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
