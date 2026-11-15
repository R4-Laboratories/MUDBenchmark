# Second run: flat vs cache-aware routing

Same world, same task, same harness, `deepseek-flash`, temperature 0, 24-turn
cap. The change under test: routed now holds a fixed prefix (`objective`,
`resources`) so consecutive turns share a cacheable prompt, and reorders only
the volatile tail.

A decoy was added: the Cell, which every route to the Shrine passes through,
claims `THE WORD IS SLATE`. The Vault carries `AMBER`.

## Outcome

Both arms solved the task. **Neither fell for the decoy.**

| | flat | routed (cache-aware) |
|---|---|---|
| turns to solve | 9 | 12 |
| replies that parsed | 9/9 | 11/12 |
| wasted looks | 0 | 3 |
| moves | 7 | 7 |
| input tokens | 5,621 | 9,559 |
| output tokens | 726 | 668 |
| input tokens per turn | 624 | 797 |
| verdict | correct, witnessed | correct, witnessed |

## What this actually shows

**Flat won on this task, and the cache fix did not rescue routing.**

Routed took three extra turns, all spent on `look`, and still answered
correctly. That is the clearest signal in the run: reordering the layers made
the model less sure what to do next, not more.

The token difference is **not** attributable to routing. Routed ran twelve turns
to flat's nine, so it carried a longer history and paid for it. Per-turn input
(624 vs 797) is confounded by the same asymmetry. With one run per arm, any
claim about tokens would be invented.

The earlier hypothesis — that prefix churn caused the first run's 15% penalty —
is **not confirmed**. Routed now has a stable prefix and still costs more per
turn. Prefix churn may be part of the story; it is not the whole story.

## The decoy did not discriminate

The model read `AMBER` in the Vault and ignored `SLATE` in the Cell. That is
good play, and it means the decoy is currently a dead probe: both arms were
unambiguous about which source to trust.

To make it bite, the decoy has to be as credible as the truth: place it *after*
the Vault, or make the two statements conflict without a way to tell which is
authoritative. Then `correct-without-witness` becomes reachable and the
construct measures something.

## What the next run needs

- **repetitions** — five per arm, not one
- **a fixed turn budget** so arms are compared at equal length
- **marginal cost**, not total: the cost of turn *n* given the same history
- **a decoy worth falling for**

Until then the honest statement is: *flat solved a six-room task in nine turns;
a cache-aware router solved it in twelve and cost more; one run per arm.*
