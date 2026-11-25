# Room prose and the adaptive description plan

A room is not a signpost. The opening rooms are where a new player and a new
agent decide whether the world is worth learning. The first pass therefore
rewrote the **18 opening rooms** — the Atrium through the West Guest Room, and
the Harbor Quay through the Ring — with a scene, a few senses and more to
examine.

## What changed

- Each opening room now has at least **280 characters** of prose, **three**
  ambient lines and **two** examinable details. The Gate enforces that floor.
- The additions carry atmosphere and orientation, not new mechanics: the
  marble seams in the Atrium, the guttering lamp outside the Vault, the dog
  under the bread table, the crane chain at the docks.
- Existing exits, objects, NPCs, secrets and quest text are unchanged.

## What comes next: adaptive descriptions

The long-term goal is for a room to describe what that character can actually
see and what has changed:

- **Light**: a lit room shows colour and detail; the dark version is shorter
  and tactile.
- **Phase and weather**: the Atrium at dawn, in rain, or at night.
- **State**: the aftermath of a fight, a quest item taken, a door opened, a
  player or party present.
- **History**: a room remembers the last thing that happened there, within a
  bounded window.

The data path is already a `text` value that can be a string or a mode map.
The next pass should add `text` variants keyed by `light` and `phase`, then
let the renderer choose the variant from the actor's state. The Gate can then
check that every variant is non-empty and that at least one variant is
reachable. This release deliberately stops at the opening prosaic pass rather
than inventing a second rendering system before the first rooms are good.
