# Factions and standing

Four local factions replace the retired quest checklists in the exploration
zones. Standing is earned by fighting what lives there, not by accepting a
quest. It persists on the character and survives logout, reset and restart.

## The four

| Faction | Contact | Room | Zone |
| --- | --- | --- | --- |
| The Ember Forge | the forge master | 63 | Ember Deep |
| The Fen Wardens | the heron keeper | 80 | Hollow Fen |
| The Salt Wardens | the tide hermit | 83 | Salt Caves |
| The Moon Wardens | the silver owl | 88 | Moonlit Reach |
| The Ashen Hand | the ashen priest | 58 | The Reliquary |
| The Red Company | the red captain | 71 | Hollow Fen |

The contacts are not guilds. The Mages' Guild and the Wardens are social
institutions with ranks; these four are local standing tracks with
quartermasters. A character can hold all four standings at once.

## Earning standing

| Mobile | Faction | Standing |
| --- | --- | --- |
| the cinder hound | Ember | 1 |
| the ember warden | Ember | 2 |
| a bog hound | Fen | 1 |
| a fen wisp | Fen | 1 |
| a brine crab | Salt | 1 |
| a salt wraith | Salt | 2 |
| a moon hare | Moon | 1 |
| the moon stag | Moon | 2 |
| the choir moth | Ashen | 2 |
| the mirror-wraith | Ashen | 1 |
| the star hound | Red | 1 |
| the sundial knight | Red | 2 |
| the eclipse regent | Red | 3 |

A kill that raises standing emits a line and a `world.standing` span. The
two-hour reset brings the mobiles back, so the loop repeats without a quest.

## Ranks and thresholds

Every faction uses the same thresholds with its own names:

| Standing | Rank |
| --- | --- |
| 0 | outsider |
| 3 | first rank (spark / trailhand / tidewalker / moonwatcher) |
| 6 | second rank (forgefriend / fenfriend / saltfriend / moonfriend) |
| 10 | sworn (ember-sworn / fen-sworn / brine-sworn / moon-sworn) |

`standing` (aliases `reputation`, `factions`) prints every faction, its value,
its rank and the next threshold.

## Quartermasters

Each contact runs a small shop. Stock can carry a faction and minimum standing:

| Item | Slot | Armour/damage | Standing | Price |
| --- | --- | --- | --- | --- |
| an ember cloak | cloak | armour 3 | Ember 3 | 55 |
| an ember-forged blade | mainhand | damage 7 | Ember 6 | 80 |
| a fen-warden's cloak | cloak | armour 3 | Fen 6 | 75 |
| a salt-warden's shield | offhand | armour 3 | Salt 6 | 80 |
| a moon-blessed circlet | head | armour 3 | Moon 6 | 85 |

`list` shows the stock and marks locked items with the required faction and
standing. `buy` refuses a locked item even if the character has the coins. The
quartermaster items are the repeatable reward for clearing a zone's lair loop;
the ordinary zone drops remain the mid-tier gear.

## The rotating event

One faction is ascendant each two-hour cycle. Its kills award double standing
and its quartermaster stock is 20% off. `world` shows the current event; the
rotation and PvP ladder are in `docs/EVENTS-AND-PVP.md`.

## Why this exists

The live table is capped at 21 quests. Factions let the Ember Deep, Hollow Fen,
Salt Caves and Moonlit Reach stay worth returning to without adding another
checklist. The loop is: fight the zone, raise standing, unlock the quartermaster
stock, wear the gear into the next zone. No quest count is consumed.
