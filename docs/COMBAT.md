# Combat

Combat is a duel of clocks. The violence pulse fires every twelve ticks — three
seconds — and resolves one round for each engagement. The tick and the
attacker's id seed every roll, so a replay fights the same fight.

## One round

1. **Hit chance** is `57 - armour`, never below 5. A d100 roll at or above the
   chance is a miss; a miss is a `world.combat` span with `outcome: "miss"` and
   damage 0, not silence.
2. **Damage** for a character is `1..4 + weapon.damage`. Unarmed is `1..4`.
   A mobile's `Damage` is its whole blow (`1..Damage`), not a bonus.
3. **Armour** is the sum of worn items with `armor`; a jerkin is 1.
4. **Both sides swing.** Attacking starts an engagement in each direction, so
   a mob or player fights back on the same pulse. Fleeing removes both.
5. **Death.** A mobile dies, is removed from the room and revives at the
   two-hour reset. A character drops everything they carry in the room they
   fell in, wakes at the start at full health, and keeps level, XP, guild and
   quests. The killer gains experience.

## Aggression

A mobile with `aggression` above 0 may begin a fight when its own clock comes
round and a character is in the room. The roll is out of 100; the victim is
engaged back. Safe rooms are exempt. The Vault guardian is the first mobile to
use it.

## Weapons, armour and food

| Thing | Field | Effect |
| --- | --- | --- |
| weapon | `flags: ["weapon"], damage` | adds to the character's damage while wielded |
| armour | `flags: ["wearable","armor"], armor` | subtracts from the attacker's hit chance |
| food | `flags: ["food"], bites, heal` | each bite restores `heal` hit points up to the maximum |

`wield <weapon>`, `unwield`, `wear <armour>`, `remove`, `eat <food>`.
Dropping, giving or storing a weapon lowers it; the reset lowers every weapon.

## Flee

`flee` chooses an exit from the current room, removes every engagement the
actor is in, and moves. It is deterministic from the tick and the room, and is
recorded as `world.flee` with the direction and the rooms. A room with no exit
refuses with `There is nowhere to flee.`

## Levels

`world/data/levels.json` is the experience table: `[0, 100, 300, ...]`. A kill
awards the mobile's `xp`, or a tenth of a player victim's level. Reaching a
threshold raises the level, increases maximum hit points by 2, heals, and
announces. Level and XP are on the identity and survive logout, reset and
restart; items do not.

`score` shows level, XP to the next level, hit points, armour, weapon and guild.

## The Ring and open PvP

The Ring beneath the Docks is an arena. `duel <name>` challenges; `duel accept`
starts a two-way engagement, `duel decline` refuses, and leaving forfeits. An
arena death takes no goods. Every other unsafe room is open PvP: attacking a
player is allowed, and death drops everything held where they fell.

## Safe rooms and PvP

An attack in a safe room is refused; a fight that reaches one is cleared.
`attack <player>` is allowed in unsafe rooms. The target is engaged back and
can flee, fight or die. Death drops their things where they fell and wakes them
at the start.

## Spans and the dataset

| Span | Fields |
| --- | --- |
| `world.combat` | `actor.id`, `target.id`, `weapon.id`, `chance`, `damage`, `target.hp`, `outcome` (`hit`/`miss`/`killed`/`died`), `room.id` |
| `world.flee` | `actor.id`, `direction`, `room.from`, `room.to` |
| `world.object` | `action.kind` `wield`/`unwield` |

`tools/dataset.mjs` turns these into `combat`, `flee` and `object` rows. A miss
is as much an observation as a hit: it says the attacker swung and the world
said no.

## Not here yet

Armour slots and encumbrance, weapon speed, criticals, spells, death penalties
beyond dropping, and quest objectives that count kills. Those arrive with the
quest and world phases; the round and the spans are the stable part.
