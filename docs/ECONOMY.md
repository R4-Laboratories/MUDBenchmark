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
gold. The reset sweeps up coin objects minted by a sale and returns the fixed
coin stacks to their home rooms.

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

## What is not here

No bank, no player-to-player trade window beyond `give`, no weight or
encumbrance, and no auction. The physical-coin system is the baseline; the next
economy question should come from the play data, not from a feature list.
