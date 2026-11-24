# Completion — the run's win condition

MUDBench is a persistent world, but a character's run has a finish line. The
run is **beaten** when all three are true:

1. **Level 10** — the top of the experience table (30,000 XP).
2. **Every live quest** — all 23 quest definitions in `world/data/quests.json`
   are in the character's completed list.
3. **Every hidden way** — all 22 secret exits have been found.

A hidden way is the puzzle set. It is the `room:direction` record the engine
already keeps when `search` or a room action reveals a secret exit. The tally
counts only secret exits that still exist, so retired content does not leave a
permanent hole.

## The commands

```text
completion      (aliases: goal, win)
score
titles
title worldbreaker
```

`completion` prints the live tally:

```text
Completion: level 10/10 · quests 23/23 · hidden ways 22/22.
Run beaten at tick 123456. Worldbreaker title earned. Moderator/immortal mode is not implemented.
```

Before completion it prints the same tally with the three conditions and no
record. `score` prints the tally as a second line. The agent's prompt carries a
`GOAL:` line with the same numbers.

## The permanent record

The first tick on which a character satisfies all three conditions writes a
**completion record** into the character:

```json
{ "tick": 123456, "cycle": 12, "level": 10, "quests": 23, "puzzles": 22 }
```

The record is saved with the identity, survives logout and server restart, and
is never removed by a later death, reset or new content. If the character has no
title, the **Worldbreaker** title is worn automatically; otherwise it is added
to the earned list and can be selected with `title worldbreaker`.

The title is a record, not a privileged role. **Moderator/immortal access is
still not built**; it stays a later product decision.

## What counts

| Fact | Where it lives | Persistence |
| --- | --- | --- |
| Level 10 | `actor.level` / XP table | identity checkpoint |
| Live quests | `actor.quests.completed` | identity checkpoint |
| Hidden ways | `actor.found` (`room:direction`) | identity checkpoint (new in v0.91.58) |
| Completed run | `actor.completion` | identity checkpoint |

The 22 hidden ways are spread across the Harbor Quay, the Lantern Quarter,
the Undervault, the Memory Garden, the Grey Keep, the Arcanum, the Mistfall,
the Deepdelve and the Drowned Foundry. `search` reveals a room's secret exits; some rooms also have an
action that opens the way (a ferry token, a key, a spell, a party, a planted
rose). Both routes count, because both set the same fact.

## Verification

- The Gate builds a level-10 character with all 23 quests and all 22 ways,
  checks the tally, records the run once, and checks the record, title and
  `found` list survive `checkpointIdentities`.
- The Gate also checks that level 9, one missing quest or one missing way is
  **not** a completed run, and that a recorded run stays achieved after the
  live tally falls.
- A live client completed the run from a prepared identity, saw `Run beaten`,
  wore `Worldbreaker`, logged out and back in, and still had the record, the
  title and all 22 discovered ways.

The completion tally does not change the world counts: **225 rooms / 15 zones /
23 quests / 105 mobiles / 248 objects**.
