# Live run: v0.82.0

This is the first isolated **real server** session for the level-10 band. It is
not production player data, and it is not an LLM decision trace. It is a
reproducible WebSocket client against a freshly started `runtime/server.mjs`.

## Setup

- Seed: one level-10 character at the Moon Throne with the full dawn kit.
- Server: private ports 8098 / 4011, private state and span files.
- Memory: `R4_URL` points at a closed port, so the local fact store is the
  fallback path.
- Holo: a verifier double admits transitions; the real model is still gated by
  `tools/gate.mjs`.
- No production account, state file or telemetry was touched.

Run it again with:

```
node tools/live-session.mjs
```

## Combat

The bot attacked the eclipse regent and waited through the violence pulse.

| Measure | Result |
| --- | --- |
| Combat rounds | **11** |
| Combat events | 21 |
| Hit rate | **47.6%** |
| Kills | 1 |
| Player damage | 66 (regent has 64 hp) |
| Enemy damage | 16 |
| Player HP at the end | 6 / 28 |

The fight was a real win, not a scripted outcome: the bot took burn ticks,
missed, and finished at 6 hp. The regent still died before the player.

## Memory quest

The same session then ran the Memory Garden chain:

```
talk guild clerk   → "The word the shrine wants is LEDGER."
recall ledger      → "You recall: ..."
east               → Quest complete: The Garden Remembers.
facts              → LEDGER (from guild-clerk)
titles             → Gardenkeeper
title gardenkeeper → Title set: Gardenkeeper.
```

The final `score` shows `Level 10`, `Title Gardenkeeper`, and four completed
quests.

## Bug found and fixed

The live run exposed a progression bug: 30,000 XP produced **level 11** because
the table had eleven thresholds. The design and every quest call level 10 the
cap. The table is now ten entries, ending at 30,000 XP, and the gate asserts:

```
0 XP         → level 1
15,000 XP    → level 9
29,999 XP    → level 9
30,000 XP    → level 10
```

## Limits

- The character and gear were seeded; this is not a fresh-player run.
- The holo is a verifier double for the live session; the real model is covered
  by the gate and the release artifact.
- The bot is scripted, so this measures the server and content, not an LLM's
  decision quality.
- Production still had no active connections at the time of the run.
