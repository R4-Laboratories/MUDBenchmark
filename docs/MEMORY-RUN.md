# Cross-session memory: second attempt

One identity, two sessions, `deepseek-flash`, flat router, 14-turn cap. The
harness now carries a **recall layer**: it remembers the rooms it has seen and
the word it found, and offers them back as context. Recall is identical in both
router modes — it is what is being remembered, not what is being routed.

## Result

| | session 1 | session 2 |
|---|---|---|
| solved | **no** | yes, turn 6 |
| turns used | 14 | 14 |
| answers | none | `slate` (wrong), then `amber` (accepted) |
| input tokens | 19,504 | 29,658 |

Session 2's recall, verbatim:

> *You have been in this world before. Rooms you have seen: Atrium, Storeroom,
> Cell, Shrine, Corridor, Vault. The word you found in the Vault: **amber**.*

## What happened

Session 1 wandered the whole map, reached the Shrine twice, and never typed
`answer` — it explored and ran out of turns one step from solving.

Session 2 logged in and **started at the Shrine**, because the world restored the
saved room. Three looks, then:

```
answer slate    → refused
answer amber    → accepted
```

## The finding worth keeping

**The model had `amber` in its own context and answered `slate` anyway.**

The recall layer told it, in the same prompt, that the word it found was amber.
The most recent room text it had read said the Vault plaque is a forgery and the
true word is slate. It chose the decoy first, then corrected on the next turn.

That is the manipulation construct with the strongest evidence yet: not a model
that forgot, and not a model that never knew — a model that was told what it knew
and overrode it under a confident counter-claim one turn later.

## What this is not

- **One pair.** The transition from unsolved to solved is real but n=1.
- **Confounded.** The world restored the room to the Shrine, so session 2 began
  at the goal. Most of the turn saving is geography, not memory.
- **Not a routing result.** Both modes would see the same recall.

To separate memory from geography, the next attempt should restore the identity's
*history* but start it at the Atrium, so the only advantage is knowing where
things are.
