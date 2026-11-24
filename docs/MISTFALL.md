# The Mistfall — a dark island depth site

The Mistfall is a **14-room island** reached by ferry from the Harbor Quay. It is
the first zone built around the old AberMUD mechanics: a bought ferry token, a
dark wreck that needs a light, identical hold rooms that form a maze, a story
quest with a guardian, and a reusable teleport stone.

## Getting there

- Buy a **mistfall ferry token** (5 coins) and a **storm lantern** (7 coins) from
  the dockhand at **The Docks (31)**. The dockhand also sells lamp oil.
- Go west to **The Harbor Quay (30)** and `board ferry`. The token is consumed.
- The return ferry at **The Mistfall Landing (182)** is free.

The ferry is a **secret exit** on the Quay (`west`), revealed and used by the
room action. The Landing has an ordinary `east` return, so the map stays
reciprocal.

## Map

```text
Harbor Quay (30) --ferry--> Mistfall Landing (182)
                                   | north
                             Black Beach (183) --east--> Cliff Path (189)
                               | north                        | north / east
                         Wreck of the Salt Rose (184)     Cave Mouth (190)
                          | north        | east                | east
                     The Hold (185)   Cave Mouth (190)   Drowned Cave (191)
                          | west                               | east
                     The Hold (186)                       Tide Pool (192)
                          | west                               | east
                     The Hold (187)                       Grave Reef (195)
                          | south
                  Captain's Cabin (188)

Cliff Path (189) --east--> Ruined Light (193) --north--> Signal Room (194)
```

The three **Hold** rooms all have the same description, details and ambient
text. The way through is **north from the wreck, west, west, south**; every
other turn loops. The castaway on the beach and the wreck captain give the
order, and the agent's notebook can hold it.

## Light and darkness

The wreck, the three hold rooms, the captain's cabin, the cave mouth, the
drowned cave, the tide pool and the signal room are **dark**. Without a lit
light source the room shows only:

> It is dark. You can see only the faint outline of the exits.

Light the storm lantern with `light lantern`; `extinguish lantern` puts it out.
The wreck also contains a **wreck lantern** for a player who forgot to buy one.
The `light` spell works too.

## The Salt Rose quest

The lighthouse keeper at **The Lighthouse (32)** gives **The Salt Rose**
(level 2, repeatable each two-hour reset):

1. Enter the captain's cabin (188).
2. Recover the captain's log (188).
3. Defeat the tide guardian (191).
4. Bring the tide-stone (192) to the lighthouse keeper (32).

Reward: **180 XP and 30 coins**. The log explains the stone and the guardian;
the castaway explains the hold order and the need for a lamp.

## Treasure and special items

- **The tide-stone** (192, value 80) is the quest object.
- **A wayfarer's stone** (194, value 100): `use` it to return to the Harbor
  Quay. Three charges; the reset restores it. This is the first item-granted
  teleport.
- **A sailor's knife** (185, damage 4), **a tarred cloak** (186, armour 1),
  **a ship's biscuit** (187, food), **a sodden purse** (184, 12 coins),
  **a signal lens** (194), **a tide chart** (193) and **a drowned crown** (195).
- The **reef crab** at 195 and the **drowned sailor** at 184 are optional
  fights; the **tide guardian** is the quest target.

## Carry limit

Every character can hold **20 items** (coins are separate). `take`, `take from`,
`take all` and `buy` refuse when the pack is full; `inventory` shows
`Pack: x/20`. The island is deliberately loot-heavy: the player has to choose
what to carry, sell or leave.

## Combat

Movement is **blocked while engaged**. You can `attack`, use a `technique`,
heal/eat, or `flee`. Flee moves you to a random adjacent room, ends the fight,
and costs **10% of current XP**; a duel forfeit also loses 12 rating. It is a
last resort, not the default. The agent prompt shows `COMBAT:` with the enemy's
HP and tells it not to walk away.

## Why this shape

The island is easy to reach from the starting town, but it is not a corridor:
the ferry token, the dark wreck, the identical hold rooms, the guardian and the
carry limit all make the player commit. It is repeatable each reset, so it can
be replayed for the quest, the loot and the wayfarer stone. The next depth sites
should follow the same pattern: one clear route in, one mechanic that changes
how the player moves, one story thread, and a reason to come back.
