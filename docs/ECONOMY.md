# Economy

Money is physical. Coins are objects in the world, not a hidden wallet: a gold
coin is worth 10, a silver mark 5, and a copper coin 1. `coins` (aliases
`money`, `purse`) adds up what a character is carrying without changing it.

## Coins

| Coin | Value |
| --- | --- |
| copper coin | 1 |
| silver mark | 5 |
| gold coin | 10 |

A purchase selects carried coins largest-first until the price is covered. The
shop keeps the change; buying with a gold coin for a 3-coin item spends the
gold. Coins carried by a character are that character's gold: they are banked
on logout, death and graceful shutdown, minted back on login, and survive the
two-hour reset. Ephemeral coins on the floor are swept by the reset; fixed coin
stacks return to their home rooms.

Coins are ordinary objects, so they are dropped on death, can be given away,
and appear in `inventory` under the Coins group. This is the simplest system
that still makes a purse feel physical. A later wallet, bank or denomination
change would be a rule change, not a rename.

## Shops

| Shop | Room | Keeper |
| --- | --- | --- |
| The store | The Storeroom | the shopkeeper |
| The smithy | The Smithy | the smith |
| The Gilded Rat | The Gilded Rat | the innkeeper |
| The Ember Forge | The Cold Forge | the forge master |
| The Fen Wardens | The Green Heart | the heron keeper |
| The Salt Wardens | The Brine Hall | the tide hermit |
| The Moon Wardens | The Owl Grove | the silver owl |
| The Night Market | The Smuggler's Cache | the night broker |
| The Ashen Hand | The Reliquary | the ashen priest |
| The Red Company | The Fen Gate | the red captain |

`list` shows the stock in the room. `buy <thing>` spends coins; `sell <thing>`
pays half the object's `value`, rounded down. A shop will not buy coins, and it
will not buy a quest collectible: selling one could strand a character on a
line they cannot repeat. Valuable non-quest objects are the intended sale
goods.

## Food, ale and healing

Food and drink are consumables with `bites` and `heal`. Each use spends one
bite and restores that many hit points up to the maximum; the last bite removes
the object.

| Item | Price | Bites | Heal per bite |
| --- | --- | --- | --- |
| loaf of bread | 2 | 2 | 2 |
| bowl of stew | 2 | 1 | 3 |
| tankard of ale | 10 | 2 | 5 |

The tankard is sold at the Gilded Rat; the room detail `bar` points at it.
`eat` handles food, `drink` (alias `quaff`) handles drink. The innkeeper's
stew and the market bread remain the cheap options; ale is the reliable
mid-fight refill.

## Valuables

The world now carries sellable treasure that is not tied to a quest:

- **a gilded chalice** — the Smuggler's Cache, value 45.
- **an ivory figurine** — the Brine Hall, value 70.
- **a moonstone** — the Moonwell, value 90.

They are ordinary takeable objects. Their value is what a shop pays half of;
their purpose is to make exploration pay without adding another quest.

## Zone gear

The retired-quest zones now pay out through mobiles rather than checklists:

| Mobile | Zone | Drop |
| --- | --- | --- |
| the ember warden | Ember Deep | ember-forged gauntlets (hands, armour 2) |
| a bog hound | Hollow Fen | a fen mantle (cloak, armour 2) |
| a salt wraith | Salt Caves | salt-crusted bracers (hands, armour 2) |
| the moon stag | Moonlit Reach | moonlit greaves (feet, armour 2) |

Each also drops its existing trophy. The gear is ordinary takeable loot, can
be worn or sold at half value, and the two-hour reset returns it to its home
room. A player who takes the room copy first simply finds no duplicate on the
mobile.

### Faction quartermasters

Six faction contacts buy and sell like shops, but some stock is gated by
faction standing. The rotating world event takes 20% off the active faction's
quartermaster stock. `standing` (or `reputation` / `factions`) shows the six
values. A locked item appears in `list` with its faction and threshold;
`buy` refuses it until the character has earned enough standing by fighting
the zone's mobiles.

