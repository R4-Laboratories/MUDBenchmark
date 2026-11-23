# The Grey Keep

The Grey Keep is the first **questless depth slice**: a 15-room border fortress
at the King's Road, built to be worked through for keys, treasure, food, light
and a way back. It does not add a quest, so the 20-quest budget is unchanged.

## Map

```text
King's Road (11) — The Grey Road (117) — Forest Edge (15)
                         |
                    The Iron Gate (118) ——— The Weeping Bailey (119)
                         | secret north              north/east/south
                    Servant Passage (125)      Hall (122) / Stables (120) / Barracks (121)
                      /          \                   |
             Cellar (124)     Chapel (126)       Solar (127)
              |     \             |                  |
        Dungeon (130) \          Hall (122)       Tower Stair (128)
              | secret east                          |
           Vault (131)                           Tower Top (129)
```

The full walkable graph is checked by the Gate; every exit is reciprocal.

## Keys and shortcuts

- **Iron postern key** is in the banded strongbox in the Guard Barracks (121).
  `unlock postern` at the Iron Gate reveals the north shortcut to the Servant
  Passage.
- **A Night Market runner** can `pick postern` instead; the action is filtered
  from everyone else and refused server-side if the guild or rank is wrong.
- **Black vault key** is in the dark iron chest in the Solar (127).
  `unlock vault` at the Dungeon (130) reveals the east door to the Vault (131).

## Light and dark

The Cellar (124), Tower Stair (128) and Vault (131) are **dark**. Without a lit
light or the `light` spell, `look` shows only the room name, a dark line and the
exits. A lit lantern or torch, or `cast light`, reveals the usual description,
objects and mobiles. The lantern is in the Iron Gate; the kitchen has a torch.

## Food and gear

The kitchen has stew and bread (healing), the barracks has a spear and helm,
the hall a shield, and the solar a mail shirt. The captain on the tower top is
the optional level-6 fight; the vault hound guards the crown. The keep is aimed
at roughly level 4–6; the gate guard will attack a character who lingers.

## Reliquary

The Chapel of Ash (126) is safe and contains the pale reliquary. In the chapel:

```text
offer <treasure>
```

The reliquary consumes a carried non-coin item worth at least 5 and grants
`floor(value / 2)` experience. The item is gone; the two-hour reset restores
world treasure. Gold is not accepted. This is a choice between selling for
coins, keeping a set piece, or turning it into experience.

## What comes next

This is the **shell**, not the finished 45–50 room castle. The next fill adds
the upper floors, the roof, the servants' wing and the sealed crypt, then tests
the full loop from the King's Road to the vault and back. The same pattern can
become the working mine, the shipwreck and the monastery; the tiny zones should
eventually be folded into larger places rather than multiplied.
