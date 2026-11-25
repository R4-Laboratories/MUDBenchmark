# Releases

A release is a tag. wick's deploy timer pulls the newest release every ten
minutes, replays its acceptance vectors, flips both units, and rolls back if
either fails. A release contains the holo (the rules), its manifest, the
identity receipt, the admission receipt, and the runtime tarball. The tag is the
version on the box.

## One action

```sh
gh workflow run release.yml --ref main \
  -f sha=<40-character-commit-sha> \
  -f tag=vX.Y.Z \
  -f notes="what changed"
```

`release.yml` does not build. It:

1. checks out the exact SHA and refuses a different commit;
2. finds a **successful Gate run for that SHA**;
3. downloads that run's artifact — the holo the Gate built, proved and
   replayed, its manifest and the identity receipt;
4. creates the tag;
5. publishes the release with the artifact, the runtime, the identity receipt
   and the admission receipt.

A missing, pending or red Gate run stops the workflow before the tag exists, so
a red commit cannot become a release. The tag push uses `GITHUB_TOKEN`, which
does not trigger a second Gate run; the artifact that is published is the one
the Gate already tested.

## The loop's path

The loop's tick commits the admitted pacing candidate, waits for the main
`Gate` run on that exact SHA, and dispatches this same `release.yml` with a
`v<current>-loop.<n>` tag. The loop's release is therefore the one-action path,
not a second one. `docs/SELF-IMPROVEMENT.md` records the branch decision.

## The older tag path

A manually pushed `v*` tag runs Gate on the tag and its `publish a tagged
release` job publishes after the model job. The self-improvement loop tags
`vX.Y.Z-loop.N` and dispatches Gate on that ref for the same reason: a tag
pushed with `GITHUB_TOKEN` does not start a workflow by itself. Both paths
publish only after the model is proved and every acceptance vector replays.

## Deploy and rollback

```sh
mudbench-deploy            # the newest release
mudbench-deploy vX.Y.Z     # a named release
mudbench-deploy --status   # what is on the box
```

The deploy script proves the artifact before flipping either unit and rolls
back if the world or the holo fails to start. A rollback is the previous tag:
`mudbench-deploy <previous-tag>`. The account/character state is forward
compatible; rolling back the runtime does not rewrite the world state.

The timer asks for the newest release every ten minutes. If that tag is already
on the box it exits without restarting; an explicit `mudbench-deploy vX.Y.Z`
always deploys, which is what makes the rollback rehearsal possible.

## Rehearsal

Rehearsed 2026-11-16:

- v0.34.0 released from `8b6b241` by one dispatch, Gate run 43973358653;
- v0.35.0 (L1) released from `296e467` by the same one-action path;
- v0.36.0 (recovery kit) released from `b48810c` the same way; the deploy
  asset proof now also checks `/recovery-kit.mjs`;
- v0.37.0 (character handoff) released from `57d7638` after rebasing the
  loop's pacing tick;
- v0.38.0 (stream polish) released from `552d805`; the deploy serves
  `/spans`;
- v0.39.0 (admission kernel) released from the L5 commit; the release carries
  both receipts;
- the loop's first real commit `2f0d8ce` was released as `v0.36.0-loop.3.1`
  and pulled by the deploy timer;
- the first admitted pacing candidate `c-4abd39bfc4ff` was committed as
  `a118a66` with its admission record, released as `v0.39.1-loop.manual`,
  deployed, rolled back to `v0.39.0` and restored;
- v0.40.0 (session-key challenge) released from the L3 commit; an open tab
  needs a reload to pick up the challenge client;
- v0.41.0 (owner-authorized rebind) released from `202bbdc`; `k1`,
  `public-test` and `agent` moved to `prism:4c40ff2d`, the three legacy
  accounts retired, and the world stayed at 105 accounts / 106 characters;
- after v0.41.0, the bare token-only account `casey` was deleted offline at
  owner request; the state was archived first and the world is now at 104
  accounts / 105 characters (MB-32). No runtime release was needed for a state
  deletion;
- v0.42.0 (public watch page) released from `a0a82bb`; `/watch` and `/live`
  serve in production, the unauthenticated `stream on` guard works, and a local
  headless run proved Go live, the public feed, audience chat and stop
  (MB-33/34);
- v0.42.1 (patch) released from `f2ba6f7`; the harness exits when a run ends,
  the watch page does not echo a sender's own chat, and the seven-room control
  is recorded (5/6 single, 4/6 corroborated, 1/6 wrong-first vs 0/6). The first
  v0.42.1 deploy rolled back on a startup race in the asset probe; the probe
  now retries for up to 16 seconds, and the re-deploy passed;
- v0.43.0 (telemetry) released from `07fe135`; durable spans, AI turn metrics,
  periodic world snapshots, `world`/`/world`, `tools/trends.mjs`, and the
  redaction policy. The pre-policy 1.9M-span and 39k-trace logs were scrubbed
  and archived before the switch (MB-36/37);
- v0.44.0 (providers) released from `fa6d87d`; custom OpenAI/Anthropic
  endpoints, optional keys, per-origin key storage, URL normalization and fast
  mode with a look fallback (MB-38);
- v0.45.0 (watch v2) adds highlight clips, audience polls and a chat toggle to
  the public watch page (MB-39);
- v0.46.0 (commands and state) adds AberMUD short forms, an `equipment` view
  and the hidden `#state` line used by the AI prompt and R4 router (MB-40);
- v0.47.0 (first world slice) adds eight equipment slots, six spells and the
  Mages' Guild, seven Lantern Quarter rooms, three personal quests and a guild
  ledger quest; the world is 40 rooms / 13 quests (MB-41/42/43);
- v0.48.0 (Undervault) adds four rooms below a searchable secret stair, two
  mobiles, two objects, the Mirror Pool/Wardstone quests, and mage rank
  advancement; the world is 44 rooms / 15 quests (MB-45/46);
- v0.49.0 (scrolls) adds spell scrolls, mage `study`, universal `recite`, and
  validated scroll spell ids (MB-48);
- v0.50.0 (room actions) adds the data-driven action engine and three live
  actions: turn mirror, push statue and ring bell; the secret Mirror Pool room
  makes 45 rooms (MB-50);
- v0.51.0 (Undervault II) adds five rooms behind a ward-key-gated Deep Door,
  two mobiles, four objects, the Drowned Ledger and Three Parts of a Sigil
  quests, and item requirements for actions; 50 rooms / 17 quests (MB-52);
- v0.52.0 (guild cycle) adds the repeatable Sigil Trial, questCycles, guild
  levels/perks and the hall-chest perk; 18 quests (MB-54);
