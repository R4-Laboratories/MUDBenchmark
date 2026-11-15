# Cross-session memory: first attempt

Three identities, two sessions each, same goal, `deepseek-flash`, flat router,
14-turn cap. Session 2 reconnects as the same identity, so the world restores its
room and its visited set.

## Result

| run | turns | solved | answers | overrides | tokens in |
|---|---|---|---|---|---|
| memory-1 session 1 | 12 | yes | AMBER, SLATE, AMBER | 1 | 12,152 |
| memory-1 session 2 | 14 | yes | AMBER | 0 | 18,435 |
| memory-2 session 1 | 14 | **no** | — | 0 | 18,973 |
| memory-2 session 2 | 11 | yes | AMBER, SLATE | 1 | 9,778 |
| memory-3 session 1 | 10 | yes | AMBER, SLATE | 1 | 8,441 |
| memory-3 session 2 | 27* | yes | AMBER | 0 | 36,625 |

\* contaminated — see below.

## This is not a result, and here is why

**One run is contaminated.** `memory-3 session 2` shows 27 turns against a
14-turn cap because the harness appended to an existing log: an earlier attempt
was killed by a timeout and its partial turns survived into the retry. That file
is two sessions wearing one name.

**Three pairs is not a sample.** The variance between runs of the *same*
identity (12 turns vs 14, 10 vs 27) is larger than any difference between first
and second visits.

**There is no mechanism by which the model should remember.** The world restores
its room and its visited set, but nothing tells the model it has been here
before. A restored room name is a hint at best; the visited set — the actual
knowledge — is invisible to it.

So the honest summary is: *the plumbing for cross-session memory exists and the
experiment is not yet capable of measuring it.*

## What was fixed

The harness now truncates its log on connect. Appending let a killed run's turns
leak into the next run under the same name, which is exactly how the
contaminated row happened.

## What a real attempt needs

1. **A recall layer.** The router already has a `persistence` layer for recent
   commands inside a session. Across sessions it must surface what the identity
   knows: rooms visited, the word it found, what it answered. Otherwise the
   experiment measures whether a model guesses that a room name implies history.
2. **Enough pairs** that variance within an identity is visible before variance
   between sessions is claimed.
3. **One session per file**, enforced by the truncate above.
