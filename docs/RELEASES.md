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
- v0.63.3 (operator block) blocks the exact Prism ids that held pins at reset
  time, so a client that mints a new session cannot re-create a removed test
  identity (MB-90);
- a SHA with no green Gate run (`a78f57e`) refused before the tag was created;
- the timer pulled v0.34.0; v0.33.0 was deployed and verified (101 accounts,
  101 characters), then v0.34.0 restored;
- the timer now exits when the newest release is already on the box.
