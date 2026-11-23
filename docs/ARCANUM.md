# The Arcanum — the Mages' tower

The Arcanum is the Mages' Guild's **21-room tower**: the one-room guild hall at
room 34 plus twenty rooms above it. It is a questless depth site, like the Grey
Keep, and adds no quest to the 20-quest budget.

The tower is built around the three utility spells a mage actually trains:
`light` for the dark rooms, `detect` for the rune wall, and `shield` for the
star-well ward. A character without those spells can still climb most of the
tower and meet its NPCs; the two secrets are the reward for the curriculum.

## Map

```text
Main climb:  34 -> 162 -> 163
North branch: 163 north -> 165 -> east 170 -> north 176 -> up 181
South branch: 163 south -> 166 -> east 171 =detect=> north 177 -> east 178 -> east 179 -> north 180 =shield=> east 181
Centre:      163 up -> 164
             164 east -> 168 -> up 174 -> west 175 -> up 180
             164 west -> 169 -> up 175
             164 up -> 167 -> up 172 -> north 178
             167 east -> 173 -> up 179
```

The two `=>` links are secret exits opened by the named spell. Every other
exit is ordinary and reciprocal. The routes loop: the high walk (178) joins the
sealed vault (172), the cold library (177), the orrery (179); the mirror room
(175) joins the aviary (174), the star stair (169) and the star well (180).


Every ordinary exit is reciprocal. The two secret exits are one-way doors that
open from the room they are hidden in; once through, the ordinary exit returns.

## Rooms

| Room | Name | Purpose |
| --- | --- | --- |
| 34 | The Mages' Guild | Archmage trainer, guild hall, stair to the tower |
| 162 | The Spiral Stair | First climb; lamps that burn without smoke |
| 163 | The Hall of Names | Plaques, the turning orrery, apprentice |
| 164 | The Lecture Hall | Tiered benches, lecturer, board of wards |
| 165 | The Scriptorium | Desks, scroll racks, a scroll of spark |
| 166 | The Lower Laboratory | Benches, cold furnace, silver reagent |
| 167 | The Upper Laboratory | Live furnace, copper coils, furnace golem |
| 168 | The Observatory | Brass telescope, star charts, astronomer |
| 169 | The Star Stair | **Dark**; narrow shaft to the mirror room |
| 170 | The Prism Chamber | Turning prism, white star mosaic |
| 171 | The Rune Gallery | **Detect** gate; carved eye and rune wall |
| 172 | The Sealed Vault | Silver-bound chest, guild seal |
| 173 | The Bellows | Great bellows, copper pipe, bellows golem |
| 174 | The Aviary | Broken dome, pale owls |
| 175 | The Mirror Room | Black mirror, mirror wraith, mirror shard |
| 176 | The Archivist's Study | Archivist, study chest, sealed codex |
| 177 | The Cold Library | **Dark**; frozen books, "On the Sealed Eye" |
| 178 | The High Walk | Gargoyles, open crown of the tower |
| 179 | The Orrery | Great brass orrery around a cracked sun |
| 180 | The Star Well | **Dark**; **shield** gate, star water, star wisp |
| 181 | The Prism Vault | **Dark**; prism keeper, the prism heart |

## Gates

### `read runes` — Detect (room 171)

The Rune Gallery's north wall is smooth except for a carved eye. A character
with `detect` in their spellbook can `read runes`: the eye opens and the north
wall becomes a door to **The Cold Library (177)**. Without the spell the action
is filtered from the room and refused server-side.

### `pass ward` — Shield (room 180)

The Star Well has a warded gap in its east wall. A character with `shield` can
`pass ward`: the ward meets the shield and opens onto **The Prism Vault (181)**.
The live check confirmed both discoveries are recorded as `171:north` and
`180:east` on the character.

### `light` — the dark rooms

The Star Stair (169), Cold Library (177), Star Well (180) and Prism Vault (181)
are dark. Without a lit light or the `light` spell, `look` shows the room name,
a dark line and exits only. This is the same rule as the Grey Keep's cellar and
crypt.

## People and treasure

- **a guild apprentice** (163) explains the Hall of Names and the rune gallery.
- **the grey lecturer** (164) explains wards and warns about the furnace golem.
- **the star astronomer** (168) points at the star chart and the aviary.
- **the archivist** (176) explains both routes into the sealed rooms.
- **a pale owl** (174) speaks in riddles about the mirror and the star well.
- **a furnace golem** (167), **the bellows golem** (173), **a mirror wraith**
  (175), **a stone gargoyle** (178), **a star wisp** (180) and **the prism
  keeper** (181) are optional fights.
- The **prism keeper** drops **the prism heart** (value 100). **The sealed guild
  seal** (40) is inside the silver-bound chest, **the sealed codex** (55) inside
  the study chest, and the **prism shard** (60), **star chart** (35), **star
  glass** (20), **mirror shard** (30), **frozen book** (25) and **flask of star
  water** (18, food) are room treasure.
- **a scroll of spark** (165) teaches `spark` through `study`/`recite`.

## Why this shape

The Arcanum is deliberately vertical and compact: one stair, one hall, then
branches that loop back through the crown. It gives the Mages' Guild the same
kind of place the Grey Keep gives the Wardens and the Night Market: somewhere
to use a trained skill on content that is not a quest, with treasure worth
selling or sacrificing and a short, readable map. The tower is 21 rooms against
the keep's 45 because it is a guild site, not a castle; the next deep site
should be a working mine, a shipwreck or a monastery rather than another tower.

## Verification

- `tools/gate.mjs` checks the 21-room zone, the stair and both secret exits,
  the four dark rooms, the study/seal chests, the prism keeper's loot, the two
  spell-gated actions, and a reducer test that `read-runes` records
  `171:north` for a character with `detect`.
- A live `/tmp/arcanum-live.mjs` walk from the guild hall cast `light`, climbed
  to the Rune Gallery, `read runes` opened the Cold Library, climbed the Star
  Stair and Mirror Room, and `pass ward` opened the Prism Vault. The character
  finished with `discovered: ["171:north", "180:east"]`, `light: true`, and the
  prism keeper and prism heart present in room 181.
