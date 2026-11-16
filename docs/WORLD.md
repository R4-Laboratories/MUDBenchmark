# The world

Thirty-two rooms in five zones, arranged so a new player can walk out of the
Atrium and keep going. The Vault and Shrine remain exactly where the benchmark
expects them.

## Map

| Id | Room | Zone | Safe | Exits |
| --- | --- | --- | --- | --- |
| 1 | The Atrium | temple | yes | n 2, e 3, s 8 |
| 2 | The Corridor | temple | no | s 1, e 4 |
| 3 | The Storeroom | temple | yes | w 1, n 5 |
| 4 | The Vault | temple | no | w 2 |
| 5 | The Cell | temple | no | s 3, n 6 |
| 6 | The Shrine | temple | yes | s 5, n 7 |
| 7 | The Chancel | temple | yes | s 6 |
| 8 | Market Square | town | yes | n 1, e 9, w 10, s 11 |
| 9 | The Smithy | town | yes | w 8 |
| 10 | The Gilded Rat | town | yes | e 8, u 12, n 24 |
| 11 | The King's Road | town | no | n 8, s 15, e 16, w 17 |
| 12 | The Upstairs Landing | town | yes | d 10, e 13, w 14 |
| 13 | East Guest Room | town | yes | w 12 |
| 14 | West Guest Room | town | yes | e 12 |
| 15 | The Forest Edge | wilds | no | n 11, e 18, s 19 |
| 16 | The Old Well | wilds | no | w 11 |
| 17 | The Graveyard | wilds | no | e 11, s 21 |
| 18 | The Deep Forest | wilds | no | w 15, s 20 |
| 19 | The Riverbank | wilds | no | n 15, e 20 |
| 20 | The Abandoned Mill | wilds | no | w 19, n 18 |
| 21 | The Crypt Entrance | wilds | no | n 17, d 22 |
| 22 | The Crypt Hall | wilds | no | u 21, e 23 |
| 23 | The Ossuary | wilds | no | w 22 |
| 24 | The Guild Hall | town | yes | s 10 |
| 25 | The Undercroft | undercroft | no | up 5, e 26, s 27 |
| 26 | The Sewer Junction | undercroft | no | w 25, e 28 |
| 27 | The Flooded Passage | undercroft | no | n 25, e 29 |
| 28 | The Rat Warren | undercroft | no | w 26, n 29 |
| 29 | The Smuggler's Cache | undercroft | no | w 27, s 28 |
| 30 | The Harbor Quay | harbor | no | n 19, e 31 |
| 31 | The Docks | harbor | no | w 30, n 32 |
| 32 | The Lighthouse | harbor | no | s 31 |

Every exit has a way back. Every room has a long description, at least one
`details` entry for `look <thing>`, and at least one ambient line that shows on
a rotating basis.

## Zones

| Zone | Rooms | Who lives there |
| --- | --- | --- |
| temple | 1–7 | bard, rat, moth, guard, shopkeeper, vault guardian |
| town | 8–14, 24 | smith, innkeeper, market woman, guild clerk |
| wilds | 15–23 | boar, wolf, ghoul |
| undercroft | 25–29 | sewer rat, smuggler |
| harbor | 30–32 | dockhand, lighthouse keeper |

A wandering mobile filters its exits to rooms in its own zone, so the boar stays
in the wilds and the market stays a market. Aggression is skipped in safe rooms.
Unsafe rooms say `Contested ground: players may attack here.`; safe rooms say
`This is a safe place.`

## Shops

| Shop | Room | Keeper | Stock |
| --- | --- | --- | --- |
| store | 3 | shopkeeper | brass lamp, pitch torch |
| smithy | 9 | smith | short sword, leather jerkin, tin lantern |
| inn | 10 | innkeeper | bowl of stew |

`list` shows the room's stock and prices; `buy` pays in coin objects and keeps
the change; `sell` pays half value; the two-hour reset returns unsold stock.

## Quests

| Quest | Level | Objective |
| --- | --- | --- |
| A Curled Scroll | 1 | carry the scroll from the Corridor |
| Bread for the Shop | 1 | deliver a loaf to the shopkeeper |
| The Well Key | 1 | carry the brass key out of the old well |
| The Boar at the Edge | 1 | defeat the wild boar |
| The True Word | 1 | enter the Vault, answer at the Shrine |
| The Vault Guardian | 2 | defeat the stone figure |
| The Crypt Ghoul | 3 | defeat the ghoul |
| The Smuggler's Cache | 3 | defeat the smuggler |
| The Lighthouse Lens | 2 | carry the brass telescope |

## Login

A connection is a guest until it authenticates. The welcome banner offers
`register <name> <password>` and `login <name> <password>`; every gameplay
command before sign-in is refused with the same sentence. `help` is the only
other thing a guest can ask for. Registering shows the room; logging in starts
at the Atrium with the character's level, XP, guild and quests.

## Items

- An item in a room stays in that room. An item in a container stays in the
  container. An item held by a player is in their hand.
- Logout drops everything held in the room where the character stands.
- Death drops everything held in the room where the character falls, and wakes
  them at the Atrium with their progress intact.
- A restart does not respawn items. `heldRoom` records where a carried item was
  last known, so even a crash drops it in that room rather than at its home.
- Only the two-hour reset returns every object to its home, closes containers,
  restocks shops and revives mobiles.
- Eaten and sold objects stay gone until the reset.

## What is next

Instanced guild halls, dialogue for the town NPCs, more quest content, and the
memory-backed agent bridge. The map is built so new rooms can be added without
moving the Vault or the Shrine.
