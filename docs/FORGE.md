# The forge

The Cold Forge turns zone materials and spare gear into better gear. It is the
first real sink for the coins and materials the exploration zones produce.

## Components

Forge components are abstract counts on the character, not world objects. They
survive logout, reset and restart.

| Set | Component |
| --- | --- |
| Ember Forge / Eclipse Court | Ember ore / Eclipse token |
| Fen Wardens | Wisp glass |
| Salt Wardens | Salt pearl |
| Moon Wardens | Moon petal |
| Ashen Hand | Ashen ash |
| Red Company | Red iron |
| Night Market | Night glass |

`components` (aliases `parts`, `materials`) lists the counts. `salvage <item>`
at the Cold Forge destroys a held gear piece and returns:

```
max(1, floor(value / 20)) + current plus
```

components of its set. Salvage refuses worn, wielded, quest and coin items.

## Upgrades

`upgrade <item>` at the Cold Forge raises a weapon or armour piece by one plus,
to a maximum of **+3**.

| Step | Components | Coins |
| --- | --- | --- |
| +1 | 2 | 20 |
| +2 | 4 | 40 |
| +3 | 6 | 60 |

The component type is the piece's set (or faction fallback). Coins are spent
largest-first like a shop purchase. An upgraded weapon adds `plus` to damage;
upgraded armour adds `plus` to armour. Upgraded gear keeps its plus through the
two-hour reset and a restart.

## Set bonuses

Gear pieces carry a `set` tag. While equipped (worn or wielded):

- **3 pieces** of the same set: +1 armour;
- **4 pieces** of the same set: +1 weapon damage as well.

`equipment` prints the active sets and totals. The bonuses stack across distinct
sets but not across duplicate pieces in one slot.

## Commands

```text
components
salvage a spare jerkin
upgrade my short sword
equipment
```

All three forge actions require the forge master at the Cold Forge (room 63).
The Gate covers cost scaling, salvage yield, component persistence, set
counting and the reducer's coin/component consumption.

## Why components are abstract

One object per scrap would clutter the inventory the project just made
readable. A character-level component count keeps the inventory clean while
still making salvage and upgrades real state. If crafting later needs physical
components, the same counts can be minted into objects without changing the
recipes.