- v0.53.0 (launch hardening) adds telemetry retention and a session clock-skew
  check; dry run against the live directory keeps the live files (MB-56);
- v0.54.0 (guild quests) adds The Mirror Ledger and The Warden's Debt, plus
  shrine prayer and wardstone touch actions; 20 quests / 7 action verbs
  (MB-58);
- v0.55.0 (M7) adds ten Undervault rooms, four linked quests, three mobiles,
  five objects and two actions; 60 rooms / 24 quests / 9 action verbs. The
  read-only account audit and a production restart drill are recorded
  (MB-60);
- v0.56.0 (guild economy) makes spell training cost coins and the trainer
  discount functional; a live-copy corruption drill refuses a truncated state
  (MB-62);
- v0.57.0 (account cap) refuses new legacy/Prism accounts at MAX_ACCOUNTS
  (default 500) while leaving existing logins alone; boundary and live test
  recorded (MB-65);
- v0.58.0 (guild-quest-2) enforces one/two active guild quests by the perk and
  exposes guild level/XP/perks in the public world status (MB-67);
- v0.59.0 (account age) records lastSeenTick and reports inactive accounts in
  the read-only audit without deleting them (MB-70);
- v0.60.0 (magician tier) adds The Choir Bell and The Reliquary Lens guild
  quests and the adept→magician rank transition; 26 quests (MB-76);
- v0.61.0 (interface) rebuilds the web shell around a prominent Model Control
  rail, a conversation/Studio center, and a telemetry focus drawer, with a
  one-column mobile layout (MB-78);
- v0.62.0 (studio) adds the trends dashboard, the ten-room Ember Deep and five
  quests (70 rooms / 31 quests), and the state-based interface: Play context
  rail, dedicated setup workspace, live stage plus 520px Studio dock, model
  chip with a Change dialog, and a full-height telemetry sheet (MB-80/81/82);
- the launch cleanup archived 105 accounts / 106 characters / 8 pins and wiped
  them to zero; the host reboot drill brought holo, world and cloudflared back
  active (MB-83/84);
- v0.63.0 (stream v2) adds GET /stream and a compact Live now card in the Play
  rail, with the streamer, room, viewer count and a Watch live link (MB-85);
- v0.63.1 (watch polish) brings the public watch page onto the same tokens,
  header and type scale as the main shell (MB-87);
- v0.63.2 (revocation) refuses Prism sessions issued before an account reset,
  so deleting a pinned log cannot be undone by replaying the old session
  (MB-89);
- v0.64.0 (direct play) injects room, self, quest and social context into the
  prompt, keeps free-form commands, adds Auto/Always/Never reasoning and fixes
  Mind/chat scrolling; the Prism-only Gemini demo and its quota proxy are
  available when the operator configures a key (MB-92/93);
- v0.64.1 (Gemini live) configures the demo with gemini-3.1-flash-lite,
  corrects the model label and records a real nine-turn Prism-only run at
  p50 1.04s / p95 1.33s (MB-95);
- v0.65.0 (agent memory) adds persistent per-character room/command/stale
  memory, injects it every turn and replaces observation loops with a fresh
  action instead of pausing (MB-97);
- v0.65.1 (container context) adds open-container contents to the injected
  action menu, so the model uses take <item> from <container> instead of
  inventing commands (MB-98);
- v0.66.0 (R4-lite memory) records the full prime-router spike and adds a
  native prime/GCD concept index over the character's own notes, injected as
  Known: facts (MB-100);
- v0.67.0 (R4 sidecar) deploys the patched prime-router as a loopback memory
  service with scoped retrieval, a note journal and an authenticated game
  proxy; the browser injects R4 CONTEXT and falls back to local memory if the
  sidecar is down (MB-101);
- v0.68.0 (grounded actions) validates commands against the current room and
  repairs invalid targets before they reach the server; adds invalid/loop/
  coverage/memory/R4 scorecards by model (MB-103);
- v0.68.1 (grounding order) records validation before telemetry, accepts
  observation nouns when state lags, and repairs for-sale takes to buy
  (MB-104);
- v0.68.2 (deploy readiness) waits for login assets **and** /health for up to
  50s before rolling back, fixing the transient asset-check rollback (MB-105);
- v0.68.3 (R4 hardening) bounds and compacts the note journal, adds the
  100-query scoped benchmark (p95 3ms on wick), and shows R4 hit/latency or
  fallback in the Model inspector (MB-107);
- v0.69.0 (social fen) adds public-speech social memory with private-line
  filtering, the ten-room Hollow Fen, five quests, the green-key chest and
  green-heart shortcut, and guild level 6 with guild-quest-3 (MB-108/109);
- v0.70.0 (stream/launch) adds last-run archives and clip downloads, demo
  remaining-quota alerts and an operator SIGNUP_MODE switch (MB-111);
- v0.71.0 (visibility) adds richer who/quests, levels, all-time leaderboard,
  zone map/shortcuts, and exposes them to the AI action menu and /llms.txt
  (MB-113);
- v0.72.0 (shortcuts/stats) adds a shortcut for every verb, 30 socials,
  battle/score/spell/equipment visibility, livelier animal cadence, snap-to-
  latest panels and the public /stats dashboard with an all-time leaderboard
  endpoint (MB-114/115);
- v0.73.0 (depth) scales spells with level/focus, adds the five-room Salt
  Caves and two quests (85 rooms / 38 quests), and adds first-run and
  spectator onboarding prompts (MB-117);
- v0.74.0 (status) adds burn/bleed/chill effects from spells, weapons and
  enemy tactics, timed ticks, chill armour loss, Mend cleansing and effect
  display in score/battle/prompts (MB-119);
- v0.75.0 (first steps) adds the beginner tour and tutorial command, plus
  The Salt Ward and The Deep Fen reward chains; 41 quests (MB-121);
- v0.76.0 (moonlit reach) adds six rooms east of the deep forest, the moon
  hare, silver owl and moon stag, a moon-key chest, the crescent shortcut and
  three linked quests; the balance sampler joins the tools (MB-123);
- v0.77.0 (eclipse court) adds the six-room level-10 capstone above the Moon
  Throne, an eclipse-key chest, the dawn-gate shortcut and a three-quest chain;
  the balance sampler now reads the real world and its top-band fights (MB-125);
- v0.78.0 (guild vault) adds a 20-slot per-guild vault in the shared hall,
  deposit/withdraw commands, reset/restart/disband handling and the repeatable
  clerk's errand; 48 quests (MB-127);
