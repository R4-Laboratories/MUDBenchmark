# Tuning from telemetry

This is the v0.80 evidence pass. It uses the archived production spans, not a
fresh live session: at the time of the pass the world had 11 accounts and no
active connections. The numbers are still useful because they are real turns
and real combat rounds, not a hand-written scenario.

## Sample

- 1,440,758 spans across the current journal and two archives.
- 2,305 AI turns.
- 152 combat rounds.
- 138 talk events.
- Providers: 2,182 Gemini-demo turns, 112 Ollama turns, 11 prime-router turns.

## AI loop

| Measure | Result |
| --- | --- |
| Parse success | 2,290 / 2,305 = **99.3%** |
| Timeouts | 1 |
| Latency p50 | **980 ms** |
| Latency p95 | **2,695 ms** |
| Most common commands | examine, look, talk, take, east, north, search, west, south, inventory |
| Talk events | 138, led by the guard, innkeeper, bard, guild clerk and market woman |

The model is exploring and talking, not only walking. The top command is
`examine`, which is the intended first-five-minutes behaviour. Parse failures
are rare enough that a prompt rewrite is not justified by this sample.

## Combat

| Measure | Result |
| --- | --- |
| Rounds | 152 |
| Hit rate | **50.7%** |
| Average damage on a hit | **1.42** |
| Player hits / misses / kills | 30 / 41 / 6 |
| Enemy hits / misses | 41 / 34 |
| Most common targets | vault guardian, sewer rat, rat |

The 50.7% hit rate is the expected shape of `57 - armour`: armour and the
d100 roll make a hit roughly a coin flip. The low average damage is the
unarmed/early band, not the level-10 band. The deterministic sampler still
shows the intended spread:

```
early     57–67%
mid       63–100%
high      56–61%
capstone  40–98%
```

The prepared caster is at the top of the capstone range; the underleveled
melee character is at the bottom. The level-10 melee character is the 50%
case. That is the intended difficulty, so v0.80 does not change status
durations, aggression or the regent's 64 HP / 6 damage.

## Live session (v0.82)

The isolated level-10 run in `docs/LIVE-RUN.md` fought the eclipse regent for
**11 rounds**: 21 combat events, 9 hits, 11 misses and one kill, for a 47.6%
hit rate. The player dealt 66 damage and took 16, finishing at 6 / 28 hp. That
is the expected close fight the sampler predicted, so the regent's 64 hp / 6
damage stays.

The same run found a real progression defect: 30,000 XP produced level 11
because the table had eleven thresholds. The table is now ten levels ending at
30,000 XP, and the gate asserts the cap.

## Unscripted model run (v0.83)

`docs/UNSCRIPTED-RUN.md` records qwen2.5:7b against the isolated Memory Garden.
Before route memory, the model planted in both attempts but looped before the
hand-in. After the shared route ledger and loop guard, the third run finished
the Remembered Bed in seven turns: take rose, plant, down, take bloom, up,
north, talk. The BFS route and waypoint sequencer then completed the broader
Root Archive run in nine turns. Seeding the graph from `/llms.txt` and adding
the movement guard completed the town-spanning Long Remembering run in 13
turns. The server contract and the navigation guards both worked. The remote
DeepSeek runs then completed the Root Archive in 5 turns and all four Three
Rememberings objectives in 24 turns without local inference. The two-quest
Press Beneath / Clerk Errand run completed in 31 turns with an objective
dependency guard. The three-quest Press Beneath / Cider Spring / First Bed run
then completed in 23 turns with the route lock enabled.

## What would change the conclusion

A fresh human or unscripted-agent session in the level 8-10 band, especially
one that starts without seeded gear and records the combat spans. The isolated
run is real server evidence, but its character and kit were seeded.
