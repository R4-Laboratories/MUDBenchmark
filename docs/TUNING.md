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

## What would change the conclusion

A real session in the level 8-10 band, especially one that fights the eclipse
regent with the pre-capstone gear and records the combat spans. The next tuning
pass should read those spans before changing numbers; the archived sample is
dominated by early rooms and one vault guardian.