- v0.79.0 (social/safety) adds the `talk` quest objective and the two-NPC
  hall-word quest, an eight-line/ten-second chat guard, and reserved names;
  49 quests (MB-129);
- v0.80.0 (safety/titles) adds persistent ignore lists across tells, mail,
  channels, guild chat, socials and room speech, quest-earned titles with a
  `title` selector, and a telemetry tuning report; 49 quests (MB-131);
- v0.81.0 (memory garden) adds NPC-learned facts, a local fact store mirrored
  to R4 with context fallback, the `recall` command, the three-room Memory
  Garden and The Garden Remembers quest; 100 rooms / 50 quests (MB-133);
- v0.82.0 (live garden) adds the crescent fact, The Moon in the Garden
  follow-up, the `facts` command, a reproducible live-server session and the
  level-10 cap fix; 51 quests (MB-135);
- v0.83.0 (remembered bed) adds a fact-gated `plant rose` action that consumes
  the memory rose and opens a hidden room, the Remembered Bed quest, Bedkeeper
  title and an unscripted qwen2.5:7b run; 101 rooms / 52 quests (MB-137);
- v0.84.0 (route memory) adds a shared room trail, unexplored-target exits and
  room-cycle detection to both agents; the unscripted qwen2.5:7b run completes
  the Remembered Bed in seven turns (MB-139);
- v0.85.0 (root archive) adds two rooms below the Remembered Bed, the first-bed
  quest, the first seed, BFS route hints and waypoint sequencing; the broader
  unscripted run completes in nine turns (MB-141);
- v0.86.0 (root road) adds a two-room shortcut from the Root Archive to Market
  Square, the town-spanning Long Remembering quest, map-seeded BFS routes,
  nearest-objective choice and a movement guard; the 13-turn unscripted run
  completes (MB-143);
- v0.87.0 (sunken orchard) adds three rooms below the Root Road, the orchard
  keeper, the windfall seed, the four-objective Three Rememberings quest and
  per-target `AGENT_OBJECTIVES` with wrong-room redirects; 108 rooms / 55
  quests (MB-145);
- v0.88.0 (remote agent) adds an OpenCode/DeepSeek provider path with no local
  inference, fixes the no-room loop, and validates both the 5-turn Root Archive
  and 24-turn four-objective Three Rememberings runs (MB-147);
- v0.89.0 (undercroft) adds three rooms below the Old Press, the press seed, the
  Press Beneath quest, objective dependencies and a two-quest remote DeepSeek
  run; 111 rooms / 56 quests (MB-149);
- v0.90.0 (cider spring) adds three rooms below the Seed Vault, the spring
  keeper, the cider bloom, the Cider Spring quest, a strict route lock and a
  23-turn three-quest remote DeepSeek run; 114 rooms / 57 quests (MB-151);
- v0.91.0 (verified actions) makes objective completion wait for the server's
  success line and adds repeatable Orchard Work; a 24-turn three-quest remote
  run completes with every action confirmed (MB-153);
- v0.91.1 (login/name fix) removes the standalone AI Prism fallback, opens
  existing AI characters instead of creating another, and generates random
  names for new AI/human characters with collision retry (MB-155);
- v0.91.2 (storage guard) refuses to start an AI persona in a memory-only/private
  window, where the next reload would create another orphan identity (MB-155);
- v0.91.3 (AI recovery) adds the explicit old-AI-session transfer: a signed
  `prism/character-transfer/1` action moves a selected orphaned character to the
  signed-in human Prism account, with session verification and ownership checks
  (MB-158);
- v0.91.4 (auto deploy) publishes a tagged release automatically when a merged
  PR has a green Gate on main, writes a hash-bound release manifest, and makes
  the pull deployer verify both assets before extraction (MB-160);
- v0.91.5 (reconnect) restores a Prism browser session after a region restart,
  resumes the active character only when no other session controls it, and adds
  a headless-Chrome reconnect test to the Gate (MB-162);
- v0.91.6 (archmage line) adds The Eclipse Ledger and The Dawn Archive, two
  rank-10 Mage quests using the Eclipse Court and the archmage's signet reward;
  60 quests / 102 objects (MB-163);
- v0.91.7 (archmage trial) adds the reset-cycle Archmage's Trial, consuming the
  regent's sigil for repeatable high-rank guild XP; 61 quests (MB-165);
- v0.91.8 (moderation) adds a 3-24 character new-name policy with token-aware
  reserved words, leetspeak folding and a legacy-safe login path, plus a
  durable `report <name> <reason>` queue that shares the chat guard (MB-167);
- v0.91.9 (generated names) replaces the `root` adjective with `rooted` so
  every random character name passes the v0.91.8 token policy, and the Gate
  checks every adjective/noun pair (MB-169);
- v0.91.10 (player stats) adds `GET /players`, `tools/players.mjs` and a
  `/stats` panel for sessions, human/AI mix, playtime, per-quest completion,
  combat outcomes, rooms and level distribution, aggregate-only (MB-171);
- v0.91.11 (player log) keeps a compact player-event log beside the full span
  log, seeds it from the existing log on first start and serves `/players` from
  it, so sparse session records survive the tail window (MB-172);
- v0.91.12 (player history) reads historical AI/human sessions through the
  matching `world.prism` record, includes `world.prism` in the compact log and
  shows the unknown-AI count on `/stats` (MB-173);
- v0.91.13 (level view) uses the most recent snapshot that actually holds
  players for the level distribution, so `/players` and `/stats` do not
  collapse to zero between sessions (MB-175);
- v0.91.14 (publisher guard) requires the gated SHA to be the PR's actual
  merge commit, so a later direct or pacing commit that GitHub associates with
  the merged PR cannot release (MB-176);
- v0.91.15 (player fundamentals) adds `t`/`take all`, `drink`, `coins`, grouped
  inventory, a 20 HP base with 5 HP per level, and removes fleeing from combat.
  The Gilded Rat sells ale for 10 coins, three sellable treasures enter the
  world, and shops refuse quest collectibles. Pollinations becomes the free,
  keyless, streaming default for the browser AI, the Wardens' Lodge opens a
  second guild with exploration ranks, the unreachable archmage promotion is
  repaired, and the quest count is frozen at 61 toward a 20-quest target
  (MB-178 through MB-181);
- v0.91.16 (20-quest spine) cuts the live table from 61 to 20, archives the 41
  retired definitions, remaps prerequisites and titles, and migrates active
  characters with a one-time completion/abandon note. Ember Deep, Hollow Fen,
  Salt Caves, Moonlit Reach and the Memory Garden keep their rooms, gear, keys
  and actions as exploration content (MB-183);