| Item | Slot | Armour/damage | Standing | Price |
| --- | --- | --- | --- | --- |
| an ember cloak | cloak | armour 3 | Ember 3 | 55 |
| an ember-forged blade | mainhand | damage 7 | Ember 6 | 80 |
| a fen-warden's cloak | cloak | armour 3 | Fen 6 | 75 |
| a salt-warden's shield | offhand | armour 3 | Salt 6 | 80 |
| a moon-blessed circlet | head | armour 3 | Moon 6 | 85 |
| an ashen hood | head | armour 1 | Ashen 3 | 50 |
| ashen boots | feet | armour 1 | Ashen 3 | 45 |
| a red company helm | head | armour 3 | Red 3 | 60 |
| red company gauntlets | hands | armour 1 | Red 3 | 50 |
| night market boots | feet | armour 1 | Night Market cutpurse | 45 |
| night market gloves | hands | armour 1 | Night Market cutpurse | 40 |
| an ashen robe | body | armour 2 | Ashen 3 | 60 |
| an unholy mace | mainhand | damage 4, Drain | Ashen 6 | 75 |
| a red company axe | mainhand | damage 6, Rage | Red 3 | 65 |
| red company boots | feet | armour 2 | Red 6 | 55 |

The world now has 256 objects. The pack holds 20 items (coins are separate); the Mistfall adds the ferry token, storm/wreck lanterns, captain's log, tide-stone, wayfarer's stone and wreck loot. The Deepdelve adds two mine lanterns, two canaries, a miner's pick, raw/sealed/deep ore, the surveyor's notes, a foreman's chest and map, and old coins. The Drowned Foundry adds two lanterns, a foundry hammer, a dark ingot, the foundry ledger, a heavy apron, cold coins and the master's core. The Flooded Monastery adds two lanterns, a small key, old coins, a ledger, a banded chest, the abbey clapper and a silver bell relic.

The second gear pass fills the thinner slots:

| Item | Slot | Armour | Source |
| --- | --- | --- | --- |
| an iron cuirass | body | 2 | the smithy, 18 coins |
| a small buckler | offhand | 1 | the smithy, 9 coins |
| the warden's shield | offhand | 3 | the warden |
| a mirror shield | offhand | 2 | the mirror-wraith |
| eclipse plate | body | 3 | the sundial knight |
| ember-tempered boots | feet | 2 | the cinder hound |
| a fen hood | head | 1 | the fen wisp |
| a salt-crusted hauberk | body | 2 | the brine crab |
| a moonstone circlet | head | 2 | the moon hare |
| a moon disc | offhand | 2 | the moon stag |

The world now has 120 objects. Body and offhand are no longer one-item slots.

## The forge

The Cold Forge (room 63) is the material sink. `salvage <item>` breaks a spare
gear piece into its set component; `upgrade <item>` spends components and
coins to raise a weapon or armour piece to **+3**. `components` shows the
counts. Three matching set pieces give +1 armour and four give +1 damage.
`docs/FORGE.md` records the recipes and salvage yield.

## Quest coins and sinks

The four starter quests pay physical coins as well as XP: First Steps 10, A
Curled Scroll 10, Bread for the Shop 5, and The True Word 10. Two starter
quests are enough to buy the short sword at the smithy.

A purchase, training fee or forge upgrade **consumes** the selected coins.
Payment never remains in the room for the buyer to pick up again. The shop
keeps any change because the selection is greedy, not exact.

## Reliquary sacrifice

The Chapel of Ash in the Grey Keep has a pale reliquary. `offer <treasure>` (or
`sacrifice <treasure>`) consumes a carried non-coin item worth at least 5 and
grants `floor(value / 2)` experience, capped at 100 XP per two-hour reset. Gold is not accepted, and the item is gone until the reset restores the world's treasure. It is a choice
between selling for coins, keeping a set piece, or turning a find into XP.

## What is not here

No bank, no player-to-player trade window beyond `give`, no weight or
encumbrance, and no auction. The physical-coin system is the baseline; the next
economy question should come from the play data, not from a feature list.
