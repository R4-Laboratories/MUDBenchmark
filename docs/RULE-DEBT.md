# Rule debt: an audit

The ratchet carried three debt items after the pulse schedule was mechanized.
Before mechanizing them, each was checked against the running code. Two were not
debt, and one exposed a defect in the design rather than in the code.

## RD-1 — move legality: the check is vacuous

```js
const target = ROOMS[actor.room].exits[dir];
const verdict = await admit({ kind: 1, room: actor.room, origin: actor.room, destination: target });
```

`origin` is set to `actor.room` by the server. The model's rule is
`origin =? room`, so the witness is the conclusion. **The check cannot fail**,
and no client claim ever reaches it.

The rule itself is sound and would matter in a design where a client states
where it is — peer-to-peer, or a client-predicted world. With a server that owns
state and a protocol where `north` carries no claim, the rule is unreachable by
construction.

That is a finding about the design, not a mechanization task. Two ways to
restore the value: let a client state its room and check it, or drop the rule
from the app facet and stop implying it protects anything.

## RD-2 — fan-out: not duplicated, just small

`broadcast(room, text)` filters on `a.room === room`. The model's `Fanout.sees`
is the same equality. There is no second implementation to drift — only the same
rule written twice because it is one character long.

Mechanizing it would buy a cache of a 6×6 identity matrix at boot and no
protection. Removing it from the debt list is the honest call.

## RD-4 — identity restore: a different predicate

The server restores a returning actor's room and visited set from its identity
record. `Session.admissible` checks `phase =? 0` — a field that exists in the
model's `Session` structure and nowhere in the runtime.

These are not the same rule. Calling it debt implied a correspondence that does
not exist.

## What the audit actually found

Of the app facet's verified rules, **one is exercised in play**:

| Rule | Kind | State |
|---|---|---|
| clearance | 6 | used at boot, decides what a room shows |
| move | 1 | called, but the server supplies the witness — vacuous |
| transfer | 2 | no command reaches it |
| speak | 4 | no call reaches it |
| wait | 0 | no call reaches it |

So the model verifies five rules and the world runs one. The honest statement is
**"we proved the rules we could, and wired the one the game needs to show
information asymmetry"** — not "the world runs verified rules".

## The debt that replaced it

Not "rules implemented twice", but **rules proved and never asked**:

- transfer has a proved bound and no way to transfer anything
- speak and wait are admissible by definition and nothing calls them

That belongs in the ratchet as a number that may fall: `unusedRules`. Until it
does, the model's coverage overstates the game's behaviour.