- v0.91.17 (zone gear) adds four armour drops to the Ember, Fen, Salt and Moon
  mobiles and gives the Wardens passive rank perks: scout +1 armour, ranger +1
  damage, warden both (MB-185);
- v0.91.18 (gear depth) fills body and offhand with smithy stock and eight more
  zone drops, and adds hit rate, kill rate, average damage, PvP/NPC rounds and
  player death rate to `/players` and `/stats` (MB-187);
- v0.91.19 (tuning evidence) adds the remote tuning harness, records two
  DeepSeek Mirror Pool fights (14 rounds, 64.3% hit, 4.67 average damage, no
  deaths), records take-all object ids, and updates the CLI agent to the
  no-flee/take-all/drink command set. No balance values changed (MB-189);
- v0.91.20 (PvP bands) extends the deterministic sampler with three PvP
  matchups and two unseeded high-level fights, and makes the bands a Gate
  check. PvP sits at 41–47%, unseeded level 8 is 51%, unseeded level 10 is 18%;
  no balance values changed (MB-191);
- v0.91.21 (faction standing) adds Ember/Fen/Salt/Moon standing from zone
  kills, the `standing` command, four quartermaster shops and five
  standing-gated gear pieces. It replaces retired quest checklists with a
  repeatable kill → standing → gear loop and adds `world.standing` spans
  (MB-193);
- v0.91.22 (weapon techniques) adds Power Strike, Cleave, Bash and Chill
  Strike as weapon-family moves with tick cooldowns, setup effects and
  `world.technique` spans, giving non-Mages tactical combat choices (MB-195);
- v0.91.23 (outlaw paths) adds the Night Market rank guild for
  thieves/assassins, the Ashen Hand and Red Company factions for dark
  priests/barbarians, Backstab/Rage/Drain techniques, and their quartermaster
  gear. It uses one new guild and two standing tracks, not four rank guilds
  (MB-197);
- v0.91.24 (forge) adds component salvage, +1..+3 gear upgrades at the Cold
  Forge, 3/4-piece set bonuses and `world.forge` spans, giving coins and zone
  materials a real sink (MB-199);
- v0.91.25 (events and PvP) adds the Ember/Fen/Salt/Moon world event rotation
  (double standing, 20% quartermaster discount) and the persistent Ring duel
  ladder with wins, losses, rating and `ladder`/`pvp`/`duels` (MB-201);
- v0.91.26 (high-level evidence) adds the unseeded level-8 Starless Hall
  scenario to the remote tuning harness. The first run reached 18 rounds with
  the star hound at 10/28 HP and the character at 36/55, no death; no balance
  values changed (MB-203);
- v0.91.27 (sets, sheet and training) completes the Ashen/Red/Night sets, adds
  shield Guard and five readable lore pieces, a web Character sheet with shop
  item stats, and the Training Yard east of the Guild Hall; 116 rooms / 57
  mobiles / 145 objects (MB-205);
- v0.91.28 (operator and access) adds the owner-token `/reports` JSON view,
  a documented review path, a Skip to game link and explicit
  focus/reduced-motion checks (MB-207);
- v0.91.29 (terminal UX and world pulse) adds command history, Tab completion
  and Ctrl+L; a compact Play HUD with HP/mana/XP, room/event, quest, exits and
  quick actions; an authenticated in-client World overview of players and
  fights while the public `/world` response stays aggregate; and public
  `/series` world-pulse charts (MB-209). The first deploy exposed a
  `curl | grep -q` SIGPIPE false rollback on the larger page; the deploy helper
  now downloads the asset probe before grepping.
- v0.91.30 (free agent front door) adds a landing hero with Play free, Start a
  free agent and Watch live; one-click Pollinations free agents with a browser
  Prism account created and registered automatically; five persona presets;
  a collapsed custom-provider drawer; and a header agent chip that keeps an
  agent running across Play/AI view switches with separate human and agent
  scrollbacks (MB-211);
- v0.91.31 (watch surface) adds the live/recent agent directory, structured
  decision cards, a Run stats tab with HP/mana/XP, level, room, quest, turn,
  commands, latency and tokens, an eight-run archive, and a server-enforced
  PvP stream delay (60s minimum) with a streamer-selectable 0/30/60/120s delay
  (MB-213);
- v0.91.32 (accessibility audit) adds `tools/a11y.mjs` to the CI Gate and fixes
  the issues it found: first-Tab skip links on all pages, watch/stats
  focus-visible rules, full tab/tabpanel ARIA and arrow-key navigation, a watch
  transcript log and polite announcer, named tables and charts, dynamic HP
  sparkline labels, and removal of the sign-in autofocus that pre-empted the
  skip link (MB-215);
- v0.91.33 (agent PvP path) adds `duel` / `duel accept` / `duel decline` to the
  CLI agent and browser AI command contracts, exposes other actors in the
  room state, adds a PvP stay-in-the-Ring guard and `tools/pvp-agents.mjs`,
  and records two remote-model duels plus an asymmetric dawn/ember live sample.
  No balance values changed in the agent-contract release (MB-218/219).
- v0.91.34 (first PvP balance adjustment) raises the ember brand damage 6 → 7
  and the Red Company helm armour 2 → 3 after independent random-tick samples
  showed dawn winning 30/41 (73.2%); the candidate sample is 25/40 (62.5%, CI
  47.0–75.8) and the confirmation is 37/60 (61.7%, CI 49.0–72.9), with the
  hit/damage curve unchanged (MB-222/223/225);
- v0.91.35 (mobile accessibility) adds a labelled header menu for Stats, Watch,
  Telemetry and font controls on phones, shows the connection state as text,
  hides the guest Latest overlay and raises primary touch targets to 44px; the
  browser audit now also runs a 390x844 phone pass for overflow, 24px targets,
  menu behavior, visible status and guest layout (MB-226/227);
- v0.91.36 (second PvP balance adjustment) raises the ember brand damage 7 → 8
  after a paired live sample on 7 fixed ticks × both login orders × both
  orientations: current dawn 16/28 (57.1%), candidate 14/28 (50.0%), two flips
  to ember and none back; ember's finishing margin improved in 22/28 pairs and
  never worsened (mean 5.14 HP, 95% CI 2.86–7.42), matching the fixed-damage
  model's 50.0% prediction (MB-230/231);
