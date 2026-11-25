# Experimental room cells

Rooms can opt into an authored cell layout in `world/data/world.json`.
Room 2 is the first example. `cells.grid` is a rectangular grid of `.` floor
and `#` wall, at most 32 by 32. Coordinates are `[x, y]`, increasing east
and south. `spawn` is the cell used by a join, recall, or teleport into that
room; `entries` maps a room exit to the cell used when entering through that
exit. Entries are optional: an unmodeled arrival has an unknown cell.

NPCs and ground objects may have an authored starting `cell`. Carried items
inherit the carrier's location; contained items inherit their container's.
Dropping places an item at the actor's cell, if known. Legacy saves and rooms
without layouts retain unknown positions rather than guessed coordinates.
Area resets restore authored NPC and object positions.

This only models positions. Existing commands still use room-level movement,
visibility, combat and interaction; entering a room remains immediate and
there is no in-room movement. The layout does not yet support MUD casting,
line of sight, target motion within rooms, or mana cells. It is not a claim
that these provisional authored dimensions represent an existing physical map.
