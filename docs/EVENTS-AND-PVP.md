# World events and the Ring ladder

Two systems that work without a crowd.

## The rotating event

Every two-hour reset advances the cycle. The event is derived from that cycle,
not stored separately:

| Cycle | Event | Faction |
| --- | --- | --- |
| 0 | The Ember Tide | Ember |
| 1 | The Fen Rising | Fen |
| 2 | The Salt Surge | Salt |
| 3 | The Moonrise | Moon |

While an event is active:

- kills for that faction award **double standing**;
- that faction's quartermaster takes **20% off** its stock;
- `world` and `GET /world` show the event name and text.

The event rotates automatically every reset. There is no signup and no quest.

## The Ring ladder

`duel <name>` at the Ring challenges another character. On acceptance both
sides engage; leaving forfeits and takes no goods.

A Ring death records:

- winner: +1 win, +16 rating
- loser: +1 loss, −16 rating, never below 0

The record lives on the identity and survives logout, reset and restart.
`ladder` (aliases `pvp`, `duels`) lists the top duelists; `duel` with no target
shows the character's own record.

The Ring is beneath the Docks. Duels are consensual: a challenge must be
accepted before either side can attack. Outside the Ring, the ordinary unsafe
room rules still apply.

## Why these two

The event gives a solo player a reason to revisit one zone each cycle, and the
discount makes the quartermaster loop matter. The ladder gives PvP a record
without requiring a crowd: a single duel produces a persistent result, and the
board fills in as more characters fight.