- v0.91.37 (first-time human onboarding) hides the character-creation panel
  while a character is playing, adds a full-width First steps action, warns
  free Prism accounts to save a recovery kit and hides the unsupported New
  character form on legacy accounts; `docs/ONBOARDING.md` records the audit
  (MB-233/234);
- v0.91.38 (HUD freshness) sends a post-tick `#state` to actors whose pending
  command intent ran, so quest completion, XP, inventory, armour and combat
  changes update the HUD immediately instead of one command later; the
  browser reconnect test now checks take/wear updates ARM without an
  intervening command (MB-236/237);
- v0.91.39 (signed-in accessibility audit) extends `tools/a11y.mjs` to create
  a Prism character and check the live shell at desktop and 390x844, and raises
  the HUD quick-action/exit targets from 22px to 24px (32px on mobile)
  (MB-239/240);
- v0.91.40 (watch replay) keeps the last eight completed runs with up to 400
  released events each, serves one at `/stream?run=<id>`, and adds a Replay
  decisions view with Play/Back/Step, a scrubber, decision cards, command/text
  timeline and state/stats summary. Finished runs replay without the live PvP
  delay; pending delayed events are not archived. A Chrome test publishes a
  synthetic run, checks the archive and steps the replay (MB-242/243);
- v0.91.41 (durable replay) writes completed runs to `STREAM_ARCHIVE_FILE`
  (default next to the state file, mode 0600, atomic rename), loads the last
  eight at startup and keeps the replay after a restart. The browser test now
  stops the server, restarts it, and replays the restored run (MB-245/246);
- v0.91.42 (core loop) adds quest coin rewards (First Steps 10, A Curled
  Scroll 10, Bread 5, The True Word 10), adds the Training Yard to the First
  Steps tour and gives explicit Yard/Smithy routes in the tutorial, and makes
  shops, training and forge upgrades consume payment instead of leaving the
  coins in the room. The first two quests now buy the short sword, and the
  Gate checks that paid coins are gone (MB-248/249);
- v0.91.43 (persistent gold) banks carried coins into the character's `gold`
  on logout, death and graceful shutdown, mints them back on login, and keeps
  held coins through the two-hour reset while equipment returns home and the
  wielded item is cleared. The Gate persistence test covers logout, login and
  reset (MB-251/252);
- v0.91.44 (reset clarity) adds a HUD reset countdown and hero world-reset
  line, broadcasts five-minute and one-minute warnings that gold/level/XP
  persist and equipment returns home, and tells the player on death/logout
  that gold is kept and equipment stays behind; the tutorial states the reset
  rule (MB-254/255);
- v0.91.45 (combat HUD) adds current enemies with name and HP to `#state`, a
  combat strip in the live HUD, and a Battle quick action; the training dummy
  shows `999/999 HP` without typing `battle` (MB-257/258);
- v0.91.46 (consider) adds `consider`/`con`: target level, HP, damage and
  armour, plus a harmless/fair/dangerous read based on HP, damage and armour;
  the training dummy reads harmless. The tutorial points at it before the
  first fight (MB-260/261);
- v0.91.47 (The Grey Keep) adds a 15-room questless border fortress at the
  King's Road: immersive rooms, a keyed postern and vault, a Night Market
  `pick` shortcut, dark cellar/tower/vault with working light, food and gear,
  guards and an optional level-6 captain, and a chapel reliquary that consumes
  treasure for experience. World 131 rooms / 15 zones / 20 quests / 68 mobiles
  / 165 objects (MB-264/265);
- v0.91.48 (Grey Keep fill) extends the keep to 45 rooms: upper gallery and
  chambers, library and map room, servants' wing, crypt/ossuary/sealed room,
  gate roof, armory, smithy, well, cistern, kennel and hayloft. It adds the
  Warden `track`/`seek` scout skill, the library cabinet and star chart, the
  sealed guardian and the 100-XP-per-reset reliquary cap. World 161 rooms / 15
  zones / 20 quests / 79 mobiles / 194 objects (MB-267/268);
- v0.91.49 (The Arcanum) opens the Mages' Guild tower as 21 rooms: spiral stair,
  hall of names, lecture hall, scriptorium, lower/upper laboratories, observatory,
  star stair, prism chamber, rune gallery, sealed vault, bellows, aviary, mirror
  room, archivist's study, cold library, high walk, orrery, star well and prism
  vault. `read runes` needs detect; `pass ward` needs shield; four rooms are
  dark and need light. Adds the prism keeper, golems, wraith, gargoyle, owls and
  guild lore, with the prism heart, sealed codex, guild seal and star water.
  World 181 rooms / 15 zones / 20 quests / 90 mobiles / 214 objects; no new
  quests (MB-270/271);
- v0.91.50 (fast agent) removes Pollinations. The anonymous tier now allows one
  reply every 45 seconds per IP, which is too slow for a playable agent. The
  free card now uses Groq's free 8B instant model with a player key, or the
  operator's server-side fast model when `GROQ_API_KEY`/`FREE_AI_KEY` is set.
  The operator proxy (`/api/free/v1`) holds the key on the server, issues a
  short-lived Prism token, enforces per-account daily/minute quotas and passes
  `429` + `Retry-After` through to a client that waits and retries up to three
  times. Production runs the proxy with DeepSeek `deepseek-flash`; the key is
  only in `~/.mudbench/owner.env` on wick. The direct provider presets, Ollama
  and the custom drawer remain.
  World unchanged: 181 rooms / 15 zones / 20 quests / 90 mobiles / 214 objects
  (MB-273/274);
- v0.91.51 (local free agent) runs Qwen2.5-3B-Instruct Q4_K_M through llama.cpp
  on the server CPU behind the existing `/api/free` proxy. The model binds to
  loopback, uses about 2.5 GB of RAM and 20 of 32 threads, and generates about
  22 tokens/sec; a normal turn is 1–2 seconds. There is no key and no
  per-request cost. The quotas are raised to 100000 daily / 120 minute /
  1000000 world-wide so a session is not cut off mid-run. The fast prompt now
  repeats the exact THOUGHT/REPLY/COMMAND format and the parser recovers a
  short legal command from REPLY when a small model omits COMMAND. The Groq
  preset moves to `openai/gpt-oss-20b` (about 30 requests/minute, 1,000/day).
  World unchanged: 181 rooms / 15 zones / 20 quests / 90 mobiles / 214 objects.
  MB-276. The local model and its docs/unit were removed in v0.91.52;
