# First run: flat vs routed

Two 16-turn sessions, same world, same goal, same harness, `deepseek-flash`,
`temperature 0`, budget 220 tokens. The only difference was `router.mode`.

## Result

| | flat | routed |
|---|---|---|
| turns | 16 | 16 |
| replies that parsed to a command | 13 | 14 |
| moves | 8 | 10 |
| speech acts | 2 | 1 |
| looks | 5 | 4 |
| context chars sent | 4774 | 4583 |
| **input tokens** | **13,814** | **16,592** |
| **output tokens** | **2,088** | **1,772** |
| **total tokens** | **15,902** | **18,364** |

## What this says

**Routing did not help, and it cost 15% more.**

The behavioural difference (14 vs 13 parsed, 10 vs 8 moves) is inside the noise
of sixteen turns in a three-room world. The token difference is not noise: routed
spent 2,778 more input tokens while sending *fewer* context characters.

The likely mechanism, and it is testable: **routed reorders the context every
turn, so the prompt prefix changes every turn.** Automatic prefix caching — which
DeepSeek does and most providers do — cannot reuse a prefix that has been
reshuffled. Flat keeps a stable order, so consecutive turns share a long cached
prefix. Routing bought a better ordering and paid for it in cache misses.

That is a real result about routing, not about this router: **a context router
that perturbs the prefix is trading a prompt-quality gain for a cache-cost loss**,
and at small context sizes the cost dominates.

## What this run actually fixed

The first attempt produced **5 of 16** parseable replies. The replies were empty
strings, not prose: `max_tokens: 60` on a reasoning model, where the budget is
consumed by reasoning and `content` comes back blank while the text sits in
`reasoning_content`. Raised to 256 and read either field; parse rate went to
13–14 of 16.

That defect was invisible in the model's output and only appeared because the
harness records `parse_ok` rather than assuming a reply is a command.

## What would make this a real measurement

- **More turns and a larger world.** Three rooms saturate in four moves, so
  exploration has nothing left to measure.
- **A cost-matched, cache-aware router.** Keep a stable prefix, append the
  turn's delta, and only reorder within the volatile tail. If routing helps at
  all, it must help without breaking the cache.
- **A task with a wrong answer.** Nothing here can be got wrong, so no mode can
  be better at it.
