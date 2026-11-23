# The Grey Keep

The Grey Keep is the first **questless depth slice**: a 45-room border
fortress at the King's Road, built to be worked through for keys, treasure,
food, light and a way back. It does not add a quest, so the 20-quest budget is
unchanged.

## Map

```text
King's Road (11) — Grey Road (117) — Forest Edge (15)
                         |
                    Iron Gate (118) ——— Weeping Bailey (119)
                    |  secret north       | north/east/south/down
               Servant Passage (125)  Hall (122) / Stables (120) / Barracks (121) / Well (152)
                 /       |       \          |             |             |
          Cellar (124) Chapel (126) Servants (141)  Solar (127)  Kennel (154)  Armory (150)
             |           |             |               |              |            |
        Dungeon (130) Crypt (146)  Laundry (142)   Tower Stair (128) Cistern (153) Smithy (151)
             |           |             |               |              |            |
          Vault (131) Ossuary (147) Servants' Hall (143) Tower Top (129) Hayloft (155)
                         | secret east      |                                |
                    Sealed Room (160)  Stillroom (144) — Back Stair (145) — Gate Roof (156)
                                                                              |
                                                                         Watch (149/157)

Upper floor: Hall (122) -> Long Gallery (132) -> North Chamber (133) / South Chamber (134) /
Nursery (135) / Library (136) / Map Room (137); Solar (127) -> Balcony (138) -> Study (159);
Library -> High Hall (158) -> Study.
```


The Gate checks the full 45-room graph; every exit is reciprocal.

## Keys and shortcuts

- **Iron postern key** is in the banded strongbox in the Guard Barracks (121).
  `unlock postern` at the Iron Gate reveals the north shortcut to the Servant
  Passage.
- **A Night Market runner** can `pick postern` instead; the action is filtered
  from everyone else and refused server-side if the guild or rank is wrong.
- **A Warden scout** can `track <name>` (or `seek`) to list matching mobiles,
  objects and containers with the room that holds them. This is how the keep
  rewards a second guild's active skill.
- The **library cabinet** in the Library (136) holds the star chart; the
  **sealed room** is behind the cracked ossuary wall (147).
- **Black vault key** is in the dark iron chest in the Solar (127).
  `unlock vault` at the Dungeon (130) reveals the east door to the Vault (131).

## Light and dark

The Cellar (124), Tower Stair (128), Vault (131), Crypt (146), Ossuary (147),
Well (152), Cistern (153), Sealed Room (160) and Tower Cell (161) are **dark**.
Without a lit light or the `light` spell, `look` shows only the room name, a
dark line and the exits. A lit lantern or torch, or `cast light`, reveals the usual description,
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
`floor(value / 2)` experience, capped at **100 XP per two-hour reset**. The
item is gone; the reset restores world treasure. Gold is not accepted. This is
a choice between selling for coins, keeping a set piece, or turning it into
experience.

## What comes next

The first slice is now **45 rooms**: gate/bailey, upper floor, library and map
room, servants' wing, crypt and sealed room, gate roof, armory, smithy, well,
cistern, kennel and hayloft. The Mages' tower is now the second deep guild
site (`docs/ARCANUM.md`, 21 rooms); the next content step is not more rooms in
either place but another site — the working mine, the shipwreck or the
monastery — and folding the tiny one-to-five-room zones into larger places
rather than multiplying zone labels.