- v0.91.52 (bring your own key) removes the server-hosted local 3B model and
  the operator/Gemini proxy. The free card asks for a provider key; **Groq** is
  the free option (`openai/gpt-oss-20b`, about 30 requests/minute and 1,000/day).
  **Anthropic**, **OpenAI**, **DeepSeek** and any OpenAI-compatible endpoint also
  work. Keys stay in the browser; the server holds no provider key and does not
  run or proxy a model. The AI harness computes its own R4/hypersphere context
  in the browser with `router.mjs` (affordances, objective, world, resources,
  persistence, social and recall), instead of calling the server R4 sidecar.
  Adds the DeepSeek preset, removes the local model service/files and the
  operator env. World unchanged: 181 rooms / 15 zones / 20 quests / 90 mobiles /
  214 objects (MB-278/279);
- v0.91.53 (DeepSeek fix) forces DeepSeek fast turns to `reasoning_effort: none`
  with a 300-token floor, uses `low`/600 on deliberate turns, and retries an
  empty-content reply once with 800 tokens while preserving the observation.
  It also saves a key typed in the setup panel before the mode switch, so
  `startAI` no longer re-renders the key field empty. A live browser session
  with a real DeepSeek key took the free gear, examined the Atrium plaque and
  walked north to the Corridor with no Brain error. World unchanged: 181 rooms /
  15 zones / 20 quests / 90 mobiles / 214 objects (MB-281/282);
- v0.91.54 (The Mistfall) adds a 14-room island reached by a bought ferry
  token: the dark wreck/hold/caves need a lantern, three identical hold rooms
  form a maze, the Salt Rose story quest sends the player through the wreck to
  the tide guardian and back to the lighthouse keeper, and the wayfarer's stone
  is a reusable teleport item. It also adds the 20-slot pack, the combat lock
  (movement is blocked while engaged; `flee` ends the fight and costs 10% XP),
  the "It is dark" default, and the agent's persistent NOTEBOOK plus SELF, PACK,
  COMBAT and SOCIAL prompt context. World 195 rooms / 16 zones / 21 quests / 95
  mobiles / 227 objects. The live walk completed the Salt Rose quest; a real
  DeepSeek session wrote and reused eight notes (MB-283/284/285);
- v0.91.55 (danger and groups) makes death cost **50% of current XP and one
  level**, PvE or PvP, and adds the deaths counter and win-condition prompt.
  It gates the Mistfall caves at level 4 and the grave reef/Tide Vault at level
  6, and adds the **Twin Door** (two players required) and Tide Vault crown.
  Night Market cutpurses can **hide**, leaving room descriptions, the actor list
  and `who` until they move or act; `detect` reveals them, and NPC aggression
  ignores them. Adds the Completionist persona. World 197 rooms / 16 zones / 21
  quests / 95 mobiles / 228 objects. A two-client live session hid, revealed by
  speaking, opened the Twin Door with one hidden partner and took the crown.
  Gate covers the death penalty, level gates, twin door, hide visibility and
  prompt (MB-286/287/288);
- v0.91.72 (open world and frontier) opens the map and makes exploration
  cumulative. Two new Temple rooms — **The Cliff Walk** (Atrium west to the
  Harbor Quay) and **The Cellar Stair** (Atrium down to the Undercroft) — join
  cross-links from the Shrine to the High Walk, the Grey Road to the Fen Gate,
  and the Docks to the Moonlit Gate. The Atrium is now a six-exit hub, and the
  Gate checks that the Harbor Quay is reachable without Market Square and the
  Docks without the King's Road. The explore focus now walks to the nearest
  **unvisited room on the seeded `/llms.txt` map**, not just the first exit;
  it is included in the focus lock, avoids stale directions and recent rooms,
  and the memory block prints `Rooms seen: N of 253` plus a `FRONTIER` line.
  The Mind now stores the model's `NOTE` lines and prints them back as `NOTES`
  (the browser notebook remains). A 120-turn DeepSeek run visited **34 rooms**
  and completed **4 quests** (First Steps, Bread, A Curled Scroll, The
  Apprentice's Charm), reached the Docks, Deep Forest, Grey Road, Moonlit Gate,
  Memory Garden and Root Archive, sent 120/120 commands, made 13 focus
  corrections and took 0 deaths at level 3 / 410 XP. A second 120-turn run
  visited 33 rooms, completed 3 quests, reached the Salt Caves and took 0
  deaths at level 3 / 414 XP. World now 253 rooms / 17 zones / 25 quests / 114
  mobiles / 263 objects (MB-326);
- v0.91.71 (federation protocol 2) replaces draft PR #11's password-transfer
  trust model. A region handoff now needs a Prism-signed
  `mudbenchmark/region-travel/1` grant for the destination origin plus a
  source-region Ed25519 attestation; no password, password hash or salt crosses
  the boundary, and a legacy password account is refused until claimed by a
  Prism id. The destination creates an account keyed by the Prism id, verifies
  the grant against the carried public records, checks the protocol, rules
  fingerprint and destination, and merges the previous local character record
  so guild, standing, components, titles, discovered details, ignores, memory
  and duel history survive a return. Carried items stay in the source region.
  Each region can disable skills, and `cast`, `train`, `study` and `recite` all
  consult the policy; `recite <scroll> on <target>` now parses the target after
  `on`. Transfer ids are replay-checked and bounded to 64; an uncertain
  handoff retries the same signed grant from the source. Federation mode
  checkpoints synchronously with rotation disabled and caps accounts at the
  lower of `MAX_ACCOUNTS` and `MUD_REGION_MAX_ACCOUNTS` (default 2,000):
  measured saves are 6 ms at 1,000 accounts, 8 ms at 2,000 and 22 ms at 10,000.
  The two-process test covers grant and region signatures, a Prism handoff,
  local-field return, skill filtering, replay and altered-grant refusal, legacy
  refusal, an outage retry and a process restart (3/3). Production is unaffected
  while the federation environment variables are unset. World unchanged: 251
  rooms / 17 zones / 25 quests / 114 mobiles / 263 objects (MB-324);
- v0.91.70 (player reports) fixes three live player bugs. Command lookup now
  lowercases verb names and aliases, so `takeFrom` is reachable after the
  parser lowercases input; the container branch accepts the `takeFrom` name as
  well as `take ... from ...`. The HUD refreshes any online actor whose HP,
  mana, effects, enemies or gear changed during the tick, so a ghoul's hit
  updates the health bar even though no player command ran. `inventory` now
  shows each item's worth and the half-price a shop pays, e.g. `a curled scroll
  [worth 5c; sells 2c]`. A live isolated-server smoke opened the chest, took the
  scroll with `takeFrom`, read the value in `inventory`, and observed the HUD
  state fall from 40 to 38 HP during automatic combat. World unchanged: 251
  rooms / 17 zones / 25 quests / 114 mobiles / 263 objects (MB-322);
- v0.91.69 (answer and fight proof) closes the answer loop and records model
  combat evidence. The `answer` command at the Shrine now advances the word
  quest instead of only printing acceptance; `answer <wrong>` is repaired to
  the known door word, and a known answer scores above a tied quest offer. The
  coach no longer treats a purse of coins as a loaf of bread (item matching now
  ignores `of`, `with`, `from` and `to` as well as articles). A focused
  DeepSeek run read the Vault door, walked to the Shrine, had `answer slate`
  blocked and repaired to `answer amber`, and completed The True Word (XP
  300 → 350). A focused boss run killed a training guardian from the model's
  own attack (XP 300 → 320), and a focused death run took the same character
  from level 3 / 300 XP to level 2 / 150 XP on its first death. A 120-turn
  DeepSeek run completed First Steps, Bread for the Shop and The Lighthouse
  Lens, visited 28 rooms, sent all 120 commands, produced 65 plans / 64 lessons,
  made 10 focus corrections and took no death. World unchanged: 251 rooms /
  17 zones / 25 quests / 114 mobiles / 263 objects. Gate covers the wrong
  answer, the stopword match, answer focus and every prior check (MB-319);
- v0.91.68 (answer and death) adds the answer/fact path: when the AI sees
  the Vault door word it stores it in the Mind, routes to the Shrine and offers
  `answer <word>`; `say <word>` at the Shrine is repaired to `answer`. Active
  objectives win ties with offers, and the focus lock refuses to force an exit
  the room does not have. A 100-turn DeepSeek run completed First Steps, Bread
  for the Shop and The Lighthouse Lens, visited 27 rooms, fought twice and took
  no death; a live death smoke took a level-3/300-XP character to level 2/150 XP
  with deaths 1 and recalculated max HP. World unchanged: 251 rooms / 17 zones /
  25 quests / 114 mobiles / 263 objects. Gate covers the answer word/coach,
  focus exit validation and every prior check (MB-317);
- v0.91.67 (objective lock) makes the focus planner compare active
  objectives and switch when one is unanswerable. It scores visit/kill/collect/
  deliver/talk objectives by whether the target is here or has a known route;
  an `answer` objective or a score of 1 falls through to a reachable quest
  offer. A bounded lock allows one detour; on the second unrelated command it
  takes the focus route/action. A 100-turn DeepSeek run against an isolated
  server completed **First Steps, Bread for the Shop, A Curled Scroll and The
  Lighthouse Lens**, held two active quests, visited 28 rooms, made 54 plans
  and lessons, and the lock corrected 7 loops. The 25-turn Deepdelve party run
  still turns the winch and reaches the surveyor. World unchanged: 251 rooms /
  17 zones / 25 quests / 114 mobiles / 263 objects. Gate covers objective
  scoring, quest switching, the lock and every prior check (MB-315);
- v0.91.66 (route and group focus) seeds the browser route graph from
  `/llms.txt` at AI start, so the planner can route to quest rooms it has never
  visited. It accepts data-driven room-action verbs (`turn winch`, `pump shaft`,
  `board cart`, `strike seam`) in pre-send validation instead of rejecting them
  as unknown commands. The combat menu no longer offers `battle` as a fight
  action (it only inspects), gear is offered only when it is an upgrade, and
  `group_actions` lets the planner form a party and use a ready group action.
  A 80-turn DeepSeek overworld run completed First Steps and explored 19 rooms;
  a 25-turn Deepdelve run formed a party with ann, turned the winch, descended
  and reached the surveyor and her notes. World unchanged: 251 rooms / 17 zones
  / 25 quests / 114 mobiles / 263 objects. Gate covers route seed, room-action
  validation, upgrade filtering, party focus, combat menu and every prior check
  (MB-313);
- v0.91.65 (focus planner) adds a model-independent planner in
  `runtime/web/planner.mjs`. The server now exposes structured quest objective
  details (kind, room, NPC, object, done), and the prompt gets a `FOCUS`,
  `ROUTE` and short `CANDIDATES` list. Priority is combat, equip carried gear,
  take room gear, the next unfinished quest objective, a quest offer, then
  exploration. The action menu is seeded with the focus candidates. A
  15-turn DeepSeek (`deepseek-flash`) run on an isolated server took and
  wielded the short sword, wore the grey cloak and leather jerkin, talked to
  the bard, sent a private `tell` to the player, accepted the `word` quest,
  went north and attacked the rat, then explored the Vault. No room, quest,
  item or mobile counts changed: 251 rooms / 17 zones / 25 quests / 114 mobiles
  / 263 objects. Gate covers planner priority, route, quest objectives and
  every prior check (MB-311);
- v0.91.64 (agent coach hardening) adds a `NEXT:` priority line (wield/wear,
  take room gear, next quest objective, or a quest offer), blocks two commands
  on one line or an item already carried (repairing to `wield`/`wear`), and
  remembers NPCs seen elsewhere so `tell <npc>` is refused even after leaving
  the room. The combat menu keeps only fight and help actions. A local 3B model
  run against an isolated server took and wielded the sword, wore cloak and
  jerkin, greeted the player, and used `talk` for an NPC; it still repeated
  commands, which the loop guard and coaches caught. World unchanged: 251
  rooms / 17 zones / 25 quests / 114 mobiles / 263 objects. Gate covers the new
  guards and every prior check; a real DeepSeek/Groq session remains the next
  evidence (MB-309);
- v0.91.63 (the agent mind) gives the browser AI a persistent structured mind
  instead of a longer transcript: identity, goal, `PLAN`/`LESSON`, the last
  twelve attempts with outcomes, derived lessons, the player/NPC social map,
  combat and gear state, and a stuck detector. A command coach redirects
  `say <npc>` and `tell <npc>` to `talk <npc>`, `talk <player>` to `tell`, and a
  repeat `attack` to a technique/battle/heal; a blocked command is not sent.
  The action menu drops attack while engaged and offers battle, techniques,
  food/drink, `cast mend`, `flee`, wield and wear. Engaged mobiles now hold
  their ground. The first 18 rooms have richer prose, with a Gate floor of 280
  characters, three ambient lines and two details. World unchanged: 251 rooms /
  17 zones / 25 quests / 114 mobiles / 263 objects. Gate covers the mind,
  coach, parser, combat menu, engaged-mobile hold, opening prose and every
  prior check. A real-provider run is the next behaviour evidence (MB-307);
- v0.91.62 (The Merry Dancer) adds a 12-room level 7/8/9 sunken wreck off the
  Docks. A free salvage skiff reaches the red buoy; the drowned deck has a party
  **capstan** that opens the cargo hatch, the galley holds the strongbox key,
  the strongroom holds the **tide-glass**, and the captain's cabin holds the
  log. The **drowned captain** (90 HP / 6 damage / 3 armour) guards the stern.
  Adds two wreck lanterns, a readable log, a keyed strongbox, the tide-glass,
  drowned coins and the repeatable **The Merry Dancer's Glass** quest
  (300 XP / 45 coins). Adds four mobiles, seven objects and two hidden ways;
  completion is now 25 quests and 25 hidden ways. World 251 rooms / 17 zones /
  25 quests / 114 mobiles / 263 objects. A two-client live session boarded the
  skiff, opened the capstan for both, used the key and strongbox, shared the
  captain's kill and completed the quest (MB-304/305);
- v0.91.61 (The Flooded Monastery) adds a 14-room level 8/9/10 story dungeon
  below the Grey Keep ossuary. A small iron key opens the banded sacristy chest,
  which holds the abbey clapper; a party of two with the clapper can pull the
  bell rope and open the secret stair to the abbot's cell. The site has ten dark
  rooms, two lanterns, a crypt, the drowned abbot (110 HP / 6 damage / 4 armour,
  shared kill credit), a silver bell relic and the repeatable **The Bell Below**
  quest (380 XP / 60 coins). Adds five mobiles, eight objects and one hidden way;
  completion is now 24 quests and 23 hidden ways. The quest table now rejects a
  quest that both collects and delivers the same object, because delivery
  consumes it. World 239 rooms / 16 zones / 24 quests / 110 mobiles / 256
  objects. A two-client live session used the key, chest, ledger and party bell,
  shared the abbot's kill and completed the quest (MB-301/302);
- v0.91.60 (zone consolidation) folds three small zone ids into their parents
  without moving a room: Harbor (4) into Town (14), the Undercroft (5) into the
  Lantern Quarter (11), and the Eclipse Court (6) into the Moonlit Reach (12).
  NPC wander zones follow the merge, so the docks, sewer and eclipse rooms stay
  populated. The world is now 225 rooms / **15 zones** / 23 quests / 105 mobiles
  / 248 objects; no room, quest, action, item or mobile changed. The Gate checks
  the 15-zone map, the room-to-zone assignment, the folded ids are gone and every
  prior check (MB-299/300);
- v0.91.59 (The Drowned Foundry) adds a 12-room level 9/10 party dungeon
  below the Deepdelve pool. A party **wheel** opens the drowned stair; the
  **valve**, **sluice**, **crane** and **bellows** each need two party members
  in the room, and a Night Market runner can **pick** the valve as a guild
  shortcut. The site has eight dark rooms, two lanterns, a foundry hammer, a
  heavy apron, a ledger, cold coins and a party-scale master
  (120 HP / 7 damage / 5 armour) with a shared-credit kill. Adds the repeatable
  **The Drowned Foundry** quest (420 XP / 70 coins), five mobiles, eight objects
  and five hidden ways. The default level table is aligned to the live ten-level
  cap, and the completion goal now counts 23 quests and 22 hidden ways. World
  225 rooms / 18 zones / 23 quests / 105 mobiles / 248 objects. A two-client
  live session turned the wheel, valve, sluice, crane and bellows for both
  members, shared the master's XP and kill credit, and completed the quest.
  Gate covers the map, level/dark gates, party actions, guild shortcut, quest
  and counts (MB-296/297);
- v0.91.58 (the win condition) records a completed run. A character beats
  MUDBench at **level 10, all 22 live quests and all 17 hidden ways**; the
  `completion` command (`goal`, `win`) and `score` show the tally, the agent
  prompt carries a `GOAL` line, and the first completion writes a permanent
  record with the tick and tally and awards the **Worldbreaker** title.
  Discovered hidden ways (`found`) and the completion record are now saved in
  the identity, so they survive death, reset, logout and restart; the record is
  never removed by a later level loss or new content. Moderator/immortal access
  is still not built. World unchanged: 213 rooms / 17 zones / 22 quests / 100
  mobiles / 240 objects. The Gate checks the tally edges, one-time record,
  title, checkpoint persistence and every prior check; a live client completed
  a prepared run, wore Worldbreaker, logged out and back in with the record,
  title and all 17 ways intact (MB-293/294);
- v0.91.57 (guardian tuning) lowers the Deepdelve guardian from 70 HP, 7
  damage and 4 armour to **55 HP, 5 damage and 3 armour**. A deterministic
  two-actor simulator of a level-8 pair with the mine pick lost to the 70/7/4
  build (both characters died with the guardian at 22 HP) and wins the 55/5/3
  build with about 35 HP each. No other world content changes; 213 rooms / 17
  zones / 22 quests / 100 mobiles / 240 objects;
- v0.91.56 (party and the Deepdelve) adds a real **party** (`party invite`,
  `accept`, `decline`, `leave`, `kick`, `disband`, `who`, up to six), shared 50% kill XP
  and quest kill credit for members in the same room, and a HUD refresh for
  party changes and shared progression. It adds the **Deepdelve**, a 16-room
  working mine off the graveyard: level 6/7/8 gates, dark tunnels, two lanterns
  and two canaries, a party **winch**, **pump**, **mine cart** and **sealed
  seam**, a **gas pocket** that burns without a canary, a **coracle** shortcut,
  a surveyor/captain/guardian story and the repeatable **Deepdelve** ore
  contract (320 XP / 50 coins). The agent prompt adds `PARTY`, `PARTY INVITE`
  and `GAS` context and party/gas rules. World 213 rooms / 17 zones / 22 quests
  / 100 mobiles / 240 objects. A two-client live session formed a party,
  opened the winch, cart and seam for both members, crossed the gas with both
  canaries, shared the guardian kill and 120 XP, completed the ore contract,
  and a level-6 character was refused at the level-7 winch room. Gate covers
  the mine map, party actions, shared XP/kill credit, gas and canary, and the
  live walk (MB-289/290);
- v0.63.3 (operator block) blocks the exact Prism ids that held pins at reset
  time, so a client that mints a new session cannot re-create a removed test
  identity (MB-90);
- a SHA with no green Gate run (`a78f57e`) refused before the tag was created;
- the timer pulled v0.34.0; v0.33.0 was deployed and verified (101 accounts,
  101 characters), then v0.34.0 restored;
- the timer now exits when the newest release is already on the box.
